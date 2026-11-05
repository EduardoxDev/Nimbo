//! Nimbo away from home: keeps a WebSocket open to the user's own relay
//! (relay/ in this repository, on Cloudflare) so the iPhone app can see the
//! island and control the PC from anywhere. The room id and its secret code are
//! made here and handed to the phone by QR code; nothing else is shared.

use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::ErrorKind,
    net::TcpStream,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use tungstenite::{stream::MaybeTlsStream, Message, WebSocket};

const SEND_EVERY: Duration = Duration::from_millis(2_000);
const MAX_COVER: usize = 850_000;
/** Same limit as relay/src/files.ts. */
const MAX_FILE: u64 = 25 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone, Default)]
struct Config {
    url: String,
    room: String,
    key: String,
    /// Only this PC knows it (never in the QR code): the relay lets in as "pc" only who has it.
    #[serde(default)]
    pc_key: String,
    enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RelayInfo {
    enabled: bool,
    url: String,
    connected: bool,
    /// https://<relay>/pair#… : opens the web app, and the iPhone app reads it too.
    pair_link: Option<String>,
    qr_svg: Option<String>,
    error: Option<String>,
}

static APP: OnceLock<AppHandle> = OnceLock::new();
static CONFIG: Mutex<Option<Config>> = Mutex::new(None);
static CONNECTED: AtomicBool = AtomicBool::new(false);
static GENERATION: AtomicU64 = AtomicU64::new(0);
static OUTBOX: Mutex<Vec<String>> = Mutex::new(Vec::new());
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);

fn random_hex(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    let _ = getrandom::getrandom(&mut buffer);
    buffer.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn config_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("relay.json"))
}

fn load(app: &AppHandle) -> Config {
    let mut config: Config = config_file(app).and_then(|file| fs::read_to_string(file).ok()).and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
    if config.room.len() != 32 || config.key.len() != 48 {
        config.room = random_hex(16);
        config.key = random_hex(24);
        config.pc_key = random_hex(24);
        save(app, &config);
    }
    if config.pc_key.len() != 48 {
        config.pc_key = random_hex(24);
        save(app, &config);
    }
    config
}

fn save(app: &AppHandle, config: &Config) {
    if let (Some(file), Ok(text)) = (config_file(app), serde_json::to_string(config)) {
        let _ = fs::write(file, text);
    }
}

/// "https://nimbo-relay.me.workers.dev/" → "https://nimbo-relay.me.workers.dev".
pub(crate) fn clean_url(url: &str) -> Option<String> {
    let url = url.trim().trim_end_matches('/');
    let parsed = reqwest::Url::parse(url).ok()?;
    let local = matches!(parsed.host_str(), Some("127.0.0.1" | "localhost"));
    (parsed.scheme() == "https" || (parsed.scheme() == "http" && local)).then(|| url.to_string())
}

fn socket_url(config: &Config) -> String {
    let base = config.url.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1);
    format!("{base}/v1/rooms/{}/ws?role=pc&key={}&pc={}", config.room, config.key, config.pc_key)
}

pub(crate) fn pair_link(config_url: &str, room: &str, key: &str, lan: Option<&str>) -> String {
    let encode = |text: &str| text.bytes().map(|byte| if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) { (byte as char).to_string() } else { format!("%{byte:02X}") }).collect::<String>();
    // After "#", so the code never reaches the server's logs.
    let mut link = format!("{config_url}/pair#relay={}&room={room}&key={key}", encode(config_url));
    if let Some(lan) = lan {
        link.push_str(&format!("&lan={}", encode(lan)));
    }
    link
}

fn info(app: &AppHandle) -> RelayInfo {
    let config = CONFIG.lock().ok().and_then(|config| config.clone()).unwrap_or_else(|| load(app));
    let ready = config.enabled && !config.url.is_empty();
    let link = ready.then(|| pair_link(&config.url, &config.room, &config.key, crate::phone::lan_url(app).as_deref()));
    RelayInfo {
        enabled: config.enabled,
        url: config.url.clone(),
        connected: CONNECTED.load(Ordering::SeqCst),
        qr_svg: link.as_deref().and_then(crate::phone::qr_svg),
        pair_link: link,
        error: LAST_ERROR.lock().ok().and_then(|error| error.clone()),
    }
}

fn set_read_timeout(socket: &WebSocket<MaybeTlsStream<TcpStream>>) {
    let stream: Option<&TcpStream> = match socket.get_ref() {
        MaybeTlsStream::Plain(stream) => Some(stream),
        MaybeTlsStream::Rustls(stream) => Some(stream.get_ref()),
        _ => None,
    };
    if let Some(stream) = stream {
        let _ = stream.set_read_timeout(Some(Duration::from_millis(250)));
    }
}

/// One connection, until it drops or the settings change.
fn session(app: &AppHandle, config: &Config, generation: u64) -> Result<(), String> {
    let (mut socket, _) = tungstenite::connect(socket_url(config)).map_err(|error| format!("Não consegui falar com o servidor: {error}"))?;
    set_read_timeout(&socket);
    CONNECTED.store(true, Ordering::SeqCst);
    if let Ok(mut error) = LAST_ERROR.lock() {
        *error = None;
    }
    let mut last_status = String::new();
    let mut last_track = String::new();
    let mut last_sent = Instant::now() - SEND_EVERY;
    while GENERATION.load(Ordering::SeqCst) == generation {
        match socket.read() {
            Ok(Message::Text(text)) => {
                let message: serde_json::Value = serde_json::from_str(text.as_str()).unwrap_or_default();
                if message["type"] == "file" && message["file"]["from"] == "phone" {
                    let id = message["file"]["id"].as_str().unwrap_or_default().to_string();
                    let name = message["file"]["name"].as_str().unwrap_or("arquivo").to_string();
                    let app = app.clone();
                    let config = config.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = receive_file(&app, &config, &id, &name).await;
                    });
                }
                if message["type"] == "command" {
                    let action = message["action"].as_str().unwrap_or_default();
                    let value = message["value"].as_str().unwrap_or_default();
                    if action == "send_text" {
                        crate::phone::receive_text(app, value);
                    } else {
                        let _ = crate::phone::run_command(app, action, value);
                    }
                }
            }
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(tungstenite::Error::Io(error)) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(error) => return Err(format!("A conexão caiu: {error}")),
        }
        if last_sent.elapsed() >= SEND_EVERY {
            last_sent = Instant::now();
            let status = crate::phone::current_status();
            if !status.is_empty() && status != last_status {
                socket.send(Message::text(format!("{{\"type\":\"status\",\"status\":{status}}}"))).map_err(|error| error.to_string())?;
                // The album art goes once per song, not with every status.
                let track = serde_json::from_str::<serde_json::Value>(&status).ok().map(|value| format!("{}{}", value["music"]["title"], value["music"]["artist"])).unwrap_or_default();
                if track != last_track {
                    last_track = track;
                    let cover = crate::media_control::get_artwork().ok().flatten().filter(|cover| cover.len() <= MAX_COVER);
                    socket.send(Message::text(serde_json::json!({ "type": "cover", "cover": cover }).to_string())).map_err(|error| error.to_string())?;
                }
                last_status = status;
            }
            let queued: Vec<String> = OUTBOX.lock().map(|mut outbox| outbox.drain(..).collect()).unwrap_or_default();
            for text in queued {
                socket.send(Message::text(serde_json::json!({ "type": "push_text", "text": text }).to_string())).map_err(|error| error.to_string())?;
            }
        }
    }
    let _ = socket.close(None);
    Ok(())
}

fn restart(app: &AppHandle) {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    CONNECTED.store(false, Ordering::SeqCst);
    let Some(config) = CONFIG.lock().ok().and_then(|config| config.clone()) else { return };
    if !config.enabled || config.url.is_empty() {
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        let mut wait = Duration::from_secs(2);
        while GENERATION.load(Ordering::SeqCst) == generation {
            let started = Instant::now();
            if let Err(error) = session(&app, &config, generation) {
                if let Ok(mut last) = LAST_ERROR.lock() {
                    *last = Some(error);
                }
            }
            CONNECTED.store(false, Ordering::SeqCst);
            // A long, healthy connection resets the back-off.
            if started.elapsed() > Duration::from_secs(60) {
                wait = Duration::from_secs(2);
            }
            let until = Instant::now() + wait;
            while Instant::now() < until && GENERATION.load(Ordering::SeqCst) == generation {
                thread::sleep(Duration::from_millis(250));
            }
            wait = (wait * 2).min(Duration::from_secs(60));
        }
    });
}

pub(crate) fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
    // reqwest and tungstenite both bring rustls; pick one crypto backend for the process.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let config = load(app);
    if let Ok(mut slot) = CONFIG.lock() {
        *slot = Some(config);
    }
    restart(app);
}

fn files_url(config: &Config, id: Option<&str>) -> String {
    let base = config.url.trim_end_matches('/');
    match id {
        Some(id) => format!("{base}/v1/rooms/{}/files/{id}?key={}&pc={}", config.room, config.key, config.pc_key),
        None => format!("{base}/v1/rooms/{}/files?key={}&pc={}", config.room, config.key, config.pc_key),
    }
}

fn enabled_config() -> Option<Config> {
    CONFIG.lock().ok().and_then(|config| config.clone()).filter(|config| config.enabled && !config.url.is_empty())
}

fn encode_component(text: &str) -> String {
    text.bytes().map(|byte| if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) { (byte as char).to_string() } else { format!("%{byte:02X}") }).collect()
}

fn mime_of(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or_default().to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "heic" => "image/heic",
        "pdf" => "application/pdf",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "txt" => "text/plain",
        "zip" => "application/zip",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => "application/octet-stream",
    }
}

/// A file the phone sent: saved next to the photos sent over Wi-Fi, then removed from the relay.
async fn receive_file(app: &AppHandle, config: &Config, id: &str, name: &str) -> Result<(), String> {
    if !id.chars().all(|c| c.is_ascii_hexdigit()) || id.len() != 16 {
        return Err("Arquivo inválido.".to_string());
    }
    let client = reqwest::Client::new();
    let response = client.get(files_url(config, Some(id))).send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("O servidor respondeu {}.", response.status()));
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    let dir = crate::phone::uploads_dir().ok_or("Não achei a pasta Downloads.")?;
    let base = name.rsplit(['/', '\\']).next().unwrap_or("arquivo").chars().filter(|c| !matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') && !c.is_control()).collect::<String>();
    let target = crate::downloads::free_path(&dir, if base.trim().is_empty() { "arquivo-do-celular" } else { base.trim() });
    fs::write(&target, &bytes).map_err(|error| error.to_string())?;
    let _ = tauri::Emitter::emit_to(app, crate::WINDOW_LABEL, "phone-file", target.to_string_lossy().to_string());
    let _ = client.delete(files_url(config, Some(id))).send().await;
    Ok(())
}

/// Sends a file to the paired phones through the relay (up to 25 MB, kept a day).
#[tauri::command]
pub(crate) async fn relay_send_file(path: String) -> Result<String, String> {
    let config = enabled_config().ok_or("Ligue \"De qualquer lugar\" em Configurações → Celular para mandar arquivos.")?;
    let path = PathBuf::from(path);
    let size = fs::metadata(&path).map_err(|error| error.to_string())?.len();
    if !path.is_file() {
        return Err("Só dá para mandar arquivos, não pastas.".to_string());
    }
    if size > MAX_FILE {
        return Err("Até 25 MB por arquivo.".to_string());
    }
    let name = path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_else(|| "arquivo".to_string());
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    let url = format!("{}&from=pc&name={}", files_url(&config, None), encode_component(&name));
    let response = reqwest::Client::new()
        .post(url)
        .header("content-type", mime_of(&name))
        .body(bytes)
        .send()
        .await
        .map_err(|error| format!("Não consegui mandar: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("O servidor recusou o arquivo ({}).", response.status()));
    }
    Ok(name)
}

#[derive(Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AlexaCode {
    code: String,
    expires_at: i64,
}

/// A six-digit code the user says to the "Nimbo" Alexa skill (valid ten minutes, once).
#[tauri::command]
pub(crate) async fn relay_alexa_code() -> Result<AlexaCode, String> {
    let config = enabled_config().ok_or("Ligue \"De qualquer lugar\" em Configurações → Celular para conectar a Alexa.")?;
    if !CONNECTED.load(Ordering::SeqCst) {
        return Err("O Nimbo ainda não está conectado ao servidor. Espere o ponto ficar verde.".to_string());
    }
    let url = format!("{}/v1/rooms/{}/alexa-code?key={}", config.url.trim_end_matches('/'), config.room, config.key);
    let response = reqwest::Client::new().post(url).send().await.map_err(|error| format!("Não consegui falar com o servidor: {error}"))?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("Seu servidor ainda não tem a parte da Alexa. Atualize o relay (veja docs/ALEXA.md).".to_string());
    }
    if !response.status().is_success() {
        return Err(format!("O servidor recusou ({}).", response.status()));
    }
    response.json::<AlexaCode>().await.map_err(|error| error.to_string())
}

/// Queues a text for the phones; false when the relay is off.
pub(crate) fn push_text(text: &str) -> bool {
    let enabled = CONFIG.lock().ok().and_then(|config| config.as_ref().map(|config| config.enabled && !config.url.is_empty())).unwrap_or(false);
    if enabled {
        if let Ok(mut outbox) = OUTBOX.lock() {
            outbox.push(text.chars().take(10_000).collect());
            let excess = outbox.len().saturating_sub(20);
            outbox.drain(..excess);
        }
    }
    enabled
}

#[tauri::command]
pub(crate) fn relay_info(app: AppHandle) -> RelayInfo {
    info(&app)
}

#[tauri::command]
pub(crate) fn relay_configure(app: AppHandle, url: String, enabled: bool) -> Result<RelayInfo, String> {
    let url = if url.trim().is_empty() { String::new() } else { clean_url(&url).ok_or("Use o endereço https do seu servidor, como https://nimbo-relay.seu-nome.workers.dev")? };
    let mut config = CONFIG.lock().ok().and_then(|config| config.clone()).unwrap_or_else(|| load(&app));
    config.url = url;
    config.enabled = enabled;
    save(&app, &config);
    if let Ok(mut slot) = CONFIG.lock() {
        *slot = Some(config);
    }
    restart(&app);
    Ok(info(&app))
}

/// A new room and code: phones paired before stop reaching this PC.
#[tauri::command]
pub(crate) fn relay_new_room(app: AppHandle) -> RelayInfo {
    let mut config = CONFIG.lock().ok().and_then(|config| config.clone()).unwrap_or_else(|| load(&app));
    config.room = random_hex(16);
    config.key = random_hex(24);
    config.pc_key = random_hex(24);
    save(&app, &config);
    if let Ok(mut slot) = CONFIG.lock() {
        *slot = Some(config);
    }
    restart(&app);
    info(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_relays_are_accepted() {
        assert_eq!(clean_url("https://nimbo-relay.eu.workers.dev/").as_deref(), Some("https://nimbo-relay.eu.workers.dev"));
        assert_eq!(clean_url("http://127.0.0.1:8787").as_deref(), Some("http://127.0.0.1:8787"));
        assert_eq!(clean_url("http://example.com"), None);
        assert_eq!(clean_url("nimbo"), None);
    }

    #[test]
    fn the_pair_link_carries_everything_the_app_needs() {
        let link = pair_link("https://r.workers.dev", "ab", "cd", Some("http://192.168.0.2:43900/?k=x"));
        assert_eq!(link, "https://r.workers.dev/pair#relay=https%3A%2F%2Fr.workers.dev&room=ab&key=cd&lan=http%3A%2F%2F192.168.0.2%3A43900%2F%3Fk%3Dx");
        let config = Config { url: "https://r.workers.dev".into(), room: "ab".into(), key: "cd".into(), pc_key: "ef".into(), enabled: true };
        assert_eq!(socket_url(&config), "wss://r.workers.dev/v1/rooms/ab/ws?role=pc&key=cd&pc=ef");
    }
}
