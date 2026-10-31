use crate::agents::{report_external, ExternalStep};
use serde::Serialize;
use serde_json::Value;
use std::{
    env, fs,
    io::{BufRead, BufReader, Read},
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    thread,
    time::SystemTime,
};
use tauri::{AppHandle, Emitter};

const AGENT_NAME: &str = "Claude Code";
const CREATE_NO_WINDOW: u32 = 0x08000000;
const MAX_PROMPT_CHARS: usize = 4_000;
const MAX_VISIBLE_STEPS: usize = 8;
const SEARCH_DEPTH: usize = 6;

static EXECUTABLE: OnceLock<Option<PathBuf>> = OnceLock::new();
static CHILD: Mutex<Option<Child>> = Mutex::new(None);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeTaskStatus {
    available: bool,
    running: bool,
    home_dir: String,
}

#[derive(Debug, PartialEq)]
pub(crate) enum StreamEvent {
    Tool(String),
    Text(String),
    Finished { text: String, failed: bool },
}

fn find_in_tree(dir: &Path, depth: usize, found: &mut Vec<PathBuf>) {
    if depth == 0 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            find_in_tree(&path, depth - 1, found);
        } else if path.file_name().and_then(|name| name.to_str()) == Some("claude.exe")
            && path.to_string_lossy().contains("claude-code")
        {
            found.push(path);
        }
    }
}

fn locate() -> Option<PathBuf> {
    if let Some(paths) = env::var_os("PATH") {
        for dir in env::split_paths(&paths) {
            let candidate = dir.join("claude.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let base = PathBuf::from(env::var_os("LOCALAPPDATA")?).join("Claude-Data");
    let mut found = Vec::new();
    find_in_tree(&base, SEARCH_DEPTH, &mut found);
    found
        .into_iter()
        .max_by_key(|path| fs::metadata(path).and_then(|meta| meta.modified()).unwrap_or(SystemTime::UNIX_EPOCH))
}

fn executable() -> Option<PathBuf> {
    EXECUTABLE.get_or_init(locate).clone()
}

fn short(text: &str, limit: usize) -> String {
    let single: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if single.chars().count() <= limit {
        single
    } else {
        format!("{}…", single.chars().take(limit).collect::<String>())
    }
}

fn file_name(input: &Value, key: &str) -> String {
    input
        .get(key)
        .and_then(Value::as_str)
        .map(|path| Path::new(path).file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_else(|| path.to_string()))
        .unwrap_or_default()
}

pub(crate) fn step_title(tool: &str, input: &Value) -> String {
    match tool {
        "Read" => format!("Lendo {}", file_name(input, "file_path")),
        "Edit" | "MultiEdit" => format!("Editando {}", file_name(input, "file_path")),
        "Write" => format!("Criando {}", file_name(input, "file_path")),
        "Bash" => format!(
            "Rodando {}",
            short(input.get("description").or_else(|| input.get("command")).and_then(Value::as_str).unwrap_or(""), 40)
        ),
        "Grep" | "Glob" => format!("Procurando {}", short(input.get("pattern").and_then(Value::as_str).unwrap_or(""), 40)),
        "WebFetch" | "WebSearch" => "Pesquisando na web".to_string(),
        "TodoWrite" => "Organizando os passos".to_string(),
        "Task" | "Agent" => "Chamando um ajudante".to_string(),
        other => other.to_string(),
    }
    .trim()
    .to_string()
}

pub(crate) fn parse_line(line: &str) -> Vec<StreamEvent> {
    let Ok(value) = serde_json::from_str::<Value>(line) else { return Vec::new() };
    match value.get("type").and_then(Value::as_str) {
        Some("assistant") => value
            .pointer("/message/content")
            .and_then(Value::as_array)
            .map(|blocks| {
                blocks
                    .iter()
                    .filter_map(|block| match block.get("type").and_then(Value::as_str) {
                        Some("tool_use") => Some(StreamEvent::Tool(step_title(
                            block.get("name").and_then(Value::as_str).unwrap_or("Ferramenta"),
                            block.get("input").unwrap_or(&Value::Null),
                        ))),
                        Some("text") => block
                            .get("text")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|text| !text.is_empty())
                            .map(|text| StreamEvent::Text(text.to_string())),
                        _ => None,
                    })
                    .collect()
            })
            .unwrap_or_default(),
        Some("result") => vec![StreamEvent::Finished {
            text: value.get("result").and_then(Value::as_str).unwrap_or("").trim().to_string(),
            failed: value.get("is_error").and_then(Value::as_bool).unwrap_or(false)
                || value.get("subtype").and_then(Value::as_str).is_some_and(|subtype| subtype != "success"),
        }],
        _ => Vec::new(),
    }
}

fn steps_of(titles: &[String], done: bool) -> Vec<ExternalStep> {
    let start = titles.len().saturating_sub(MAX_VISIBLE_STEPS);
    titles[start..]
        .iter()
        .enumerate()
        .map(|(index, title)| ExternalStep {
            title: title.clone(),
            status: if done || start + index + 1 < titles.len() { "completed" } else { "in_progress" },
        })
        .collect()
}

fn watch(app: AppHandle, child: Child, goal: String) {
    let mut child = child;
    let stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    if let Ok(mut slot) = CHILD.lock() {
        *slot = Some(child);
    }
    let mut titles: Vec<String> = Vec::new();
    let mut last_text: Option<String> = None;
    let mut finished = false;

    if let Some(stdout) = stdout {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            for event in parse_line(&line) {
                match event {
                    StreamEvent::Tool(title) => {
                        titles.push(title);
                        report_external(&app, AGENT_NAME, None, steps_of(&titles, false), "working", last_text.clone(), None);
                    }
                    StreamEvent::Text(text) => {
                        last_text = Some(short(&text, 300));
                        report_external(&app, AGENT_NAME, None, steps_of(&titles, false), "working", last_text.clone(), None);
                    }
                    StreamEvent::Finished { text, failed } => {
                        finished = true;
                        let answer = if text.is_empty() { last_text.clone().unwrap_or_default() } else { text };
                        let notice = if failed { "Não consegui terminar" } else { "Terminei o pedido" };
                        report_external(
                            &app,
                            AGENT_NAME,
                            None,
                            steps_of(&titles, true),
                            if failed { "error" } else { "done" },
                            Some(answer.clone()),
                            Some((notice.to_string(), if failed { "warning" } else { "success" })),
                        );
                        let _ = app.emit("claude-task-finished", serde_json::json!({ "text": answer, "failed": failed }));
                    }
                }
            }
        }
    }

    let mut errors = String::new();
    if let Some(stderr) = stderr.as_mut() {
        let _ = stderr.take(4_000).read_to_string(&mut errors);
    }
    let stopped_by_user = CHILD.lock().map(|mut slot| slot.take().is_none()).unwrap_or(false);
    if !finished && !stopped_by_user {
        let message = if errors.trim().is_empty() { "O Claude Code parou sem responder.".to_string() } else { short(&errors, 300) };
        crate::diagnostics::log("claude-task", &message);
        report_external(
            &app,
            AGENT_NAME,
            Some(goal),
            steps_of(&titles, true),
            "error",
            Some(message.clone()),
            Some(("Não consegui terminar".to_string(), "warning")),
        );
        let _ = app.emit("claude-task-finished", serde_json::json!({ "text": message, "failed": true }));
    }
}

fn is_running() -> bool {
    CHILD
        .lock()
        .map(|mut slot| match slot.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(None)),
            None => false,
        })
        .unwrap_or(false)
}

#[tauri::command]
pub(crate) async fn claude_task_status() -> ClaudeTaskStatus {
    let available = tauri::async_runtime::spawn_blocking(|| executable().is_some()).await.unwrap_or(false);
    ClaudeTaskStatus {
        available,
        running: is_running(),
        home_dir: env::var("USERPROFILE").unwrap_or_default(),
    }
}

#[tauri::command]
pub(crate) async fn claude_task_start(app: AppHandle, prompt: String, folder: String, mode: String) -> Result<(), String> {
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("Escreva o que o Claude Code deve fazer.".to_string());
    }
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err("O pedido está grande demais.".to_string());
    }
    let folder = PathBuf::from(folder.trim());
    if !folder.is_absolute() || !folder.is_dir() {
        return Err("Escolha uma pasta que existe nas Configurações → Agentes de IA.".to_string());
    }
    let mode = if mode == "plan" { "plan" } else { "acceptEdits" };
    if is_running() {
        return Err("O Claude Code já está trabalhando num pedido.".to_string());
    }
    let exe = tauri::async_runtime::spawn_blocking(executable)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Não achei o Claude Code neste PC.".to_string())?;

    let child = Command::new(exe)
        .creation_flags(CREATE_NO_WINDOW)
        .args(["-p", &prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", mode])
        .current_dir(&folder)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Não consegui abrir o Claude Code: {error}"))?;

    let goal = short(&prompt, 120);
    report_external(&app, AGENT_NAME, Some(goal.clone()), Vec::new(), "working", None, None);
    thread::spawn(move || watch(app, child, goal));
    Ok(())
}

#[tauri::command]
pub(crate) fn claude_task_stop(app: AppHandle) -> Result<(), String> {
    let child = CHILD.lock().map_err(|error| error.to_string())?.take();
    if let Some(mut child) = child {
        let _ = child.kill();
        report_external(&app, AGENT_NAME, None, Vec::new(), "error", Some("Você parou o pedido.".to_string()), None);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn tool_uses_become_friendly_steps() {
        assert_eq!(step_title("Read", &json!({ "file_path": "C:\\x\\src\\App.tsx" })), "Lendo App.tsx");
        assert_eq!(step_title("Bash", &json!({ "command": "npm test", "description": "Rodar os testes" })), "Rodando Rodar os testes");
        assert_eq!(step_title("Grep", &json!({ "pattern": "useState" })), "Procurando useState");
        assert_eq!(step_title("Mystery", &json!({})), "Mystery");
    }

    #[test]
    fn stream_lines_become_events() {
        let assistant = json!({ "type": "assistant", "message": { "content": [
            { "type": "text", "text": "Vou olhar o arquivo." },
            { "type": "tool_use", "name": "Edit", "input": { "file_path": "/a/b.rs" } }
        ] } });
        assert_eq!(
            parse_line(&assistant.to_string()),
            vec![StreamEvent::Text("Vou olhar o arquivo.".into()), StreamEvent::Tool("Editando b.rs".into())]
        );
        let result = json!({ "type": "result", "subtype": "success", "is_error": false, "result": "Pronto!" });
        assert_eq!(parse_line(&result.to_string()), vec![StreamEvent::Finished { text: "Pronto!".into(), failed: false }]);
        let failed = json!({ "type": "result", "subtype": "error_max_turns", "result": "" });
        assert_eq!(parse_line(&failed.to_string()), vec![StreamEvent::Finished { text: String::new(), failed: true }]);
        assert!(parse_line("not json").is_empty());
    }

    #[test]
    fn only_the_last_step_is_in_progress() {
        let titles: Vec<String> = (1..=10).map(|index| format!("passo {index}")).collect();
        let steps = steps_of(&titles, false);
        assert_eq!(steps.len(), MAX_VISIBLE_STEPS);
        assert_eq!(steps.last().unwrap().status, "in_progress");
        assert!(steps[..steps.len() - 1].iter().all(|step| step.status == "completed"));
        assert!(steps_of(&titles, true).iter().all(|step| step.status == "completed"));
    }
}
