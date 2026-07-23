#!/usr/bin/env python3
"""Claude Code hook -> writes each session's state to ~/.claude/status/<id>.json.

Usage (via settings.json):  status.py <waiting|running|idle|end>
Reads the hook payload from stdin (JSON with session_id, cwd, message,
notification_type, tool_name, tool_input, transcript_path). "end" deletes the
session file. Also captures the tty and TERM_PROGRAM so the widget can focus
the right terminal, plus the last assistant message and token usage from the
transcript.
"""
import json
import os
import pathlib
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import notch_ipc

TAIL_BYTES = 131072
MESSAGE_LIMIT = 280

status = sys.argv[1] if len(sys.argv) > 1 else "waiting"

try:
    data = json.load(sys.stdin)
except Exception:
    data = {}

sid = data.get("session_id", "unknown")
status_dir = pathlib.Path.home() / ".claude" / "status"
status_dir.mkdir(parents=True, exist_ok=True)
status_file = status_dir / f"{sid}.json"

if status == "end":
    status_file.unlink(missing_ok=True)
    sys.exit(0)

previous = {}
try:
    previous = json.loads(status_file.read_text())
except Exception:
    pass


def controlling_tty():
    """tty of the terminal controlling this session (e.g. /dev/ttys003)."""
    try:
        fd = os.open("/dev/tty", os.O_RDONLY)
        try:
            return os.ttyname(fd)
        finally:
            os.close(fd)
    except Exception:
        return ""


def term_program():
    """Cursor is a VS Code fork and also reports TERM_PROGRAM=vscode; tell them
    apart by the host app bundle id so the widget focuses the right app."""
    program = os.environ.get("TERM_PROGRAM", "")
    bundle = os.environ.get("__CFBundleIdentifier", "").lower()
    is_cursor = program == "vscode" and "cursor" in bundle
    return "cursor" if is_cursor else program


def tool_summary():
    """One-line description of the current tool call (PreToolUse/PostToolUse)."""
    tool = data.get("tool_name", "")
    if not tool:
        return ""
    tool_input = data.get("tool_input") or {}
    detail = (
        tool_input.get("command")
        or tool_input.get("file_path")
        or tool_input.get("path")
        or tool_input.get("pattern")
        or ""
    )
    detail = " ".join(str(detail).split())[:120]
    return f"{tool} · {detail}" if detail else tool


TOOL_INPUT_LIMIT = 49152


def bounded_tool_input():
    """Full tool_input for the popover; dropped when huge (giant Write)."""
    tool_input = data.get("tool_input")
    if tool_input is None:
        return None
    try:
        small = len(json.dumps(tool_input)) <= TOOL_INPUT_LIMIT
    except Exception:
        return None
    return tool_input if small else None


def transcript_tail(path):
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - TAIL_BYTES))
            return f.read().decode("utf-8", "ignore").splitlines()
    except Exception:
        return []


def last_assistant_info(path):
    """(last text message, current context tokens, usage-limit message) from the
    transcript tail. The limit only counts when it is the newest assistant
    entry, so old errors stop flagging once the session moves on."""
    text, context, limit, newest_seen = "", 0, "", False
    for line in reversed(transcript_tail(path)):
        try:
            entry = json.loads(line)
        except Exception:
            continue
        if entry.get("type") != "assistant":
            continue
        message = entry.get("message") or {}
        usage = message.get("usage") or {}
        context = context or (
            usage.get("input_tokens", 0)
            + usage.get("cache_read_input_tokens", 0)
            + usage.get("cache_creation_input_tokens", 0)
        )
        parts = [
            c.get("text", "")
            for c in (message.get("content") or [])
            if isinstance(c, dict) and c.get("type") == "text"
        ]
        joined = " ".join(" ".join(parts).split())[:MESSAGE_LIMIT]
        if not newest_seen:
            newest_seen = True
            is_limit = entry.get("isApiErrorMessage") and "limit reached" in joined.lower()
            if is_limit:
                # Claude Code may append "|<epoch>" to the limit text; drop it.
                # Skip so last_message keeps pointing at the real reply below.
                limit = joined.split("|")[0].strip()
                continue
        text = text or joined
        if text and context:
            break
    return text, context, limit


def total_output_tokens(path):
    """Sum of output tokens across the whole transcript. O(file), so only
    computed on low-frequency events (waiting/idle); preserved otherwise."""
    total = 0
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            for line in f:
                if '"output_tokens"' not in line:
                    continue
                try:
                    entry = json.loads(line)
                except Exception:
                    continue
                usage = (entry.get("message") or {}).get("usage") or {}
                total += usage.get("output_tokens", 0)
    except Exception:
        pass
    return total


transcript_path = data.get("transcript_path", "") or previous.get("transcript_path", "")
last_message, context_tokens, limit_message = last_assistant_info(transcript_path)
compute_totals = status in ("waiting", "idle")

notch_ipc.write_status(status_file, {
    "status": status,
    "provider": "claude",
    "started_at": previous.get("started_at") or time.time(),
    "project": os.path.basename(data.get("cwd", "")),
    "cwd": data.get("cwd", ""),
    "message": data.get("message", ""),
    # The Notification hook has no tool payload; keep the tool captured by
    # PreToolUse so the popover can show which action is asking for permission.
    "tool": tool_summary() or (previous.get("tool", "") if status == "waiting" else ""),
    "tool_name": data.get("tool_name", "") or (previous.get("tool_name", "") if status == "waiting" else ""),
    "tool_input": bounded_tool_input() or (previous.get("tool_input") if status == "waiting" else None),
    "type": data.get("notification_type", ""),
    "tty": controlling_tty() or previous.get("tty", ""),
    "term_program": term_program() or previous.get("term_program", ""),
    "transcript_path": transcript_path,
    "last_message": last_message or previous.get("last_message", ""),
    "limit_message": limit_message,
    "context_tokens": context_tokens or previous.get("context_tokens", 0),
    "output_tokens": total_output_tokens(transcript_path) if compute_totals else previous.get("output_tokens", 0),
    "ts": time.time(),
})
