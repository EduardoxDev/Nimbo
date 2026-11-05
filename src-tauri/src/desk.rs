//! The PC's time machine: every few minutes of use, a picture of the desk (which programs
//! were open, where each window sat, the files in use and the browser page), kept only on
//! this PC for a week. "Volta meu PC para ontem às 15h" reopens what is missing and puts
//! every window back where it was.

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use windows::Win32::{
    Foundation::{HWND, POINT, RECT},
    UI::WindowsAndMessaging::{GetWindowPlacement, SetWindowPlacement, SW_SHOWMAXIMIZED, SW_SHOWMINIMIZED, SW_SHOWNORMAL, WINDOWPLACEMENT},
};

const SNAP_EVERY: Duration = Duration::from_secs(5 * 60);
const KEEP_DAYS: i64 = 7;
const MAX_WINDOWS: usize = 30;
/// Programs that are the shell, or Nimbo, or cannot be reopened by path.
const SKIPPED: [&str; 8] = [
    "explorer.exe",
    "applicationframehost.exe",
    "nimbo.exe",
    "searchhost.exe",
    "shellexperiencehost.exe",
    "startmenuexperiencehost.exe",
    "textinputhost.exe",
    "systemsettings.exe",
];

static DIR: OnceLock<PathBuf> = OnceLock::new();

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct Placement {
    /// "normal", "max" or "min".
    show: String,
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct DeskWindow {
    app: String,
    path: String,
    title: String,
    placement: Placement,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct Desk {
    /// Milliseconds since 1970.
    at: u64,
    windows: Vec<DeskWindow>,
    /// Windows' Recent shortcuts touched since the last picture.
    files: Vec<String>,
    url: Option<String>,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeskRestore {
    /// When the picture used was taken.
    at: u64,
    launched: u32,
    moved: u32,
    files: u32,
    /// Opened by the island (the default browser), not here.
    urls: Vec<String>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|time| time.as_millis() as u64).unwrap_or(0)
}

fn day_key(ms: u64) -> String {
    chrono::DateTime::from_timestamp_millis(ms as i64)
        .map(|time| time.with_timezone(&chrono::Local).format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

fn file_for(day: &str) -> Option<PathBuf> {
    DIR.get().map(|dir| dir.join(format!("{day}.json")))
}

fn load(day: &str) -> Vec<Desk> {
    file_for(day).and_then(|path| fs::read_to_string(path).ok()).and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

fn placement_of(window: HWND) -> Option<Placement> {
    let mut placement = WINDOWPLACEMENT { length: std::mem::size_of::<WINDOWPLACEMENT>() as u32, ..Default::default() };
    unsafe { GetWindowPlacement(window, &mut placement) }.ok()?;
    let show = match placement.showCmd as i32 {
        value if value == SW_SHOWMAXIMIZED.0 => "max",
        value if value == SW_SHOWMINIMIZED.0 => "min",
        _ => "normal",
    };
    let rect = placement.rcNormalPosition;
    Some(Placement { show: show.to_string(), left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })
}

fn place(window: HWND, placement: &Placement) -> bool {
    let show = match placement.show.as_str() {
        "max" => SW_SHOWMAXIMIZED,
        "min" => SW_SHOWMINIMIZED,
        _ => SW_SHOWNORMAL,
    };
    let wanted = WINDOWPLACEMENT {
        length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
        flags: Default::default(),
        showCmd: show.0 as u32,
        ptMinPosition: POINT { x: -1, y: -1 },
        ptMaxPosition: POINT { x: -1, y: -1 },
        rcNormalPosition: RECT { left: placement.left, top: placement.top, right: placement.right, bottom: placement.bottom },
    };
    unsafe { SetWindowPlacement(window, &wanted) }.is_ok()
}

fn current_windows() -> Vec<(HWND, DeskWindow)> {
    crate::buddy::open_window_handles()
        .into_iter()
        .filter(|(_, window)| !SKIPPED.contains(&window.app.as_str()))
        .filter_map(|(handle, window)| {
            let placement = placement_of(handle)?;
            let title = crate::activity::private_title(&window.app, &window.title);
            Some((handle, DeskWindow { app: window.app, path: window.path, title, placement }))
        })
        .take(MAX_WINDOWS)
        .collect()
}

/// A new picture is only kept when the desk changed: other programs, or windows moved.
pub(crate) fn changed(previous: Option<&Desk>, windows: &[DeskWindow], files: &[String]) -> bool {
    let Some(previous) = previous else { return true };
    let shape = |list: &[DeskWindow]| list.iter().map(|window| (window.path.to_lowercase(), window.placement.clone())).collect::<Vec<_>>();
    !files.is_empty() || shape(&previous.windows) != shape(windows)
}

/// The last picture taken at or before `at`.
pub(crate) fn nearest(desks: &[Desk], at: u64) -> Option<&Desk> {
    desks.iter().filter(|desk| desk.at <= at).max_by_key(|desk| desk.at)
}

/// Which open window takes which saved place: same program, in the order they were stacked.
pub(crate) fn pair_up<'a, T>(saved: &'a [DeskWindow], open: &'a [(T, String)]) -> Vec<(&'a T, &'a DeskWindow)> {
    let mut taken = vec![false; open.len()];
    let mut pairs = Vec::new();
    for window in saved {
        if let Some(index) = open.iter().enumerate().position(|(index, (_, path))| !taken[index] && path.eq_ignore_ascii_case(&window.path)) {
            taken[index] = true;
            pairs.push((&open[index].0, window));
        }
    }
    pairs
}

fn snapshot(last: &mut Option<Desk>) {
    let at = now_ms();
    let windows: Vec<DeskWindow> = current_windows().into_iter().map(|(_, window)| window).collect();
    let since = SystemTime::now() - SNAP_EVERY - Duration::from_secs(30);
    let files: Vec<String> = crate::workspace::recent_files(since).into_iter().map(|item| item.path).collect();
    if windows.is_empty() || !changed(last.as_ref(), &windows, &files) {
        return;
    }
    let url = tauri::async_runtime::block_on(crate::handoff::browser_url()).ok().flatten();
    let desk = Desk { at, windows, files, url };
    let day = day_key(at);
    let mut desks = load(&day);
    desks.push(desk.clone());
    if let (Some(path), Ok(text)) = (file_for(&day), serde_json::to_string(&desks)) {
        let _ = fs::write(path, text);
    }
    *last = Some(desk);
}

fn prune() {
    let Some(dir) = DIR.get() else { return };
    let oldest = (chrono::Local::now() - chrono::Duration::days(KEEP_DAYS)).format("%Y-%m-%d").to_string();
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".json") && name < format!("{oldest}.json") {
            let _ = fs::remove_file(entry.path());
        }
    }
}

pub(crate) fn init(app: &AppHandle) {
    let Ok(dir) = app.path().app_data_dir().map(|dir| dir.join("desk")) else { return };
    if fs::create_dir_all(&dir).is_err() || DIR.set(dir).is_err() {
        return;
    }
    prune();
    thread::spawn(|| {
        let mut last: Option<Desk> = load(&day_key(now_ms())).pop();
        loop {
            thread::sleep(SNAP_EVERY);
            // Same switch and the same "away" rule as the day's diary.
            if crate::activity::is_enabled() && crate::activity::idle_seconds() < 5 * 60 {
                snapshot(&mut last);
            }
        }
    });
}

/// Puts the desk back as it was at `at` (ms): opens what is missing, then moves every window.
#[tauri::command]
pub(crate) async fn desk_restore(at: u64) -> Result<DeskRestore, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut desks = load(&day_key(at));
        if nearest(&desks, at).is_none() {
            desks = load(&day_key(at.saturating_sub(86_400_000)));
        }
        let desk = nearest(&desks, at).cloned().ok_or("Não tenho uma foto da mesa desse horário. Ela começa a ser guardada a partir de agora, a cada 5 minutos de uso.")?;
        let mut result = DeskRestore { at: desk.at, ..Default::default() };

        let running: Vec<String> = current_windows().into_iter().map(|(_, window)| window.path.to_lowercase()).collect();
        let mut started: Vec<String> = Vec::new();
        for window in &desk.windows {
            let path = Path::new(&window.path);
            let key = window.path.to_lowercase();
            let is_exe = path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("exe"));
            if !is_exe || !path.is_file() || running.contains(&key) || started.contains(&key) {
                continue;
            }
            if std::process::Command::new(path).spawn().is_ok() {
                started.push(key);
                result.launched += 1;
            }
        }
        let recent = crate::workspace::recent_dir();
        for file in desk.files.iter().take(12) {
            let link = Path::new(file);
            let inside_recent = recent.as_ref().is_some_and(|dir| link.parent() == Some(dir.as_path()));
            if inside_recent && link.is_file() && std::process::Command::new("explorer.exe").arg(link).spawn().is_ok() {
                result.files += 1;
            }
        }
        result.urls = desk.url.iter().cloned().collect();

        // Programs just opened need a moment to show their windows.
        if result.launched > 0 || result.files > 0 {
            thread::sleep(Duration::from_secs(4));
        }
        let open: Vec<(HWND, String)> = current_windows().into_iter().map(|(handle, window)| (handle, window.path)).collect();
        for (handle, window) in pair_up(&desk.windows, &open) {
            if place(*handle, &window.placement) {
                result.moved += 1;
            }
        }
        Ok(result)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window(path: &str, left: i32) -> DeskWindow {
        DeskWindow { app: String::new(), path: path.to_string(), title: String::new(), placement: Placement { show: "normal".into(), left, top: 0, right: left + 800, bottom: 600 } }
    }

    #[test]
    fn a_picture_is_kept_only_when_the_desk_changes() {
        let desk = Desk { at: 1, windows: vec![window(r"C:\a.exe", 0)], files: vec![], url: None };
        assert!(changed(None, &desk.windows, &[]));
        assert!(!changed(Some(&desk), &[window(r"c:\A.EXE", 0)], &[]));
        assert!(changed(Some(&desk), &[window(r"C:\a.exe", 100)], &[]));
        assert!(changed(Some(&desk), &desk.windows, &["x.lnk".to_string()]));
    }

    #[test]
    fn the_right_picture_and_the_right_windows() {
        let desks = vec![
            Desk { at: 100, windows: vec![], files: vec![], url: None },
            Desk { at: 300, windows: vec![], files: vec![], url: None },
        ];
        assert_eq!(nearest(&desks, 250).map(|desk| desk.at), Some(100));
        assert_eq!(nearest(&desks, 99), None);
        let saved = vec![window(r"C:\code.exe", 0), window(r"C:\code.exe", 900), window(r"C:\chrome.exe", 0)];
        let open = vec![(1, r"C:\chrome.exe".to_string()), (2, r"c:\CODE.exe".to_string()), (3, r"C:\code.exe".to_string()), (4, r"C:\spotify.exe".to_string())];
        let pairs: Vec<(i32, i32)> = pair_up(&saved, &open).into_iter().map(|(id, window)| (*id, window.placement.left)).collect();
        assert_eq!(pairs, vec![(2, 0), (3, 900), (1, 0)]);
    }
}
