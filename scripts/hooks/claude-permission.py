#!/usr/bin/env python3
"""Claude Code PermissionRequest hook -> real approval via the app socket.

Blocks while the notch shows the approval card. Answers with the documented
PermissionRequest decision JSON on allow/deny; stays silent on passthrough or
when the app is unreachable, so the normal terminal prompt appears (fail-open).
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import notch_ipc

RESPONSE_TIMEOUT = 560.0

try:
    data = json.load(sys.stdin)
except Exception:
    data = {}

sid = data.get("session_id", "unknown")
status_file = notch_ipc.NOTCH_DIR.parent / ".claude" / "status" / f"{sid}.json"
previous = notch_ipc.read_status(status_file)


def tool_summary():
    tool = data.get("tool_name", "")
    tool_input = data.get("tool_input") or {}
    detail = (
        tool_input.get("command")
        or tool_input.get("file_path")
        or tool_input.get("path")
        or ""
    )
    detail = " ".join(str(detail).split())[:120]
    return f"{tool} · {detail}" if detail else tool


def write_status(status):
    state = dict(previous)
    state.update({
        "status": status,
        "provider": "claude",
        "started_at": previous.get("started_at") or time.time(),
        "project": os.path.basename(data.get("cwd", "")) or previous.get("project", ""),
        "cwd": data.get("cwd", "") or previous.get("cwd", ""),
        "tool": tool_summary(),
        "tool_name": data.get("tool_name", ""),
        "tool_input": data.get("tool_input"),
        "type": "permission_prompt" if status == "waiting" else "",
        "ts": time.time(),
    })
    notch_ipc.write_status(status_file, state)


write_status("waiting")

decision = notch_ipc.request_decision({
    "kind": "permission_request",
    "provider": "claude",
    "session_id": sid,
    "tool_name": data.get("tool_name", ""),
    "tool_input": data.get("tool_input"),
    "cwd": data.get("cwd", ""),
    "project": os.path.basename(data.get("cwd", "")),
}, RESPONSE_TIMEOUT)

if decision is None:
    # App unreachable: undo the phantom prompt and let Claude Code prompt
    # normally in the terminal.
    write_status("running")
    sys.exit(0)

if decision == "passthrough":
    sys.exit(0)

write_status("running")
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PermissionRequest",
        "decision": {"behavior": decision},
    },
}))
