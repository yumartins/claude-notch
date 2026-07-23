"""Shared helpers for claude-notch hook scripts: status files and the app socket.

The socket round-trip is fail-open by contract: if the app is not running or
answers nothing, hooks must exit quickly without output so no agent ever blocks.

Deployed alongside the hook scripts in ~/.claude-notch/hooks so they can import
it with a plain `import notch_ipc`.
"""
import json
import pathlib
import socket

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
    status_file.parent.mkdir(parents=True, exist_ok=True)
    status_file.write_text(json.dumps(payload))


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
