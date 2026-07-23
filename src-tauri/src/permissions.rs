//! Permission approval over a local unix socket: agent hook -> unix socket ->
//! app shows the prompt -> decision flows back to the blocked hook. Fail-open
//! by contract: hooks give up fast when the app is unreachable and a timeout
//! resolves to passthrough, so the agent's own prompt always remains available.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::Duration;
use std::{fs, thread};
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

/// One permission request forwarded by a provider hook over the unix socket,
/// waiting for the user's decision in the popover.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct PendingPermission {
    pub request_id: String,
    pub provider: String,
    pub session_id: String,
    pub tool_name: String,
    pub tool_input: serde_json::Value,
    pub cwd: String,
    pub project: String,
    pub ts: f64,
}

#[derive(Default)]
pub struct PendingPermissions(pub Mutex<HashMap<String, (PendingPermission, mpsc::Sender<String>)>>);

pub const DECISION_PASSTHROUGH: &str = "passthrough";
const VALID_DECISIONS: [&str; 3] = ["allow", "deny", DECISION_PASSTHROUGH];

/// Hooks block on this wait; each python script waits slightly longer, so the
/// app always answers first. Cursor gets a shorter window because a blocked
/// editor is more disruptive than a delayed terminal prompt.
const CLAUDE_WAIT: Duration = Duration::from_secs(540);
const CURSOR_WAIT: Duration = Duration::from_secs(180);

static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);

pub fn is_valid_decision(decision: &str) -> bool {
    VALID_DECISIONS.contains(&decision)
}

pub fn wait_for_provider(provider: &str) -> Duration {
    match provider {
        "cursor" => CURSOR_WAIT,
        _ => CLAUDE_WAIT,
    }
}

/// One request line from a hook -> PendingPermission (without an id yet).
pub fn parse_request(line: &str) -> Option<PendingPermission> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("kind").and_then(|x| x.as_str()) != Some("permission_request") {
        return None;
    }
    let get = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let session_id = get("session_id");
    if session_id.is_empty() {
        return None;
    }
    Some(PendingPermission {
        request_id: String::new(),
        provider: get("provider"),
        session_id,
        tool_name: get("tool_name"),
        tool_input: v.get("tool_input").cloned().unwrap_or(serde_json::Value::Null),
        cwd: get("cwd"),
        project: get("project"),
        ts: crate::now_epoch(),
    })
}

pub fn socket_path() -> std::path::PathBuf {
    crate::notch_dir().join("notch.sock")
}

pub fn spawn_server(app: tauri::AppHandle) {
    thread::spawn(move || {
        let dir = crate::notch_dir();
        let _ = fs::create_dir_all(&dir);
        let path = socket_path();
        let _ = fs::remove_file(&path);
        let Ok(listener) = UnixListener::bind(&path) else {
            return;
        };
        for stream in listener.incoming().flatten() {
            let handle = app.clone();
            thread::spawn(move || handle_connection(handle, stream));
        }
    });
}

fn notify_request(app: &tauri::AppHandle, request: &PendingPermission) {
    let enabled = app
        .try_state::<Mutex<crate::AppSettings>>()
        .map(|state| state.lock().unwrap().notifications_enabled)
        .unwrap_or(true);
    if !enabled {
        return;
    }
    let _ = app
        .notification()
        .builder()
        .title(format!("{} requests permission", request.project))
        .body(request.tool_name.clone())
        .show();
}

fn handle_connection(app: tauri::AppHandle, stream: UnixStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(clone) => clone,
        Err(_) => return,
    });
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() {
        return;
    }
    let Some(mut request) = parse_request(&line) else {
        return;
    };
    request.request_id = REQUEST_COUNTER.fetch_add(1, Ordering::SeqCst).to_string();

    let (tx, rx) = mpsc::channel::<String>();
    let state = app.state::<PendingPermissions>();
    state
        .0
        .lock()
        .unwrap()
        .insert(request.request_id.clone(), (request.clone(), tx));
    let _ = app.emit("permission_request", &request);
    notify_request(&app, &request);

    let decision = rx
        .recv_timeout(wait_for_provider(&request.provider))
        .unwrap_or_else(|_| DECISION_PASSTHROUGH.to_string());

    state.0.lock().unwrap().remove(&request.request_id);
    let _ = app.emit("permission_resolved", &request.request_id);

    let mut stream = stream;
    let _ = writeln!(stream, "{}", serde_json::json!({ "decision": decision }));
}

#[tauri::command]
pub fn resolve_permission(
    state: tauri::State<PendingPermissions>,
    request_id: String,
    decision: String,
) -> Result<(), String> {
    if !is_valid_decision(&decision) {
        return Err("invalid decision".into());
    }
    let map = state.0.lock().unwrap();
    let Some((_, tx)) = map.get(&request_id) else {
        return Err("permission request not found".into());
    };
    tx.send(decision).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pending_permissions(state: tauri::State<PendingPermissions>) -> Vec<PendingPermission> {
    let mut pending: Vec<PendingPermission> = state
        .0
        .lock()
        .unwrap()
        .values()
        .map(|(request, _)| request.clone())
        .collect();
    pending.sort_by(|a, b| a.ts.partial_cmp(&b.ts).unwrap_or(std::cmp::Ordering::Equal));
    pending
}

#[cfg(test)]
mod tests {
    use super::{is_valid_decision, parse_request, wait_for_provider};
    use std::time::Duration;

    #[test]
    fn requests_are_parsed_from_socket_lines() {
        let line = r#"{"kind":"permission_request","provider":"cursor","session_id":"cursor-1","tool_name":"Shell","tool_input":{"command":"git push"},"cwd":"/tmp/demo","project":"demo"}"#;
        let request = parse_request(line).unwrap();
        assert_eq!(request.provider, "cursor");
        assert_eq!(request.session_id, "cursor-1");
        assert_eq!(request.tool_name, "Shell");
        assert_eq!(request.tool_input["command"], "git push");
        assert_eq!(request.project, "demo");
    }

    #[test]
    fn non_permission_lines_are_rejected() {
        assert!(parse_request("not json").is_none());
        assert!(parse_request(r#"{"kind":"other","session_id":"x"}"#).is_none());
        assert!(parse_request(r#"{"kind":"permission_request"}"#).is_none());
    }

    #[test]
    fn cursor_waits_less_than_terminal_providers() {
        assert_eq!(wait_for_provider("cursor"), Duration::from_secs(180));
        assert_eq!(wait_for_provider("claude"), Duration::from_secs(540));
        assert_eq!(wait_for_provider("codex"), Duration::from_secs(540));
    }

    #[test]
    fn only_protocol_decisions_are_accepted() {
        assert!(is_valid_decision("allow"));
        assert!(is_valid_decision("deny"));
        assert!(is_valid_decision("passthrough"));
        assert!(!is_valid_decision("maybe"));
    }
}
