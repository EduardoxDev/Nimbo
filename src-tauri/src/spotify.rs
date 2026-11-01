//! Spotify Connect remote for Nimbo Music: full songs play in the user's own
//! Spotify app (Premium) while Nimbo browses, queues and controls them.
//!
//! The web playback SDK needs Widevine, which WebView2 does not ship, so
//! Nimbo drives a Spotify device through the Web API instead. Sign-in uses
//! OAuth with PKCE against the user's own developer app: there is no client
//! secret, and the refresh token lives only in Windows Credential Manager.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

const CREDENTIAL_SERVICE: &str = "com.nimbo.app.spotify";
const CREDENTIAL_USER: &str = "connection";
const REDIRECT_ADDRESS: &str = "127.0.0.1:43827";
pub(crate) const REDIRECT_URI: &str = "http://127.0.0.1:43827/callback";
const SCOPES: &str = "user-read-playback-state user-modify-playback-state user-read-currently-playing user-read-private";
const API: &str = "https://api.spotify.com/v1";
const ACCOUNTS: &str = "https://accounts.spotify.com";
const TIMEOUT: Duration = Duration::from_secs(10);
const SIGN_IN_WAIT: Duration = Duration::from_secs(180);
/// Songs resolved and sent per play request; Spotify keeps going with its own suggestions after.
const PLAY_BATCH: usize = 25;

#[derive(Serialize, Deserialize, Clone, Default)]
struct Saved {
    client_id: String,
    refresh_token: Option<String>,
}

struct Access {
    token: String,
    expires: Instant,
}

static ACCESS: Mutex<Option<Access>> = Mutex::new(None);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpotifyStatus {
    connected: bool,
    client_id: Option<String>,
    name: Option<String>,
    premium: Option<bool>,
    redirect_uri: &'static str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WantedTrack {
    title: String,
    artist: String,
    isrc: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlayResult {
    found: usize,
    device: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlayingItem {
    id: String,
    title: String,
    artists: String,
    album: String,
    cover: Option<String>,
    isrc: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlaybackState {
    is_playing: bool,
    progress_ms: u64,
    duration_ms: u64,
    shuffle: bool,
    repeat: String,
    volume: Option<u64>,
    device: Option<String>,
    item: Option<PlayingItem>,
}

// ---------- Saved connection ----------

fn credential() -> Result<Entry, String> {
    Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER).map_err(|error| error.to_string())
}

fn read_saved() -> Result<Option<Saved>, String> {
    match credential()?.get_password() {
        Ok(raw) => Ok(serde_json::from_str(&raw).ok()),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read Windows Credential Manager: {error}")),
    }
}

fn write_saved(saved: &Saved) -> Result<(), String> {
    let raw = serde_json::to_string(saved).map_err(|error| error.to_string())?;
    credential()?
        .set_password(&raw)
        .map_err(|error| format!("Could not save to Windows Credential Manager: {error}"))
}

fn valid_client_id(client_id: &str) -> bool {
    client_id.len() == 32 && client_id.chars().all(|c| c.is_ascii_hexdigit())
}

// ---------- HTTP helpers ----------

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|error| format!("Could not start the Spotify client: {error}"))
}

/// `application/x-www-form-urlencoded` body without the reqwest `form` feature.
fn form(params: &[(&str, &str)]) -> Result<String, String> {
    reqwest::Url::parse_with_params("http://form.invalid/", params)
        .map(|url| url.query().unwrap_or_default().to_string())
        .map_err(|error| format!("Could not encode the request: {error}"))
}

fn random_text(bytes: usize) -> Result<String, String> {
    let mut buffer = vec![0u8; bytes];
    getrandom::getrandom(&mut buffer).map_err(|error| format!("No random source: {error}"))?;
    Ok(URL_SAFE_NO_PAD.encode(buffer))
}

#[derive(Deserialize)]
struct TokenAnswer {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
}

async fn request_token(params: &[(&str, &str)]) -> Result<TokenAnswer, String> {
    let response = client()?
        .post(format!("{ACCOUNTS}/api/token"))
        .header(reqwest::header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(form(params)?)
        .send()
        .await
        .map_err(|error| format!("Could not reach Spotify: {error}"))?;
    let status = response.status();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let reason = body
            .get("error_description")
            .or_else(|| body.get("error"))
            .and_then(Value::as_str)
            .unwrap_or("unknown error");
        return Err(format!("Spotify refused the sign-in: {reason}"));
    }
    serde_json::from_value(body).map_err(|error| format!("Unexpected Spotify answer: {error}"))
}

/// A valid access token, refreshing it (and rotating the saved refresh token) when needed.
async fn access_token() -> Result<String, String> {
    if let Some(access) = ACCESS.lock().map_err(|_| "Spotify state is unavailable")?.as_ref() {
        if access.expires > Instant::now() + Duration::from_secs(30) {
            return Ok(access.token.clone());
        }
    }
    let mut saved = read_saved()?.ok_or("Spotify is not connected.")?;
    let refresh = saved.refresh_token.clone().ok_or("Spotify is not connected.")?;
    let answer = request_token(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", &refresh),
        ("client_id", &saved.client_id),
    ])
    .await?;
    if let Some(next) = answer.refresh_token.clone() {
        saved.refresh_token = Some(next);
        write_saved(&saved)?;
    }
    let token = answer.access_token.clone();
    *ACCESS.lock().map_err(|_| "Spotify state is unavailable")? = Some(Access {
        token: answer.access_token,
        expires: Instant::now() + Duration::from_secs(answer.expires_in),
    });
    Ok(token)
}

/// Calls the Web API. `Ok(None)` means "204 No Content".
async fn api(method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Option<Value>, String> {
    let token = access_token().await?;
    let mut request = client()?.request(method, format!("{API}{path}")).bearer_auth(token);
    request = match body {
        Some(body) => request.json(&body),
        // Spotify wants an explicit empty body on PUT/POST without content.
        None => request.header(reqwest::header::CONTENT_LENGTH, "0"),
    };
    let response = request.send().await.map_err(|error| format!("Could not reach Spotify: {error}"))?;
    let status = response.status();
    if status == reqwest::StatusCode::NO_CONTENT || status == reqwest::StatusCode::ACCEPTED {
        return Ok(None);
    }
    let text = response.text().await.unwrap_or_default();
    if status.is_success() {
        return Ok(if text.trim().is_empty() { None } else { serde_json::from_str(&text).ok() });
    }
    if status == reqwest::StatusCode::UNAUTHORIZED {
        if let Ok(mut access) = ACCESS.lock() {
            *access = None;
        }
    }
    let error: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    let reason = error.pointer("/error/reason").and_then(Value::as_str).unwrap_or_default();
    let message = error.pointer("/error/message").and_then(Value::as_str).unwrap_or("unknown error");
    Err(match (status.as_u16(), reason) {
        (403, "PREMIUM_REQUIRED") => "PREMIUM_REQUIRED".into(),
        (404, _) | (_, "NO_ACTIVE_DEVICE") => "NO_DEVICE".into(),
        (429, _) => "Spotify asked to slow down; try again in a few seconds.".into(),
        (403, _) if message.to_lowercase().contains("user may not be registered") => "NOT_REGISTERED".into(),
        _ => format!("Spotify answered {}: {message}", status.as_u16()),
    })
}

// ---------- Sign-in ----------

#[tauri::command]
pub(crate) async fn spotify_status() -> Result<SpotifyStatus, String> {
    let saved = read_saved()?;
    let mut status = SpotifyStatus {
        connected: false,
        client_id: saved.as_ref().map(|saved| saved.client_id.clone()),
        name: None,
        premium: None,
        redirect_uri: REDIRECT_URI,
    };
    if saved.and_then(|saved| saved.refresh_token).is_none() {
        return Ok(status);
    }
    match api(reqwest::Method::GET, "/me", None).await {
        Ok(Some(me)) => {
            status.connected = true;
            status.name = me.get("display_name").and_then(Value::as_str).map(str::to_string);
            status.premium = me.get("product").and_then(Value::as_str).map(|product| product == "premium");
        }
        // Offline or a hiccup: keep showing the account as connected.
        Ok(None) => status.connected = true,
        Err(error) if error.starts_with("Could not reach") => status.connected = true,
        Err(_) => {}
    }
    Ok(status)
}

/// Opens Spotify's consent page in the browser and waits for it to come back
/// to the loopback address with a code, then trades the code for tokens.
#[tauri::command]
pub(crate) async fn spotify_connect(app: AppHandle, client_id: String) -> Result<SpotifyStatus, String> {
    let client_id = client_id.trim().to_string();
    if !valid_client_id(&client_id) {
        return Err("INVALID_CLIENT_ID".into());
    }
    let verifier = random_text(64)?;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_text(16)?;

    let server = tiny_http::Server::http(REDIRECT_ADDRESS)
        .map_err(|error| format!("Port 43827 is busy, so Spotify cannot answer: {error}"))?;
    let authorize = reqwest::Url::parse_with_params(
        &format!("{ACCOUNTS}/authorize"),
        &[
            ("response_type", "code"),
            ("client_id", client_id.as_str()),
            ("scope", SCOPES),
            ("redirect_uri", REDIRECT_URI),
            ("code_challenge_method", "S256"),
            ("code_challenge", challenge.as_str()),
            ("state", state.as_str()),
        ],
    )
    .map_err(|error| format!("Could not build the Spotify address: {error}"))?;
    app.opener()
        .open_url(authorize.as_str(), None::<&str>)
        .map_err(|error| format!("Could not open the browser: {error}"))?;

    let expected_state = state.clone();
    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(&server, &expected_state))
        .await
        .map_err(|error| format!("The sign-in stopped: {error}"))??;

    let answer = request_token(&[
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", REDIRECT_URI),
        ("client_id", &client_id),
        ("code_verifier", &verifier),
    ])
    .await?;
    write_saved(&Saved { client_id, refresh_token: answer.refresh_token.clone() })?;
    *ACCESS.lock().map_err(|_| "Spotify state is unavailable")? = Some(Access {
        token: answer.access_token,
        expires: Instant::now() + Duration::from_secs(answer.expires_in),
    });
    spotify_status().await
}

fn wait_for_code(server: &tiny_http::Server, expected_state: &str) -> Result<String, String> {
    let deadline = Instant::now() + SIGN_IN_WAIT;
    while Instant::now() < deadline {
        let Ok(Some(request)) = server.recv_timeout(Duration::from_millis(500)) else { continue };
        let url = reqwest::Url::parse(&format!("http://{REDIRECT_ADDRESS}{}", request.url()));
        let Ok(url) = url else { continue };
        if url.path() != "/callback" {
            let _ = request.respond(tiny_http::Response::empty(404));
            continue;
        }
        let value = |key: &str| url.query_pairs().find(|(name, _)| name == key).map(|(_, value)| value.into_owned());
        let ok = value("state").as_deref() == Some(expected_state) && value("code").is_some();
        let page = if ok { SIGNED_IN_PAGE } else { FAILED_PAGE };
        let mut response = tiny_http::Response::from_string(page);
        if let Ok(header) = tiny_http::Header::from_bytes("Content-Type", "text/html; charset=utf-8") {
            response = response.with_header(header);
        }
        let _ = request.respond(response);
        if ok {
            return Ok(value("code").unwrap_or_default());
        }
        let reason = value("error").unwrap_or_else(|| "the answer did not match".into());
        return Err(format!("Spotify sign-in was not completed: {reason}"));
    }
    Err("SIGN_IN_TIMEOUT".into())
}

const SIGNED_IN_PAGE: &str = r#"<!doctype html><meta charset="utf-8"><title>Nimbo Music</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#08080a;color:#f5f5f7;font:600 18px 'Segoe UI',system-ui,sans-serif">
<div style="text-align:center"><div style="font-size:54px">🎧</div><p>Spotify conectado ao Nimbo Music.</p><p style="color:#8e8e93;font-weight:500;font-size:14px">Pode fechar esta aba e voltar para o Nimbo.</p></div></body>"#;

const FAILED_PAGE: &str = r#"<!doctype html><meta charset="utf-8"><title>Nimbo Music</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#08080a;color:#f5f5f7;font:600 18px 'Segoe UI',system-ui,sans-serif">
<div style="text-align:center"><p>Não deu para conectar o Spotify.</p><p style="color:#8e8e93;font-weight:500;font-size:14px">Volte ao Nimbo e tente de novo.</p></div></body>"#;

/// Forgets the account but keeps the client ID, so reconnecting is one click.
#[tauri::command]
pub(crate) fn spotify_disconnect() -> Result<(), String> {
    if let Ok(mut access) = ACCESS.lock() {
        *access = None;
    }
    match read_saved()? {
        Some(saved) => write_saved(&Saved { client_id: saved.client_id, refresh_token: None }),
        None => Ok(()),
    }
}

// ---------- Playback ----------

async fn find_uri(track: &WantedTrack) -> Option<String> {
    let first_uri = |answer: Option<Value>| {
        answer?
            .pointer("/tracks/items/0/uri")
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    if let Some(isrc) = track.isrc.as_deref().filter(|isrc| isrc.chars().all(|c| c.is_ascii_alphanumeric())) {
        let path = format!("/search?type=track&limit=1&q={}", urlencode(&format!("isrc:{isrc}")));
        if let Some(uri) = first_uri(api(reqwest::Method::GET, &path, None).await.ok().flatten()) {
            return Some(uri);
        }
    }
    let query = format!("track:{} artist:{}", track.title, track.artist);
    let path = format!("/search?type=track&limit=1&q={}", urlencode(&query));
    if let Some(uri) = first_uri(api(reqwest::Method::GET, &path, None).await.ok().flatten()) {
        return Some(uri);
    }
    // Live and remastered titles often carry extras; a loose search catches those.
    let path = format!("/search?type=track&limit=1&q={}", urlencode(&format!("{} {}", track.title, track.artist)));
    first_uri(api(reqwest::Method::GET, &path, None).await.ok().flatten())
}

fn urlencode(text: &str) -> String {
    form(&[("q", text)]).map(|query| query.trim_start_matches("q=").to_string()).unwrap_or_default()
}

/// The active device, else this PC's Spotify app (started if needed).
async fn device_id(app: &AppHandle) -> Result<(String, String), String> {
    let pick = |answer: Option<Value>| -> Option<(String, String)> {
        let devices = answer?.get("devices")?.as_array()?.clone();
        let chosen = devices
            .iter()
            .find(|device| device.get("is_active").and_then(Value::as_bool) == Some(true))
            .or_else(|| devices.iter().find(|device| device.get("type").and_then(Value::as_str) == Some("Computer")))
            .or_else(|| devices.first())?;
        Some((
            chosen.get("id")?.as_str()?.to_string(),
            chosen.get("name").and_then(Value::as_str).unwrap_or("Spotify").to_string(),
        ))
    };
    if let Some(found) = pick(api(reqwest::Method::GET, "/me/player/devices", None).await?) {
        return Ok(found);
    }
    // Nothing is open: start the desktop app and wait for it to sign in.
    let _ = app.opener().open_url("spotify:", None::<&str>);
    for _ in 0..12 {
        tokio_sleep(Duration::from_millis(1000)).await;
        if let Some(found) = pick(api(reqwest::Method::GET, "/me/player/devices", None).await?) {
            return Ok(found);
        }
    }
    Err("NO_DEVICE".into())
}

async fn tokio_sleep(duration: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(duration)).await;
}

#[tauri::command]
pub(crate) async fn spotify_play(app: AppHandle, tracks: Vec<WantedTrack>, index: usize) -> Result<PlayResult, String> {
    let wanted: Vec<WantedTrack> = tracks.into_iter().skip(index).take(PLAY_BATCH).collect();
    if wanted.is_empty() {
        return Err("Nothing to play.".into());
    }
    let mut lookups = Vec::new();
    for track in wanted {
        lookups.push(tauri::async_runtime::spawn(async move { find_uri(&track).await }));
    }
    let mut uris = Vec::new();
    for lookup in lookups {
        if let Ok(Some(uri)) = lookup.await {
            if !uris.contains(&uri) {
                uris.push(uri);
            }
        }
    }
    if uris.is_empty() {
        return Err("NOT_ON_SPOTIFY".into());
    }
    let (id, name) = device_id(&app).await?;
    api(
        reqwest::Method::PUT,
        &format!("/me/player/play?device_id={}", urlencode(&id)),
        Some(json!({ "uris": uris, "position_ms": 0 })),
    )
    .await?;
    Ok(PlayResult { found: uris.len(), device: name })
}

#[tauri::command]
pub(crate) async fn spotify_queue(track: WantedTrack) -> Result<(), String> {
    let uri = find_uri(&track).await.ok_or("NOT_ON_SPOTIFY")?;
    api(reqwest::Method::POST, &format!("/me/player/queue?uri={}", urlencode(&uri)), None).await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn spotify_state() -> Result<Option<PlaybackState>, String> {
    let Some(state) = api(reqwest::Method::GET, "/me/player?additional_types=track", None).await? else {
        return Ok(None);
    };
    let text = |value: &Value, pointer: &str| value.pointer(pointer).and_then(Value::as_str).map(str::to_string);
    let item = state.get("item").filter(|item| !item.is_null()).map(|item| PlayingItem {
        id: text(item, "/id").unwrap_or_default(),
        title: text(item, "/name").unwrap_or_default(),
        artists: item
            .get("artists")
            .and_then(Value::as_array)
            .map(|artists| artists.iter().filter_map(|artist| artist.get("name")?.as_str()).collect::<Vec<_>>().join(", "))
            .unwrap_or_default(),
        album: text(item, "/album/name").unwrap_or_default(),
        cover: text(item, "/album/images/0/url"),
        isrc: text(item, "/external_ids/isrc"),
    });
    Ok(Some(PlaybackState {
        is_playing: state.get("is_playing").and_then(Value::as_bool).unwrap_or(false),
        progress_ms: state.get("progress_ms").and_then(Value::as_u64).unwrap_or(0),
        duration_ms: state.pointer("/item/duration_ms").and_then(Value::as_u64).unwrap_or(0),
        shuffle: state.get("shuffle_state").and_then(Value::as_bool).unwrap_or(false),
        repeat: text(&state, "/repeat_state").unwrap_or_else(|| "off".into()),
        volume: state.pointer("/device/volume_percent").and_then(Value::as_u64),
        device: text(&state, "/device/name"),
        item,
    }))
}

/// Transport controls. `value` is milliseconds for seek, 0–100 for volume,
/// 0/1 for shuffle and 0/1/2 (off/context/track) for repeat.
#[tauri::command]
pub(crate) async fn spotify_control(action: String, value: Option<i64>) -> Result<(), String> {
    let value = value.unwrap_or(0).max(0);
    let (method, path) = match action.as_str() {
        "play" => (reqwest::Method::PUT, "/me/player/play".to_string()),
        "pause" => (reqwest::Method::PUT, "/me/player/pause".to_string()),
        "next" => (reqwest::Method::POST, "/me/player/next".to_string()),
        "previous" => (reqwest::Method::POST, "/me/player/previous".to_string()),
        "seek" => (reqwest::Method::PUT, format!("/me/player/seek?position_ms={value}")),
        "volume" => (reqwest::Method::PUT, format!("/me/player/volume?volume_percent={}", value.min(100))),
        "shuffle" => (reqwest::Method::PUT, format!("/me/player/shuffle?state={}", value == 1)),
        "repeat" => (
            reqwest::Method::PUT,
            format!("/me/player/repeat?state={}", match value { 1 => "context", 2 => "track", _ => "off" }),
        ),
        _ => return Err(format!("Unknown Spotify action: {action}")),
    };
    api(method, &path, None).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_ids_are_32_hex_characters() {
        assert!(valid_client_id("0123456789abcdef0123456789ABCDEF"));
        assert!(!valid_client_id("0123456789abcdef"));
        assert!(!valid_client_id("0123456789abcdef0123456789abcdeg"));
    }

    #[test]
    fn search_queries_are_url_encoded() {
        assert_eq!(urlencode("isrc:USUG1"), "isrc%3AUSUG1");
        assert_eq!(urlencode("track:Pós artist:A&B"), "track%3AP%C3%B3s+artist%3AA%26B");
    }
}
