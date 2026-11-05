//! "Where did I leave off?": the apps open now and the files and folders used
//! in the last hours (from Windows' Recent items), so a project reopens in one click.

use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

const MAX_APPS: usize = 10;
const MAX_FILES: usize = 12;
/// Programs that cannot be reopened by path, or that are the shell itself.
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

#[derive(Serialize, Debug, PartialEq)]
pub(crate) struct WorkspaceItem {
    pub(crate) name: String,
    pub(crate) path: String,
}

#[derive(Serialize, Debug)]
pub(crate) struct WorkspaceSnapshot {
    apps: Vec<WorkspaceItem>,
    files: Vec<WorkspaceItem>,
}

pub(crate) fn recent_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|dir| PathBuf::from(dir).join(r"Microsoft\Windows\Recent"))
}

fn stem(path: &str) -> String {
    Path::new(path).file_stem().and_then(|name| name.to_str()).unwrap_or(path).to_string()
}

/// Shortcuts Windows made for files and folders opened since `since`, newest first.
pub(crate) fn recent_files(since: SystemTime) -> Vec<WorkspaceItem> {
    let Some(dir) = recent_dir() else { return Vec::new() };
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut found: Vec<(SystemTime, WorkspaceItem)> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let is_link = path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("lnk"));
            let modified = entry.metadata().ok()?.modified().ok()?;
            (is_link && modified >= since).then(|| {
                let path = path.to_string_lossy().to_string();
                (modified, WorkspaceItem { name: stem(&path), path })
            })
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, item)| item).take(MAX_FILES).collect()
}

/// Window titles read "file - App"; the app part is the friendliest name.
fn app_name(title: &str, path: &str) -> String {
    title.rsplit(" - ").next().filter(|name| !name.trim().is_empty() && name.len() <= 40).map(str::trim).map(str::to_string).unwrap_or_else(|| stem(path))
}

#[tauri::command]
pub(crate) async fn workspace_snapshot(hours: Option<u32>) -> Result<WorkspaceSnapshot, String> {
    let hours = hours.unwrap_or(6).clamp(1, 48);
    tauri::async_runtime::spawn_blocking(move || {
        let mut apps: Vec<WorkspaceItem> = Vec::new();
        for window in crate::buddy::open_windows() {
            if SKIPPED.contains(&window.app.as_str()) || apps.iter().any(|app| app.path.eq_ignore_ascii_case(&window.path)) {
                continue;
            }
            apps.push(WorkspaceItem { name: app_name(&window.title, &window.path), path: window.path });
        }
        apps.truncate(MAX_APPS);
        let since = SystemTime::now() - Duration::from_secs(u64::from(hours) * 3_600);
        WorkspaceSnapshot { apps, files: recent_files(since) }
    })
    .await
    .map_err(|error| error.to_string())
}

/// Reopens a saved project: programs that are not running yet, then its files and folders.
#[tauri::command]
pub(crate) async fn workspace_open(apps: Vec<String>, files: Vec<String>) -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let running: Vec<String> = crate::buddy::open_windows().into_iter().map(|window| window.path.to_lowercase()).collect();
        let recent = recent_dir();
        let mut opened = 0;
        for app in apps.iter().take(MAX_APPS) {
            let program = Path::new(app);
            let is_exe = program.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("exe"));
            if !is_exe || !program.is_file() || running.contains(&app.to_lowercase()) {
                continue;
            }
            if std::process::Command::new(program).spawn().is_ok() {
                opened += 1;
            }
        }
        for file in files.iter().take(MAX_FILES) {
            let link = Path::new(file);
            // Only Windows' own Recent shortcuts: the saved list cannot point anywhere else.
            let inside_recent = recent.as_ref().is_some_and(|dir| link.parent() == Some(dir.as_path()));
            let is_link = link.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| ext.eq_ignore_ascii_case("lnk"));
            if inside_recent && is_link && link.is_file() && std::process::Command::new("explorer.exe").arg(link).spawn().is_ok() {
                opened += 1;
            }
        }
        if opened == 0 && !(apps.is_empty() && files.is_empty()) {
            return Err("Tudo desse projeto já está aberto ou não existe mais.".to_string());
        }
        Ok(opened)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_names_come_from_the_title() {
        assert_eq!(app_name("App.tsx - nimbo - Visual Studio Code", r"C:\x\Code.exe"), "Visual Studio Code");
        assert_eq!(app_name("Spotify", r"C:\x\Spotify.exe"), "Spotify");
        assert_eq!(app_name("", r"C:\x\Notion.exe"), "Notion");
    }
}
