//! Folders that tidy themselves: loose files in Downloads go into folders by
//! type (with an undo), and big files forgotten for a month are pointed out.

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};
use tauri::{AppHandle, Manager};

const RECENT: Duration = Duration::from_secs(10 * 60);
const OLD: Duration = Duration::from_secs(30 * 24 * 3600);
const BIG: u64 = 200 * 1024 * 1024;
const PARTIAL: [&str; 4] = ["crdownload", "part", "tmp", "download"];

/// Folder names stay the same in every language so the undo log always matches.
pub(crate) fn folder_for(extension: &str) -> &'static str {
    match extension {
        "pdf" | "doc" | "docx" | "odt" | "rtf" | "txt" | "md" | "xls" | "xlsx" | "csv" | "ods" | "ppt" | "pptx" | "odp" | "epub" => "Documentos",
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "heic" | "bmp" | "svg" | "tif" | "tiff" | "avif" => "Imagens",
        "mp4" | "mov" | "mkv" | "avi" | "webm" | "wmv" => "Videos",
        "mp3" | "wav" | "flac" | "m4a" | "ogg" | "aac" => "Musicas",
        "zip" | "rar" | "7z" | "tar" | "gz" | "iso" => "Compactados",
        "exe" | "msi" | "msix" | "appx" => "Instaladores",
        _ => "Outros",
    }
}

fn downloads_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join("Downloads")).filter(|dir| dir.is_dir())
}

fn undo_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("downloads-undo.json"))
}

#[derive(Serialize, Deserialize)]
struct Move {
    from: String,
    to: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BigFile {
    name: String,
    path: String,
    size_mb: u64,
    days_old: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DownloadsReport {
    /// Loose files that would move, per folder.
    loose: Vec<(String, u32)>,
    loose_total: u32,
    big_old: Vec<BigFile>,
    can_undo: bool,
}

fn loose_files(dir: &Path) -> Vec<(PathBuf, &'static str)> {
    let now = SystemTime::now();
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    entries
        .flatten()
        .filter_map(|entry| {
            let meta = entry.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let path = entry.path();
            let extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or_default().to_lowercase();
            let name = entry.file_name().to_string_lossy().to_lowercase();
            // Still downloading, or just arrived: leave it where the browser put it.
            let fresh = meta.modified().ok().and_then(|time| now.duration_since(time).ok()).is_none_or(|age| age < RECENT);
            if fresh || PARTIAL.contains(&extension.as_str()) || name == "desktop.ini" {
                return None;
            }
            Some((path, folder_for(&extension)))
        })
        .collect()
}

fn big_old_files(dir: &Path) -> Vec<BigFile> {
    let now = SystemTime::now();
    let mut found = Vec::new();
    let mut stack = vec![(dir.to_path_buf(), 0)];
    while let Some((folder, depth)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&folder) else { continue };
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                if depth < 2 {
                    stack.push((entry.path(), depth + 1));
                }
                continue;
            }
            let age = meta.accessed().or_else(|_| meta.modified()).ok().and_then(|time| now.duration_since(time).ok()).unwrap_or_default();
            if meta.len() >= BIG && age >= OLD {
                found.push(BigFile {
                    name: entry.file_name().to_string_lossy().to_string(),
                    path: entry.path().to_string_lossy().to_string(),
                    size_mb: meta.len() / (1024 * 1024),
                    days_old: age.as_secs() / 86_400,
                });
            }
        }
    }
    found.sort_by(|a, b| b.size_mb.cmp(&a.size_mb));
    found.truncate(8);
    found
}

#[tauri::command]
pub(crate) async fn downloads_report(app: AppHandle) -> Result<DownloadsReport, String> {
    let can_undo = undo_file(&app).is_some_and(|file| file.is_file());
    tauri::async_runtime::spawn_blocking(move || {
        let dir = downloads_dir().ok_or("Não achei a pasta Downloads.")?;
        let files = loose_files(&dir);
        let mut loose: Vec<(String, u32)> = Vec::new();
        for (_, folder) in &files {
            match loose.iter_mut().find(|(name, _)| name == folder) {
                Some((_, count)) => *count += 1,
                None => loose.push((folder.to_string(), 1)),
            }
        }
        loose.sort_by(|a, b| b.1.cmp(&a.1));
        Ok(DownloadsReport { loose_total: files.len() as u32, loose, big_old: big_old_files(&dir), can_undo })
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Next free name: "foto.png" → "foto (2).png".
pub(crate) fn free_path(folder: &Path, name: &str) -> PathBuf {
    let target = folder.join(name);
    if !target.exists() {
        return target;
    }
    let path = Path::new(name);
    let stem = path.file_stem().and_then(|stem| stem.to_str()).unwrap_or(name);
    let extension = path.extension().and_then(|ext| ext.to_str()).map(|ext| format!(".{ext}")).unwrap_or_default();
    (2..1000).map(|index| folder.join(format!("{stem} ({index}){extension}"))).find(|candidate| !candidate.exists()).unwrap_or(target)
}

#[tauri::command]
pub(crate) async fn downloads_organize(app: AppHandle) -> Result<u32, String> {
    let log = undo_file(&app).ok_or("No app folder.")?;
    tauri::async_runtime::spawn_blocking(move || {
        let dir = downloads_dir().ok_or("Não achei a pasta Downloads.")?;
        let mut moves = Vec::new();
        for (path, folder) in loose_files(&dir) {
            let target_dir = dir.join(folder);
            if fs::create_dir_all(&target_dir).is_err() {
                continue;
            }
            let name = path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
            let target = free_path(&target_dir, &name);
            // Files open in another program fail to move and simply stay.
            if fs::rename(&path, &target).is_ok() {
                moves.push(Move { from: path.to_string_lossy().to_string(), to: target.to_string_lossy().to_string() });
            }
        }
        if !moves.is_empty() {
            fs::write(&log, serde_json::to_string(&moves).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
        }
        Ok(moves.len() as u32)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Puts back everything the last tidy-up moved.
#[tauri::command]
pub(crate) async fn downloads_undo(app: AppHandle) -> Result<u32, String> {
    let log = undo_file(&app).ok_or("No app folder.")?;
    tauri::async_runtime::spawn_blocking(move || {
        let moves: Vec<Move> = serde_json::from_str(&fs::read_to_string(&log).map_err(|_| "Não há nada para desfazer.".to_string())?).map_err(|error| error.to_string())?;
        let mut restored = 0;
        for item in moves {
            let (from, to) = (Path::new(&item.from), Path::new(&item.to));
            if to.exists() && !from.exists() && fs::rename(to, from).is_ok() {
                restored += 1;
            }
        }
        let _ = fs::remove_file(&log);
        Ok(restored)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Shows a file in Explorer (for the big forgotten ones).
#[tauri::command]
pub(crate) fn downloads_reveal(path: String) -> Result<(), String> {
    let dir = downloads_dir().ok_or("Não achei a pasta Downloads.")?;
    let file = Path::new(&path);
    if !file.starts_with(&dir) || !file.exists() {
        return Err("Esse arquivo não está mais lá.".to_string());
    }
    std::process::Command::new("explorer.exe").arg(format!("/select,{}", file.display())).spawn().map(|_| ()).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn files_go_to_the_right_folder() {
        assert_eq!(folder_for("pdf"), "Documentos");
        assert_eq!(folder_for("png"), "Imagens");
        assert_eq!(folder_for("exe"), "Instaladores");
        assert_eq!(folder_for("xyz"), "Outros");
    }
}
