use crate::agents::{report_external, ExternalStep};
use crate::claude_task::step_title;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, SystemTime},
};
use tauri::AppHandle;

const POLL: Duration = Duration::from_secs(3);
const WORKING_WITHIN: Duration = Duration::from_secs(25);
const STUCK_AFTER: Duration = Duration::from_secs(20);
const VISIBLE_WITHIN: Duration = Duration::from_secs(10 * 60);
const TAIL_BYTES: u64 = 96 * 1024;
const MAX_STEPS: usize = 6;

static ENABLED: AtomicBool = AtomicBool::new(true);
static IGNORED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

#[derive(Debug, Default, PartialEq, Clone)]
pub(crate) struct SessionSnapshot {
    pub(crate) title: Option<String>,
    pub(crate) folder: Option<String>,
    pub(crate) prompt: Option<String>,
    pub(crate) steps: Vec<String>,
    pub(crate) last_text: Option<String>,
    pub(crate) waiting_for_tool: bool,
    pub(crate) headless: bool,
}

pub(crate) fn ignore_session(id: &str) {
    if let Ok(mut ignored) = IGNORED.lock() {
        ignored.get_or_insert_with(HashSet::new).insert(id.to_string());
    }
}

fn is_ignored(id: &str) -> bool {
    IGNORED.lock().map(|ignored| ignored.as_ref().is_some_and(|set| set.contains(id))).unwrap_or(false)
}

fn short(text: &str, limit: usize) -> String {
    let single: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if single.chars().count() <= limit {
        single
    } else {
        format!("{}…", single.chars().take(limit).collect::<String>())
    }
}

fn user_text(message: &Value) -> Option<String> {
    match message.get("content")? {
        Value::String(text) => Some(text.clone()),
        Value::Array(blocks) => {
            let text: Vec<&str> = blocks
                .iter()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect();
            (!text.is_empty()).then(|| text.join(" "))
        }
        _ => None,
    }
    .map(|text| text.trim().to_string())
    .filter(|text| !text.is_empty() && !text.starts_with('<'))
}

pub(crate) fn summarize(lines: &str) -> SessionSnapshot {
    let mut snapshot = SessionSnapshot::default();
    for line in lines.lines() {
        let Ok(entry) = serde_json::from_str::<Value>(line) else { continue };
        if entry.get("isSidechain").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        if entry.get("entrypoint").and_then(Value::as_str) == Some("sdk-cli") {
            snapshot.headless = true;
        }
        if let Some(cwd) = entry.get("cwd").and_then(Value::as_str) {
            snapshot.folder = Some(cwd.to_string());
        }
        match entry.get("type").and_then(Value::as_str) {
            Some("custom-title") => snapshot.title = entry.get("customTitle").and_then(Value::as_str).map(str::to_string),
            Some("last-prompt") => {
                if let Some(prompt) = entry.get("lastPrompt").and_then(Value::as_str) {
                    snapshot.prompt = Some(prompt.to_string());
                }
            }
            Some("user") => {
                let Some(message) = entry.get("message") else { continue };
                if let Some(text) = user_text(message) {
                    snapshot.prompt = Some(text);
                    snapshot.steps.clear();
                    snapshot.last_text = None;
                }
                snapshot.waiting_for_tool = false;
            }
            Some("assistant") => {
                let Some(blocks) = entry.pointer("/message/content").and_then(Value::as_array) else { continue };
                for block in blocks {
                    match block.get("type").and_then(Value::as_str) {
                        Some("tool_use") => {
                            let name = block.get("name").and_then(Value::as_str).unwrap_or("Ferramenta");
                            snapshot.steps.push(step_title(name, block.get("input").unwrap_or(&Value::Null)));
                            snapshot.waiting_for_tool = true;
                        }
                        Some("text") => {
                            if let Some(text) = block.get("text").and_then(Value::as_str).map(str::trim).filter(|text| !text.is_empty()) {
                                snapshot.last_text = Some(text.to_string());
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    let start = snapshot.steps.len().saturating_sub(MAX_STEPS);
    snapshot.steps = snapshot.steps.split_off(start);
    snapshot
}

fn read_tail(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    let start = length.saturating_sub(TAIL_BYTES);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    Some(if start > 0 { text.split_once('\n').map(|(_, rest)| rest.to_string()).unwrap_or_default() } else { text })
}

fn projects_dir() -> Option<PathBuf> {
    Some(PathBuf::from(env::var_os("USERPROFILE")?).join(".claude").join("projects"))
}

fn recent_transcripts(now: SystemTime) -> Vec<(PathBuf, Duration)> {
    let Some(root) = projects_dir() else { return Vec::new() };
    let Ok(projects) = fs::read_dir(root) else { return Vec::new() };
    let mut found = Vec::new();
    for project in projects.flatten().filter(|entry| entry.path().is_dir()) {
        let Ok(files) = fs::read_dir(project.path()) else { continue };
        for file in files.flatten() {
            let path = file.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(modified) = file.metadata().and_then(|meta| meta.modified()) else { continue };
            let age = now.duration_since(modified).unwrap_or_default();
            if age <= VISIBLE_WITHIN {
                found.push((path, age));
            }
        }
    }
    found
}

fn session_state(snapshot: &SessionSnapshot, age: Duration) -> &'static str {
    if snapshot.waiting_for_tool && age > STUCK_AFTER {
        "waiting"
    } else if age <= WORKING_WITHIN {
        "working"
    } else {
        "done"
    }
}

fn agent_name(snapshot: &SessionSnapshot) -> String {
    let folder = snapshot
        .folder
        .as_deref()
        .and_then(|path| Path::new(path).file_name())
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "sessão".to_string());
    format!("Claude Code · {folder}")
}

fn tick(app: &AppHandle, last: &mut HashMap<PathBuf, (String, SessionSnapshot)>) {
    let now = SystemTime::now();
    for (path, age) in recent_transcripts(now) {
        let id = path.file_stem().map(|stem| stem.to_string_lossy().to_string()).unwrap_or_default();
        if is_ignored(&id) {
            continue;
        }
        let Some(lines) = read_tail(&path) else { continue };
        let snapshot = summarize(&lines);
        if snapshot.headless || (snapshot.prompt.is_none() && snapshot.steps.is_empty()) {
            continue;
        }
        let state = session_state(&snapshot, age);
        let working = state != "done";
        let unchanged = last.get(&path).is_some_and(|(previous_state, previous)| previous_state == state && previous == &snapshot);
        if unchanged {
            continue;
        }
        let steps = snapshot
            .steps
            .iter()
            .enumerate()
            .map(|(index, title)| ExternalStep {
                title: title.clone(),
                status: if !working || index + 1 < snapshot.steps.len() { "completed" } else { "in_progress" },
            })
            .collect();
        let goal = snapshot.title.clone().or_else(|| snapshot.prompt.as_deref().map(|prompt| short(prompt, 120)));
        let message = if working { snapshot.last_text.as_deref().map(|text| short(text, 200)) } else { snapshot.last_text.as_deref().map(|text| short(text, 600)) };
        let was_waiting = last.get(&path).is_some_and(|(previous_state, _)| previous_state == "waiting");
        let notice = (state == "waiting" && !was_waiting).then(|| ("Parece estar esperando você responder no Claude.".to_string(), "warning"));
        let message = if state == "waiting" { Some("Parado esperando você. Abra o Claude para responder.".to_string()) } else { message };
        report_external(app, &agent_name(&snapshot), goal, steps, state, message, notice);
        last.insert(path, (state.to_string(), snapshot));
    }
}

pub(crate) fn init(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        let mut last = HashMap::new();
        loop {
            if ENABLED.load(Ordering::SeqCst) {
                tick(&app, &mut last);
            }
            thread::sleep(POLL);
        }
    });
}

#[tauri::command]
pub(crate) fn set_watch_claude_sessions(enabled: bool) {
    ENABLED.store(enabled, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn lines(entries: &[Value]) -> String {
        entries.iter().map(Value::to_string).collect::<Vec<_>>().join("\n")
    }

    #[test]
    fn a_new_prompt_resets_the_steps() {
        let text = lines(&[
            json!({ "type": "user", "cwd": "C:\\code\\nimbo", "message": { "content": "corrige o teste" } }),
            json!({ "type": "assistant", "message": { "content": [{ "type": "tool_use", "name": "Read", "input": { "file_path": "C:\\code\\nimbo\\a.rs" } }] } }),
            json!({ "type": "user", "message": { "content": [{ "type": "tool_result", "content": "ok" }] } }),
            json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": "Achei o erro." }, { "type": "tool_use", "name": "Edit", "input": { "file_path": "C:\\code\\nimbo\\a.rs" } }] } }),
            json!({ "type": "custom-title", "customTitle": "Teste quebrado" }),
        ]);
        let snapshot = summarize(&text);
        assert_eq!(snapshot.prompt.as_deref(), Some("corrige o teste"));
        assert_eq!(snapshot.steps, vec!["Lendo a.rs", "Editando a.rs"]);
        assert_eq!(snapshot.last_text.as_deref(), Some("Achei o erro."));
        assert_eq!(snapshot.title.as_deref(), Some("Teste quebrado"));
        assert_eq!(agent_name(&snapshot), "Claude Code · nimbo");

        let next = format!("{text}\n{}", json!({ "type": "user", "message": { "content": "agora roda tudo" } }));
        let after = summarize(&next);
        assert_eq!(after.prompt.as_deref(), Some("agora roda tudo"));
        assert!(after.steps.is_empty());
    }

    #[test]
    fn a_quiet_pending_tool_means_waiting() {
        let pending = SessionSnapshot { waiting_for_tool: true, ..Default::default() };
        assert_eq!(session_state(&pending, Duration::from_secs(5)), "working");
        assert_eq!(session_state(&pending, Duration::from_secs(40)), "waiting");
        let idle = SessionSnapshot::default();
        assert_eq!(session_state(&idle, Duration::from_secs(10)), "working");
        assert_eq!(session_state(&idle, Duration::from_secs(40)), "done");
    }

    #[test]
    fn headless_runs_are_marked() {
        let text = lines(&[json!({ "type": "user", "entrypoint": "sdk-cli", "message": { "content": "2+2" } })]);
        assert!(summarize(&text).headless);
        let desktop = lines(&[json!({ "type": "user", "entrypoint": "claude-desktop", "message": { "content": "oi" } })]);
        assert!(!summarize(&desktop).headless);
    }

    #[test]
    fn side_chains_and_system_text_are_ignored() {
        let text = lines(&[
            json!({ "type": "user", "message": { "content": "<command-name>/clear</command-name>" } }),
            json!({ "type": "assistant", "isSidechain": true, "message": { "content": [{ "type": "tool_use", "name": "Grep", "input": { "pattern": "x" } }] } }),
        ]);
        let snapshot = summarize(&text);
        assert!(snapshot.prompt.is_none());
        assert!(snapshot.steps.is_empty());
    }
}
