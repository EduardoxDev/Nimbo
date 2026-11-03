use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use windows::core::{Interface, HSTRING};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ};
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

pub(crate) const MEMORY_WINDOW_LABEL: &str = "memory";
const MAX_FILES: usize = 400;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct RecentFile {
    path: String,
    name: String,
    folder: bool,
    at: u64,
}

fn recent_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|dir| PathBuf::from(dir).join("Microsoft").join("Windows").join("Recent")).filter(|dir| dir.is_dir())
}

fn millis(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).map(|duration| duration.as_millis() as u64).unwrap_or(0)
}

fn target_of(link: &Path) -> Option<PathBuf> {
    unsafe {
        let shell: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        let file: IPersistFile = shell.cast().ok()?;
        file.Load(&HSTRING::from(link.as_os_str()), STGM_READ).ok()?;
        let mut buffer = [0u16; 1024];
        shell.GetPath(&mut buffer, std::ptr::null_mut(), 0).ok()?;
        let length = buffer.iter().position(|unit| *unit == 0).unwrap_or(buffer.len());
        let path = String::from_utf16_lossy(&buffer[..length]);
        (!path.is_empty()).then(|| PathBuf::from(path))
    }
}

pub(crate) fn newest_links(dir: &Path, since: SystemTime) -> Vec<(PathBuf, SystemTime)> {
    let mut links: Vec<(PathBuf, SystemTime)> = fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.path().extension().map(|ext| ext.eq_ignore_ascii_case("lnk")).unwrap_or(false))
                .filter_map(|entry| entry.metadata().ok().and_then(|meta| meta.modified().ok()).map(|time| (entry.path(), time)))
                .filter(|(_, time)| *time >= since)
                .collect()
        })
        .unwrap_or_default();
    links.sort_by(|a, b| b.1.cmp(&a.1));
    links.truncate(MAX_FILES);
    links
}

fn read_recent(days: u32) -> Vec<RecentFile> {
    let Some(dir) = recent_dir() else { return Vec::new() };
    let since = SystemTime::now() - Duration::from_secs(u64::from(days.clamp(1, 60)) * 86_400);
    let links = newest_links(&dir, since);
    let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok();
    let mut seen = std::collections::HashSet::new();
    let files = links
        .into_iter()
        .filter_map(|(link, time)| {
            let target = target_of(&link)?;
            if !target.exists() || !seen.insert(target.to_string_lossy().to_lowercase()) {
                return None;
            }
            let name = target.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_else(|| target.display().to_string());
            Some(RecentFile { folder: target.is_dir(), path: target.display().to_string(), name, at: millis(time) })
        })
        .collect();
    if initialized {
        unsafe { CoUninitialize() };
    }
    files
}

#[tauri::command]
pub(crate) async fn memory_recent_files(days: Option<u32>) -> Result<Vec<RecentFile>, String> {
    let days = days.unwrap_or(14);
    tauri::async_runtime::spawn_blocking(move || read_recent(days)).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn memory_open_file(path: String) -> Result<(), String> {
    let wanted = path.trim().to_lowercase();
    let known = tauri::async_runtime::spawn_blocking(|| read_recent(60)).await.map_err(|error| error.to_string())?;
    let file = known.into_iter().find(|file| file.path.to_lowercase() == wanted).ok_or_else(|| "Nimbo only reopens files from your recent list.".to_string())?;
    std::process::Command::new("explorer.exe").arg(&file.path).spawn().map(|_| ()).map_err(|error| error.to_string())
}

pub(crate) fn show_memory_window(app: &AppHandle) -> Result<(), String> {
    let window = match app.get_webview_window(MEMORY_WINDOW_LABEL) {
        Some(window) => window,
        None => WebviewWindowBuilder::new(app, MEMORY_WINDOW_LABEL, WebviewUrl::App("index.html?window=memory".into()))
            .title("Nimbo Memória")
            .inner_size(980.0, 660.0)
            .min_inner_size(760.0, 520.0)
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
pub(crate) async fn memory_open(app: AppHandle) -> Result<(), String> {
    show_memory_window(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_recent_shortcuts_are_read_newest_first() {
        let dir = std::env::temp_dir().join("nimbo-memory-recent");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.lnk"), b"x").unwrap();
        std::thread::sleep(Duration::from_millis(20));
        fs::write(dir.join("b.lnk"), b"x").unwrap();
        fs::write(dir.join("notes.txt"), b"x").unwrap();
        let links = newest_links(&dir, SystemTime::now() - Duration::from_secs(60));
        let names: Vec<_> = links.iter().map(|(path, _)| path.file_name().unwrap().to_string_lossy().to_string()).collect();
        assert_eq!(names, vec!["b.lnk", "a.lnk"]);
        assert!(newest_links(&dir, SystemTime::now() + Duration::from_secs(60)).is_empty());
    }

    #[test]
    fn real_recent_list_resolves_without_crashing() {
        let files = read_recent(3);
        assert!(files.iter().all(|file| !file.path.is_empty() && file.at > 0));
    }
}
