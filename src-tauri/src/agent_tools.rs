use serde::Serialize;
use std::collections::VecDeque;
use std::fs;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const MAX_LIST: usize = 200;
const MAX_FOUND: usize = 15;
const SKIP: &[&str] = &["node_modules", "appdata", "target", "dist", "build", "$recycle.bin", "venv", ".venv", "__pycache__"];

fn home() -> Result<PathBuf, String> {
    std::env::var_os("USERPROFILE").map(PathBuf::from).filter(|dir| dir.is_dir()).ok_or_else(|| "The user folder was not found.".to_string())
}

fn fold(text: &str) -> String {
    text.chars().flat_map(char::to_lowercase).filter(|c| c.is_alphanumeric()).collect()
}

fn lower(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\").trim_start_matches(r"\\?\").to_lowercase()
}

pub(crate) fn inside(home: &Path, path: &Path) -> bool {
    let home = lower(home);
    let path = lower(path);
    if path == home {
        return true;
    }
    match path.strip_prefix(&format!("{}\\", home.trim_end_matches('\\'))) {
        Some(rest) => !rest.split('\\').any(|part| part == "appdata"),
        None => false,
    }
}

fn canonical_or_ancestor(path: &Path) -> PathBuf {
    let mut existing = path.to_path_buf();
    let mut rest = Vec::new();
    while !existing.exists() {
        match (existing.file_name().map(|name| name.to_os_string()), existing.parent()) {
            (Some(name), Some(parent)) => {
                rest.push(name);
                existing = parent.to_path_buf();
            }
            _ => return path.to_path_buf(),
        }
    }
    let mut resolved = fs::canonicalize(&existing).unwrap_or(existing);
    for name in rest.into_iter().rev() {
        resolved.push(name);
    }
    resolved
}

pub(crate) fn resolve_in(home: &Path, raw: &str) -> Result<PathBuf, String> {
    let raw = raw.trim().trim_matches('"');
    if raw.is_empty() {
        return Err("Empty path.".to_string());
    }
    let expanded = if let Some(rest) = raw.strip_prefix('~') { home.join(rest.trim_start_matches(['\\', '/'])) } else { PathBuf::from(raw) };
    let absolute = if expanded.is_absolute() { expanded } else { home.join(expanded) };
    let resolved = canonical_or_ancestor(&absolute);
    let home = fs::canonicalize(home).unwrap_or_else(|_| home.to_path_buf());
    if resolved.components().any(|part| part.as_os_str() == "..") || !inside(&home, &resolved) {
        return Err(format!("{} is outside the user's folder, so Nimbo will not touch it.", resolved.display()));
    }
    Ok(resolved)
}

fn resolve(raw: &str) -> Result<PathBuf, String> {
    resolve_in(&home()?, raw)
}

pub(crate) fn wildcard(pattern: &str, name: &str) -> bool {
    let pattern: Vec<char> = pattern.to_lowercase().chars().collect();
    let name: Vec<char> = name.to_lowercase().chars().collect();
    let (mut p, mut n, mut star, mut mark) = (0, 0, None, 0);
    while n < name.len() {
        if p < pattern.len() && (pattern[p] == '?' || pattern[p] == name[n]) {
            p += 1;
            n += 1;
        } else if p < pattern.len() && pattern[p] == '*' {
            star = Some(p);
            mark = n;
            p += 1;
        } else if let Some(position) = star {
            p = position + 1;
            mark += 1;
            n = mark;
        } else {
            return false;
        }
    }
    pattern[p..].iter().all(|c| *c == '*')
}

pub(crate) fn unique_target(folder: &Path, name: &str) -> PathBuf {
    let first = folder.join(name);
    if !first.exists() {
        return first;
    }
    let path = Path::new(name);
    let stem = path.file_stem().map(|stem| stem.to_string_lossy().to_string()).unwrap_or_else(|| name.to_string());
    let extension = path.extension().map(|ext| format!(".{}", ext.to_string_lossy())).unwrap_or_default();
    (2..1000).map(|count| folder.join(format!("{stem} ({count}){extension}"))).find(|candidate| !candidate.exists()).unwrap_or(first)
}

fn skip(name: &str) -> bool {
    name.starts_with('.') || SKIP.contains(&name.to_lowercase().as_str())
}

fn find(home: &Path, query: &str) -> Vec<String> {
    let wanted = fold(query);
    if wanted.is_empty() {
        return Vec::new();
    }
    let mut found: Vec<(u8, usize, PathBuf)> = Vec::new();
    let mut queue = VecDeque::from([(home.to_path_buf(), 0usize)]);
    let mut visited = 0usize;
    while let Some((dir, depth)) = queue.pop_front() {
        visited += 1;
        if visited > 20_000 {
            break;
        }
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else { continue };
            if !kind.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if skip(&name) {
                continue;
            }
            let path = entry.path();
            let folded = fold(&name);
            if folded == wanted {
                found.push((0, depth, path.clone()));
            } else if folded.contains(&wanted) {
                found.push((1, depth, path.clone()));
            }
            if depth < 4 {
                queue.push_back((path, depth + 1));
            }
        }
    }
    found.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    found.into_iter().take(MAX_FOUND).map(|(_, _, path)| path.display().to_string()).collect()
}

#[derive(Serialize)]
struct Entry {
    name: String,
    folder: bool,
    size: u64,
    modified: u64,
}

#[tauri::command]
pub(crate) async fn agent_find_folders(query: String) -> Result<Vec<String>, String> {
    let home = home()?;
    tauri::async_runtime::spawn_blocking(move || find(&home, &query)).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn agent_list_files(path: String, pattern: Option<String>) -> Result<String, String> {
    let dir = resolve(&path)?;
    if !dir.is_dir() {
        return Err(format!("{} is not a folder.", dir.display()));
    }
    let pattern = pattern.filter(|pattern| !pattern.trim().is_empty()).unwrap_or_else(|| "*".to_string());
    let mut entries: Vec<Entry> = fs::read_dir(&dir)
        .map_err(|error| error.to_string())?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if !wildcard(&pattern, &name) {
                return None;
            }
            let meta = entry.metadata().ok()?;
            let modified = meta.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map(|time| time.as_millis() as u64).unwrap_or(0);
            Some(Entry { name, folder: meta.is_dir(), size: if meta.is_dir() { 0 } else { meta.len() }, modified })
        })
        .collect();
    let total = entries.len();
    entries.sort_by(|a, b| b.folder.cmp(&a.folder).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    entries.truncate(MAX_LIST);
    serde_json::to_string(&serde_json::json!({ "folder": dir.display().to_string(), "total": total, "entries": entries })).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn agent_open_path(path: String, with: Option<String>) -> Result<String, String> {
    let target = resolve(&path)?;
    if !target.exists() {
        return Err(format!("{} does not exist.", target.display()));
    }
    if with.as_deref() == Some("vscode") {
        let status = Command::new("cmd").args(["/c", "code"]).arg(&target).creation_flags(CREATE_NO_WINDOW).status().map_err(|error| error.to_string())?;
        if !status.success() {
            return Err("VS Code's `code` command is not installed.".to_string());
        }
        return Ok(format!("Opened {} in VS Code.", target.display()));
    }
    Command::new("explorer.exe").arg(&target).spawn().map_err(|error| error.to_string())?;
    Ok(format!("Opened {}.", target.display()))
}

#[tauri::command]
pub(crate) async fn agent_create_folder(path: String) -> Result<String, String> {
    let target = resolve(&path)?;
    fs::create_dir_all(&target).map_err(|error| error.to_string())?;
    Ok(format!("Folder ready: {}", target.display()))
}

#[tauri::command]
pub(crate) async fn agent_move_files(files: Vec<String>, to: String) -> Result<String, String> {
    if files.is_empty() || files.len() > 500 {
        return Err("Give between 1 and 500 files.".to_string());
    }
    let folder = resolve(&to)?;
    fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    let mut moved = Vec::new();
    let mut failed = Vec::new();
    for raw in &files {
        let source = match resolve(raw) {
            Ok(source) if source.is_file() => source,
            Ok(source) => {
                failed.push(format!("{} (not a file)", source.display()));
                continue;
            }
            Err(error) => {
                failed.push(error);
                continue;
            }
        };
        let name = source.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
        let target = unique_target(&folder, &name);
        match fs::rename(&source, &target).or_else(|_| fs::copy(&source, &target).and_then(|_| fs::remove_file(&source))) {
            Ok(()) => moved.push(target.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or(name)),
            Err(error) => failed.push(format!("{name}: {error}")),
        }
    }
    Ok(serde_json::json!({ "folder": folder.display().to_string(), "moved": moved, "failed": failed }).to_string())
}

#[tauri::command]
pub(crate) async fn agent_run_in_terminal(command: String, cwd: String) -> Result<String, String> {
    let command = command.trim();
    if command.is_empty() || command.len() > 600 || command.contains(['\n', '\r']) {
        return Err("Give one command line of up to 600 characters.".to_string());
    }
    let dir = resolve(&cwd)?;
    if !dir.is_dir() {
        return Err(format!("{} is not a folder.", dir.display()));
    }
    let terminal = Command::new("wt.exe").arg("-d").arg(&dir).args(["cmd", "/k", command]).spawn();
    if terminal.is_err() {
        Command::new("cmd")
            .args(["/c", "start", "", "/D"])
            .arg(&dir)
            .args(["cmd", "/k", command])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    Ok(format!("Started `{command}` in a terminal window at {}.", dir.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_must_stay_in_the_user_folder() {
        let home = std::env::temp_dir().join("nimbo-agent-home");
        fs::create_dir_all(home.join("projetos")).unwrap();
        assert!(resolve_in(&home, "projetos").is_ok());
        assert!(resolve_in(&home, "~/projetos/novo").is_ok());
        assert!(resolve_in(&home, r"C:\Windows\System32").is_err());
        assert!(resolve_in(&home, "..\\..\\Windows").is_err());
        assert!(resolve_in(&home, "AppData\\Roaming").is_err());
        assert!(resolve_in(&home, "").is_err());
    }

    #[test]
    fn wildcards_match_like_explorer() {
        assert!(wildcard("*.pdf", "Nota Fiscal.PDF"));
        assert!(wildcard("nota*", "nota-outubro.pdf"));
        assert!(wildcard("*", "qualquer"));
        assert!(!wildcard("*.pdf", "foto.png"));
        assert!(wildcard("img_????.jpg", "IMG_2041.jpg"));
    }

    #[test]
    fn moved_files_never_overwrite() {
        let folder = std::env::temp_dir().join("nimbo-agent-move");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("a.pdf"), b"x").unwrap();
        assert_eq!(unique_target(&folder, "a.pdf").file_name().unwrap(), "a (2).pdf");
        assert_eq!(unique_target(&folder, "b.pdf").file_name().unwrap(), "b.pdf");
    }

    #[test]
    fn finds_project_folders_by_name() {
        let home = std::env::temp_dir().join("nimbo-agent-find");
        fs::create_dir_all(home.join("Downloads").join("otimiza").join("kyvopay")).unwrap();
        fs::create_dir_all(home.join("Downloads").join("otimiza").join("node_modules").join("kyvopay")).unwrap();
        let found = find(&home, "kyvoPay");
        assert_eq!(found.len(), 1);
        assert!(found[0].ends_with("kyvopay"));
    }
}
