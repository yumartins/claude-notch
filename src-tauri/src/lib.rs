use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use std::{fs, path::PathBuf, thread, time::Duration};
use tauri::image::Image;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_positioner::{Position, WindowExt};

const TRAY_IDLE: &[u8] = include_bytes!("../icons/tray.png");
const TRAY_ACTIVE: &[u8] = include_bytes!("../icons/tray-active.png");
const POLL_INTERVAL: Duration = Duration::from_millis(1500);
const MAX_RECENTS: usize = 8;
const TYPE_CLAUDE_SCRIPT: &str = r#"delay 1.2
tell application "System Events" to keystroke "claude"
tell application "System Events" to key code 36"#;

/// One Claude Code session, derived from a ~/.claude/status/<session_id>.json file.
#[derive(Serialize, Clone)]
struct Session {
    session_id: String,
    project: String,
    cwd: String,
    status: String,
    message: String,
    tool: String,
    tool_name: String,
    tool_input: serde_json::Value,
    #[serde(rename = "type")]
    kind: String,
    tty: String,
    term_program: String,
    last_message: String,
    limit_message: String,
    context_tokens: u64,
    output_tokens: u64,
    ts: f64,
}

#[derive(Serialize)]
struct AppStats {
    memory_mb: f64,
    cpu_percent: f64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
struct AppSettings {
    shortcut: String,
    launcher_terminal: String,
    notifications_enabled: bool,
    stale_hours: f64,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            shortcut: "cmd+alt+c".into(),
            launcher_terminal: "Warp".into(),
            notifications_enabled: true,
            stale_hours: 2.0,
        }
    }
}

fn status_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home).join(".claude").join("status")
}

fn config_file(app: &tauri::AppHandle, name: &str) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    let _ = fs::create_dir_all(&dir);
    Some(dir.join(name))
}

fn load_settings(app: &tauri::AppHandle) -> AppSettings {
    config_file(app, "settings.json")
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_settings(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = config_file(app, "settings.json").ok_or("config dir unavailable")?;
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

fn load_recents(app: &tauri::AppHandle) -> Vec<String> {
    config_file(app, "recents.json")
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn remember_recent(app: &tauri::AppHandle, path: &str) {
    if path.is_empty() {
        return;
    }
    let mut recents = load_recents(app);
    recents.retain(|p| p != path);
    recents.insert(0, path.to_string());
    recents.truncate(MAX_RECENTS);
    let Some(file) = config_file(app, "recents.json") else {
        return;
    };
    let Ok(text) = serde_json::to_string_pretty(&recents) else {
        return;
    };
    let _ = fs::write(file, text);
}

fn is_stale(ts: f64, now: f64, stale_secs: f64) -> bool {
    ts <= 0.0 || now - ts > stale_secs
}

fn now_epoch() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

/// Read every status file and turn it into a Session. Missing/garbage/stale
/// files are skipped.
fn read_sessions(stale_secs: f64) -> Vec<Session> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(status_dir()) else {
        return out;
    };
    let now = now_epoch();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        let ts = v.get("ts").and_then(|x| x.as_f64()).unwrap_or(0.0);
        if is_stale(ts, now, stale_secs) {
            continue;
        }
        let session_id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let get = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
        let get_u64 = |k: &str| v.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
        out.push(Session {
            session_id,
            project: get("project"),
            cwd: get("cwd"),
            status: get("status"),
            message: get("message"),
            tool: get("tool"),
            tool_name: get("tool_name"),
            tool_input: v.get("tool_input").cloned().unwrap_or(serde_json::Value::Null),
            kind: get("type"),
            tty: get("tty"),
            term_program: get("term_program"),
            last_message: get("last_message"),
            limit_message: get("limit_message"),
            context_tokens: get_u64("context_tokens"),
            output_tokens: get_u64("output_tokens"),
            ts,
        });
    }
    out
}

fn read_session_file(session_id: &str) -> Option<serde_json::Value> {
    let text = fs::read_to_string(status_dir().join(format!("{session_id}.json"))).ok()?;
    serde_json::from_str(&text).ok()
}

const TRANSCRIPT_TAIL_BYTES: usize = 131_072;

/// Raw tail of the session transcript; the frontend parses the jsonl.
#[tauri::command]
async fn read_transcript_tail(session_id: String) -> Result<String, String> {
    let v = read_session_file(&session_id).ok_or("sessão não encontrada")?;
    let path = v
        .get("transcript_path")
        .and_then(|x| x.as_str())
        .unwrap_or("");
    if path.is_empty() {
        return Err("transcript indisponível".into());
    }
    let data = fs::read(path).map_err(|e| e.to_string())?;
    let start = data.len().saturating_sub(TRANSCRIPT_TAIL_BYTES);
    Ok(String::from_utf8_lossy(&data[start..]).into_owned())
}

#[derive(Serialize, Clone, Default, PartialEq, Debug)]
struct UsageBucket {
    day: String,
    project: String,
    model: String,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_creation_tokens: u64,
}

struct UsageEntry {
    bucket: UsageBucket,
    message_id: String,
}

/// One transcript line -> usage entry. Only assistant entries with usage count.
fn parse_usage_entry(line: &str) -> Option<UsageEntry> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("type").and_then(|x| x.as_str()) != Some("assistant") {
        return None;
    }
    let message = v.get("message")?;
    let usage = message.get("usage")?;
    let tok = |k: &str| usage.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
    let day = v
        .get("timestamp")
        .and_then(|x| x.as_str())
        .filter(|t| t.len() >= 10)?[..10]
        .to_string();
    let project = v
        .get("cwd")
        .and_then(|x| x.as_str())
        .and_then(|c| c.rsplit('/').next())
        .unwrap_or("")
        .to_string();
    let model = message
        .get("model")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let message_id = message
        .get("id")
        .and_then(|x| x.as_str())
        .or_else(|| v.get("uuid").and_then(|x| x.as_str()))
        .unwrap_or("")
        .to_string();
    Some(UsageEntry {
        bucket: UsageBucket {
            day,
            project,
            model,
            input_tokens: tok("input_tokens"),
            output_tokens: tok("output_tokens"),
            cache_read_tokens: tok("cache_read_input_tokens"),
            cache_creation_tokens: tok("cache_creation_input_tokens"),
        },
        message_id,
    })
}

/// Streaming writes several transcript entries per API call sharing message.id
/// with the same usage; count each API call once.
fn aggregate_usage(lines: impl Iterator<Item = String>) -> Vec<UsageBucket> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut buckets: std::collections::HashMap<(String, String, String), UsageBucket> =
        std::collections::HashMap::new();
    for line in lines {
        if !line.contains("\"output_tokens\"") {
            continue;
        }
        let Some(entry) = parse_usage_entry(&line) else {
            continue;
        };
        if !entry.message_id.is_empty() && !seen.insert(entry.message_id) {
            continue;
        }
        let b = entry.bucket;
        let key = (b.day.clone(), b.project.clone(), b.model.clone());
        let agg = buckets.entry(key).or_insert_with(|| UsageBucket {
            day: b.day.clone(),
            project: b.project.clone(),
            model: b.model.clone(),
            ..Default::default()
        });
        agg.input_tokens += b.input_tokens;
        agg.output_tokens += b.output_tokens;
        agg.cache_read_tokens += b.cache_read_tokens;
        agg.cache_creation_tokens += b.cache_creation_tokens;
    }
    let mut out: Vec<UsageBucket> = buckets.into_values().collect();
    out.sort_by(|a, b| (&a.day, &a.project, &a.model).cmp(&(&b.day, &b.project, &b.model)));
    out
}

/// Token usage aggregated per (day, project, model) from every transcript
/// modified in the last `days` days.
#[tauri::command]
async fn usage_stats(days: u64) -> Vec<UsageBucket> {
    let home = std::env::var("HOME").unwrap_or_default();
    let projects = PathBuf::from(home).join(".claude").join("projects");
    let cutoff = SystemTime::now() - Duration::from_secs(days * 86_400);
    let mut lines: Vec<String> = Vec::new();
    let Ok(dirs) = fs::read_dir(projects) else {
        return Vec::new();
    };
    for dir in dirs.flatten() {
        let Ok(files) = fs::read_dir(dir.path()) else {
            continue;
        };
        for file in files.flatten() {
            let path = file.path();
            let is_jsonl = path.extension().and_then(|e| e.to_str()) == Some("jsonl");
            let recent = file
                .metadata()
                .and_then(|m| m.modified())
                .map(|m| m >= cutoff)
                .unwrap_or(false);
            if !is_jsonl || !recent {
                continue;
            }
            let Ok(text) = fs::read_to_string(&path) else {
                continue;
            };
            lines.extend(
                text.lines()
                    .filter(|l| l.contains("\"output_tokens\""))
                    .map(String::from),
            );
        }
    }
    aggregate_usage(lines.into_iter())
}

/// tty strings are simple (/dev/ttys003); strip anything not path-safe before
/// interpolating into AppleScript.
fn sanitize_tty(tty: &str) -> String {
    tty.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '/')
        .collect()
}

/// Cursor, Windsurf, and VSCodium all report TERM_PROGRAM=vscode; resolve to
/// whichever fork is actually installed.
const VSCODE_FORKS: &[&str] = &["Visual Studio Code", "Cursor", "Windsurf", "VSCodium"];

fn vscode_app_name(app_installed: impl Fn(&str) -> bool) -> &'static str {
    VSCODE_FORKS
        .iter()
        .copied()
        .find(|app| app_installed(app))
        .unwrap_or("Visual Studio Code")
}

fn app_installed(name: &str) -> bool {
    PathBuf::from("/Applications")
        .join(format!("{name}.app"))
        .exists()
}

/// AppleScript that brings the terminal owning this session to the front.
/// Matches the exact tab/pane by tty on Terminal.app and iTerm2; falls back
/// to just activating the app elsewhere.
fn focus_script(term: &str, tty: &str) -> Result<String, String> {
    match term {
        "Apple_Terminal" => Ok(format!(
            r#"tell application "Terminal"
  activate
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "{tty}" then
        set selected of t to true
        set index of w to 1
      end if
    end repeat
  end repeat
end tell"#
        )),
        "iTerm.app" => Ok(format!(
            r#"tell application "iTerm2"
  activate
  repeat with w in windows
    repeat with tb in tabs of w
      repeat with s in sessions of tb
        if tty of s is "{tty}" then
          select s
          select tb
        end if
      end repeat
    end repeat
  end repeat
end tell"#
        )),
        other => {
            let app = match other {
                "vscode" => vscode_app_name(app_installed),
                "cursor" => "Cursor",
                "Hyper" => "Hyper",
                "WarpTerminal" => "Warp",
                "ghostty" => "Ghostty",
                "WezTerm" => "WezTerm",
                "kitty" => "kitty",
                "Tabby" => "Tabby",
                "alacritty" => "Alacritty",
                _ => "",
            };
            match app.is_empty() {
                true => Err(format!("terminal não suportado: {other}")),
                false => Ok(format!(r#"tell application "{app}" to activate"#)),
            }
        }
    }
}

// ponytail: hardcoded fallback; the launcher terminal setting covers new
// sessions, this covers focusing sessions with unknown TERM_PROGRAM
const FALLBACK_TERM_PROGRAM: &str = "WarpTerminal";

fn session_focus_script(session_id: &str) -> Result<String, String> {
    let v = read_session_file(session_id).ok_or("sessão não encontrada")?;
    let tty = sanitize_tty(v.get("tty").and_then(|x| x.as_str()).unwrap_or(""));
    let term = v.get("term_program").and_then(|x| x.as_str()).unwrap_or("");
    focus_script(term, &tty).or_else(|_| focus_script(FALLBACK_TERM_PROGRAM, &tty))
}

fn run_osascript(script: &str) -> Result<(), String> {
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| e.to_string())?;
    match output.status.success() {
        true => Ok(()),
        false => Err(String::from_utf8_lossy(&output.stderr).trim().to_string()),
    }
}

#[tauri::command]
fn focus_session(session_id: String) -> Result<(), String> {
    let script = session_focus_script(&session_id)?;
    run_osascript(&script)
}

/// Answers the pending permission prompt by focusing the session's terminal and
/// sending the keystroke Claude Code expects ("1" = approve, Esc = dismiss).
/// Needs the macOS Accessibility permission (System Events keystrokes).
#[tauri::command]
fn respond_session(session_id: String, approve: bool) -> Result<(), String> {
    let focus = session_focus_script(&session_id)?;
    let key = match approve {
        true => r#"keystroke "1""#,
        false => "key code 53",
    };
    // ponytail: fixed delay for the terminal to take focus; enough in practice
    let script = format!("{focus}\ndelay 0.4\ntell application \"System Events\" to {key}");
    run_osascript(&script)
}

/// Inserts a rule into permissions.allow, creating the structure as needed.
/// Returns false when the rule was already present.
fn add_rule_to_settings(root: &mut serde_json::Value, rule: &str) -> bool {
    let base = root.as_object_mut().expect("settings root must be an object");
    let permissions = base
        .entry("permissions")
        .or_insert_with(|| serde_json::json!({}));
    let allow = permissions
        .as_object_mut()
        .map(|p| p.entry("allow").or_insert_with(|| serde_json::json!([])))
        .and_then(|a| a.as_array_mut());
    let Some(allow) = allow else {
        return false;
    };
    let exists = allow.iter().any(|r| r.as_str() == Some(rule));
    if exists {
        return false;
    }
    allow.push(serde_json::Value::String(rule.to_string()));
    true
}

/// "Always allow": appends the rule to the project's .claude/settings.local.json,
/// the file Claude Code uses for the user's per-project permission grants.
#[tauri::command]
fn add_permission_rule(cwd: String, rule: String) -> Result<(), String> {
    if cwd.is_empty() || rule.is_empty() {
        return Err("projeto ou regra ausente".into());
    }
    let dir = PathBuf::from(&cwd).join(".claude");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("settings.local.json");
    let mut root: serde_json::Value = fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| serde_json::json!({}));
    add_rule_to_settings(&mut root, &rule);
    let text = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

fn applescript_escape(text: &str) -> String {
    text.replace('\\', "\\\\").replace('"', "\\\"")
}

fn is_awaiting_permission(session_id: &str) -> bool {
    read_session_file(session_id)
        .map(|v| {
            let get = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
            get("status") == "waiting" && get("type") == "permission_prompt"
        })
        .unwrap_or(false)
}

/// Types an instruction into the session's terminal. A pending permission
/// prompt is dismissed first (Esc) so the text lands in the input box.
#[tauri::command]
fn send_text(session_id: String, text: String) -> Result<(), String> {
    let clean: String = text.replace(['\n', '\r'], " ");
    if clean.trim().is_empty() {
        return Err("mensagem vazia".into());
    }
    let focus = session_focus_script(&session_id)?;
    let dismiss = match is_awaiting_permission(&session_id) {
        true => "key code 53\ndelay 0.4\n",
        false => "",
    };
    let escaped = applescript_escape(&clean);
    let script = format!(
        "{focus}\ndelay 0.4\ntell application \"System Events\"\n{dismiss}keystroke \"{escaped}\"\ndelay 0.2\nkey code 36\nend tell"
    );
    run_osascript(&script)
}

/// Opens a new window of the configured terminal at the given path and starts
/// `claude` in it. Keystroke-based paths share the Accessibility permission.
fn launch_terminal(terminal: &str, path: &str) -> Result<(), String> {
    // ponytail: strip quotes instead of escaping; paths with quotes are not real
    let safe = path.replace(['\'', '"'], "");
    match terminal {
        "Terminal" => run_osascript(&format!(
            r#"tell application "Terminal"
  activate
  do script "cd '{safe}' && claude"
end tell"#
        )),
        "iTerm2" => run_osascript(&format!(
            r#"tell application "iTerm2"
  activate
  create window with default profile
  tell current session of current window to write text "cd '{safe}' && claude"
end tell"#
        )),
        "Ghostty" => {
            Command::new("open")
                .args([
                    "-na",
                    "Ghostty",
                    "--args",
                    &format!("--working-directory={safe}"),
                ])
                .status()
                .map_err(|e| e.to_string())?;
            run_osascript(TYPE_CLAUDE_SCRIPT)
        }
        _ => {
            let encoded = safe.replace(' ', "%20");
            Command::new("open")
                .arg(format!("warp://action/new_window?path={encoded}"))
                .status()
                .map_err(|e| e.to_string())?;
            run_osascript(TYPE_CLAUDE_SCRIPT)
        }
    }
}

#[tauri::command]
fn start_session(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettings>>,
    path: String,
) -> Result<(), String> {
    let terminal = state.lock().unwrap().launcher_terminal.clone();
    remember_recent(&app, &path);
    launch_terminal(&terminal, &path)
}

#[tauri::command]
fn get_settings(state: tauri::State<Mutex<AppSettings>>) -> AppSettings {
    state.lock().unwrap().clone()
}

#[tauri::command]
fn set_settings(
    app: tauri::AppHandle,
    state: tauri::State<Mutex<AppSettings>>,
    settings: AppSettings,
) -> Result<(), String> {
    let shortcut: Shortcut = settings
        .shortcut
        .parse()
        .map_err(|_| "atalho inválido (ex.: cmd+alt+c)".to_string())?;
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();
    shortcuts.register(shortcut).map_err(|e| e.to_string())?;
    save_settings(&app, &settings)?;
    *state.lock().unwrap() = settings;
    Ok(())
}

#[tauri::command]
fn get_recents(app: tauri::AppHandle) -> Vec<String> {
    load_recents(&app)
}

/// Resource usage of the main process (webview helper processes not included).
#[tauri::command]
fn app_stats() -> AppStats {
    let pid = std::process::id().to_string();
    let text = Command::new("ps")
        .args(["-o", "rss=,%cpu=", "-p", &pid])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    let mut parts = text.split_whitespace();
    let rss_kb: f64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let cpu_percent: f64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0.0);
    AppStats {
        memory_mb: rss_kb / 1024.0,
        cpu_percent,
    }
}

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

const PLAN_USAGE_ENDPOINT: &str = "https://api.anthropic.com/api/oauth/usage";
const PLAN_USAGE_CACHE_TTL: Duration = Duration::from_secs(60);

#[derive(Default)]
struct PlanUsageCache(Option<(Instant, serde_json::Value)>);

/// Claude Code's OAuth token, from the same Keychain item Claude Code uses.
fn oauth_token() -> Result<String, String> {
    let output = Command::new("security")
        .args(["find-generic-password", "-s", "Claude Code-credentials", "-w"])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("credenciais do Claude Code não encontradas no Keychain".into());
    }
    let creds: serde_json::Value =
        serde_json::from_str(String::from_utf8_lossy(&output.stdout).trim())
            .map_err(|_| "credenciais em formato inesperado".to_string())?;
    creds
        .pointer("/claudeAiOauth/accessToken")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| "token OAuth ausente".to_string())
}

/// Mirrors Claude Code's /usage. The endpoint is undocumented, so any schema
/// drift surfaces as an Err and the frontend hides the plan tab.
fn fetch_plan_usage() -> Result<serde_json::Value, String> {
    let token = oauth_token()?;
    let output = Command::new("curl")
        .args([
            "-sS",
            "-m",
            "10",
            PLAN_USAGE_ENDPOINT,
            "-H",
            &format!("Authorization: Bearer {token}"),
            "-H",
            "anthropic-beta: oauth-2025-04-20",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    let body: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| "resposta inválida do endpoint de uso".to_string())?;
    match body.get("limits").map(serde_json::Value::is_array) {
        Some(true) => Ok(body),
        _ => Err("endpoint de uso sem dados de limites".to_string()),
    }
}

#[tauri::command]
async fn plan_usage(
    cache: tauri::State<'_, Mutex<PlanUsageCache>>,
) -> Result<serde_json::Value, String> {
    if let Some((at, value)) = &cache.lock().unwrap().0 {
        if at.elapsed() < PLAN_USAGE_CACHE_TTL {
            return Ok(value.clone());
        }
    }
    // ponytail: blocking curl on the async pool; fine for one call a minute
    let value = fetch_plan_usage()?;
    cache.lock().unwrap().0 = Some((Instant::now(), value.clone()));
    Ok(value)
}

fn toggle_popover(app: &tauri::AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    match win.is_visible().unwrap_or(false) {
        true => {
            let _ = win.hide();
        }
        false => {
            // TrayCenter only works after the positioner has seen a tray event;
            // fall back to the menu-bar corner for shortcut-first opens.
            if win.move_window(Position::TrayCenter).is_err() {
                let _ = win.move_window(Position::TopRight);
            }
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

/// Fires a native notification for every session that just entered "waiting".
fn notify_new_waiting(app: &tauri::AppHandle, sessions: &[Session], previous: &HashSet<String>) {
    for session in sessions {
        let newly_waiting =
            session.status == "waiting" && !previous.contains(&session.session_id);
        if !newly_waiting {
            continue;
        }
        let body = [&session.tool, &session.message, &session.last_message]
            .into_iter()
            .find(|s| !s.is_empty())
            .cloned()
            .unwrap_or_else(|| "Aguardando você".to_string());
        let _ = app
            .notification()
            .builder()
            .title(format!("{} aguardando", session.project))
            .body(body)
            .show();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        toggle_popover(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            focus_session,
            respond_session,
            send_text,
            add_permission_rule,
            read_transcript_tail,
            usage_stats,
            start_session,
            get_settings,
            set_settings,
            get_recents,
            app_stats,
            plan_usage,
            quit
        ])
        .setup(|app| {
            // Menu-bar-style app: no Dock icon, no app-switcher entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Launch on login (packaged builds only; dev runs stay out of Login Items).
            #[cfg(not(debug_assertions))]
            {
                use tauri_plugin_autostart::ManagerExt;
                let _ = app.autolaunch().enable();
            }

            let settings = load_settings(app.handle());
            if let Ok(shortcut) = settings.shortcut.parse::<Shortcut>() {
                let _ = app.global_shortcut().register(shortcut);
            }
            app.manage(Mutex::new(settings));
            app.manage(Mutex::new(PlanUsageCache::default()));

            let window = app.get_webview_window("main").expect("main window missing");
            let _ = window.set_shadow(true);

            // Auto-hide the popover when it loses focus (click elsewhere).
            let win_evt = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Focused(false) = event {
                    let _ = win_evt.hide();
                }
            });

            // Tray icon: click to toggle the popover, positioned right under it.
            TrayIconBuilder::with_id("main")
                .icon(Image::from_bytes(TRAY_IDLE)?)
                .icon_as_template(true)
                .tooltip("Claude Code")
                .on_tray_icon_event(|tray, event| {
                    tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_popover(tray.app_handle());
                    }
                })
                .build(app)?;

            // Poll the status dir: push sessions to the UI and reflect the count in the tray.
            let handle = app.handle().clone();
            thread::spawn(move || {
                let mut last: i64 = -1;
                let mut previous_waiting: HashSet<String> = HashSet::new();
                let mut known_cwds: HashSet<String> = HashSet::new();
                loop {
                    let (stale_secs, notifications_enabled) = {
                        let state = handle.state::<Mutex<AppSettings>>();
                        let settings = state.lock().unwrap();
                        (settings.stale_hours * 3600.0, settings.notifications_enabled)
                    };

                    let sessions = read_sessions(stale_secs);
                    let _ = handle.emit("sessions", &sessions);

                    for session in &sessions {
                        let is_new = !session.cwd.is_empty()
                            && known_cwds.insert(session.cwd.clone());
                        if is_new {
                            remember_recent(&handle, &session.cwd);
                        }
                    }

                    if notifications_enabled {
                        notify_new_waiting(&handle, &sessions, &previous_waiting);
                    }
                    previous_waiting = sessions
                        .iter()
                        .filter(|s| s.status == "waiting")
                        .map(|s| s.session_id.clone())
                        .collect();

                    let waiting = sessions.iter().filter(|s| s.status == "waiting").count() as i64;
                    if waiting != last {
                        last = waiting;
                        if let Some(tray) = handle.tray_by_id("main") {
                            if waiting > 0 {
                                if let Ok(img) = Image::from_bytes(TRAY_ACTIVE) {
                                    let _ = tray.set_icon(Some(img));
                                    let _ = tray.set_icon_as_template(false);
                                }
                                let _ = tray.set_title(Some(format!("{waiting}")));
                            } else {
                                if let Ok(img) = Image::from_bytes(TRAY_IDLE) {
                                    let _ = tray.set_icon(Some(img));
                                    let _ = tray.set_icon_as_template(true);
                                }
                                let _ = tray.set_title(None::<String>);
                            }
                        }
                    }
                    thread::sleep(POLL_INTERVAL);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        add_rule_to_settings, aggregate_usage, applescript_escape, is_stale, parse_usage_entry,
        vscode_app_name, AppSettings,
    };

    #[test]
    fn rules_are_added_once_into_permissions_allow() {
        let mut root = serde_json::json!({});
        assert!(add_rule_to_settings(&mut root, "Bash(bun test:*)"));
        assert!(!add_rule_to_settings(&mut root, "Bash(bun test:*)"));
        assert_eq!(
            root,
            serde_json::json!({"permissions": {"allow": ["Bash(bun test:*)"]}})
        );
    }

    #[test]
    fn existing_settings_keys_are_preserved() {
        let mut root = serde_json::json!({"permissions": {"deny": ["WebFetch"]}, "other": 1});
        assert!(add_rule_to_settings(&mut root, "Edit"));
        assert_eq!(root["permissions"]["deny"], serde_json::json!(["WebFetch"]));
        assert_eq!(root["other"], 1);
        assert_eq!(root["permissions"]["allow"], serde_json::json!(["Edit"]));
    }

    const USAGE_LINE: &str = r#"{"type":"assistant","timestamp":"2026-07-21T18:00:00.000Z","cwd":"/Users/x/dev/notch","message":{"id":"msg_1","model":"claude-sonnet-5","usage":{"input_tokens":10,"output_tokens":20,"cache_read_input_tokens":30,"cache_creation_input_tokens":40}}}"#;

    #[test]
    fn usage_entry_is_parsed_from_transcript_line() {
        let entry = parse_usage_entry(USAGE_LINE).unwrap();
        assert_eq!(entry.bucket.day, "2026-07-21");
        assert_eq!(entry.bucket.project, "notch");
        assert_eq!(entry.bucket.model, "claude-sonnet-5");
        assert_eq!(entry.bucket.input_tokens, 10);
        assert_eq!(entry.bucket.output_tokens, 20);
        assert_eq!(entry.bucket.cache_read_tokens, 30);
        assert_eq!(entry.bucket.cache_creation_tokens, 40);
        assert_eq!(entry.message_id, "msg_1");
    }

    #[test]
    fn aggregate_dedups_streamed_entries_by_message_id() {
        let lines = vec![USAGE_LINE.to_string(), USAGE_LINE.to_string()];
        let buckets = aggregate_usage(lines.into_iter());
        assert_eq!(buckets.len(), 1);
        assert_eq!(buckets[0].output_tokens, 20);
    }

    #[test]
    fn non_assistant_lines_are_ignored() {
        let line = r#"{"type":"user","timestamp":"2026-07-21T18:00:00.000Z","message":{}}"#;
        assert!(parse_usage_entry(line).is_none());
    }

    #[test]
    fn applescript_escaping_handles_quotes_and_backslashes() {
        assert_eq!(applescript_escape(r#"say "hi" \o/"#), r#"say \"hi\" \\o/"#);
    }

    #[test]
    fn vscode_resolves_to_installed_fork() {
        assert_eq!(vscode_app_name(|app| app == "Cursor"), "Cursor");
        assert_eq!(vscode_app_name(|_| false), "Visual Studio Code");
    }

    #[test]
    fn stale_sessions_are_filtered() {
        let stale_secs = 2.0 * 3_600.0;
        assert!(is_stale(0.0, 1_000.0, stale_secs));
        assert!(is_stale(100.0, 100.0 + 3.0 * 3_600.0, stale_secs));
        assert!(!is_stale(100.0, 100.0 + 60.0, stale_secs));
    }

    #[test]
    fn settings_defaults_apply_to_missing_fields() {
        let settings: AppSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(settings.shortcut, "cmd+alt+c");
        assert_eq!(settings.launcher_terminal, "Warp");
        assert!(settings.notifications_enabled);
        assert_eq!(settings.stale_hours, 2.0);
    }
}
