//! The island on the phone: a small page served on the home Wi-Fi only,
//! opened by scanning a QR code. Every request needs the pairing code in that
//! link. From the phone: see music, focus and the island's notices, control
//! them, lock the PC, send text and photos to the PC. From the PC: send text
//! to the phone. Off until the user turns it on.

use serde::Serialize;
use std::{
    fs,
    io::Read,
    net::UdpSocket,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

const PORTS: std::ops::Range<u16> = 43_900..43_910;
const MAX_TEXT: usize = 10_000;
const MAX_UPLOAD: usize = 50 * 1024 * 1024;
const PAGE: &str = include_str!("phone_page.html");
/// Shown for a missing or old code: most "it does not open" cases are this one.
const DENIED: &str = "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><body style='margin:0;padding:32px 22px;background:#08080a;color:#f5f5f7;font:16px/1.5 system-ui,-apple-system,sans-serif'><h2 style='margin:0 0 12px'>Nimbo</h2><p>Este link é de um código antigo. No PC, abra Configurações → Celular e escaneie o QR code de novo.</p><p style='color:#98989d'>This link uses an old code. On the PC, open Settings → Phone and scan the QR code again.</p></body>";

static RUNNING: AtomicBool = AtomicBool::new(false);
static STOP: AtomicBool = AtomicBool::new(false);
static PORT: Mutex<Option<u16>> = Mutex::new(None);
static TOKEN: Mutex<Option<String>> = Mutex::new(None);
static STATUS: Mutex<String> = Mutex::new(String::new());
static INBOX: Mutex<Vec<(u64, String)>> = Mutex::new(Vec::new());
static APP: OnceLock<AppHandle> = OnceLock::new();

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PhoneInfo {
    running: bool,
    url: Option<String>,
    qr_svg: Option<String>,
}

fn token_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("phone-token"))
}

fn new_token() -> String {
    let mut bytes = [0u8; 12];
    let _ = getrandom::getrandom(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn token(app: &AppHandle) -> String {
    if let Ok(mut slot) = TOKEN.lock() {
        if let Some(token) = slot.as_ref() {
            return token.clone();
        }
        let stored = token_file(app).and_then(|file| fs::read_to_string(file).ok()).map(|text| text.trim().to_string()).filter(|text| text.len() == 24);
        let token = stored.unwrap_or_else(|| {
            let fresh = new_token();
            if let Some(file) = token_file(app) {
                let _ = fs::write(file, &fresh);
            }
            fresh
        });
        *slot = Some(token.clone());
        return token;
    }
    new_token()
}

/// The PC's address on the local network (no packet is actually sent).
fn lan_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.168.0.1:80").ok()?;
    Some(socket.local_addr().ok()?.ip().to_string())
}

fn url(app: &AppHandle) -> Option<String> {
    let port = (*PORT.lock().ok()?)?;
    Some(format!("http://{}:{port}/?k={}", lan_ip()?, token(app)))
}

pub(crate) fn qr_svg(text: &str) -> Option<String> {
    let code = qrcode::QrCode::new(text.as_bytes()).ok()?;
    Some(code.render::<qrcode::render::svg::Color>().min_dimensions(220, 220).dark_color(qrcode::render::svg::Color("#000000")).light_color(qrcode::render::svg::Color("#ffffff")).build())
}

/// The home-Wi-Fi address of the phone page, while it is on.
pub(crate) fn lan_url(app: &AppHandle) -> Option<String> {
    RUNNING.load(Ordering::SeqCst).then(|| url(app)).flatten()
}

fn info(app: &AppHandle) -> PhoneInfo {
    let running = RUNNING.load(Ordering::SeqCst);
    let url = running.then(|| url(app)).flatten();
    PhoneInfo { running, qr_svg: url.as_deref().and_then(qr_svg), url }
}

fn header(name: &str, value: &str) -> tiny_http::Header {
    tiny_http::Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("valid header")
}

fn respond(request: tiny_http::Request, status: u16, kind: &str, body: Vec<u8>) {
    let response = tiny_http::Response::from_data(body)
        .with_status_code(status)
        .with_header(header("Content-Type", kind))
        .with_header(header("Cache-Control", "no-store"))
        .with_header(header("X-Content-Type-Options", "nosniff"));
    let _ = request.respond(response);
}

fn json(request: tiny_http::Request, value: serde_json::Value) {
    respond(request, 200, "application/json; charset=utf-8", value.to_string().into_bytes());
}

fn query_param(url: &str, key: &str) -> Option<String> {
    let query = url.split_once('?')?.1;
    query.split('&').find_map(|pair| {
        let (name, value) = pair.split_once('=')?;
        (name == key).then(|| value.to_string())
    })
}

/// Same length and every byte compared, so timing says nothing about the code.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn safe_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("foto");
    let cleaned: String = base.chars().filter(|c| !matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') && !c.is_control()).take(100).collect();
    let cleaned = cleaned.trim().trim_start_matches('.').to_string();
    if cleaned.is_empty() { "arquivo-do-celular".to_string() } else { cleaned }
}

fn uploads_dir() -> Option<PathBuf> {
    let dir = PathBuf::from(std::env::var_os("USERPROFILE")?).join("Downloads").join("Nimbo do celular");
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn handle(app: &AppHandle, mut request: tiny_http::Request) {
    let url = request.url().to_string();
    let path = url.split('?').next().unwrap_or("/").to_string();
    let given = query_param(&url, "k")
        .or_else(|| request.headers().iter().find(|header| header.field.equiv("X-Nimbo-Key")).map(|header| header.value.as_str().to_string()))
        .unwrap_or_default();
    if !same(&given, &token(app)) {
        respond(request, 403, "text/html; charset=utf-8", DENIED.as_bytes().to_vec());
        return;
    }
    match (request.method(), path.as_str()) {
        (tiny_http::Method::Get, "/") => respond(request, 200, "text/html; charset=utf-8", PAGE.as_bytes().to_vec()),
        (tiny_http::Method::Get, "/api/status") => {
            let status = STATUS.lock().map(|status| status.clone()).unwrap_or_default();
            let since: u64 = query_param(&url, "inbox").and_then(|value| value.parse().ok()).unwrap_or(0);
            let inbox: Vec<serde_json::Value> = INBOX
                .lock()
                .map(|items| items.iter().filter(|(id, _)| *id > since).map(|(id, text)| serde_json::json!({ "id": id, "text": text })).collect())
                .unwrap_or_default();
            let status: serde_json::Value = serde_json::from_str(&status).unwrap_or(serde_json::Value::Null);
            json(request, serde_json::json!({ "status": status, "inbox": inbox }));
        }
        (tiny_http::Method::Get, "/api/cover") => {
            // The album art of what is playing, as a data URL (or null).
            let cover = crate::media_control::get_artwork().ok().flatten();
            json(request, serde_json::json!({ "cover": cover }));
        }
        (tiny_http::Method::Post, "/api/send") => {
            let mut body = String::new();
            let _ = request.as_reader().take(MAX_TEXT as u64 * 4).read_to_string(&mut body);
            let text: String = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|value| value["text"].as_str().map(str::to_string))
                .unwrap_or_default()
                .chars()
                .take(MAX_TEXT)
                .collect();
            json(request, serde_json::json!({ "ok": receive_text(app, &text) }));
        }
        (tiny_http::Method::Post, "/api/upload") => {
            let name = safe_name(&query_param(&url, "name").map(|name| urlencoding_decode(&name)).unwrap_or_default());
            let mut bytes = Vec::new();
            let _ = request.as_reader().take(MAX_UPLOAD as u64 + 1).read_to_end(&mut bytes);
            if bytes.is_empty() || bytes.len() > MAX_UPLOAD {
                json(request, serde_json::json!({ "ok": false, "error": "Até 50 MB por arquivo." }));
                return;
            }
            let Some(dir) = uploads_dir() else {
                json(request, serde_json::json!({ "ok": false }));
                return;
            };
            let target = crate::downloads::free_path(&dir, &name);
            let saved = fs::write(&target, &bytes).is_ok();
            if saved {
                let _ = app.emit_to(crate::WINDOW_LABEL, "phone-file", target.to_string_lossy().to_string());
            }
            json(request, serde_json::json!({ "ok": saved }));
        }
        (tiny_http::Method::Post, "/api/command") => {
            let mut body = String::new();
            let _ = request.as_reader().take(1_000).read_to_string(&mut body);
            let parsed = serde_json::from_str::<serde_json::Value>(&body).unwrap_or(serde_json::Value::Null);
            let action = parsed["action"].as_str().unwrap_or_default();
            let value = parsed["value"].as_str().unwrap_or_default();
            json(request, serde_json::json!({ "ok": run_command(app, action, value).is_ok() }));
        }
        _ => respond(request, 404, "text/plain; charset=utf-8", b"Not found".to_vec()),
    }
}

/// Text sent from a phone: goes to the clipboard and shows on the island.
pub(crate) fn receive_text(app: &AppHandle, text: &str) -> bool {
    let text: String = text.chars().take(MAX_TEXT).collect();
    if text.trim().is_empty() {
        return false;
    }
    if let Ok(mut clipboard) = arboard::Clipboard::new() {
        let _ = clipboard.set_text(text.clone());
    }
    let _ = app.emit_to(crate::WINDOW_LABEL, "phone-text", &text);
    true
}

/// What a phone may ask the PC to do, on the home Wi-Fi or through the relay.
pub(crate) fn run_command(app: &AppHandle, action: &str, value: &str) -> Result<(), String> {
    // Only a short text or id travels with a command.
    let value: String = value.chars().take(200).collect();
    match action {
        "lock" => crate::pc::lock_pc().map(|_| ()),
        "shutdown_cancel" => crate::pc::shutdown_in(0).map(|_| ()),
        "approve" | "deny" => crate::agents::agents_answer_approval(app.clone(), value, action == "approve").map(|_| ()),
        "play_pause" | "next" | "previous" | "focus_start" | "focus_pause" | "focus_skip" | "task_toggle" | "task_add" | "water_add" | "ring" | "read_later_add" | "read_later_done" => app
            .emit_to(crate::WINDOW_LABEL, "phone-command", serde_json::json!({ "action": action, "value": value }))
            .map_err(|error| error.to_string()),
        _ => Err("Unknown command.".to_string()),
    }
}

/// The latest island status the main window published.
pub(crate) fn current_status() -> String {
    STATUS.lock().map(|status| status.clone()).unwrap_or_default()
}

/// Minimal %XX decoding for the file name parameter.
fn urlencoding_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' if index + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok().and_then(|hex| u8::from_str_radix(hex, 16).ok());
                match hex {
                    Some(byte) => {
                        out.push(byte);
                        index += 3;
                    }
                    None => {
                        out.push(b'%');
                        index += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

#[tauri::command]
pub(crate) fn phone_start(app: AppHandle) -> Result<PhoneInfo, String> {
    let _ = APP.set(app.clone());
    if RUNNING.load(Ordering::SeqCst) {
        return Ok(info(&app));
    }
    let (server, port) = PORTS
        .clone()
        .find_map(|port| tiny_http::Server::http(("0.0.0.0", port)).ok().map(|server| (server, port)))
        .ok_or("Não consegui abrir a porta para o celular.")?;
    *PORT.lock().map_err(|error| error.to_string())? = Some(port);
    STOP.store(false, Ordering::SeqCst);
    RUNNING.store(true, Ordering::SeqCst);
    let handle_app = app.clone();
    thread::spawn(move || {
        while !STOP.load(Ordering::SeqCst) {
            match server.recv_timeout(Duration::from_millis(800)) {
                Ok(Some(request)) => handle(&handle_app, request),
                Ok(None) => {}
                Err(_) => break,
            }
        }
        RUNNING.store(false, Ordering::SeqCst);
    });
    Ok(info(&app))
}

#[tauri::command]
pub(crate) fn phone_stop() {
    STOP.store(true, Ordering::SeqCst);
    RUNNING.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub(crate) fn phone_info(app: AppHandle) -> PhoneInfo {
    info(&app)
}

/// A new pairing code: links and QR codes shown before stop working.
#[tauri::command]
pub(crate) fn phone_new_code(app: AppHandle) -> PhoneInfo {
    let fresh = new_token();
    if let Some(file) = token_file(&app) {
        let _ = fs::write(file, &fresh);
    }
    if let Ok(mut slot) = TOKEN.lock() {
        *slot = Some(fresh);
    }
    info(&app)
}

/// What the phone page shows, published by the island every few seconds.
#[tauri::command]
pub(crate) fn phone_publish(status: serde_json::Value) {
    if let Ok(mut slot) = STATUS.lock() {
        *slot = status.to_string();
    }
}

/// Sends a text from the PC to the phone page.
#[tauri::command]
pub(crate) fn phone_push(text: String) -> Result<(), String> {
    let relayed = crate::relay::push_text(&text);
    if !RUNNING.load(Ordering::SeqCst) {
        return if relayed { Ok(()) } else { Err("A ilha no celular está desligada.".to_string()) };
    }
    let mut inbox = INBOX.lock().map_err(|error| error.to_string())?;
    let id = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|time| time.as_millis() as u64).unwrap_or(0);
    inbox.push((id, text.chars().take(MAX_TEXT).collect()));
    let excess = inbox.len().saturating_sub(20);
    inbox.drain(..excess);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_and_names_are_safe() {
        assert!(same("abc", "abc"));
        assert!(!same("abc", "abd"));
        assert!(!same("abc", "abcd"));
        assert_eq!(safe_name("../../Windows/evil.exe"), "evil.exe");
        assert_eq!(safe_name("foto:1?.jpg"), "foto1.jpg");
        assert_eq!(safe_name(".."), "arquivo-do-celular");
        assert_eq!(urlencoding_decode("Minha%20foto+1.jpg"), "Minha foto 1.jpg");
        assert_eq!(query_param("/api/status?k=abc&inbox=5", "inbox").as_deref(), Some("5"));
    }
}
