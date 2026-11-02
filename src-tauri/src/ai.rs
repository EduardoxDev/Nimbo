//! Which AI answers the island's assistant and the quick translation.
//!
//! Claude keeps its native Messages API (see `assistant.rs`). Ollama (on this
//! PC), Gemini and Groq are free and all speak the OpenAI chat format, so this
//! module converts the conversation the webview keeps (Anthropic-style content
//! blocks) to that format and the answer back. The webview never sees a key.

use keyring::{Entry, Error as KeyringError};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::time::Duration;

const CREDENTIAL_SERVICE: &str = "com.nimbo.app.ai";
const CHOICE_USER: &str = "provider";
const OLLAMA: &str = "http://127.0.0.1:11434";
/// Small models that call tools well, best first. `qwen2.5:7b` is the one Settings offers to download.
const OLLAMA_PREFERRED: [&str; 7] = ["qwen3", "qwen2.5", "llama3.2", "llama3.1", "mistral-nemo", "mistral", "gemma3"];
pub(crate) const OLLAMA_SUGGESTED: &str = "qwen2.5:7b";
const GEMINI_BASE: &str = "https://generativelanguage.googleapis.com/v1beta/openai";
const GEMINI_PREFERRED: [&str; 3] = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-2.0-flash"];
const GROQ_BASE: &str = "https://api.groq.com/openai/v1";
const GROQ_PREFERRED: [&str; 3] = ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "llama-3.1-8b-instant"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Provider {
    Claude,
    Gemini,
    Groq,
    Ollama,
}

impl Provider {
    fn parse(name: &str) -> Option<Self> {
        match name {
            "claude" => Some(Self::Claude),
            "gemini" => Some(Self::Gemini),
            "groq" => Some(Self::Groq),
            "ollama" => Some(Self::Ollama),
            _ => None,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Gemini => "gemini",
            Self::Groq => "groq",
            Self::Ollama => "ollama",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiStatus {
    provider: &'static str,
    ready: bool,
    claude: bool,
    gemini: bool,
    groq: bool,
    ollama_running: bool,
    ollama_models: Vec<String>,
    ollama_suggested: &'static str,
}

// ---------- Saved choice and keys ----------

fn entry(user: &str) -> Result<Entry, String> {
    Entry::new(CREDENTIAL_SERVICE, user).map_err(|error| error.to_string())
}

fn read(user: &str) -> Option<String> {
    match entry(user).ok()?.get_password() {
        Ok(value) => Some(value),
        Err(KeyringError::NoEntry) | Err(_) => None,
    }
}

fn key_for(provider: Provider) -> Option<String> {
    match provider {
        Provider::Claude => crate::assistant::read_key().ok().flatten(),
        Provider::Gemini => read("gemini"),
        Provider::Groq => read("groq"),
        Provider::Ollama => None,
    }
}

/// The chosen provider; with no choice yet, the first one that can answer.
pub(crate) fn chosen() -> Provider {
    if let Some(provider) = read(CHOICE_USER).as_deref().and_then(Provider::parse) {
        return provider;
    }
    [Provider::Claude, Provider::Gemini, Provider::Groq]
        .into_iter()
        .find(|provider| key_for(*provider).is_some())
        .unwrap_or(Provider::Ollama)
}

async fn ollama_models() -> Option<Vec<String>> {
    let body: Value = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .ok()?
        .get(format!("{OLLAMA}/api/tags"))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    Some(
        body.get("models")
            .and_then(Value::as_array)
            .map(|models| models.iter().filter_map(|model| model.get("name")?.as_str().map(str::to_string)).collect())
            .unwrap_or_default(),
    )
}

fn pick_ollama(models: &[String]) -> Option<String> {
    OLLAMA_PREFERRED
        .iter()
        .find_map(|family| models.iter().find(|model| model.starts_with(family)).cloned())
        .or_else(|| models.iter().find(|model| !model.contains("embed")).cloned())
}

/// Ready to answer: a key for cloud providers, a running Ollama with a chat model for local.
pub(crate) async fn ready(provider: Provider) -> bool {
    match provider {
        Provider::Ollama => ollama_models().await.is_some_and(|models| pick_ollama(&models).is_some()),
        other => key_for(other).is_some(),
    }
}

#[tauri::command]
pub(crate) async fn ai_status() -> Result<AiStatus, String> {
    let provider = chosen();
    let models = ollama_models().await;
    Ok(AiStatus {
        provider: provider.name(),
        ready: ready(provider).await,
        claude: key_for(Provider::Claude).is_some(),
        gemini: key_for(Provider::Gemini).is_some(),
        groq: key_for(Provider::Groq).is_some(),
        ollama_running: models.is_some(),
        ollama_models: models.unwrap_or_default(),
        ollama_suggested: OLLAMA_SUGGESTED,
    })
}

#[tauri::command]
pub(crate) async fn ai_set_provider(provider: String) -> Result<AiStatus, String> {
    let parsed = Provider::parse(&provider).ok_or("Unknown AI provider.")?;
    entry(CHOICE_USER)?
        .set_password(parsed.name())
        .map_err(|error| format!("Could not save the choice: {error}"))?;
    ai_status().await
}

/// Checks a Gemini or Groq key by listing models (free) before keeping it.
#[tauri::command]
pub(crate) async fn ai_save_key(provider: String, key: String) -> Result<AiStatus, String> {
    let parsed = Provider::parse(&provider).ok_or("Unknown AI provider.")?;
    let key = key.trim().to_string();
    if key.len() < 20 || key.len() > 400 || key.chars().any(char::is_whitespace) {
        return Err("AI_KEY".into());
    }
    match parsed {
        Provider::Claude => {
            crate::assistant::assistant_save_key(key)?;
        }
        Provider::Gemini | Provider::Groq => {
            list_models(parsed, &key).await?;
            entry(parsed.name())?
                .set_password(&key)
                .map_err(|error| format!("Could not save to Windows Credential Manager: {error}"))?;
        }
        Provider::Ollama => return Err("Ollama needs no key.".into()),
    }
    ai_set_provider(parsed.name().to_string()).await
}

#[tauri::command]
pub(crate) async fn ai_delete_key(provider: String) -> Result<AiStatus, String> {
    match Provider::parse(&provider).ok_or("Unknown AI provider.")? {
        Provider::Claude => crate::assistant::assistant_delete_key()?,
        Provider::Ollama => {}
        other => match entry(other.name())?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => {}
            Err(error) => return Err(format!("Could not remove the key: {error}")),
        },
    }
    ai_status().await
}

/// Downloads the suggested local model. Several gigabytes, so no timeout.
#[tauri::command]
pub(crate) async fn ai_ollama_pull() -> Result<AiStatus, String> {
    let response = reqwest::Client::new()
        .post(format!("{OLLAMA}/api/pull"))
        .json(&json!({ "model": OLLAMA_SUGGESTED, "stream": false }))
        .send()
        .await
        .map_err(|_| "OLLAMA_OFF".to_string())?;
    if !response.status().is_success() {
        return Err(format!("Ollama could not download the model ({}).", response.status().as_u16()));
    }
    ai_status().await
}

// ---------- OpenAI-format requests ----------

fn base(provider: Provider) -> &'static str {
    match provider {
        Provider::Gemini => GEMINI_BASE,
        Provider::Groq => GROQ_BASE,
        _ => "http://127.0.0.1:11434/v1",
    }
}

fn client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| format!("Could not start the request: {error}"))
}

async fn list_models(provider: Provider, key: &str) -> Result<Vec<String>, String> {
    let response = client(Duration::from_secs(10))?
        .get(format!("{}/models", base(provider)))
        .bearer_auth(key)
        .send()
        .await
        .map_err(|error| format!("Could not reach {}: {error}", provider.name()))?;
    match response.status().as_u16() {
        200 => {}
        400 | 401 | 403 => return Err("AI_KEY".into()),
        code => return Err(format!("{} answered {code}.", provider.name())),
    }
    let body: Value = response.json().await.unwrap_or(Value::Null);
    Ok(body
        .get("data")
        .and_then(Value::as_array)
        .map(|models| {
            models
                .iter()
                .filter_map(|model| model.get("id")?.as_str())
                // Gemini lists "models/gemini-…"; the chat endpoint wants the bare id.
                .map(|id| id.trim_start_matches("models/").to_string())
                .collect()
        })
        .unwrap_or_default())
}

async fn model_for(provider: Provider, key: Option<&str>) -> Result<String, String> {
    match provider {
        Provider::Ollama => {
            let models = ollama_models().await.ok_or("OLLAMA_OFF")?;
            pick_ollama(&models).ok_or_else(|| "OLLAMA_NO_MODEL".to_string())
        }
        Provider::Gemini | Provider::Groq => {
            let preferred: &[&str] = if provider == Provider::Gemini { &GEMINI_PREFERRED } else { &GROQ_PREFERRED };
            let available = list_models(provider, key.unwrap_or_default()).await.unwrap_or_default();
            Ok(preferred
                .iter()
                .find(|model| available.iter().any(|item| item == *model))
                .map(|model| model.to_string())
                // The list can fail or change; the first preference is still a sensible guess.
                .unwrap_or_else(|| preferred[0].to_string()))
        }
        Provider::Claude => Err("Claude uses its own API.".into()),
    }
}

/// Anthropic-style tools into OpenAI "function" tools.
pub(crate) fn openai_tools(tools: &Value) -> Value {
    Value::Array(
        tools
            .as_array()
            .map(|tools| {
                tools
                    .iter()
                    .map(|tool| {
                        json!({
                            "type": "function",
                            "function": {
                                "name": tool["name"],
                                "description": tool["description"],
                                "parameters": tool["input_schema"],
                            }
                        })
                    })
                    .collect()
            })
            .unwrap_or_default(),
    )
}

fn text_of(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|block| block.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n\n"),
        _ => String::new(),
    }
}

/// The webview's conversation (Anthropic content blocks) as OpenAI chat messages.
pub(crate) fn openai_messages(system: &str, messages: &[Value]) -> Vec<Value> {
    let mut out = vec![json!({ "role": "system", "content": system })];
    for message in messages {
        let role = message.get("role").and_then(Value::as_str).unwrap_or("user");
        let content = message.get("content").cloned().unwrap_or(Value::Null);
        let blocks = content.as_array().cloned().unwrap_or_default();
        if role == "assistant" {
            let calls: Vec<Value> = blocks
                .iter()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_use"))
                .map(|block| {
                    json!({
                        "id": block["id"],
                        "type": "function",
                        "function": {
                            "name": block["name"],
                            "arguments": serde_json::to_string(&block["input"]).unwrap_or_else(|_| "{}".into()),
                        }
                    })
                })
                .collect();
            // A sentence written next to tool calls is a draft; sending it back makes
            // Gemini repeat it in the final answer, so tool turns go without it.
            let text = if calls.is_empty() { text_of(&content) } else { String::new() };
            let mut turn = Map::new();
            turn.insert("role".into(), json!("assistant"));
            turn.insert("content".into(), if text.is_empty() { Value::Null } else { json!(text) });
            if !calls.is_empty() {
                turn.insert("tool_calls".into(), Value::Array(calls));
            }
            out.push(Value::Object(turn));
            continue;
        }
        // A user turn is either tool results or text (with the volatile context block).
        let results: Vec<&Value> = blocks
            .iter()
            .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_result"))
            .collect();
        for result in &results {
            out.push(json!({
                "role": "tool",
                "tool_call_id": result["tool_use_id"],
                "content": text_of(&result["content"]).chars().take(8_000).collect::<String>()
                    + if result.get("is_error").and_then(Value::as_bool) == Some(true) { " (error)" } else { "" },
            }));
        }
        let text = text_of(&content);
        if !text.is_empty() {
            out.push(json!({ "role": "user", "content": text }));
        }
    }
    out
}

/// The OpenAI answer as `{ stopReason, content }` in Anthropic blocks, like `assistant_step` returns.
pub(crate) fn from_openai(answer: &Value) -> Value {
    let message = answer.pointer("/choices/0/message").cloned().unwrap_or(Value::Null);
    let mut content = Vec::new();
    if let Some(text) = message.get("content").and_then(Value::as_str).map(str::trim).filter(|text| !text.is_empty()) {
        content.push(json!({ "type": "text", "text": text }));
    }
    let calls = message.get("tool_calls").and_then(Value::as_array).cloned().unwrap_or_default();
    for (index, call) in calls.iter().enumerate() {
        let id = call.get("id").and_then(Value::as_str).filter(|id| !id.is_empty()).map(str::to_string).unwrap_or_else(|| format!("call_{index}"));
        let arguments = call.pointer("/function/arguments");
        // Most providers send the arguments as a JSON string; some send an object.
        let input = match arguments {
            Some(Value::String(raw)) => serde_json::from_str(raw).unwrap_or_else(|_| json!({})),
            Some(Value::Object(object)) => Value::Object(object.clone()),
            _ => json!({}),
        };
        content.push(json!({
            "type": "tool_use",
            "id": id,
            "name": call.pointer("/function/name").cloned().unwrap_or(json!("")),
            "input": input,
        }));
    }
    let stop = if calls.is_empty() { "end_turn" } else { "tool_use" };
    json!({ "stopReason": stop, "content": content })
}

/// One chat request to a free provider: the assistant step and the translation both use it.
pub(crate) async fn chat(provider: Provider, messages: Vec<Value>, tools: Option<Value>) -> Result<Value, String> {
    let key = key_for(provider);
    if provider != Provider::Ollama && key.is_none() {
        return Err("AI_NOT_READY".into());
    }
    let model = model_for(provider, key.as_deref()).await?;
    let mut body = json!({ "model": model, "messages": messages, "temperature": 0.3 });
    if let Some(tools) = tools {
        body["tools"] = tools;
        body["tool_choice"] = json!("auto");
    }
    // A local model can take a while to load into memory the first time.
    let timeout = if provider == Provider::Ollama { Duration::from_secs(240) } else { Duration::from_secs(60) };
    let mut request = client(timeout)?.post(format!("{}/chat/completions", base(provider))).json(&body);
    if let Some(key) = key {
        request = request.bearer_auth(key);
    }
    let response = request.send().await.map_err(|error| {
        if provider == Provider::Ollama && error.is_connect() {
            "OLLAMA_OFF".to_string()
        } else if error.is_timeout() {
            "AI_SLOW".to_string()
        } else {
            format!("Could not reach {}: {error}", provider.name())
        }
    })?;
    let status = response.status().as_u16();
    let answer: Value = response.json().await.unwrap_or(Value::Null);
    match status {
        200 => Ok(answer),
        400 if provider == Provider::Gemini && answer.to_string().contains("API key") => Err("AI_KEY".into()),
        401 | 403 => Err("AI_KEY".into()),
        429 => Err("AI_LIMIT".into()),
        _ => {
            let detail = answer
                .pointer("/error/message")
                .or_else(|| answer.pointer("/0/error/message"))
                .and_then(Value::as_str)
                .unwrap_or("unknown error");
            Err(format!("{} answered {status}: {detail}", provider.name()))
        }
    }
}

/// Plain completion (no tools) for the translator.
pub(crate) async fn complete(provider: Provider, system: &str, text: &str) -> Result<String, String> {
    let answer = chat(provider, openai_messages(system, &[json!({ "role": "user", "content": text })]), None).await?;
    let output = answer.pointer("/choices/0/message/content").and_then(Value::as_str).unwrap_or_default().trim().to_string();
    if output.is_empty() {
        return Err("The AI did not return a translation.".into());
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tool_round_trip_converts_both_ways() {
        let conversation = vec![
            json!({ "role": "user", "content": [{ "type": "text", "text": "liga o ar em 22" }, { "type": "text", "text": "Language: pt-BR" }] }),
            json!({ "role": "assistant", "content": [
                { "type": "thinking", "thinking": "", "signature": "x" },
                { "type": "tool_use", "id": "t1", "name": "air_conditioner", "input": { "action": "set_temperature", "temperature": 22 } }
            ] }),
            json!({ "role": "user", "content": [{ "type": "tool_result", "tool_use_id": "t1", "content": "AC set to 22." }] }),
        ];
        let messages = openai_messages("system", &conversation);
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[1]["content"], "liga o ar em 22\n\nLanguage: pt-BR");
        assert_eq!(messages[2]["role"], "assistant");
        assert_eq!(messages[2]["content"], Value::Null);
        assert_eq!(messages[2]["tool_calls"][0]["function"]["name"], "air_conditioner");
        assert_eq!(messages[2]["tool_calls"][0]["function"]["arguments"], r#"{"action":"set_temperature","temperature":22}"#);
        assert_eq!(messages[3]["role"], "tool");
        assert_eq!(messages[3]["tool_call_id"], "t1");
        assert_eq!(messages.len(), 4);

        let drafted = openai_messages("s", &[json!({ "role": "assistant", "content": [
            { "type": "text", "text": "Vou ver." },
            { "type": "tool_use", "id": "t2", "name": "get_status", "input": {} }
        ] })]);
        assert_eq!(drafted[1]["content"], Value::Null);

        let answer = json!({ "choices": [{ "message": { "content": null, "tool_calls": [
            { "id": "", "type": "function", "function": { "name": "add_task", "arguments": "{\"title\":\"Pagar conta\"}" } }
        ] } }] });
        let step = from_openai(&answer);
        assert_eq!(step["stopReason"], "tool_use");
        assert_eq!(step["content"][0]["type"], "tool_use");
        assert_eq!(step["content"][0]["id"], "call_0");
        assert_eq!(step["content"][0]["input"]["title"], "Pagar conta");

        let done = from_openai(&json!({ "choices": [{ "message": { "content": "Pronto, ar em 22°." } }] }));
        assert_eq!(done["stopReason"], "end_turn");
        assert_eq!(done["content"][0]["text"], "Pronto, ar em 22°.");
    }

    #[test]
    fn tools_become_functions() {
        let tools = json!([{ "name": "log_water", "description": "Water.", "strict": true, "input_schema": { "type": "object" } }]);
        let converted = openai_tools(&tools);
        assert_eq!(converted[0]["type"], "function");
        assert_eq!(converted[0]["function"]["name"], "log_water");
        assert_eq!(converted[0]["function"]["parameters"]["type"], "object");
    }

    #[test]
    fn the_best_local_model_is_picked() {
        let models = vec!["nomic-embed-text:latest".to_string(), "llama3.1:8b".to_string(), "qwen2.5:7b".to_string()];
        assert_eq!(pick_ollama(&models).as_deref(), Some("qwen2.5:7b"));
        assert_eq!(pick_ollama(&["nomic-embed-text".to_string()]), None);
        assert_eq!(pick_ollama(&["phi4:14b".to_string()]).as_deref(), Some("phi4:14b"));
    }
}
