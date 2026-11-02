//! "Ask your PC": why it is slow, what is filling the disk, free up space,
//! shut down later. Also the file half of the launcher's universal search.

use serde::Serialize;
use std::{
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant, SystemTime},
};
use windows::{
    core::HSTRING,
    Win32::Storage::FileSystem::GetDiskFreeSpaceExW,
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const MAX_HITS: usize = 8;
const MAX_VISITED: usize = 40_000;
const SEARCH_BUDGET: Duration = Duration::from_millis(1_500);
const SKIP_DIRS: [&str; 8] = ["node_modules", ".git", "appdata", "$recycle.bin", "target", ".cache", "__pycache__", ".venv"];

/// Lower case without Portuguese accents, so "Março" matches "marco".
pub(crate) fn fold(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            other => other,
        })
        .collect()
}

#[derive(Serialize, Debug)]
pub(crate) struct FileHit {
    name: String,
    path: String,
    folder: String,
    /// Milliseconds since 1970.
    modified: u64,
}

fn search_roots() -> Vec<PathBuf> {
    let Some(home) = std::env::var_os("USERPROFILE").map(PathBuf::from) else { return Vec::new() };
    let mut roots: Vec<PathBuf> = ["Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music", r"OneDrive\Desktop", r"OneDrive\Documents", r"OneDrive\Área de Trabalho", r"OneDrive\Documentos"]
        .iter()
        .map(|name| home.join(name))
        .filter(|path| path.is_dir())
        .collect();
    if let Some(recent) = std::env::var_os("APPDATA").map(|dir| PathBuf::from(dir).join(r"Microsoft\Windows\Recent")) {
        roots.insert(0, recent);
    }
    roots
}

fn millis(time: SystemTime) -> u64 {
    time.duration_since(SystemTime::UNIX_EPOCH).map(|value| value.as_millis() as u64).unwrap_or(0)
}

fn month_of(ms: u64) -> u32 {
    use chrono::Datelike;
    chrono::DateTime::from_timestamp_millis(ms as i64).map(|time| time.with_timezone(&chrono::Local).month()).unwrap_or(0)
}

pub(crate) fn file_matches(name: &str, terms: &[String], extensions: &[String]) -> bool {
    let folded = fold(name);
    let extension_ok = extensions.is_empty()
        || Path::new(&folded.trim_end_matches(".lnk")).extension().and_then(|ext| ext.to_str()).is_some_and(|ext| extensions.iter().any(|wanted| wanted == ext));
    extension_ok && terms.iter().all(|term| folded.contains(term.as_str()))
}

/// Files whose name holds every word, of the wanted types and month, newest first.
#[tauri::command]
pub(crate) async fn search_files(terms: Vec<String>, extensions: Vec<String>, month: Option<u32>) -> Result<Vec<FileHit>, String> {
    let terms: Vec<String> = terms.iter().map(|term| fold(term)).filter(|term| term.len() >= 2).take(6).collect();
    let extensions: Vec<String> = extensions.iter().map(|ext| fold(ext)).take(8).collect();
    if terms.is_empty() && extensions.is_empty() {
        return Ok(Vec::new());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let mut hits: Vec<FileHit> = Vec::new();
        let mut visited = 0usize;
        let mut stack: Vec<(PathBuf, u32)> = search_roots().into_iter().map(|root| (root, 0)).collect();
        while let Some((dir, depth)) = stack.pop() {
            if visited > MAX_VISITED || started.elapsed() > SEARCH_BUDGET {
                break;
            }
            let Ok(entries) = std::fs::read_dir(&dir) else { continue };
            for entry in entries.flatten() {
                visited += 1;
                let name = entry.file_name().to_string_lossy().to_string();
                let Ok(meta) = entry.metadata() else { continue };
                if meta.is_dir() {
                    if depth < 4 && !name.starts_with('.') && !SKIP_DIRS.contains(&fold(&name).as_str()) {
                        stack.push((entry.path(), depth + 1));
                    }
                    continue;
                }
                if name.eq_ignore_ascii_case("desktop.ini") || !file_matches(&name, &terms, &extensions) {
                    continue;
                }
                let modified = meta.modified().map(millis).unwrap_or(0);
                if month.is_some_and(|wanted| month_of(modified) != wanted) {
                    continue;
                }
                let path = entry.path();
                let shown = name.trim_end_matches(".lnk").to_string();
                if hits.iter().any(|hit| hit.name.eq_ignore_ascii_case(&shown)) {
                    continue;
                }
                hits.push(FileHit {
                    name: shown,
                    folder: dir.file_name().map(|folder| folder.to_string_lossy().to_string()).unwrap_or_default(),
                    path: path.to_string_lossy().to_string(),
                    modified,
                });
            }
        }
        hits.sort_by(|a, b| b.modified.cmp(&a.modified));
        hits.truncate(MAX_HITS);
        hits
    })
    .await
    .map_err(|error| error.to_string())
}

/// Opens a file the search found (only inside the searched folders).
#[tauri::command]
pub(crate) fn search_open(path: String) -> Result<(), String> {
    let file = Path::new(&path);
    let inside = search_roots().iter().any(|root| file.starts_with(root));
    if !inside || !file.exists() {
        return Err("Esse arquivo não está mais lá.".to_string());
    }
    Command::new("explorer.exe").arg(file).spawn().map(|_| ()).map_err(|error| error.to_string())
}

#[derive(Serialize)]
struct ProcessUse {
    name: String,
    memory_mb: u64,
    cpu_percent: f64,
}

fn powershell(script: &str) -> Result<String, String> {
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| error.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn free_gb(path: &str) -> Option<(f64, f64)> {
    let (mut free, mut total) = (0u64, 0u64);
    unsafe { GetDiskFreeSpaceExW(&HSTRING::from(path), Some(&mut free), Some(&mut total), None).ok()? };
    Some((free as f64 / 1e9, total as f64 / 1e9))
}

fn dir_size(dir: &Path, budget: &mut usize) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    let mut total = 0;
    for entry in entries.flatten() {
        if *budget == 0 {
            break;
        }
        *budget -= 1;
        let Ok(meta) = entry.metadata() else { continue };
        total += if meta.is_dir() { dir_size(&entry.path(), budget) } else { meta.len() };
    }
    total
}

/// Snapshot for "why is it slow?" and "what is filling the disk?".
pub(crate) async fn pc_status() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        // CPU per process needs two samples; Windows' own counters do that for us.
        let raw = powershell(
            "$c=(Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors; Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.Name -ne '_Total' -and $_.Name -ne 'Idle' } | Sort-Object WorkingSetPrivate -Descending | Select-Object -First 8 Name, @{n='mb';e={[math]::Round($_.WorkingSetPrivate/1MB)}}, @{n='cpu';e={[math]::Round($_.PercentProcessorTime/$c,1)}} | ConvertTo-Json -Compress",
        )
        .unwrap_or_default();
        let processes: Vec<ProcessUse> = serde_json::from_str::<serde_json::Value>(raw.trim())
            .ok()
            .map(|value| if value.is_array() { value } else { serde_json::Value::Array(vec![value]) })
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default()
            .iter()
            .map(|item| ProcessUse {
                name: item["Name"].as_str().unwrap_or("").split('#').next().unwrap_or("").to_string(),
                memory_mb: item["mb"].as_u64().unwrap_or(0),
                cpu_percent: item["cpu"].as_f64().unwrap_or(0.0),
            })
            .collect();
        let stats = crate::system::system_stats().ok();
        let disk = free_gb("C:\\");
        let mut budget = 30_000;
        let temp_gb = std::env::var_os("TEMP").map(|dir| dir_size(Path::new(&dir), &mut budget) as f64 / 1e9).unwrap_or(0.0);
        let mut budget = 30_000;
        let downloads_gb = std::env::var_os("USERPROFILE")
            .map(|home| dir_size(&PathBuf::from(home).join("Downloads"), &mut budget) as f64 / 1e9)
            .unwrap_or(0.0);
        serde_json::json!({
            "cpuAndMemory": stats,
            "topProcessesByMemory": processes,
            "diskC": disk.map(|(free, total)| serde_json::json!({ "freeGB": (free * 10.0).round() / 10.0, "totalGB": total.round() })),
            "tempFolderGB": (temp_gb * 100.0).round() / 100.0,
            "downloadsFolderGB": (downloads_gb * 100.0).round() / 100.0,
        })
        .to_string()
    })
    .await
    .map_err(|error| error.to_string())
}

/// Deletes temporary files older than two days (what Windows' own cleanup does).
pub(crate) async fn clean_temp() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let dir = std::env::var_os("TEMP").map(PathBuf::from).ok_or("No temp folder.")?;
        let cutoff = SystemTime::now() - Duration::from_secs(2 * 24 * 3600);
        let (mut freed, mut removed) = (0u64, 0u32);
        let Ok(entries) = std::fs::read_dir(&dir) else { return Err("Could not read the temp folder.".to_string()) };
        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            if meta.modified().map(|time| time > cutoff).unwrap_or(true) {
                continue;
            }
            let mut budget = 20_000;
            let size = if meta.is_dir() { dir_size(&entry.path(), &mut budget) } else { meta.len() };
            let gone = if meta.is_dir() { std::fs::remove_dir_all(entry.path()).is_ok() } else { std::fs::remove_file(entry.path()).is_ok() };
            // Files in use stay; that is expected.
            if gone {
                freed += size;
                removed += 1;
            }
        }
        Ok(format!("Removed {removed} old temporary items, freeing {:.2} GB.", freed as f64 / 1e9))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Shuts the PC down after `minutes`, or cancels a pending shutdown with 0.
pub(crate) fn shutdown_in(minutes: u32) -> Result<String, String> {
    let status = if minutes == 0 {
        Command::new("shutdown.exe").arg("/a").creation_flags(CREATE_NO_WINDOW).status()
    } else {
        Command::new("shutdown.exe").args(["/s", "/t", &(minutes.min(24 * 60) * 60).to_string()]).creation_flags(CREATE_NO_WINDOW).status()
    }
    .map_err(|error| error.to_string())?;
    match (minutes, status.success()) {
        (0, true) => Ok("Scheduled shutdown cancelled.".to_string()),
        (0, false) => Ok("There was no shutdown scheduled.".to_string()),
        (_, true) => Ok(format!("The PC will shut down in {minutes} minutes.")),
        _ => Err("Windows refused to schedule the shutdown.".to_string()),
    }
}

pub(crate) fn lock_pc() -> Result<String, String> {
    unsafe { windows::Win32::System::Shutdown::LockWorkStation() }.map_err(|error| error.to_string())?;
    Ok("Locked.".to_string())
}

/// Assistant tools that act on the PC itself; the webview forwards them here.
#[tauri::command]
pub(crate) async fn pc_tool(name: String, minutes: Option<u32>, confirm: Option<bool>) -> Result<String, String> {
    match name.as_str() {
        "pc_status" => pc_status().await,
        "free_space" if confirm == Some(true) => clean_temp().await,
        "free_space" => Ok("Ask the user to confirm before deleting old temporary files; then call again with confirm true.".to_string()),
        "shutdown_timer" => shutdown_in(minutes.unwrap_or(0)),
        "lock_pc" => lock_pc(),
        _ => Err("Unknown PC tool.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_match_without_accents_or_case() {
        assert!(file_matches("Contrato Março 2026.pdf", &["contrato".into(), "marco".into()], &["pdf".into()]));
        assert!(file_matches("Contrato.pdf.lnk", &["contrato".into()], &["pdf".into()]));
        assert!(!file_matches("Contrato.docx", &["contrato".into()], &["pdf".into()]));
        assert!(!file_matches("Relatório.pdf", &["contrato".into()], &[]));
        assert_eq!(fold("ÁGUA Ação"), "agua acao");
    }
}
