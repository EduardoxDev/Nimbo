//! Print library: every screenshot Windows saves (PrtSc, Win+PrtSc and the
//! Snipping Tool's automatic save) is read once with Windows' OCR, so the
//! launcher can find "that print with the 404 error" by its words. The index
//! stays in the app's folder; the images are never copied or sent anywhere.

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager};
use windows::{
    core::HSTRING,
    Graphics::Imaging::{BitmapDecoder, BitmapPixelFormat, SoftwareBitmap},
    Storage::{FileAccessMode, StorageFile},
    Win32::UI::Shell::{FOLDERID_Screenshots, SHGetKnownFolderPath, KF_FLAG_DEFAULT},
};

const IMAGE_EXTENSIONS: [&str; 4] = ["png", "jpg", "jpeg", "bmp"];
const MAX_INDEX: usize = 2_000;
/// OCR is slow-ish: a few new prints per scan, the rest next time.
const READ_PER_SCAN: usize = 12;
const MAX_TEXT: usize = 4_000;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Entry {
    path: String,
    name: String,
    modified: u64,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrintMatch {
    path: String,
    name: String,
    modified: u64,
    snippet: String,
}

static LOCK: Mutex<()> = Mutex::new(());

fn screenshots_dir() -> Option<PathBuf> {
    unsafe {
        let path = SHGetKnownFolderPath(&FOLDERID_Screenshots, KF_FLAG_DEFAULT, None).ok()?;
        let text = path.to_string().ok();
        windows::Win32::System::Com::CoTaskMemFree(Some(path.0 as *const _));
        text.map(PathBuf::from).filter(|dir| dir.is_dir())
    }
}

fn index_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("prints-index.json"))
}

fn load(app: &AppHandle) -> Vec<Entry> {
    index_file(app).and_then(|file| fs::read_to_string(file).ok()).and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

fn save(app: &AppHandle, entries: &[Entry]) {
    if let Some(file) = index_file(app) {
        if let Some(dir) = file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let _ = fs::write(file, serde_json::to_string(entries).unwrap_or_default());
    }
}

fn read_image(path: &Path) -> Result<String, String> {
    let engine = crate::lens::ocr_engine()?;
    let read = || -> windows::core::Result<String> {
        let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.as_os_str()))?.get()?;
        let stream = file.OpenAsync(FileAccessMode::Read)?.get()?;
        let decoder = BitmapDecoder::CreateAsync(&stream)?.get()?;
        let bitmap = SoftwareBitmap::Convert(&decoder.GetSoftwareBitmapAsync()?.get()?, BitmapPixelFormat::Bgra8)?;
        let (lines, _) = crate::lens::read_bitmap(&engine, &bitmap)?;
        Ok(crate::lens::join_lines(&lines))
    };
    read().map(|text| text.chars().take(MAX_TEXT).collect()).map_err(|error| error.to_string())
}

fn images_in(dir: &Path) -> Vec<(PathBuf, u64)> {
    let mut found: Vec<(PathBuf, u64)> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| {
            entry.path().extension().and_then(|extension| extension.to_str()).is_some_and(|extension| IMAGE_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
        })
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64;
            Some((entry.path(), modified))
        })
        .collect();
    found.sort_by_key(|item| std::cmp::Reverse(item.1));
    found.truncate(MAX_INDEX);
    found
}

/// Reads the newest prints not read yet. Returns how many are in the library.
#[tauri::command]
pub(crate) async fn prints_scan(app: AppHandle) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = LOCK.lock().map_err(|error| error.to_string())?;
        let dir = screenshots_dir().ok_or("Não achei a pasta de capturas de tela do Windows.")?;
        let mut entries = load(&app);
        let on_disk = images_in(&dir);
        // Prints deleted from the folder leave the library too.
        entries.retain(|entry| on_disk.iter().any(|(path, _)| path.to_string_lossy() == entry.path));
        let mut read = 0;
        for (path, modified) in on_disk {
            let key = path.to_string_lossy().to_string();
            if entries.iter().any(|entry| entry.path == key && entry.modified == modified) {
                continue;
            }
            if read >= READ_PER_SCAN {
                break;
            }
            read += 1;
            let text = read_image(&path).unwrap_or_default();
            entries.retain(|entry| entry.path != key);
            let name = path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
            entries.push(Entry { path: key, name, modified, text });
        }
        entries.sort_by_key(|entry| std::cmp::Reverse(entry.modified));
        save(&app, &entries);
        Ok(entries.len())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// The words around the first match, so the launcher can show why it matched.
pub(crate) fn snippet_of(text: &str, terms: &[String]) -> String {
    let folded = crate::pc::fold(text);
    let at = terms.iter().filter_map(|term| folded.find(term.as_str())).min().unwrap_or(0);
    let chars: Vec<char> = text.chars().collect();
    let start = folded[..at].chars().count().saturating_sub(25);
    let piece: String = chars.iter().skip(start).take(80).collect();
    piece.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Prints whose text (or name) has every word of the query, newest first.
#[tauri::command]
pub(crate) fn prints_search(app: AppHandle, query: String) -> Vec<PrintMatch> {
    let terms: Vec<String> = crate::pc::fold(&query).split_whitespace().filter(|term| term.chars().count() >= 2).map(str::to_string).collect();
    if terms.is_empty() {
        return Vec::new();
    }
    load(&app)
        .into_iter()
        .filter(|entry| {
            let haystack = crate::pc::fold(&format!("{} {}", entry.name, entry.text));
            terms.iter().all(|term| haystack.contains(term.as_str()))
        })
        .take(5)
        .map(|entry| PrintMatch { snippet: snippet_of(&entry.text, &terms), path: entry.path, name: entry.name, modified: entry.modified })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_snippet_shows_the_words_around_the_match() {
        let text = "Painel de controle\nErro 404: página não encontrada\nVoltar ao início";
        let snippet = snippet_of(text, &["404".to_string()]);
        assert!(snippet.contains("Erro 404"), "{snippet}");
        assert!(snippet.chars().count() <= 80);
    }
}

#[cfg(test)]
mod real {
    /// Reads the newest real screenshot: `cargo test prints::real -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn reads_the_newest_screenshot() {
        let dir = super::screenshots_dir().expect("screenshots folder");
        let newest = super::images_in(&dir).into_iter().next().expect("a screenshot");
        let text = super::read_image(&newest.0).expect("ocr");
        println!("{} → {} caracteres: {:?}", newest.0.display(), text.chars().count(), text.chars().take(80).collect::<String>());
    }
}
