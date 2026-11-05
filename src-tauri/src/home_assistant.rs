//! Home Assistant bridge for the "Home" page: air conditioners (climate),
//! lights, switches and fans over the REST API of the user's own server.
//!
//! The access token lives only in Windows Credential Manager and never goes back
//! to the webview, and the webview can only call the few services listed in
//! `ALLOWED_SERVICES`, so a compromised page cannot drive the rest of the house.

use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::time::Duration;

const CREDENTIAL_SERVICE: &str = "com.nimbo.app.home-assistant";
const CREDENTIAL_USER: &str = "connection";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
const SUPPORTED_DOMAINS: [&str; 4] = ["climate", "light", "switch", "fan"];

/// Services the island may call, per domain, with the data keys each may send.
const ALLOWED_SERVICES: &[(&str, &str, &[&str])] = &[
    ("climate", "set_temperature", &["temperature"]),
    ("climate", "set_hvac_mode", &["hvac_mode"]),
    ("climate", "set_fan_mode", &["fan_mode"]),
    ("climate", "turn_on", &[]),
    ("climate", "turn_off", &[]),
    ("light", "toggle", &[]),
    ("switch", "toggle", &[]),
    ("fan", "toggle", &[]),
];

#[derive(Serialize, Deserialize)]
struct Connection {
    url: String,
    token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeStatus {
    configured: bool,
    url: Option<String>,
}

/// The parts of an entity the island shows; everything else stays on the server.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeEntity {
    entity_id: String,
    domain: String,
    name: String,
    state: String,
    current_temperature: Option<f64>,
    target_temperature: Option<f64>,
    min_temperature: Option<f64>,
    max_temperature: Option<f64>,
    temperature_step: Option<f64>,
    hvac_modes: Vec<String>,
    hvac_action: Option<String>,
    fan_mode: Option<String>,
    fan_modes: Vec<String>,
    unit: Option<String>,
}

fn credential() -> Result<Entry, String> {
    Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER).map_err(|error| error.to_string())
}

fn read_connection() -> Result<Option<Connection>, String> {
    match credential()?.get_password() {
        Ok(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|_| "The saved Home Assistant connection is damaged; connect again.".to_string()),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read Windows Credential Manager: {error}")),
    }
}

fn require_connection() -> Result<Connection, String> {
    read_connection()?.ok_or_else(|| "Home Assistant is not connected.".to_string())
}

/// Accepts `http(s)://host[:port][/path]`, drops a trailing slash and any `/api` suffix.
fn normalize_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    let trimmed = trimmed.strip_suffix("/api").unwrap_or(trimmed);
    let url = reqwest::Url::parse(trimmed)
        .map_err(|_| "Enter the address like http://homeassistant.local:8123".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("The address must start with http:// or https://".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() {
        return Err("Use only the server address, without user, password or parameters.".to_string());
    }
    Ok(trimmed.to_string())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("Could not prepare the connection: {error}"))
}

fn describe_failure(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "Home Assistant did not answer in time. Check the address and the network.".to_string()
    } else if error.is_connect() {
        "Could not reach Home Assistant at this address.".to_string()
    } else {
        format!("Home Assistant request failed: {error}")
    }
}

async fn get_json(connection: &Connection, path: &str) -> Result<Value, String> {
    let response = client()?
        .get(format!("{}{path}", connection.url))
        .bearer_auth(&connection.token)
        .send()
        .await
        .map_err(describe_failure)?;
    match response.status().as_u16() {
        200..=299 => response
            .json()
            .await
            .map_err(|error| format!("Home Assistant sent an unexpected answer: {error}")),
        401 | 403 => Err("Home Assistant refused the token. Create a new long-lived token.".to_string()),
        status => Err(format!("Home Assistant answered with error {status}.")),
    }
}

#[tauri::command]
pub(crate) fn home_assistant_status() -> Result<HomeStatus, String> {
    let connection = read_connection()?;
    Ok(HomeStatus {
        configured: connection.is_some(),
        url: connection.map(|connection| connection.url),
    })
}

/// Checks the address and token against `/api/` before saving them.
#[tauri::command]
pub(crate) async fn connect_home_assistant(url: String, token: String) -> Result<HomeStatus, String> {
    let token = token.trim().to_string();
    if token.len() < 20 || token.len() > 4_000 || token.chars().any(char::is_whitespace) {
        return Err("Paste the whole long-lived access token.".to_string());
    }
    let connection = Connection { url: normalize_url(&url)?, token };
    get_json(&connection, "/api/").await?;

    let raw = serde_json::to_string(&connection).map_err(|error| error.to_string())?;
    credential()?
        .set_password(&raw)
        .map_err(|error| format!("Could not save to Windows Credential Manager: {error}"))?;
    Ok(HomeStatus { configured: true, url: Some(connection.url) })
}

#[tauri::command]
pub(crate) fn disconnect_home_assistant() -> Result<(), String> {
    match credential()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not remove the saved connection: {error}")),
    }
}

#[tauri::command]
pub(crate) async fn home_assistant_entities() -> Result<Vec<HomeEntity>, String> {
    let connection = require_connection()?;
    let states = get_json(&connection, "/api/states").await?;
    let mut entities: Vec<HomeEntity> = states
        .as_array()
        .map(|items| items.iter().filter_map(entity_from_state).collect())
        .unwrap_or_default();
    entities.sort_by(|a, b| {
        domain_rank(&a.domain)
            .cmp(&domain_rank(&b.domain))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entities)
}

#[tauri::command]
pub(crate) async fn home_assistant_call(
    domain: String,
    service: String,
    entity_id: String,
    data: Option<Map<String, Value>>,
) -> Result<(), String> {
    let allowed_keys = ALLOWED_SERVICES
        .iter()
        .find(|(allowed_domain, allowed_service, _)| {
            *allowed_domain == domain && *allowed_service == service
        })
        .map(|(_, _, keys)| *keys)
        .ok_or_else(|| "This action is not allowed from the island.".to_string())?;
    if !is_valid_entity_id(&entity_id, &domain) {
        return Err("Unknown device.".to_string());
    }

    let mut body = Map::new();
    for (key, value) in data.unwrap_or_default() {
        if !allowed_keys.contains(&key.as_str()) || !(value.is_number() || value.is_string()) {
            return Err(format!("The value \"{key}\" is not allowed for this action."));
        }
        body.insert(key, value);
    }
    body.insert("entity_id".to_string(), Value::String(entity_id));
    post_service(&require_connection()?, &domain, &service, &body).await
}

/// Where Nimbo can reach you around the house: speakers that can talk, lights that can blink.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReachTargets {
    speakers: Vec<ReachTarget>,
    lights: Vec<ReachTarget>,
    /// A text-to-speech entity exists, so the speakers can actually talk.
    can_speak: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReachTarget {
    entity_id: String,
    name: String,
}

fn reach_targets_of(states: &Value) -> (Vec<ReachTarget>, Vec<ReachTarget>, Option<String>) {
    let mut speakers = Vec::new();
    let mut lights = Vec::new();
    let mut tts = None;
    for state in states.as_array().into_iter().flatten() {
        let Some(entity_id) = state.get("entity_id").and_then(Value::as_str) else { continue };
        if state.get("state").and_then(Value::as_str) == Some("unavailable") {
            continue;
        }
        let name = state
            .get("attributes")
            .and_then(|attributes| attributes.get("friendly_name"))
            .and_then(Value::as_str)
            .unwrap_or(entity_id)
            .to_string();
        let target = ReachTarget { entity_id: entity_id.to_string(), name };
        if is_valid_entity_id(entity_id, "media_player") {
            speakers.push(target);
        } else if is_valid_entity_id(entity_id, "light") {
            lights.push(target);
        } else if tts.is_none() && is_valid_entity_id(entity_id, "tts") {
            tts = Some(entity_id.to_string());
        }
    }
    speakers.sort_by_key(|target| target.name.to_lowercase());
    lights.sort_by_key(|target| target.name.to_lowercase());
    (speakers, lights, tts)
}

#[tauri::command]
pub(crate) async fn home_assistant_reach_targets() -> Result<ReachTargets, String> {
    let connection = require_connection()?;
    let (speakers, lights, tts) = reach_targets_of(&get_json(&connection, "/api/states").await?);
    Ok(ReachTargets { speakers, lights, can_speak: tts.is_some() })
}

/// Says a short notice on a speaker, with Home Assistant's own voice (tts.speak).
#[tauri::command]
pub(crate) async fn home_assistant_announce(speaker: String, message: String) -> Result<(), String> {
    if !is_valid_entity_id(&speaker, "media_player") {
        return Err("Unknown speaker.".to_string());
    }
    let message: String = message.chars().filter(|char| !char.is_control()).take(250).collect();
    if message.trim().is_empty() {
        return Err("Nothing to say.".to_string());
    }
    let connection = require_connection()?;
    let (_, _, tts) = reach_targets_of(&get_json(&connection, "/api/states").await?);
    let tts = tts.ok_or("Home Assistant has no voice (text-to-speech) set up. Add one in Settings → Voice assistants.")?;
    let mut body = Map::new();
    body.insert("entity_id".to_string(), Value::String(tts));
    body.insert("media_player_entity_id".to_string(), Value::String(speaker));
    body.insert("message".to_string(), Value::String(message));
    post_service(&connection, "tts", "speak", &body).await
}

/// Blinks a light a few times, to call you from another room.
#[tauri::command]
pub(crate) async fn home_assistant_flash(light: String) -> Result<(), String> {
    if !is_valid_entity_id(&light, "light") {
        return Err("Unknown light.".to_string());
    }
    let mut body = Map::new();
    body.insert("entity_id".to_string(), Value::String(light));
    body.insert("flash".to_string(), Value::String("long".to_string()));
    post_service(&require_connection()?, "light", "turn_on", &body).await
}

async fn post_service(connection: &Connection, domain: &str, service: &str, body: &Map<String, Value>) -> Result<(), String> {
    let response = client()?
        .post(format!("{}/api/services/{domain}/{service}", connection.url))
        .bearer_auth(&connection.token)
        .json(body)
        .send()
        .await
        .map_err(describe_failure)?;
    match response.status().as_u16() {
        200..=299 => Ok(()),
        401 | 403 => Err("Home Assistant refused the token. Create a new long-lived token.".to_string()),
        400 => Err("Home Assistant did not accept this value for the device.".to_string()),
        status => Err(format!("Home Assistant answered with error {status}.")),
    }
}

fn domain_rank(domain: &str) -> usize {
    SUPPORTED_DOMAINS
        .iter()
        .position(|candidate| *candidate == domain)
        .unwrap_or(SUPPORTED_DOMAINS.len())
}

fn is_valid_entity_id(entity_id: &str, domain: &str) -> bool {
    entity_id
        .strip_prefix(domain)
        .and_then(|rest| rest.strip_prefix('.'))
        .is_some_and(|object_id| {
            !object_id.is_empty()
                && object_id.len() <= 255
                && object_id
                    .chars()
                    .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
        })
}

fn entity_from_state(state: &Value) -> Option<HomeEntity> {
    let entity_id = state.get("entity_id")?.as_str()?.to_string();
    let domain = entity_id.split('.').next()?.to_string();
    if !SUPPORTED_DOMAINS.contains(&domain.as_str()) {
        return None;
    }
    let value = state.get("state")?.as_str()?.to_string();
    if value == "unavailable" {
        return None;
    }
    let attributes = state.get("attributes").and_then(Value::as_object);
    let attribute = |key: &str| attributes.and_then(|map| map.get(key));
    let number = |key: &str| attribute(key).and_then(Value::as_f64);
    let text = |key: &str| attribute(key).and_then(Value::as_str).map(str::to_string);
    let list = |key: &str| {
        attribute(key)
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default()
    };

    Some(HomeEntity {
        name: text("friendly_name").unwrap_or_else(|| entity_id.clone()),
        entity_id,
        domain,
        state: value,
        current_temperature: number("current_temperature"),
        target_temperature: number("temperature"),
        min_temperature: number("min_temp"),
        max_temperature: number("max_temp"),
        temperature_step: number("target_temp_step"),
        hvac_modes: list("hvac_modes"),
        hvac_action: text("hvac_action"),
        fan_mode: text("fan_mode"),
        fan_modes: list("fan_modes"),
        unit: text("temperature_unit").or_else(|| text("unit_of_measurement")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn addresses_are_normalized_and_unsafe_ones_rejected() {
        assert_eq!(normalize_url(" http://homeassistant.local:8123/ ").unwrap(), "http://homeassistant.local:8123");
        assert_eq!(normalize_url("https://casa.example.com/api").unwrap(), "https://casa.example.com");
        assert!(normalize_url("ftp://casa").is_err());
        assert!(normalize_url("homeassistant.local").is_err());
        assert!(normalize_url("http://user:pass@casa:8123").is_err());
        assert!(normalize_url("http://casa:8123/?x=1").is_err());
    }

    #[test]
    fn speakers_lights_and_a_voice_are_found() {
        let states = json!([
            { "entity_id": "media_player.echo_sala", "state": "idle", "attributes": { "friendly_name": "Echo da sala" } },
            { "entity_id": "media_player.tv", "state": "unavailable", "attributes": {} },
            { "entity_id": "light.escritorio", "state": "off", "attributes": { "friendly_name": "Escritório" } },
            { "entity_id": "tts.google_pt", "state": "unknown", "attributes": {} },
            { "entity_id": "switch.cafeteira", "state": "off", "attributes": {} }
        ]);
        let (speakers, lights, tts) = reach_targets_of(&states);
        assert_eq!(speakers.iter().map(|target| target.name.as_str()).collect::<Vec<_>>(), ["Echo da sala"]);
        assert_eq!(lights.iter().map(|target| target.entity_id.as_str()).collect::<Vec<_>>(), ["light.escritorio"]);
        assert_eq!(tts.as_deref(), Some("tts.google_pt"));
    }

    #[test]
    fn entity_ids_must_match_the_domain() {
        assert!(is_valid_entity_id("climate.ar_da_sala", "climate"));
        assert!(!is_valid_entity_id("light.sala", "climate"));
        assert!(!is_valid_entity_id("climate.", "climate"));
        assert!(!is_valid_entity_id("climate.sala/../x", "climate"));
        assert!(!is_valid_entity_id("climate.Sala", "climate"));
    }

    #[test]
    fn climate_states_keep_only_what_the_island_needs() {
        let entity = entity_from_state(&json!({
            "entity_id": "climate.ar_da_sala",
            "state": "cool",
            "attributes": {
                "friendly_name": "Ar da sala",
                "current_temperature": 26.5,
                "temperature": 22,
                "min_temp": 16,
                "max_temp": 30,
                "target_temp_step": 1,
                "hvac_modes": ["off", "cool", "heat", "auto"],
                "hvac_action": "cooling",
                "access_token": "should never be copied"
            }
        }))
        .unwrap();
        assert_eq!(entity.name, "Ar da sala");
        assert_eq!(entity.target_temperature, Some(22.0));
        assert_eq!(entity.hvac_modes, vec!["off", "cool", "heat", "auto"]);
        assert!(!serde_json::to_string(&entity).unwrap().contains("should never"));
        assert!(entity_from_state(&json!({"entity_id": "sensor.x", "state": "1"})).is_none());
        assert!(entity_from_state(&json!({"entity_id": "light.x", "state": "unavailable"})).is_none());
    }
}
