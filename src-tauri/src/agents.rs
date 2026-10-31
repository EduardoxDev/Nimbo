//! A local MCP server so AI agents (Claude Code, Codex, Claude Desktop, ...)
//! can show their own plan on the island, post short notices and hand tasks
//! to the user.
//!
//! Transport is MCP "Streamable HTTP" answered with plain JSON on
//! `http://127.0.0.1:<port>/mcp`. Only loopback, only with the bearer token,
//! never from a browser page (any `Origin` header is refused) and only with a
//! loopback `Host` (blocks DNS rebinding).

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

pub(crate) const DEFAULT_PORT: u16 = 47615;
const CONFIG_FILE: &str = "agents.json";
const BOARD_FILE: &str = "agents-board.json";
const PROTOCOL_VERSION: &str = "2025-06-18";
const MAX_BODY_BYTES: usize = 256 * 1024;
const MAX_AGENTS: usize = 8;
const MAX_STEPS: usize = 40;
const MAX_TEXT: usize = 200;
const MAX_APPROVALS: usize = 10;
const APPROVAL_TTL_MS: i64 = 60 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentsConfig {
    enabled: bool,
    token: String,
    port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentStep {
    title: String,
    /// "pending", "in_progress" or "completed".
    status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentEntry {
    id: String,
    name: String,
    goal: Option<String>,
    steps: Vec<AgentStep>,
    /// "working" or "done".
    state: String,
    message: Option<String>,
    updated_at: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentBoard {
    agents: Vec<AgentEntry>,
    #[serde(default)]
    approvals: Vec<Approval>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Approval {
    id: String,
    agent: String,
    question: String,
    status: String,
    created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UserTodo {
    title: String,
    done: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerInfo {
    enabled: bool,
    running: bool,
    url: String,
    token: String,
    error: Option<String>,
}

/// Side effects a tool call asks the app to perform.
#[derive(Debug, PartialEq)]
enum Effect {
    BoardChanged,
    Notice { agent: String, text: String, level: String },
    AddTodo { agent: String, title: String },
}

struct Runtime {
    board: AgentBoard,
    todos: Vec<UserTodo>,
    /// MCP session id -> agent name taken from `clientInfo`.
    sessions: HashMap<String, String>,
}

struct ServerHandle {
    server: Arc<tiny_http::Server>,
}

static RUNTIME: OnceLock<Mutex<Runtime>> = OnceLock::new();
static SERVER: Mutex<Option<ServerHandle>> = Mutex::new(None);
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);

fn runtime() -> &'static Mutex<Runtime> {
    RUNTIME.get_or_init(|| {
        Mutex::new(Runtime { board: AgentBoard::default(), todos: Vec::new(), sessions: HashMap::new() })
    })
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

fn data_path(app: &AppHandle, file: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(file))
}

fn random_token() -> String {
    let mut bytes = [0_u8; 24];
    getrandom::getrandom(&mut bytes).expect("the OS random source is available");
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn load_config(app: &AppHandle) -> AgentsConfig {
    let saved = data_path(app, CONFIG_FILE)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str::<AgentsConfig>(&raw).ok())
        .filter(|config| config.token.len() >= 32);
    saved.unwrap_or_else(|| {
        let config = AgentsConfig { enabled: true, token: random_token(), port: DEFAULT_PORT };
        let _ = save_config(app, &config);
        config
    })
}

fn save_config(app: &AppHandle, config: &AgentsConfig) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(data_path(app, CONFIG_FILE)?, raw).map_err(|error| error.to_string())
}

fn save_board(app: &AppHandle, board: &AgentBoard) {
    if let (Ok(path), Ok(raw)) = (data_path(app, BOARD_FILE), serde_json::to_string(board)) {
        let _ = fs::write(path, raw);
    }
}

fn clip(text: &str) -> String {
    let trimmed = text.trim();
    let mut clipped: String = trimmed.chars().take(MAX_TEXT).collect();
    if trimmed.chars().count() > MAX_TEXT {
        clipped.push('…');
    }
    clipped
}

/// "claude-code" -> "Claude Code", so the island shows a friendly name.
fn friendly_name(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("claude-code") || lower.contains("claude code") {
        return "Claude Code".to_string();
    }
    if lower.contains("codex") {
        return "Codex".to_string();
    }
    if lower.contains("cursor") {
        return "Cursor".to_string();
    }
    if lower.starts_with("claude") {
        return "Claude".to_string();
    }
    let words: Vec<String> = raw
        .split(['-', '_', ' '])
        .filter(|word| !word.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            chars.next().map(|first| first.to_uppercase().chain(chars).collect()).unwrap_or_default()
        })
        .collect();
    if words.is_empty() { "Agente".to_string() } else { clip(&words.join(" ")) }
}

fn agent_id(name: &str) -> String {
    name.to_lowercase().chars().filter(|ch| ch.is_alphanumeric()).collect()
}

fn tool_definitions() -> Value {
    let agent = json!({ "type": "string", "description": "Your name, if your client did not already send it (e.g. \"Claude Code\")." });
    json!([
        {
            "name": "set_plan",
            "description": "Show your current plan on the user's Nimbo island (a widget at the top of their screen). Call it when you start a multi-step task and again every time a step changes status; each call replaces your previous plan. Keep step titles short (under 60 characters).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "goal": { "type": "string", "description": "One short line saying what you are working on." },
                    "steps": {
                        "type": "array",
                        "maxItems": MAX_STEPS,
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": { "type": "string" },
                                "status": { "type": "string", "enum": ["pending", "in_progress", "completed"] }
                            },
                            "required": ["title", "status"]
                        }
                    },
                    "agent": agent
                },
                "required": ["steps"]
            }
        },
        {
            "name": "notify",
            "description": "Show a short message on the closed island, e.g. that you need the user's attention. Under 80 characters.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "message": { "type": "string" },
                    "level": { "type": "string", "enum": ["info", "success", "warning"] },
                    "agent": agent
                },
                "required": ["message"]
            }
        },
        {
            "name": "finish",
            "description": "Mark your plan as done and show a one-line summary on the island.",
            "inputSchema": {
                "type": "object",
                "properties": { "summary": { "type": "string" }, "agent": agent },
                "required": ["summary"]
            }
        },
        {
            "name": "clear_plan",
            "description": "Remove your plan from the island.",
            "inputSchema": { "type": "object", "properties": { "agent": agent } }
        },
        {
            "name": "add_user_task",
            "description": "Add a task to the USER's own to-do list in Nimbo. Only for things the user must do themselves (review something, answer a question, test on a device), not for your own steps.",
            "inputSchema": {
                "type": "object",
                "properties": { "title": { "type": "string" }, "agent": agent },
                "required": ["title"]
            }
        },
        {
            "name": "request_approval",
            "description": "Ask the user to approve or deny something before you do it (e.g. deleting files, running a migration, sending a message). The question appears on the user's Nimbo island with Approve and Deny buttons. Returns an id right away; then call check_approval with that id every few seconds until the status is approved or denied. Keep the question under 120 characters.",
            "inputSchema": {
                "type": "object",
                "properties": { "question": { "type": "string" }, "agent": agent },
                "required": ["question"]
            }
        },
        {
            "name": "check_approval",
            "description": "Read the user's answer to a request_approval call: pending, approved or denied.",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"]
            }
        },
        {
            "name": "list_user_tasks",
            "description": "Read the user's to-do list in Nimbo (titles and whether each is done).",
            "inputSchema": { "type": "object", "properties": {} }
        }
    ])
}

fn text_result(text: impl Into<String>, is_error: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": text.into() }], "isError": is_error })
}

fn rpc_result(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn upsert<'a>(board: &'a mut AgentBoard, name: &str) -> Result<&'a mut AgentEntry, String> {
    let id = agent_id(name);
    if let Some(index) = board.agents.iter().position(|agent| agent.id == id) {
        return Ok(&mut board.agents[index]);
    }
    if board.agents.len() >= MAX_AGENTS {
        // Make room by dropping the agent that was quiet the longest.
        if let Some(oldest) = board
            .agents
            .iter()
            .enumerate()
            .min_by_key(|(_, agent)| agent.updated_at)
            .map(|(index, _)| index)
        {
            board.agents.remove(oldest);
        }
    }
    board.agents.push(AgentEntry {
        id,
        name: name.to_string(),
        goal: None,
        steps: Vec::new(),
        state: "working".to_string(),
        message: None,
        updated_at: now_millis(),
    });
    Ok(board.agents.last_mut().expect("just pushed"))
}

/// Runs one tool. Returns the MCP result and the effects for the app.
fn call_tool(runtime: &mut Runtime, session_agent: Option<&str>, name: &str, args: &Map<String, Value>) -> (Value, Vec<Effect>) {
    let agent_name = args
        .get("agent")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(friendly_name)
        .or_else(|| session_agent.map(friendly_name))
        .unwrap_or_else(|| "Agente".to_string());
    let text = |key: &str| args.get(key).and_then(Value::as_str).map(clip).filter(|value| !value.is_empty());

    match name {
        "set_plan" => {
            let Some(raw_steps) = args.get("steps").and_then(Value::as_array) else {
                return (text_result("`steps` must be a list.", true), vec![]);
            };
            let mut steps = Vec::new();
            for step in raw_steps.iter().take(MAX_STEPS) {
                let title = step.get("title").and_then(Value::as_str).map(clip).unwrap_or_default();
                let status = step.get("status").and_then(Value::as_str).unwrap_or("pending");
                if title.is_empty() || !matches!(status, "pending" | "in_progress" | "completed") {
                    return (text_result("Each step needs a title and a status of pending, in_progress or completed.", true), vec![]);
                }
                steps.push(AgentStep { title, status: status.to_string() });
            }
            let done = steps.iter().filter(|step| step.status == "completed").count();
            let total = steps.len();
            let goal = text("goal");
            match upsert(&mut runtime.board, &agent_name) {
                Ok(entry) => {
                    entry.steps = steps;
                    if goal.is_some() {
                        entry.goal = goal;
                    }
                    entry.state = if total > 0 && done == total { "done" } else { "working" }.to_string();
                    entry.updated_at = now_millis();
                    (text_result(format!("Plan shown on the island ({done}/{total} done)."), false), vec![Effect::BoardChanged])
                }
                Err(error) => (text_result(error, true), vec![]),
            }
        }
        "notify" => {
            let Some(message) = text("message") else {
                return (text_result("`message` is required.", true), vec![]);
            };
            let level = match args.get("level").and_then(Value::as_str) {
                Some(level @ ("success" | "warning")) => level.to_string(),
                _ => "info".to_string(),
            };
            if let Ok(entry) = upsert(&mut runtime.board, &agent_name) {
                entry.message = Some(message.clone());
                entry.updated_at = now_millis();
            }
            (
                text_result("Shown on the island.", false),
                vec![Effect::BoardChanged, Effect::Notice { agent: agent_name, text: message, level }],
            )
        }
        "finish" => {
            let summary = text("summary").unwrap_or_else(|| "Done".to_string());
            if let Ok(entry) = upsert(&mut runtime.board, &agent_name) {
                for step in &mut entry.steps {
                    step.status = "completed".to_string();
                }
                entry.state = "done".to_string();
                entry.message = Some(summary.clone());
                entry.updated_at = now_millis();
            }
            (
                text_result("Marked as done on the island.", false),
                vec![
                    Effect::BoardChanged,
                    Effect::Notice { agent: agent_name, text: summary, level: "success".to_string() },
                ],
            )
        }
        "clear_plan" => {
            let id = agent_id(&agent_name);
            runtime.board.agents.retain(|agent| agent.id != id);
            (text_result("Removed from the island.", false), vec![Effect::BoardChanged])
        }
        "add_user_task" => match text("title") {
            Some(title) => (
                text_result("Added to the user's to-do list.", false),
                vec![Effect::AddTodo { agent: agent_name, title }],
            ),
            None => (text_result("`title` is required.", true), vec![]),
        },
        "request_approval" => {
            let Some(question) = text("question") else {
                return (text_result("`question` is required.", true), vec![]);
            };
            prune_approvals(&mut runtime.board.approvals, now_millis());
            if runtime.board.approvals.iter().filter(|approval| approval.status == "pending").count() >= MAX_APPROVALS {
                return (text_result("Too many questions are waiting for the user.", true), vec![]);
            }
            let id = format!("{:x}{:04x}", now_millis(), runtime.board.approvals.len());
            runtime.board.approvals.push(Approval {
                id: id.clone(),
                agent: agent_name,
                question,
                status: "pending".to_string(),
                created_at: now_millis(),
            });
            (
                text_result(format!("Asked the user. Call check_approval with id \"{id}\" until it is approved or denied."), false),
                vec![Effect::BoardChanged],
            )
        }
        "check_approval" => {
            let id = args.get("id").and_then(Value::as_str).unwrap_or_default();
            match runtime.board.approvals.iter().find(|approval| approval.id == id) {
                Some(approval) => (text_result(approval.status.clone(), false), vec![]),
                None => (text_result("Unknown or expired approval id.", true), vec![]),
            }
        }
        "list_user_tasks" => {
            let lines: Vec<String> = runtime
                .todos
                .iter()
                .map(|todo| format!("[{}] {}", if todo.done { "x" } else { " " }, todo.title))
                .collect();
            let body = if lines.is_empty() { "The user's to-do list is empty.".to_string() } else { lines.join("\n") };
            (text_result(body, false), vec![])
        }
        _ => (text_result(format!("Unknown tool: {name}"), true), vec![]),
    }
}

fn prune_approvals(approvals: &mut Vec<Approval>, now: i64) {
    approvals.retain(|approval| approval.status == "pending" || now - approval.created_at < APPROVAL_TTL_MS);
    if approvals.len() > MAX_APPROVALS * 2 {
        let excess = approvals.len() - MAX_APPROVALS * 2;
        approvals.drain(..excess);
    }
}

fn answer_approval(approvals: &mut [Approval], id: &str, approved: bool) -> bool {
    match approvals.iter_mut().find(|approval| approval.id == id && approval.status == "pending") {
        Some(approval) => {
            approval.status = if approved { "approved" } else { "denied" }.to_string();
            true
        }
        None => false,
    }
}

/// Handles one JSON-RPC message. `None` means "no response body" (a notification).
fn handle_rpc(runtime: &mut Runtime, session: Option<&str>, message: &Value) -> (Option<Value>, Vec<Effect>, Option<String>) {
    let id = message.get("id").cloned();
    let method = message.get("method").and_then(Value::as_str).unwrap_or_default();
    let Some(id) = id else {
        return (None, vec![], None); // notifications such as notifications/initialized
    };
    let session_agent = session.and_then(|key| runtime.sessions.get(key)).cloned();
    match method {
        "initialize" => {
            let client = message
                .pointer("/params/clientInfo/name")
                .and_then(Value::as_str)
                .unwrap_or("Agente")
                .to_string();
            let requested = message.pointer("/params/protocolVersion").and_then(Value::as_str);
            let version = match requested {
                Some(version @ ("2025-06-18" | "2025-03-26" | "2024-11-05")) => version,
                _ => PROTOCOL_VERSION,
            };
            let new_session = random_token();
            runtime.sessions.insert(new_session.clone(), client);
            let result = json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "nimbo", "title": "Nimbo", "version": env!("CARGO_PKG_VERSION") },
                "instructions": "Nimbo is a widget at the top of the user's screen. Use set_plan to show your steps while you work on multi-step tasks, finish when done, and add_user_task only for things the user must do."
            });
            (Some(rpc_result(&id, result)), vec![], Some(new_session))
        }
        "ping" => (Some(rpc_result(&id, json!({}))), vec![], None),
        "tools/list" => (Some(rpc_result(&id, json!({ "tools": tool_definitions() }))), vec![], None),
        "tools/call" => {
            let name = message.pointer("/params/name").and_then(Value::as_str).unwrap_or_default();
            let empty = Map::new();
            let args = message.pointer("/params/arguments").and_then(Value::as_object).unwrap_or(&empty);
            let (result, effects) = call_tool(runtime, session_agent.as_deref(), name, args);
            (Some(rpc_result(&id, result)), effects, None)
        }
        _ => (Some(rpc_error(&id, -32601, "Method not found")), vec![], None),
    }
}

/// Transport checks shared by every request. `Err` carries the HTTP status.
fn check_request(method: &str, path: &str, headers: &[(String, String)], token: &str, port: u16) -> Result<(), u16> {
    let header = |name: &str| {
        headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    };
    if path.split('?').next() != Some("/mcp") {
        return Err(404);
    }
    let host_ok = header("host").is_some_and(|host| {
        host == format!("127.0.0.1:{port}") || host == format!("localhost:{port}")
    });
    if !host_ok {
        return Err(403);
    }
    // Browsers always send Origin on cross-site requests; agents never need it.
    if header("origin").is_some() {
        return Err(403);
    }
    let expected = format!("Bearer {token}");
    let given = header("authorization").unwrap_or_default();
    if given.len() != expected.len()
        || given.bytes().zip(expected.bytes()).fold(0_u8, |acc, (a, b)| acc | (a ^ b)) != 0
    {
        return Err(401);
    }
    if method != "POST" {
        return Err(405);
    }
    Ok(())
}

fn apply_effects(app: &AppHandle, effects: Vec<Effect>) {
    for effect in effects {
        match effect {
            Effect::BoardChanged => {
                let board = runtime().lock().map(|guard| guard.board.clone()).unwrap_or_default();
                save_board(app, &board);
                let _ = app.emit("agents-board", board);
            }
            Effect::Notice { agent, text, level } => {
                let _ = app.emit("agents-notice", json!({ "agent": agent, "text": text, "level": level }));
            }
            Effect::AddTodo { agent, title } => {
                let _ = app.emit("agents-add-todo", json!({ "agent": agent, "title": title }));
            }
        }
    }
}

fn respond(request: tiny_http::Request, status: u16, body: Option<Value>, session: Option<String>) {
    let text = body.map(|value| value.to_string()).unwrap_or_default();
    let mut response = tiny_http::Response::from_string(text).with_status_code(status);
    if let Ok(header) = tiny_http::Header::from_bytes("Content-Type", "application/json") {
        response.add_header(header);
    }
    if let Some(session) = session {
        if let Ok(header) = tiny_http::Header::from_bytes("Mcp-Session-Id", session.as_bytes()) {
            response.add_header(header);
        }
    }
    let _ = request.respond(response);
}

fn serve(app: AppHandle, server: Arc<tiny_http::Server>, token: String, port: u16) {
    for mut request in server.incoming_requests() {
        let headers: Vec<(String, String)> = request
            .headers()
            .iter()
            .map(|header| (header.field.as_str().to_string(), header.value.as_str().to_string()))
            .collect();
        let method = request.method().as_str().to_uppercase();
        if let Err(status) = check_request(&method, request.url(), &headers, &token, port) {
            respond(request, status, None, None);
            continue;
        }
        let mut body = String::new();
        let read = request.as_reader().take(MAX_BODY_BYTES as u64 + 1).read_to_string(&mut body);
        if read.is_err() || body.len() > MAX_BODY_BYTES {
            respond(request, 413, None, None);
            continue;
        }
        let Ok(message) = serde_json::from_str::<Value>(&body) else {
            respond(request, 400, Some(rpc_error(&Value::Null, -32700, "Parse error")), None);
            continue;
        };
        let session = headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case("mcp-session-id"))
            .map(|(_, value)| value.clone());
        let (reply, effects, new_session) = match runtime().lock() {
            Ok(mut guard) => handle_rpc(&mut guard, session.as_deref(), &message),
            Err(_) => (Some(rpc_error(&Value::Null, -32603, "Busy")), vec![], None),
        };
        match reply {
            Some(reply) => respond(request, 200, Some(reply), new_session),
            None => respond(request, 202, None, None),
        }
        apply_effects(&app, effects);
    }
}

fn stop_server() {
    if let Ok(mut guard) = SERVER.lock() {
        if let Some(handle) = guard.take() {
            handle.server.unblock();
        }
    }
}

fn start_server(app: &AppHandle, config: &AgentsConfig) {
    stop_server();
    if !config.enabled {
        return;
    }
    match tiny_http::Server::http(("127.0.0.1", config.port)) {
        Ok(server) => {
            let server = Arc::new(server);
            let (app, token, port, worker) = (app.clone(), config.token.clone(), config.port, server.clone());
            thread::spawn(move || serve(app, worker, token, port));
            if let Ok(mut guard) = SERVER.lock() {
                *guard = Some(ServerHandle { server });
            }
            if let Ok(mut error) = LAST_ERROR.lock() {
                *error = None;
            }
        }
        Err(error) => {
            if let Ok(mut last) = LAST_ERROR.lock() {
                *last = Some(format!("Port {} is busy: {error}", config.port));
            }
        }
    }
}

/// Called once at startup: restores the board and starts the server.
pub(crate) fn init(app: &AppHandle) {
    if let Some(board) = data_path(app, BOARD_FILE)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str::<AgentBoard>(&raw).ok())
    {
        if let Ok(mut guard) = runtime().lock() {
            guard.board = board;
        }
    }
    start_server(app, &load_config(app));
}

fn info(app: &AppHandle) -> ServerInfo {
    let config = load_config(app);
    ServerInfo {
        enabled: config.enabled,
        running: SERVER.lock().map(|guard| guard.is_some()).unwrap_or(false),
        url: format!("http://127.0.0.1:{}/mcp", config.port),
        token: config.token,
        error: LAST_ERROR.lock().ok().and_then(|guard| guard.clone()),
    }
}

#[tauri::command]
pub(crate) fn agents_board() -> AgentBoard {
    runtime().lock().map(|guard| guard.board.clone()).unwrap_or_default()
}

#[tauri::command]
pub(crate) fn agents_server_info(app: AppHandle) -> ServerInfo {
    info(&app)
}

#[tauri::command]
pub(crate) fn agents_set_enabled(app: AppHandle, enabled: bool) -> Result<ServerInfo, String> {
    let mut config = load_config(&app);
    config.enabled = enabled;
    save_config(&app, &config)?;
    start_server(&app, &config);
    Ok(info(&app))
}

#[tauri::command]
pub(crate) fn agents_regenerate_token(app: AppHandle) -> Result<ServerInfo, String> {
    let mut config = load_config(&app);
    config.token = random_token();
    save_config(&app, &config)?;
    if let Ok(mut guard) = runtime().lock() {
        guard.sessions.clear();
    }
    start_server(&app, &config);
    Ok(info(&app))
}

#[tauri::command]
pub(crate) fn agents_clear(app: AppHandle, agent_id: Option<String>) -> AgentBoard {
    if let Ok(mut guard) = runtime().lock() {
        match agent_id {
            Some(id) => guard.board.agents.retain(|agent| agent.id != id),
            None => guard.board.agents.clear(),
        }
    }
    apply_effects(&app, vec![Effect::BoardChanged]);
    agents_board()
}

#[tauri::command]
pub(crate) fn agents_answer_approval(app: AppHandle, id: String, approved: bool) -> Result<AgentBoard, String> {
    let changed = runtime()
        .lock()
        .map(|mut guard| answer_approval(&mut guard.board.approvals, &id, approved))
        .map_err(|error| error.to_string())?;
    if !changed {
        return Err("This question was already answered or expired.".to_string());
    }
    apply_effects(&app, vec![Effect::BoardChanged]);
    Ok(agents_board())
}

/// The island keeps the user's to-dos; agents read them through this copy.
#[tauri::command]
pub(crate) fn agents_sync_todos(todos: Vec<UserTodo>) {
    if let Ok(mut guard) = runtime().lock() {
        guard.todos = todos.into_iter().take(200).map(|todo| UserTodo { title: clip(&todo.title), done: todo.done }).collect();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh() -> Runtime {
        Runtime { board: AgentBoard::default(), todos: Vec::new(), sessions: HashMap::new() }
    }

    fn headers(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs.iter().map(|(key, value)| (key.to_string(), value.to_string())).collect()
    }

    #[test]
    fn requests_need_loopback_host_token_and_no_origin() {
        let token = "t".repeat(48);
        let auth = format!("Bearer {token}");
        let ok = headers(&[("Host", "127.0.0.1:47615"), ("Authorization", &auth)]);
        assert_eq!(check_request("POST", "/mcp", &ok, &token, 47615), Ok(()));
        assert_eq!(check_request("GET", "/mcp", &ok, &token, 47615), Err(405));
        assert_eq!(check_request("POST", "/other", &ok, &token, 47615), Err(404));
        let rebinding = headers(&[("Host", "evil.example:47615"), ("Authorization", &auth)]);
        assert_eq!(check_request("POST", "/mcp", &rebinding, &token, 47615), Err(403));
        let browser = headers(&[("Host", "127.0.0.1:47615"), ("Authorization", &auth), ("Origin", "https://site.example")]);
        assert_eq!(check_request("POST", "/mcp", &browser, &token, 47615), Err(403));
        let wrong = headers(&[("Host", "localhost:47615"), ("Authorization", "Bearer nope")]);
        assert_eq!(check_request("POST", "/mcp", &wrong, &token, 47615), Err(401));
    }

    #[test]
    fn initialize_names_the_session_and_tools_are_listed() {
        let mut runtime = fresh();
        let (reply, _, session) = handle_rpc(
            &mut runtime,
            None,
            &json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"claude-code","version":"2"}}}),
        );
        let reply = reply.unwrap();
        assert_eq!(reply["result"]["protocolVersion"], "2025-06-18");
        let session = session.unwrap();
        assert_eq!(runtime.sessions.get(&session).map(String::as_str), Some("claude-code"));
        let (list, _, _) = handle_rpc(&mut runtime, Some(&session), &json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}));
        let names: Vec<_> = list.unwrap()["result"]["tools"].as_array().unwrap().iter().map(|tool| tool["name"].as_str().unwrap().to_string()).collect();
        assert!(names.contains(&"set_plan".to_string()) && names.contains(&"add_user_task".to_string()));
        let (none, _, _) = handle_rpc(&mut runtime, None, &json!({"jsonrpc":"2.0","method":"notifications/initialized"}));
        assert!(none.is_none());
        let (missing, _, _) = handle_rpc(&mut runtime, None, &json!({"jsonrpc":"2.0","id":3,"method":"resources/list"}));
        assert_eq!(missing.unwrap()["error"]["code"], -32601);
    }

    #[test]
    fn plans_land_on_the_board_under_the_client_name() {
        let mut runtime = fresh();
        runtime.sessions.insert("s".into(), "claude-code".into());
        let call = json!({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"set_plan","arguments":{
            "goal":"Corrigir o login","steps":[{"title":"Ler o código","status":"completed"},{"title":"Rodar testes","status":"in_progress"}]}}});
        let (reply, effects, _) = handle_rpc(&mut runtime, Some("s"), &call);
        assert_eq!(reply.unwrap()["result"]["isError"], false);
        assert_eq!(effects, vec![Effect::BoardChanged]);
        let agent = &runtime.board.agents[0];
        assert_eq!(agent.name, "Claude Code");
        assert_eq!(agent.goal.as_deref(), Some("Corrigir o login"));
        assert_eq!(agent.state, "working");

        let bad = json!({"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"set_plan","arguments":{"steps":[{"title":"x","status":"later"}]}}});
        assert_eq!(handle_rpc(&mut runtime, Some("s"), &bad).0.unwrap()["result"]["isError"], true);

        let finish = json!({"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"finish","arguments":{"summary":"Login corrigido"}}});
        let (_, effects, _) = handle_rpc(&mut runtime, Some("s"), &finish);
        assert_eq!(runtime.board.agents[0].state, "done");
        assert!(effects.iter().any(|effect| matches!(effect, Effect::Notice { level, .. } if level == "success")));
    }

    #[test]
    fn user_tasks_go_through_effects_and_are_readable() {
        let mut runtime = fresh();
        runtime.todos = vec![UserTodo { title: "Revisar PR".into(), done: false }];
        let add = json!({"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"add_user_task","arguments":{"title":"Testar no celular","agent":"codex-cli"}}});
        let (_, effects, _) = handle_rpc(&mut runtime, None, &add);
        assert_eq!(effects, vec![Effect::AddTodo { agent: "Codex".into(), title: "Testar no celular".into() }]);
        let list = json!({"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"list_user_tasks","arguments":{}}});
        let text = handle_rpc(&mut runtime, None, &list).0.unwrap()["result"]["content"][0]["text"].as_str().unwrap().to_string();
        assert_eq!(text, "[ ] Revisar PR");
    }

    #[test]
    fn names_are_friendly_and_text_is_clipped() {
        assert_eq!(friendly_name("claude-code"), "Claude Code");
        assert_eq!(friendly_name("my_cool-agent"), "My Cool Agent");
        assert_eq!(clip(&"a".repeat(300)).chars().count(), MAX_TEXT + 1);
    }

    #[test]
    fn approvals_wait_for_the_user_and_can_be_answered_once() {
        let mut runtime = fresh();
        let args = json!({ "question": "Apagar a pasta build?", "agent": "Claude Code" });
        let (result, effects) = call_tool(&mut runtime, None, "request_approval", args.as_object().unwrap());
        assert_eq!(effects, vec![Effect::BoardChanged]);
        let id = runtime.board.approvals[0].id.clone();
        assert!(result.to_string().contains(&id));
        let check = json!({ "id": id });
        let (status, _) = call_tool(&mut runtime, None, "check_approval", check.as_object().unwrap());
        assert!(status.to_string().contains("pending"));
        assert!(answer_approval(&mut runtime.board.approvals, &id, true));
        assert!(!answer_approval(&mut runtime.board.approvals, &id, false));
        let (status, _) = call_tool(&mut runtime, None, "check_approval", check.as_object().unwrap());
        assert!(status.to_string().contains("approved"));
    }

    #[test]
    fn answered_approvals_expire() {
        let mut approvals = vec![
            Approval { id: "a".into(), agent: "x".into(), question: "q".into(), status: "approved".into(), created_at: 0 },
            Approval { id: "b".into(), agent: "x".into(), question: "q".into(), status: "pending".into(), created_at: 0 },
        ];
        prune_approvals(&mut approvals, APPROVAL_TTL_MS + 1);
        assert_eq!(approvals.len(), 1);
        assert_eq!(approvals[0].id, "b");
    }
}

