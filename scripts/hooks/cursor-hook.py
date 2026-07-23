#!/usr/bin/env python3
"""Cursor hook -> status files plus real approval via the claude-notch socket.

Registered (via the app's integration installer) in ~/.cursor/hooks.json for
beforeSubmitPrompt, afterFileEdit, stop, beforeShellExecution and
beforeMCPExecution. Gating events block on the app socket and answer Cursor
with {"permission": allow|deny|ask}; when the app is unreachable the hook
stays silent so Cursor keeps its default behavior (fail-open).
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import notch_ipc

RESPONSE_TIMEOUT = 200.0

STATUS_EVENTS = {
    "beforeSubmitPrompt": "running",
    "afterFileEdit": "running",
    "stop": "waiting",
}
GATING_EVENTS = ("beforeShellExecution", "beforeMCPExecution")
# The app resolves passthrough into Cursor's own in-editor prompt.
DECISION_PERMISSION = {"allow": "allow", "deny": "deny", "passthrough": "ask"}


def gating_tool(data):
    if data.get("hook_event_name") == "beforeShellExecution":
        return "Shell", {"command": data.get("command", "")}
    return data.get("tool_name", "MCP"), data.get("arguments") or {}


def tool_summary(tool_name, tool_input):
    detail = " ".join(str(tool_input.get("command", "")).split())[:120]
    return f"{tool_name} · {detail}" if detail else tool_name


def write_state(status_file, previous, data, patch):
    cwd = (data.get("workspace_roots") or [""])[0]
    state = {
        "status": "running",
        "provider": "cursor",
        "started_at": previous.get("started_at") or time.time(),
        "project": os.path.basename(cwd),
        "cwd": cwd,
        "message": "",
        "tool": previous.get("tool", ""),
        "tool_name": previous.get("tool_name", ""),
        "tool_input": None,
        "type": "",
        "tty": "",
        # Cursor hooks run outside a terminal; "cursor" makes focus_session
        # activate the Cursor app.
        "term_program": "cursor",
        "transcript_path": "",
        "last_message": previous.get("last_message", ""),
        "limit_message": "",
        "context_tokens": 0,
        "output_tokens": 0,
        "ts": time.time(),
    }
    state.update(patch)
    notch_ipc.write_status(status_file, state)


try:
    data = json.load(sys.stdin)
except Exception:
    data = {}

event = data.get("hook_event_name", "")
sid = f"cursor-{data.get('conversation_id', 'unknown')}"
status_file = notch_ipc.STATUS_DIR / f"{sid}.json"
previous = notch_ipc.read_status(status_file)

if event in STATUS_EVENTS:
    is_stop = event == "stop"
    is_edit = event == "afterFileEdit"
    tool = f"Edit · {data.get('file_path', '')}" if is_edit else ""
    write_state(status_file, previous, data, {
        "status": STATUS_EVENTS[event],
        "type": "idle_prompt" if is_stop else "",
        "tool": tool if is_edit else "",
        "tool_name": "Edit" if is_edit else "",
    })
    sys.exit(0)

if event not in GATING_EVENTS:
    sys.exit(0)

tool_name, tool_input = gating_tool(data)
summary = tool_summary(tool_name, tool_input)
write_state(status_file, previous, data, {
    "status": "waiting",
    "type": "permission_prompt",
    "tool": summary,
    "tool_name": tool_name,
    "tool_input": tool_input,
})

decision = notch_ipc.request_decision({
    "kind": "permission_request",
    "provider": "cursor",
    "session_id": sid,
    "tool_name": tool_name,
    "tool_input": tool_input,
    "cwd": (data.get("workspace_roots") or [""])[0],
    "project": os.path.basename((data.get("workspace_roots") or [""])[0]),
}, RESPONSE_TIMEOUT)

if decision is None:
    # App unreachable: leave Cursor's default flow untouched, keep the row
    # informative instead of stuck on a phantom permission prompt.
    write_state(status_file, previous, data, {"tool": summary, "tool_name": tool_name})
    sys.exit(0)

if decision in ("allow", "deny"):
    write_state(status_file, previous, data, {"tool": summary, "tool_name": tool_name})

print(json.dumps({"permission": DECISION_PERMISSION[decision]}))
