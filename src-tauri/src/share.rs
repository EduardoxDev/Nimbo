//! Images the Nimbo makes for sharing (the monthly retrospective card), saved
//! in Pictures\Nimbo and shown in Explorer.

use std::{fs, path::PathBuf};

const MAX_IMAGE: usize = 15 * 1024 * 1024;

fn pictures_dir() -> Option<PathBuf> {
    let dir = PathBuf::from(std::env::var_os("USERPROFILE")?).join("Pictures").join("Nimbo");
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn safe_stem(name: &str) -> String {
    let stem: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_')).take(60).collect();
    if stem.is_empty() { "nimbo".to_string() } else { stem }
}

#[tauri::command]
pub(crate) fn share_save_png(name: String, bytes: Vec<u8>) -> Result<String, String> {
    if bytes.len() > MAX_IMAGE || !bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Err("Imagem inválida.".to_string());
    }
    let dir = pictures_dir().ok_or("Não achei a pasta Imagens.")?;
    let path = crate::downloads::free_path(&dir, &format!("{}.png", safe_stem(&name)));
    fs::write(&path, bytes).map_err(|error| error.to_string())?;
    let _ = std::process::Command::new("explorer.exe").arg(format!("/select,{}", path.display())).spawn();
    Ok(path.to_string_lossy().to_string())
}
