//! Per-provider hook installer. Conservative by design: edit each agent's
//! config with a one-time backup, tag every entry with a marker path, and
//! uninstall by removing only marker entries — user configuration is never
//! rewritten.

use serde_json::{json, Value};
use std::path::PathBuf;
use std::{fs, io};

/// Every hook entry the installer writes carries this path fragment, so
/// uninstall can strip exactly our entries and nothing else.
pub const MARKER: &str = ".claude-notch/hooks/";

const HOOK_SCRIPTS: [(&str, &str); 5] = [
    ("notch_ipc.py", include_str!("../../scripts/hooks/notch_ipc.py")),
    ("claude-status.py", include_str!("../../scripts/hooks/claude-status.py")),
    ("claude-permission.py", include_str!("../../scripts/hooks/claude-permission.py")),
    ("codex-status.py", include_str!("../../scripts/hooks/codex-status.py")),
    ("cursor-hook.py", include_str!("../../scripts/hooks/cursor-hook.py")),
];

struct HookEntry {
    event: &'static str,
    matcher: Option<&'static str>,
    script: &'static str,
    args: &'static str,
    timeout: Option<u64>,
}

/// PermissionRequest gets a long timeout so the hook can wait for the popover;
/// the python script gives up before Claude Code does.
const CLAUDE_ENTRIES: [HookEntry; 7] = [
    HookEntry { event: "PermissionRequest", matcher: Some("*"), script: "claude-permission.py", args: "", timeout: Some(600) },
    HookEntry { event: "Notification", matcher: Some("permission_prompt|idle_prompt"), script: "claude-status.py", args: "waiting", timeout: None },
    HookEntry { event: "UserPromptSubmit", matcher: None, script: "claude-status.py", args: "running", timeout: None },
    HookEntry { event: "PreToolUse", matcher: None, script: "claude-status.py", args: "running", timeout: None },
    HookEntry { event: "PostToolUse", matcher: None, script: "claude-status.py", args: "running", timeout: None },
    HookEntry { event: "Stop", matcher: None, script: "claude-status.py", args: "idle", timeout: None },
    HookEntry { event: "SessionEnd", matcher: None, script: "claude-status.py", args: "end", timeout: None },
];

const CODEX_ENTRIES: [HookEntry; 5] = [
    HookEntry { event: "SessionStart", matcher: None, script: "codex-status.py", args: "", timeout: None },
    HookEntry { event: "UserPromptSubmit", matcher: None, script: "codex-status.py", args: "", timeout: None },
    HookEntry { event: "PreToolUse", matcher: None, script: "codex-status.py", args: "", timeout: None },
    HookEntry { event: "PostToolUse", matcher: None, script: "codex-status.py", args: "", timeout: None },
    HookEntry { event: "Stop", matcher: None, script: "codex-status.py", args: "", timeout: None },
];

const CURSOR_EVENTS: [&str; 5] = [
    "beforeSubmitPrompt",
    "afterFileEdit",
    "stop",
    "beforeShellExecution",
    "beforeMCPExecution",
];

pub fn hooks_dir() -> PathBuf {
    crate::notch_dir().join("hooks")
}

fn command_line(hooks_dir: &str, script: &str, args: &str) -> String {
    let base = format!("python3 \"{hooks_dir}/{script}\"");
    match args.is_empty() {
        true => base,
        false => format!("{base} {args}"),
    }
}

fn entry_contains_marker(entry: &Value) -> bool {
    entry.to_string().contains(MARKER)
}

fn ensure_event_array<'a>(root: &'a mut Value, event: &str) -> Option<&'a mut Vec<Value>> {
    let base = root.as_object_mut()?;
    let hooks = base.entry("hooks").or_insert_with(|| json!({}));
    let array = hooks
        .as_object_mut()?
        .entry(event)
        .or_insert_with(|| json!([]));
    array.as_array_mut()
}

fn claude_style_entry(entry: &HookEntry, hooks_dir: &str) -> Value {
    let mut command = json!({
        "type": "command",
        "command": command_line(hooks_dir, entry.script, entry.args),
    });
    if let Some(timeout) = entry.timeout {
        command["timeout"] = json!(timeout);
    }
    let mut value = json!({ "hooks": [command] });
    if let Some(matcher) = entry.matcher {
        value["matcher"] = json!(matcher);
    }
    value
}

/// Inserts (or refreshes) our hook entries, leaving user entries untouched.
pub fn apply_claude_style_hooks(root: &mut Value, entries: &[HookEntry], hooks_dir: &str) {
    for entry in entries {
        let Some(array) = ensure_event_array(root, entry.event) else {
            continue;
        };
        array.retain(|existing| !entry_contains_marker(existing));
        array.push(claude_style_entry(entry, hooks_dir));
    }
}

pub fn apply_cursor_hooks(root: &mut Value, hooks_dir: &str) {
    if let Some(base) = root.as_object_mut() {
        base.entry("version").or_insert(json!(1));
    }
    for event in CURSOR_EVENTS {
        let Some(array) = ensure_event_array(root, event) else {
            continue;
        };
        array.retain(|existing| !entry_contains_marker(existing));
        array.push(json!({ "command": command_line(hooks_dir, "cursor-hook.py", "") }));
    }
}

/// Strips our entries from every event, pruning arrays that end up empty.
pub fn remove_marker_hooks(root: &mut Value) {
    let Some(hooks) = root.get_mut("hooks").and_then(|h| h.as_object_mut()) else {
        return;
    };
    for (_, value) in hooks.iter_mut() {
        if let Some(array) = value.as_array_mut() {
            array.retain(|entry| !entry_contains_marker(entry));
        }
    }
    hooks.retain(|_, value| value.as_array().map(|a| !a.is_empty()).unwrap_or(true));
}

pub fn is_installed(root: &Value) -> bool {
    root.to_string().contains(MARKER)
}

/// Ensures ~/.codex/config.toml enables the hooks feature. Returns the text
/// unchanged when the flag is already on.
pub fn enable_codex_hooks_flag(text: &str) -> String {
    let flag_line = text
        .lines()
        .find(|line| line.trim_start().starts_with("codex_hooks"));
    if let Some(line) = flag_line {
        if line.contains("true") {
            return text.to_string();
        }
        return text.replace(line, "codex_hooks = true");
    }
    if text.lines().any(|line| line.trim() == "[features]") {
        return text.replace("[features]", "[features]\ncodex_hooks = true");
    }
    let separator = match text.is_empty() || text.ends_with('\n') {
        true => "",
        false => "\n",
    };
    format!("{text}{separator}[features]\ncodex_hooks = true\n")
}

fn load_json(path: &PathBuf) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}

fn save_json(path: &PathBuf, root: &Value) -> Result<(), String> {
    let parent = path.parent().ok_or("caminho de configuração inválido")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(root).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

/// One-time copy so an uninstall (or a bug) can never lose the user's config.
fn backup_once(path: &PathBuf) {
    let backup = path.with_extension("json.claude-notch.bak");
    let missing = !backup.exists();
    if path.exists() && missing {
        let _ = fs::copy(path, backup);
    }
}

fn write_hook_scripts() -> io::Result<()> {
    let dir = hooks_dir();
    fs::create_dir_all(&dir)?;
    for (name, contents) in HOOK_SCRIPTS {
        let path = dir.join(name);
        fs::write(&path, contents)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755))?;
        }
    }
    Ok(())
}

fn claude_settings_path() -> PathBuf {
    crate::home_dir().join(".claude").join("settings.json")
}

fn codex_hooks_path() -> PathBuf {
    crate::home_dir().join(".codex").join("hooks.json")
}

fn codex_config_path() -> PathBuf {
    crate::home_dir().join(".codex").join("config.toml")
}

fn cursor_hooks_path() -> PathBuf {
    crate::home_dir().join(".cursor").join("hooks.json")
}

fn config_path(provider: &str) -> Result<PathBuf, String> {
    match provider {
        "claude" => Ok(claude_settings_path()),
        "codex" => Ok(codex_hooks_path()),
        "cursor" => Ok(cursor_hooks_path()),
        other => Err(format!("provider desconhecido: {other}")),
    }
}

fn enable_codex_feature() -> Result<(), String> {
    let path = codex_config_path();
    let parent = path.parent().ok_or("caminho de configuração inválido")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let current = fs::read_to_string(&path).unwrap_or_default();
    let updated = enable_codex_hooks_flag(&current);
    if updated == current {
        return Ok(());
    }
    let backup = path.with_extension("toml.claude-notch.bak");
    let missing = !backup.exists();
    if path.exists() && missing {
        let _ = fs::copy(&path, backup);
    }
    fs::write(&path, updated).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn install_integration(provider: String) -> Result<(), String> {
    write_hook_scripts().map_err(|e| e.to_string())?;
    let hooks_dir = hooks_dir().to_string_lossy().into_owned();
    let path = config_path(&provider)?;
    backup_once(&path);
    let mut root = load_json(&path);
    match provider.as_str() {
        "claude" => apply_claude_style_hooks(&mut root, &CLAUDE_ENTRIES, &hooks_dir),
        "codex" => {
            enable_codex_feature()?;
            apply_claude_style_hooks(&mut root, &CODEX_ENTRIES, &hooks_dir);
        }
        _ => apply_cursor_hooks(&mut root, &hooks_dir),
    }
    save_json(&path, &root)
}

#[tauri::command]
pub fn uninstall_integration(provider: String) -> Result<(), String> {
    let path = config_path(&provider)?;
    if !path.exists() {
        return Ok(());
    }
    let mut root = load_json(&path);
    remove_marker_hooks(&mut root);
    save_json(&path, &root)
}

#[tauri::command]
pub fn integration_status(provider: String) -> Result<bool, String> {
    let path = config_path(&provider)?;
    Ok(is_installed(&load_json(&path)))
}

#[cfg(test)]
mod tests {
    use super::{
        apply_claude_style_hooks, apply_cursor_hooks, enable_codex_hooks_flag, is_installed,
        remove_marker_hooks, CLAUDE_ENTRIES, CODEX_ENTRIES,
    };
    use serde_json::json;

    const HOOKS_DIR: &str = "/Users/me/.claude-notch/hooks";

    #[test]
    fn claude_hooks_are_added_idempotently() {
        let mut root = json!({});
        apply_claude_style_hooks(&mut root, &CLAUDE_ENTRIES, HOOKS_DIR);
        let once = root.clone();
        apply_claude_style_hooks(&mut root, &CLAUDE_ENTRIES, HOOKS_DIR);
        assert_eq!(root, once);
        assert!(is_installed(&root));
        assert_eq!(root["hooks"]["PermissionRequest"][0]["matcher"], "*");
        assert_eq!(
            root["hooks"]["PermissionRequest"][0]["hooks"][0]["timeout"],
            600
        );
        assert_eq!(
            root["hooks"]["Stop"][0]["hooks"][0]["command"],
            format!("python3 \"{HOOKS_DIR}/claude-status.py\" idle")
        );
    }

    #[test]
    fn user_hook_entries_survive_install_and_uninstall() {
        let user_entry = json!({ "hooks": [{ "type": "command", "command": "echo hi" }] });
        let mut root = json!({ "hooks": { "PreToolUse": [user_entry.clone()] }, "permissions": { "allow": ["Edit"] } });

        apply_claude_style_hooks(&mut root, &CLAUDE_ENTRIES, HOOKS_DIR);
        assert_eq!(root["hooks"]["PreToolUse"][0], user_entry);
        assert_eq!(root["hooks"]["PreToolUse"].as_array().unwrap().len(), 2);

        remove_marker_hooks(&mut root);
        assert_eq!(root["hooks"]["PreToolUse"], json!([user_entry]));
        assert!(root["hooks"].get("Stop").is_none());
        assert_eq!(root["permissions"]["allow"], json!(["Edit"]));
        assert!(!is_installed(&root));
    }

    #[test]
    fn codex_hooks_cover_the_turn_lifecycle() {
        let mut root = json!({});
        apply_claude_style_hooks(&mut root, &CODEX_ENTRIES, HOOKS_DIR);
        let hooks = root["hooks"].as_object().unwrap();
        let events: Vec<&str> = hooks.keys().map(String::as_str).collect();
        for event in ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"] {
            assert!(events.contains(&event), "missing {event}");
        }
        assert_eq!(
            root["hooks"]["Stop"][0]["hooks"][0]["command"],
            format!("python3 \"{HOOKS_DIR}/codex-status.py\"")
        );
    }

    #[test]
    fn cursor_hooks_use_the_flat_format() {
        let mut root = json!({});
        apply_cursor_hooks(&mut root, HOOKS_DIR);
        assert_eq!(root["version"], 1);
        assert_eq!(
            root["hooks"]["beforeShellExecution"][0]["command"],
            format!("python3 \"{HOOKS_DIR}/cursor-hook.py\"")
        );
        let once = root.clone();
        apply_cursor_hooks(&mut root, HOOKS_DIR);
        assert_eq!(root, once);

        remove_marker_hooks(&mut root);
        assert!(!is_installed(&root));
    }

    #[test]
    fn codex_feature_flag_is_enabled_in_every_toml_shape() {
        assert_eq!(
            enable_codex_hooks_flag(""),
            "[features]\ncodex_hooks = true\n"
        );
        assert_eq!(
            enable_codex_hooks_flag("model = \"gpt-5\"\n[features]\nother = 1\n"),
            "model = \"gpt-5\"\n[features]\ncodex_hooks = true\nother = 1\n"
        );
        assert_eq!(
            enable_codex_hooks_flag("[features]\ncodex_hooks = false\n"),
            "[features]\ncodex_hooks = true\n"
        );
        let already = "[features]\ncodex_hooks = true\n";
        assert_eq!(enable_codex_hooks_flag(already), already);
    }
}
