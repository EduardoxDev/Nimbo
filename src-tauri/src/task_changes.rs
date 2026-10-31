use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const MAX_CHANGES: usize = 50;

#[derive(Debug, Clone)]
pub(crate) struct Snapshot {
    folder: PathBuf,
    base: String,
    untracked_before: HashSet<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileChange {
    path: String,
    added: u32,
    removed: u32,
    created: bool,
}

static SNAPSHOT: Mutex<Option<Snapshot>> = Mutex::new(None);
static CHANGES: Mutex<Vec<FileChange>> = Mutex::new(Vec::new());

fn git(folder: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .creation_flags(CREATE_NO_WINDOW)
        .arg("-C")
        .arg(folder)
        .args(args)
        .output()
        .ok()?;
    output.status.success().then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

fn untracked(folder: &Path) -> HashSet<String> {
    git(folder, &["ls-files", "--others", "--exclude-standard"])
        .map(|text| text.lines().map(str::to_string).collect())
        .unwrap_or_default()
}

pub(crate) fn parse_numstat(text: &str) -> Vec<FileChange> {
    text.lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\t');
            let added = parts.next()?;
            let removed = parts.next()?;
            let path = parts.next()?.trim();
            (!path.is_empty()).then(|| FileChange {
                path: path.to_string(),
                added: added.parse().unwrap_or(0),
                removed: removed.parse().unwrap_or(0),
                created: false,
            })
        })
        .collect()
}

pub(crate) fn begin(folder: &Path) {
    let inside = git(folder, &["rev-parse", "--is-inside-work-tree"]).is_some_and(|text| text.trim() == "true");
    let snapshot = inside
        .then(|| {
            let stash = git(folder, &["stash", "create"]).map(|text| text.trim().to_string()).unwrap_or_default();
            let base = if stash.is_empty() { git(folder, &["rev-parse", "HEAD"])?.trim().to_string() } else { stash };
            Some(Snapshot { folder: folder.to_path_buf(), base, untracked_before: untracked(folder) })
        })
        .flatten();
    if let Ok(mut slot) = SNAPSHOT.lock() {
        *slot = snapshot;
    }
    if let Ok(mut changes) = CHANGES.lock() {
        changes.clear();
    }
}

pub(crate) fn finish() -> Vec<FileChange> {
    let Some(snapshot) = SNAPSHOT.lock().ok().and_then(|slot| slot.clone()) else { return Vec::new() };
    let mut changes = git(&snapshot.folder, &["diff", "--numstat", "--relative", &snapshot.base])
        .map(|text| parse_numstat(&text))
        .unwrap_or_default();
    let mut created: Vec<String> = untracked(&snapshot.folder).difference(&snapshot.untracked_before).cloned().collect();
    created.sort();
    changes.extend(created.into_iter().map(|path| {
        let lines = fs::read_to_string(snapshot.folder.join(&path)).map(|text| text.lines().count() as u32).unwrap_or(0);
        FileChange { path, added: lines, removed: 0, created: true }
    }));
    changes.truncate(MAX_CHANGES);
    if let Ok(mut slot) = CHANGES.lock() {
        *slot = changes.clone();
    }
    changes
}

#[tauri::command]
pub(crate) fn claude_task_changes() -> Vec<FileChange> {
    CHANGES.lock().map(|changes| changes.clone()).unwrap_or_default()
}

#[tauri::command]
pub(crate) fn claude_task_undo() -> Result<usize, String> {
    let snapshot = SNAPSHOT.lock().map_err(|error| error.to_string())?.clone().ok_or("Não há mudanças para desfazer.")?;
    let changes = CHANGES.lock().map_err(|error| error.to_string())?.clone();
    let mut restored = 0;
    for change in &changes {
        let target = snapshot.folder.join(&change.path);
        if !target.starts_with(&snapshot.folder) {
            continue;
        }
        let ok = if change.created {
            fs::remove_file(&target).is_ok()
        } else {
            git(&snapshot.folder, &["checkout", &snapshot.base, "--", &change.path]).is_some()
        };
        if ok {
            restored += 1;
        }
    }
    if let Ok(mut slot) = CHANGES.lock() {
        slot.clear();
    }
    Ok(restored)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numstat_lines_become_changes() {
        let changes = parse_numstat("12\t4\tsrc/App.tsx\n-\t-\tlogo.png\n\n3\t0\tREADME.md\n");
        assert_eq!(changes.len(), 3);
        assert_eq!(changes[0], FileChange { path: "src/App.tsx".into(), added: 12, removed: 4, created: false });
        assert_eq!(changes[1].added, 0);
        assert_eq!(changes[2].path, "README.md");
    }
}
