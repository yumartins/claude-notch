"""Shared helpers for claude-notch hook scripts: status files and the app socket.

The socket round-trip is fail-open by contract: if the app is not running or
answers nothing, hooks must exit quickly without output so no agent ever blocks.

Deployed alongside the hook scripts in ~/.claude-notch/hooks so they can import
it with a plain `import notch_ipc`.
"""
import json
import os
import pathlib
import socket
import tempfile
import time

CONNECT_TIMEOUT = 0.25

NOTCH_DIR = pathlib.Path.home() / ".claude-notch"
SOCKET_PATH = NOTCH_DIR / "notch.sock"
STATUS_DIR = NOTCH_DIR / "status"


def read_status(status_file):
    try:
        return json.loads(status_file.read_text())
    except Exception:
        return {}


def write_status(status_file, payload):
    """Atomic write: agents fire status hooks in rapid bursts (PreToolUse,
    PostToolUse, Stop), so two processes race on the same file. A plain write
    interleaves them into corrupt JSON; a temp file + os.replace makes every
    reader see one complete version or the other, never a torn one."""
    status_file.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(status_file.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(json.dumps(payload))
        os.replace(tmp, status_file)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def request_decision(request, response_timeout):
    """Round-trip a permission request to the app. Returns "allow", "deny",
    "passthrough", or None when the app is unreachable (fail-open)."""
    try:
        conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        conn.settimeout(CONNECT_TIMEOUT)
        conn.connect(str(SOCKET_PATH))
    except Exception:
        return None
    try:
        conn.settimeout(response_timeout)
        conn.sendall((json.dumps(request) + "\n").encode())
        buffer = b""
        while b"\n" not in buffer:
            chunk = conn.recv(65536)
            if not chunk:
                return None
            buffer += chunk
        line = buffer.split(b"\n", 1)[0]
        decision = json.loads(line).get("decision", "")
        return decision if decision in ("allow", "deny", "passthrough") else None
    except Exception:
        return None
    finally:
        conn.close()


def _tool_summary(data):
    tool = data.get("tool_name", "")
    tool_input = data.get("tool_input") or {}
    detail = tool_input.get("command") or tool_input.get("file_path") or tool_input.get("path") or ""
    detail = " ".join(str(detail).split())[:120]
    return f"{tool} · {detail}" if detail else tool


def gate_permission(provider, session_id, status_file, data, response_timeout):
    """Shared PermissionRequest flow for Claude and Codex, whose hook contracts
    are identical: block while the app shows the approval card, then answer with
    the documented decision JSON. Stays silent on passthrough or an unreachable
    app so the agent's own terminal prompt appears (fail-open)."""
    previous = read_status(status_file)

    def write(status):
        state = dict(previous)
        state.update({
            "status": status,
            "provider": provider,
            "started_at": previous.get("started_at") or time.time(),
            "project": os.path.basename(data.get("cwd", "")) or previous.get("project", ""),
            "cwd": data.get("cwd", "") or previous.get("cwd", ""),
            "tool": _tool_summary(data),
            "tool_name": data.get("tool_name", ""),
            "tool_input": data.get("tool_input"),
            "type": "permission_prompt" if status == "waiting" else "",
            "ts": time.time(),
        })
        write_status(status_file, state)

    write("waiting")
    decision = request_decision({
        "kind": "permission_request",
        "provider": provider,
        "session_id": session_id,
        "tool_name": data.get("tool_name", ""),
        "tool_input": data.get("tool_input"),
        "cwd": data.get("cwd", ""),
        "project": os.path.basename(data.get("cwd", "")),
    }, response_timeout)

    if decision is None:
        write("running")
        return
    if decision == "passthrough":
        return
    write("running")
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PermissionRequest",
            "decision": {"behavior": decision},
        },
    }))
