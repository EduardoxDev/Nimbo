use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::windows::process::CommandExt,
    path::PathBuf,
    process::Command,
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Manager};

const LOG_FILE: &str = "nimbo.log";
const OLD_LOG_FILE: &str = "nimbo.old.log";
const MAX_LOG_BYTES: u64 = 1024 * 1024;
const MAX_MESSAGE_CHARS: usize = 600;
const REPORT_LINES: usize = 120;
const CREATE_NO_WINDOW: u32 = 0x08000000;

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
static WRITE_LOCK: Mutex<()> = Mutex::new(());

pub(crate) fn init(app: &AppHandle) {
    let Ok(dir) = app.path().app_log_dir() else {
        return;
    };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join(LOG_FILE);
    if fs::metadata(&path).map(|meta| meta.len() > MAX_LOG_BYTES).unwrap_or(false) {
        let _ = fs::rename(&path, dir.join(OLD_LOG_FILE));
    }
    let _ = LOG_PATH.set(path);

    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log("panic", &info.to_string());
        previous(info);
    }));
    log("start", &format!("Nimbo {}", app.package_info().version));
}

pub(crate) fn log(source: &str, message: &str) {
    let Some(path) = LOG_PATH.get() else {
        return;
    };
    let line = format!("{} [{source}] {}\n", timestamp(), clean(message));
    let _guard = WRITE_LOCK.lock();
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(line.as_bytes());
    }
}

fn clean(message: &str) -> String {
    let single_line: String = message.chars().map(|ch| if ch.is_control() { ' ' } else { ch }).collect();
    redact(single_line.trim()).chars().take(MAX_MESSAGE_CHARS).collect()
}

fn redact(message: &str) -> String {
    message
        .split(' ')
        .map(|word| {
            let lower = word.to_ascii_lowercase();
            if lower.starts_with("sk-ant-") || lower.contains("token=") || lower.contains("key=") {
                "[oculto]".to_string()
            } else if lower.starts_with("https://") || lower.starts_with("http://") {
                let host = word.split('/').nth(2).unwrap_or_default();
                format!("https://{host}/…")
            } else {
                word.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn timestamp() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%SZ").to_string()
}

fn windows_version() -> String {
    Command::new("cmd")
        .creation_flags(CREATE_NO_WINDOW)
        .args(["/C", "ver"])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_else(|_| "unknown".to_string())
}

#[tauri::command]
pub(crate) fn diagnostics_log(message: String) {
    log("ui", &message);
}

#[tauri::command]
pub(crate) fn diagnostics_report(app: AppHandle) -> String {
    let recent = LOG_PATH
        .get()
        .and_then(|path| fs::read_to_string(path).ok())
        .map(|content| {
            let lines: Vec<&str> = content.lines().collect();
            lines[lines.len().saturating_sub(REPORT_LINES)..].join("\n")
        })
        .unwrap_or_default();
    format!(
        "Nimbo {}\n{}\n{} {}\n\n{}",
        app.package_info().version,
        windows_version(),
        std::env::consts::OS,
        std::env::consts::ARCH,
        recent
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_and_private_links_are_hidden() {
        let cleaned = clean("failed sk-ant-api03-abc with https://calendar.google.com/secret/abc.ics\nnext");
        assert!(!cleaned.contains("sk-ant"));
        assert!(!cleaned.contains("secret/abc"));
        assert!(cleaned.contains("https://calendar.google.com/…"));
        assert!(!cleaned.contains('\n'));
    }
}
