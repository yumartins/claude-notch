#!/usr/bin/env python3
"""Codex CLI hook -> writes the session's state to ~/.claude-notch/status.

Registered (via the app's integration installer) for SessionStart,
UserPromptSubmit, PreToolUse, PostToolUse and Stop in ~/.codex/hooks.json.
The event name comes in the payload's hook_event_name, so a single entry
command covers every event.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import notch_ipc

EVENT_STATUS = {
    "SessionStart": "idle",
    "UserPromptSubmit": "running",
    "PreToolUse": "running",
    "PostToolUse": "running",
    "Stop": "waiting",
}


def controlling_tty():
    try:
        fd = os.open("/dev/tty", os.O_RDONLY)
        try:
            return os.ttyname(fd)
        finally:
            os.close(fd)
    except Exception:
        return ""


def tool_summary(data):
    tool = data.get("tool_name", "")
    if not tool:
        return ""
    tool_input = data.get("tool_input") or {}
    detail = " ".join(str(tool_input.get("command", "")).split())[:120]
    return f"{tool} · {detail}" if detail else tool


try:
    data = json.load(sys.stdin)
except Exception:
    data = {}

event = data.get("hook_event_name", "")
status = EVENT_STATUS.get(event)
if status is None:
    sys.exit(0)

sid = data.get("session_id", "unknown")
status_file = notch_ipc.STATUS_DIR / f"codex-{sid}.json"
previous = notch_ipc.read_status(status_file)
is_stop = event == "Stop"

notch_ipc.write_status(status_file, {
    "status": status,
    "provider": "codex",
    "started_at": previous.get("started_at") or time.time(),
    "project": os.path.basename(data.get("cwd", "")),
    "cwd": data.get("cwd", ""),
    "message": "",
    "tool": "" if is_stop else tool_summary(data) or previous.get("tool", ""),
    "tool_name": data.get("tool_name", ""),
    "tool_input": data.get("tool_input"),
    "type": "idle_prompt" if is_stop else "",
    "tty": controlling_tty() or previous.get("tty", ""),
    "term_program": os.environ.get("TERM_PROGRAM", "") or previous.get("term_program", ""),
    "transcript_path": data.get("transcript_path") or previous.get("transcript_path", ""),
    "last_message": data.get("last_assistant_message") or previous.get("last_message", ""),
    "limit_message": "",
    "context_tokens": previous.get("context_tokens", 0),
    "output_tokens": previous.get("output_tokens", 0),
    "ts": time.time(),
})
