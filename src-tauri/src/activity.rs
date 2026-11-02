//! A private diary of the day: which app was in front and when, sampled every
//! few seconds and kept only on this PC (one JSON file per day, 30 days).
//! It powers the timeline, the time X-ray and the automatic diary.

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use windows::Win32::{
    System::SystemInformation::GetTickCount,
    UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
};

const SAMPLE_EVERY: Duration = Duration::from_secs(10);
/// No mouse or keyboard for this long counts as away.
const IDLE_AFTER_MS: u32 = 5 * 60 * 1000;
/// A gap longer than this starts a new block even for the same window.
const MAX_GAP_MS: u64 = 45_000;
const KEEP_DAYS: i64 = 30;

static ENABLED: AtomicBool = AtomicBool::new(true);
static DIR: OnceLock<PathBuf> = OnceLock::new();
static TODAY: Mutex<Option<(String, Vec<Segment>)>> = Mutex::new(None);

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct Segment {
    /// Program file name, lower case ("code.exe").
    app: String,
    title: String,
    /// Milliseconds since 1970.
    start: u64,
    end: u64,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|time| time.as_millis() as u64).unwrap_or(0)
}

fn day_key(ms: u64) -> String {
    chrono::DateTime::from_timestamp_millis(ms as i64)
        .map(|time| time.with_timezone(&chrono::Local).format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

fn idle_ms() -> u32 {
    let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    unsafe {
        if GetLastInputInfo(&mut info).as_bool() {
            GetTickCount().wrapping_sub(info.dwTime)
        } else {
            0
        }
    }
}

/// Private browser windows and password managers stay unnamed.
fn private_title(app: &str, title: &str) -> String {
    let lower = title.to_lowercase();
    let private = lower.contains("inprivate")
        || lower.contains("incognito")
        || lower.contains("anônima")
        || lower.contains("anonima")
        || lower.contains("private browsing")
        || ["keepass.exe", "keepassxc.exe", "bitwarden.exe", "1password.exe"].contains(&app);
    if private { String::new() } else { title.chars().take(160).collect() }
}

/// Adds one sample to the day: extends the last block or starts a new one.
pub(crate) fn record(segments: &mut Vec<Segment>, app: &str, title: &str, at: u64) {
    if let Some(last) = segments.last_mut() {
        if last.app == app && last.title == title && at.saturating_sub(last.end) <= MAX_GAP_MS {
            last.end = at;
            return;
        }
        // Close the previous block at this sample when it was continuous.
        if at.saturating_sub(last.end) <= MAX_GAP_MS {
            last.end = at;
        }
    }
    segments.push(Segment { app: app.to_string(), title: title.to_string(), start: at, end: at });
}

fn file_for(day: &str) -> Option<PathBuf> {
    DIR.get().map(|dir| dir.join(format!("{day}.json")))
}

fn load(day: &str) -> Vec<Segment> {
    file_for(day)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save(day: &str, segments: &[Segment]) {
    if let (Some(path), Ok(text)) = (file_for(day), serde_json::to_string(segments)) {
        let _ = fs::write(path, text);
    }
}

fn prune() {
    let Some(dir) = DIR.get() else { return };
    let oldest = (chrono::Local::now() - chrono::Duration::days(KEEP_DAYS)).format("%Y-%m-%d").to_string();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".json") && name < format!("{oldest}.json") {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

pub(crate) fn init(app: &AppHandle) {
    let Ok(dir) = app.path().app_data_dir().map(|dir| dir.join("activity")) else { return };
    if fs::create_dir_all(&dir).is_err() || DIR.set(dir).is_err() {
        return;
    }
    prune();
    thread::spawn(|| {
        let mut unsaved = 0;
        loop {
            thread::sleep(SAMPLE_EVERY);
            if !ENABLED.load(Ordering::SeqCst) || idle_ms() > IDLE_AFTER_MS {
                continue;
            }
            let Some(window) = crate::buddy::foreground() else { continue };
            let at = now_ms();
            let day = day_key(at);
            let Ok(mut today) = TODAY.lock() else { continue };
            if today.as_ref().map(|(key, _)| key != &day).unwrap_or(true) {
                if let Some((key, segments)) = today.as_ref() {
                    save(key, segments);
                }
                *today = Some((day.clone(), load(&day)));
            }
            if let Some((_, segments)) = today.as_mut() {
                record(segments, &window.app, &private_title(&window.app, &window.title), at);
                unsaved += 1;
                // Written about once a minute; a crash loses at most that.
                if unsaved >= 6 {
                    save(&day, segments);
                    unsaved = 0;
                }
            }
        }
    });
}

pub(crate) const DAY_WINDOW_LABEL: &str = "day";

/// "My day": timeline, time X-ray, diary and plan, on the tab asked for.
pub(crate) fn show_day_window(app: &AppHandle, tab: Option<&str>) -> Result<(), String> {
    let tab = tab.filter(|tab| ["today", "xray", "diary", "plan"].contains(tab));
    let window = match app.get_webview_window(DAY_WINDOW_LABEL) {
        Some(window) => {
            if let Some(tab) = tab {
                let _ = app.emit_to(DAY_WINDOW_LABEL, "day-tab", tab);
            }
            window
        }
        None => WebviewWindowBuilder::new(app, DAY_WINDOW_LABEL, WebviewUrl::App(format!("index.html?window=day&tab={}", tab.unwrap_or("today")).into()))
            .title("Nimbo · Meu dia")
            .inner_size(980.0, 700.0)
            .min_inner_size(640.0, 480.0)
            .center()
            .decorations(false)
            .transparent(true)
            .resizable(true)
            .shadow(true)
            .visible(false)
            .build()
            .map_err(|error| error.to_string())?,
    };
    if window.is_minimized().unwrap_or(false) {
        window.unminimize().map_err(|error| error.to_string())?;
    }
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn open_day_window(app: AppHandle, tab: Option<String>) -> Result<(), String> {
    show_day_window(&app, tab.as_deref())
}

/// One day's blocks, "YYYY-MM-DD".
#[tauri::command]
pub(crate) fn activity_day(day: String) -> Result<Vec<Segment>, String> {
    if !day.chars().all(|c| c.is_ascii_digit() || c == '-') || day.len() != 10 {
        return Err("Invalid day.".to_string());
    }
    if let Ok(today) = TODAY.lock() {
        if let Some((key, segments)) = today.as_ref() {
            if *key == day {
                return Ok(segments.clone());
            }
        }
    }
    Ok(load(&day))
}

#[tauri::command]
pub(crate) fn activity_set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::SeqCst);
}

/// Forgets everything recorded so far.
#[tauri::command]
pub(crate) fn activity_clear() -> Result<(), String> {
    if let Ok(mut today) = TODAY.lock() {
        *today = None;
    }
    let dir = DIR.get().ok_or("Activity is not ready.")?;
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())?.flatten() {
        let _ = fs::remove_file(entry.path());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_join_into_blocks() {
        let mut day = Vec::new();
        record(&mut day, "code.exe", "a", 0);
        record(&mut day, "code.exe", "a", 10_000);
        record(&mut day, "chrome.exe", "b", 20_000);
        record(&mut day, "chrome.exe", "b", 200_000);
        assert_eq!(day.len(), 3);
        assert_eq!((day[0].start, day[0].end), (0, 20_000));
        assert_eq!((day[1].start, day[1].end), (20_000, 20_000));
        assert_eq!(day[2].start, 200_000);
    }

    #[test]
    fn private_windows_have_no_title() {
        assert_eq!(private_title("msedge.exe", "Nova guia InPrivate - Edge"), "");
        assert_eq!(private_title("keepass.exe", "Banco.kdbx"), "");
        assert_eq!(private_title("code.exe", "App.tsx - nimbo"), "App.tsx - nimbo");
    }
}
