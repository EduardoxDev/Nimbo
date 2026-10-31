use base64::{engine::general_purpose::STANDARD, Engine};
use image::{ImageFormat, RgbaImage};
use std::{fs, io::Cursor, path::PathBuf};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
use windows::Win32::{
    Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC, SelectObject,
        BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY,
    },
    UI::{
        Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_LWIN, VK_MENU},
        WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN},
    },
};

pub(crate) const DRAW_LABEL: &str = "draw";

pub(crate) fn bgra_to_rgba(pixels: &mut [u8]) {
    for pixel in pixels.chunks_exact_mut(4) {
        pixel.swap(0, 2);
        pixel[3] = 255;
    }
}

fn grab_primary() -> Result<RgbaImage, String> {
    unsafe {
        let width = GetSystemMetrics(SM_CXSCREEN);
        let height = GetSystemMetrics(SM_CYSCREEN);
        if width <= 0 || height <= 0 {
            return Err("Não achei a tela.".to_string());
        }
        let screen = GetDC(None);
        let memory = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, width, height);
        let previous = SelectObject(memory, bitmap.into());
        let copied = BitBlt(memory, 0, 0, width, height, Some(screen), 0, 0, SRCCOPY).is_ok();
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pixels = vec![0u8; (width * height * 4) as usize];
        let lines = GetDIBits(memory, bitmap, 0, height as u32, Some(pixels.as_mut_ptr() as *mut _), &mut info, DIB_RGB_COLORS);
        SelectObject(memory, previous);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(memory);
        ReleaseDC(None, screen);
        if !copied || lines == 0 {
            return Err("Não consegui capturar a tela.".to_string());
        }
        bgra_to_rgba(&mut pixels);
        RgbaImage::from_raw(width as u32, height as u32, pixels).ok_or_else(|| "Captura inválida.".to_string())
    }
}

fn png_bytes(image: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    image.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png).map_err(|error| error.to_string())?;
    Ok(bytes)
}

pub(crate) fn captures_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?.join("captures");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub(crate) async fn capture_screen_file(app: AppHandle) -> Result<String, String> {
    let dir = captures_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let image = grab_primary()?;
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let _ = fs::remove_file(entry.path());
            }
        }
        let path = dir.join(format!("tela-{}.png", chrono::Local::now().format("%Y%m%d-%H%M%S")));
        fs::write(&path, png_bytes(&image)?).map_err(|error| error.to_string())?;
        Ok(path.to_string_lossy().to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn draw_open(app: AppHandle) -> Result<(), String> {
    let image = tauri::async_runtime::spawn_blocking(grab_primary).await.map_err(|error| error.to_string())??;
    let encoded = STANDARD.encode(png_bytes(&image)?);
    if let Ok(mut slot) = DRAW_BACKGROUND.lock() {
        *slot = Some(encoded);
    }
    if let Some(window) = app.get_webview_window(DRAW_LABEL) {
        let _ = window.destroy();
    }
    let window = WebviewWindowBuilder::new(&app, DRAW_LABEL, WebviewUrl::App("index.html?window=draw".into()))
        .title("Nimbo")
        .decorations(false)
        .transparent(false)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())?;
    if let Some(monitor) = window.primary_monitor().map_err(|error| error.to_string())? {
        window.set_position(PhysicalPosition::new(monitor.position().x, monitor.position().y)).map_err(|error| error.to_string())?;
        window.set_size(PhysicalSize::new(monitor.size().width, monitor.size().height)).map_err(|error| error.to_string())?;
    }
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

static DRAW_BACKGROUND: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

#[tauri::command]
pub(crate) fn draw_background() -> Result<String, String> {
    DRAW_BACKGROUND.lock().map_err(|error| error.to_string())?.clone().ok_or_else(|| "Sem captura.".to_string())
}

#[tauri::command]
pub(crate) async fn draw_finish(app: AppHandle, png: Option<String>) -> Result<(), String> {
    if let Ok(mut slot) = DRAW_BACKGROUND.lock() {
        *slot = None;
    }
    if let Some(data) = png {
        let bytes = STANDARD.decode(data.trim_start_matches("data:image/png;base64,")).map_err(|error| error.to_string())?;
        let image = image::load_from_memory_with_format(&bytes, ImageFormat::Png).map_err(|error| error.to_string())?.to_rgba8();
        crate::clipboard_history::write_clipboard_image_public(&image)?;
    }
    if let Some(window) = app.get_webview_window(DRAW_LABEL) {
        window.destroy().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn key(code: VIRTUAL_KEY, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: code, dwFlags: if up { KEYEVENTF_KEYUP } else { Default::default() }, ..Default::default() } },
    }
}

#[tauri::command]
pub(crate) fn record_last_clip() -> Result<(), String> {
    let g = VIRTUAL_KEY(b'G' as u16);
    let inputs = [key(VK_LWIN, false), key(VK_MENU, false), key(g, false), key(g, true), key(VK_MENU, true), key(VK_LWIN, true)];
    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent as usize == inputs.len() {
        Ok(())
    } else {
        Err("O Windows não aceitou o atalho do Game Bar.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screen_pixels_become_opaque_rgba() {
        let mut pixels = vec![10, 20, 30, 0, 1, 2, 3, 0];
        bgra_to_rgba(&mut pixels);
        assert_eq!(pixels, vec![30, 20, 10, 255, 3, 2, 1, 255]);
    }
}
