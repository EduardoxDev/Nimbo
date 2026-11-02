//! Live activities on the island: browser downloads (Chrome, Edge and Firefox
//! keep a temporary file in Downloads while they work) and file copies in
//! Explorer (its progress window says "45% concluído"). One light check a
//! second, only while the user has this on.

use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
    thread,
    time::{Duration, Instant, SystemTime},
};
use tauri::{AppHandle, Emitter};
use windows::{
    core::BOOL,
    Win32::{
        Foundation::{HWND, LPARAM},
        UI::WindowsAndMessaging::{EnumWindows, GetClassNameW, GetWindowTextW, IsWindowVisible},
    },
};

const TICK: Duration = Duration::from_millis(1_000);
/// A download that has not grown for this long is paused or abandoned.
const STALE: Duration = Duration::from_secs(10 * 60);
const TEMP_EXTENSIONS: [&str; 5] = ["crdownload", "part", "partial", "download", "opdownload"];

static RUNNING: AtomicBool = AtomicBool::new(false);
static GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Download {
    id: String,
    name: String,
    bytes: u64,
    /// Bytes per second, smoothed.
    speed: u64,
}

#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Copy {
    percent: u8,
    title: String,
}

#[derive(Serialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
struct LiveState {
    downloads: Vec<Download>,
    copies: Vec<Copy>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Finished {
    name: String,
    path: String,
}

struct Tracked {
    bytes: u64,
    speed: f64,
    changed_at: Instant,
    seen_at: Instant,
}

fn downloads_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join("Downloads")).filter(|dir| dir.is_dir())
}

fn is_temp(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(_, extension)| TEMP_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
}

/// "relatório.pdf.crdownload" → "relatório.pdf"; Chrome's "Unconfirmed 1234.crdownload" has no name yet.
fn final_name_of(temp: &str) -> Option<String> {
    let (base, _) = temp.rsplit_once('.')?;
    if base.is_empty() || base.to_ascii_lowercase().starts_with("unconfirmed ") || !base.contains('.') {
        return None;
    }
    Some(base.to_string())
}

/// What the user sees while it downloads: the final name when there is one.
fn display_name(temp: &str) -> String {
    final_name_of(temp).unwrap_or_else(|| temp.rsplit_once('.').map(|(base, _)| base).unwrap_or(temp).to_string())
}

/// "45% concluído", "45% complete", "已完成 45%" → 45.
fn parse_percent(title: &str) -> Option<u8> {
    let percent_at = title.find('%')?;
    let digits: String = title[..percent_at].chars().rev().take_while(|c| c.is_ascii_digit()).collect::<Vec<_>>().into_iter().rev().collect();
    if let Ok(value) = digits.parse::<u8>() {
        return (value <= 100).then_some(value);
    }
    let after: String = title[percent_at + 1..].chars().skip_while(|c| !c.is_ascii_digit()).take_while(|c| c.is_ascii_digit()).collect();
    after.parse::<u8>().ok().filter(|value| *value <= 100)
}

/// The newest real file in the folder, for downloads that had no name while running.
fn newest_file(dir: &Path, since: SystemTime) -> Option<PathBuf> {
    fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .filter(|entry| !is_temp(&entry.file_name().to_string_lossy()))
        .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
        .filter(|(modified, _)| *modified >= since)
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path)
}

unsafe extern "system" fn collect_copies(window: HWND, data: LPARAM) -> BOOL {
    let list = &mut *(data.0 as *mut Vec<Copy>);
    if !IsWindowVisible(window).as_bool() {
        return BOOL(1);
    }
    let mut class = [0u16; 64];
    let length = GetClassNameW(window, &mut class);
    if String::from_utf16_lossy(&class[..length.max(0) as usize]) == "OperationStatusWindow" {
        let mut title = [0u16; 256];
        let length = GetWindowTextW(window, &mut title);
        let title = String::from_utf16_lossy(&title[..length.max(0) as usize]);
        if let Some(percent) = parse_percent(&title) {
            list.push(Copy { percent, title });
        }
    }
    BOOL(1)
}

fn copies() -> Vec<Copy> {
    let mut list: Vec<Copy> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect_copies), LPARAM(&mut list as *mut Vec<Copy> as isize));
    }
    list.truncate(3);
    list
}

fn watch(app: AppHandle, generation: u64) {
    let mut tracked: HashMap<String, Tracked> = HashMap::new();
    let mut last = LiveState::default();
    let dir = downloads_dir();
    while GENERATION.load(Ordering::SeqCst) == generation {
        let now = Instant::now();
        let mut present: Vec<String> = Vec::new();
        if let Some(dir) = dir.as_ref() {
            for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !is_temp(&name) {
                    continue;
                }
                let bytes = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
                present.push(name.clone());
                let item = tracked.entry(name).or_insert(Tracked { bytes, speed: 0.0, changed_at: now, seen_at: now });
                let elapsed = now.duration_since(item.seen_at).as_secs_f64().max(0.001);
                let instant = bytes.saturating_sub(item.bytes) as f64 / elapsed;
                item.speed = if item.speed == 0.0 { instant } else { item.speed * 0.6 + instant * 0.4 };
                if bytes != item.bytes {
                    item.changed_at = now;
                }
                item.bytes = bytes;
                item.seen_at = now;
            }
        }
        // Gone temporary files: finished (renamed to the real name) or cancelled.
        let gone: Vec<String> = tracked.keys().filter(|name| !present.contains(name)).cloned().collect();
        for name in gone {
            tracked.remove(&name);
            let Some(dir) = dir.as_ref() else { continue };
            let finished = final_name_of(&name)
                .map(|final_name| dir.join(final_name))
                .filter(|path| path.is_file())
                .or_else(|| newest_file(dir, SystemTime::now() - Duration::from_secs(8)));
            if let Some(path) = finished {
                let display = path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
                let _ = app.emit_to(crate::WINDOW_LABEL, "live-download-done", Finished { name: display, path: path.to_string_lossy().to_string() });
            }
        }
        let mut downloads: Vec<Download> = tracked
            .iter()
            .filter(|(_, item)| now.duration_since(item.changed_at) < STALE)
            .map(|(name, item)| Download { id: name.clone(), name: display_name(name), bytes: item.bytes, speed: item.speed.max(0.0) as u64 })
            .collect();
        downloads.sort_by(|a, b| a.id.cmp(&b.id));
        let state = LiveState { downloads, copies: copies() };
        // Every second while something runs (the numbers move), once when it all stops.
        let active = !state.downloads.is_empty() || !state.copies.is_empty();
        if active || state != last {
            let _ = app.emit_to(crate::WINDOW_LABEL, "live-activities", &state);
            last = state;
        }
        thread::sleep(TICK);
    }
    RUNNING.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub(crate) fn live_watch(app: AppHandle, enabled: bool) -> Result<(), String> {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    if !enabled {
        return Ok(());
    }
    RUNNING.store(true, Ordering::SeqCst);
    thread::Builder::new()
        .name("nimbo-live".to_string())
        .spawn(move || watch(app, generation))
        .map(|_| ())
        .map_err(|error| format!("Não consegui acompanhar os downloads: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temporary_download_files_are_recognised() {
        assert!(is_temp("filme.mp4.crdownload"));
        assert!(is_temp("setup.exe.PART"));
        assert!(!is_temp("foto.jpg"));
        assert!(!is_temp("sem-extensao"));
    }

    #[test]
    fn the_final_name_comes_from_the_temporary_one() {
        assert_eq!(final_name_of("relatório.pdf.crdownload").as_deref(), Some("relatório.pdf"));
        assert_eq!(final_name_of("Unconfirmed 123456.crdownload"), None);
        assert_eq!(final_name_of("abc.part"), None);
        assert_eq!(display_name("Unconfirmed 123456.crdownload"), "Unconfirmed 123456");
    }

    #[test]
    fn explorer_titles_give_the_percent() {
        assert_eq!(parse_percent("45% concluído"), Some(45));
        assert_eq!(parse_percent("100% complete"), Some(100));
        assert_eq!(parse_percent("已完成 7%"), Some(7));
        assert_eq!(parse_percent("Copiando 3 itens"), None);
        assert_eq!(parse_percent("250% bug"), None);
    }
}
