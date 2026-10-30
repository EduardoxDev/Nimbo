//! The shelf: files and folders dropped on the island, kept as references to
//! the originals (like a desktop "drop zone"), so they can be dragged back out
//! into any app later.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const SHELF_FILE: &str = "shelf.json";
const DRAG_ICON_FILE: &str = "shelf-drag-icon.png";
const MAX_ITEMS: usize = 60;
const THUMBNAIL_SIZE: u32 = 96;
/// Bigger images are listed without a thumbnail rather than decoded.
const MAX_THUMBNAIL_SOURCE_BYTES: u64 = 25 * 1024 * 1024;
const IMAGE_EXTENSIONS: [&str; 6] = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredItem {
    id: String,
    path: String,
    added_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShelfItem {
    id: String,
    path: String,
    name: String,
    /// "folder", "image", "video", "audio", "archive", "document", "code" or "file".
    kind: String,
    size: Option<u64>,
    exists: bool,
    added_at: i64,
    thumbnail: Option<String>,
}

static LOCK: Mutex<()> = Mutex::new(());

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

fn data_path(app: &AppHandle, file: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(file))
}

fn load(app: &AppHandle) -> Vec<StoredItem> {
    data_path(app, SHELF_FILE)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, items: &[StoredItem]) -> Result<(), String> {
    let raw = serde_json::to_string(items).map_err(|error| error.to_string())?;
    fs::write(data_path(app, SHELF_FILE)?, raw).map_err(|error| format!("Could not save the shelf: {error}"))
}

fn kind_of(path: &Path) -> &'static str {
    if path.is_dir() {
        return "folder";
    }
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_lowercase)
        .unwrap_or_default();
    match extension.as_str() {
        ext if IMAGE_EXTENSIONS.contains(&ext) || ext == "svg" || ext == "heic" => "image",
        "mp4" | "mov" | "mkv" | "avi" | "webm" => "video",
        "mp3" | "wav" | "flac" | "m4a" | "ogg" | "aac" => "audio",
        "zip" | "rar" | "7z" | "tar" | "gz" => "archive",
        "pdf" | "doc" | "docx" | "txt" | "md" | "xls" | "xlsx" | "ppt" | "pptx" | "csv" => "document",
        "rs" | "ts" | "tsx" | "js" | "py" | "json" | "html" | "css" | "go" | "java" | "cs" => "code",
        _ => "file",
    }
}

fn thumbnail_of(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_str()?.to_lowercase();
    if !IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        return None;
    }
    if fs::metadata(path).ok()?.len() > MAX_THUMBNAIL_SOURCE_BYTES {
        return None;
    }
    let image = image::open(path).ok()?.thumbnail(THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    let mut bytes = Vec::new();
    image.write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png).ok()?;
    Some(format!("data:image/png;base64,{}", BASE64.encode(bytes)))
}

fn describe(item: &StoredItem) -> ShelfItem {
    let path = Path::new(&item.path);
    let metadata = fs::metadata(path).ok();
    ShelfItem {
        id: item.id.clone(),
        path: item.path.clone(),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| item.path.clone()),
        kind: kind_of(path).to_string(),
        size: metadata.as_ref().filter(|meta| meta.is_file()).map(|meta| meta.len()),
        exists: metadata.is_some(),
        added_at: item.added_at,
        thumbnail: metadata.is_some().then(|| thumbnail_of(path)).flatten(),
    }
}

fn find(app: &AppHandle, id: &str) -> Result<StoredItem, String> {
    load(app)
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| "That item is no longer on the shelf.".to_string())
}

/// Newest first; new paths are added once, at the front.
fn merge(mut items: Vec<StoredItem>, paths: Vec<String>, now: i64) -> Vec<StoredItem> {
    for (offset, path) in paths.into_iter().enumerate() {
        items.retain(|item| !item.path.eq_ignore_ascii_case(&path));
        items.insert(0, StoredItem { id: format!("{now:x}-{offset}"), path, added_at: now });
    }
    items.truncate(MAX_ITEMS);
    items
}

#[tauri::command]
pub(crate) async fn shelf_list(app: AppHandle) -> Result<Vec<ShelfItem>, String> {
    tauri::async_runtime::spawn_blocking(move || load(&app).iter().map(describe).collect())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn shelf_add(app: AppHandle, paths: Vec<String>) -> Result<Vec<ShelfItem>, String> {
    let existing: Vec<String> = paths
        .into_iter()
        .filter(|path| Path::new(path).is_absolute() && Path::new(path).exists())
        .take(MAX_ITEMS)
        .collect();
    if existing.is_empty() {
        return Err("Nothing to add: drop files or folders from your computer.".to_string());
    }
    {
        let _guard = LOCK.lock().map_err(|_| "Busy, try again.".to_string())?;
        save(&app, &merge(load(&app), existing, now_millis()))?;
    }
    shelf_list(app).await
}

#[tauri::command]
pub(crate) fn shelf_remove(app: AppHandle, id: Option<String>) -> Result<(), String> {
    let _guard = LOCK.lock().map_err(|_| "Busy, try again.".to_string())?;
    let items = match id {
        Some(id) => load(&app).into_iter().filter(|item| item.id != id).collect(),
        None => Vec::new(),
    };
    save(&app, &items)
}

#[tauri::command]
pub(crate) fn shelf_open(app: AppHandle, id: String) -> Result<(), String> {
    let item = find(&app, &id)?;
    app.opener()
        .open_path(&item.path, None::<&str>)
        .map_err(|error| format!("Could not open it: {error}"))
}

#[tauri::command]
pub(crate) fn shelf_reveal(app: AppHandle, id: String) -> Result<(), String> {
    let item = find(&app, &id)?;
    app.opener()
        .reveal_item_in_dir(&item.path)
        .map_err(|error| format!("Could not show it in its folder: {error}"))
}

/// A small picture the OS shows under the cursor while dragging out.
#[tauri::command]
pub(crate) fn shelf_drag_icon(app: AppHandle) -> Result<String, String> {
    let path = data_path(&app, DRAG_ICON_FILE)?;
    let icon: &[u8] = include_bytes!("../icons/32x32.png");
    // Rewritten when the app icon changes between versions.
    if fs::read(&path).ok().as_deref() != Some(icon) {
        fs::write(&path, icon).map_err(|error| error.to_string())?;
    }
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_items_go_first_without_duplicates() {
        let items = merge(Vec::new(), vec!["C:\\a.txt".into(), "C:\\b.png".into()], 1);
        assert_eq!(items.iter().map(|item| item.path.as_str()).collect::<Vec<_>>(), ["C:\\b.png", "C:\\a.txt"]);
        let again = merge(items, vec!["c:\\A.TXT".into()], 2);
        assert_eq!(again.len(), 2);
        assert_eq!(again[0].path, "c:\\A.TXT");
        let many = merge(Vec::new(), (0..100).map(|index| format!("C:\\{index}.txt")).collect(), 3);
        assert_eq!(many.len(), MAX_ITEMS);
    }

    #[test]
    fn kinds_follow_the_extension() {
        assert_eq!(kind_of(Path::new("C:\\x\\foto.JPG")), "image");
        assert_eq!(kind_of(Path::new("C:\\x\\notas.pdf")), "document");
        assert_eq!(kind_of(Path::new("C:\\x\\app.zip")), "archive");
        assert_eq!(kind_of(Path::new("C:\\x\\algo.xyz")), "file");
    }
}
