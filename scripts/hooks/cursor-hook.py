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

GATING_EVENTS = ("beforeShellExecution", "beforeMCPExecution")
# The app resolves passthrough into Cursor's own in-editor prompt.
DECISION_PERMISSION = {"allow": "allow", "deny": "deny", "passthrough": "ask"}

TRANSCRIPT_DIR = notch_ipc.NOTCH_DIR / "transcripts"


def gating_tool(data):
    if data.get("hook_event_name") == "beforeShellExecution":
        return "Shell", {"command": data.get("command", "")}
    return data.get("tool_name", "MCP"), data.get("arguments") or {}


def tool_summary(tool_name, tool_input):
    detail = " ".join(str(tool_input.get("command", "")).split())[:120]
    return f"{tool_name} · {detail}" if detail else tool_name


def suggest_rule(tool_name, tool_input):
    # Mirror of suggestRule in src/lib/rules.ts: the app writes rules in this
    # exact form, so the two must agree token-for-token.
    if not tool_name:
        return None
    command = str((tool_input or {}).get("command", "")).strip()
    if not command:
        return tool_name
    tokens = command.split()
    if len(tokens) == 1:
        return f"{tool_name}({command})"
    return f"{tool_name}({tokens[0]} {tokens[1]}:*)"


def is_pre_approved(cwd, tool_name, tool_input):
    rule = suggest_rule(tool_name, tool_input)
    if not rule:
        return False
    rules = notch_ipc.read_status(notch_ipc.NOTCH_DIR / "rules.json")
    return rule in (rules.get(cwd) or [])


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
        "transcript_path": str(transcript_file),
        "last_message": previous.get("last_message", ""),
        "limit_message": "",
        "context_tokens": 0,
        "output_tokens": 0,
        "ts": time.time(),
    }
    state.update(patch)
    notch_ipc.write_status(status_file, state)


def append_transcript(entry):
    # ponytail: append-only, one file per conversation_id; the app tail-reads a
    # capped window, so growth never matters. Old conversations' files linger.
    try:
        TRANSCRIPT_DIR.mkdir(parents=True, exist_ok=True)
        with open(transcript_file, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        pass


def user_turn(text):
    return {"type": "user", "message": {"content": text}}


def assistant_text(text):
    return {"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}}


def assistant_tool(name, tool_input):
    return {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": name, "input": tool_input}]}}


try:
    data = json.load(sys.stdin)
except Exception:
    data = {}

event = data.get("hook_event_name", "")
# sessionEnd keys the conversation as session_id; every other event uses
# conversation_id. Accept either so the whole lifecycle maps to one file.
conversation = data.get("conversation_id") or data.get("session_id") or "unknown"
sid = f"cursor-{conversation}"
status_file = notch_ipc.STATUS_DIR / f"{sid}.json"
transcript_file = TRANSCRIPT_DIR / f"{sid}.jsonl"
previous = notch_ipc.read_status(status_file)

if event == "sessionEnd":
    # Conversation closed: drop the row instead of leaving it "waiting" until
    # it goes stale.
    status_file.unlink(missing_ok=True)
    transcript_file.unlink(missing_ok=True)
    sys.exit(0)

if event == "beforeSubmitPrompt":
    append_transcript(user_turn(data.get("prompt", "")))
    write_state(status_file, previous, data, {"status": "running"})
    sys.exit(0)

if event == "afterFileEdit":
    path = data.get("file_path", "")
    append_transcript(assistant_tool("Edit", {"file_path": path}))
    write_state(status_file, previous, data, {
        "status": "running", "tool": f"Edit · {path}", "tool_name": "Edit",
    })
    sys.exit(0)

if event == "afterAgentResponse":
    text = data.get("text", "")
    append_transcript(assistant_text(text))
    write_state(status_file, previous, data, {"status": "running", "last_message": text})
    sys.exit(0)

if event == "stop":
    write_state(status_file, previous, data, {"status": "waiting", "type": "idle_prompt"})
    sys.exit(0)

if event not in GATING_EVENTS:
    sys.exit(0)

tool_name, tool_input = gating_tool(data)
summary = tool_summary(tool_name, tool_input)
cwd = (data.get("workspace_roots") or [""])[0]
append_transcript(assistant_tool(tool_name, tool_input))

if is_pre_approved(cwd, tool_name, tool_input):
    # "Always allow" grant: approve without prompting or hitting the app.
    write_state(status_file, previous, data, {"tool": summary, "tool_name": tool_name})
    print(json.dumps({"permission": "allow"}))
    sys.exit(0)

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
    "cwd": cwd,
    "project": os.path.basename(cwd),
}, RESPONSE_TIMEOUT)

if decision is None:
    # App unreachable: leave Cursor's default flow untouched, keep the row
    # informative instead of stuck on a phantom permission prompt.
    write_state(status_file, previous, data, {"tool": summary, "tool_name": tool_name})
    sys.exit(0)

if decision in ("allow", "deny"):
    write_state(status_file, previous, data, {"tool": summary, "tool_name": tool_name})

print(json.dumps({"permission": DECISION_PERMISSION[decision]}))
