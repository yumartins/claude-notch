#!/usr/bin/env python3
"""Claude Code PermissionRequest hook -> real approval via the app socket.

Blocks while the notch shows the approval card. Answers with the documented
PermissionRequest decision JSON on allow/deny; stays silent on passthrough or
when the app is unreachable, so the normal terminal prompt appears (fail-open).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import notch_ipc

RESPONSE_TIMEOUT = 560.0

try:
    data = json.load(sys.stdin)
except Exception:
    data = {}

sid = data.get("session_id", "unknown")
status_file = notch_ipc.NOTCH_DIR.parent / ".claude" / "status" / f"{sid}.json"
notch_ipc.gate_permission("claude", sid, status_file, data, RESPONSE_TIMEOUT)
