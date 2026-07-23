#!/usr/bin/env python3
"""Codex CLI PermissionRequest hook -> real approval via the app socket.

Codex's PermissionRequest contract matches Claude's (same decision JSON, same
fail-open semantics), so the shared gate handles both. The status file mirrors
codex-status.py's naming (codex-<session_id>) so the app shows one row.
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
session_id = f"codex-{sid}"
status_file = notch_ipc.STATUS_DIR / f"{session_id}.json"
notch_ipc.gate_permission("codex", session_id, status_file, data, RESPONSE_TIMEOUT)
