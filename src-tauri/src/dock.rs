use base64::{engine::general_purpose::STANDARD, Engine};
use image::{ImageFormat, RgbaImage};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::Cursor,
    path::Path,
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use windows::{
    core::{BOOL, HSTRING},
    Win32::{
        Foundation::{CloseHandle, HWND, LPARAM, WPARAM},
        Graphics::{
            Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED},
            Gdi::{CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS},
        },
        System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION},
        UI::{
            Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_MENU},
            Shell::{SHAppBarMessage, ABM_GETSTATE, ABM_SETSTATE, ABS_AUTOHIDE, APPBARDATA},
            WindowsAndMessaging::{
                DestroyIcon, DrawIconEx, EnumWindows, FindWindowW, GetForegroundWindow, GetWindow, GetWindowLongPtrW, GetWindowTextLengthW, GetWindowTextW,
                GetWindowThreadProcessId, IsIconic, IsWindowVisible, PostMessageW, PrivateExtractIconsW, SetForegroundWindow, ShowWindow, DI_NORMAL, GWL_EXSTYLE,
                GW_OWNER, HICON, SW_MINIMIZE, SW_RESTORE, WM_CLOSE, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
            },
        },
    },
};

pub(crate) const DOCK_LABEL: &str = "dock";
const ICON_SIZE: i32 = 64;
const SKIP_EXES: [&str; 6] = ["textinputhost.exe", "shellexperiencehost.exe", "searchhost.exe", "startmenuexperiencehost.exe", "lockapp.exe", "dock_64.exe"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DockWindowInfo {
    id: i64,
    title: String,
    minimized: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DockApp {
    path: String,
    name: String,
    windows: Vec<DockWindowInfo>,
    active: bool,
}

static ICONS: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
static TASKBAR_WAS_AUTOHIDE: Mutex<Option<bool>> = Mutex::new(None);

pub(crate) fn pretty_name(path: &str) -> String {
    let stem = Path::new(path).file_stem().map(|stem| stem.to_string_lossy().to_string()).unwrap_or_default();
    let known = match stem.to_lowercase().as_str() {
        "msedge" => "Edge",
        "chrome" => "Chrome",
        "code" => "VS Code",
        "explorer" => "Explorador",
        "windowsterminal" => "Terminal",
        "spotify" => "Spotify",
        "discord" | "discordcanary" => "Discord",
        "winword" => "Word",
        "excel" => "Excel",
        "powerpnt" => "PowerPoint",
        "notepad" => "Bloco de notas",
        "claude" => "Claude",
        "nimbo" => "Nimbo",
        _ => "",
    };
    if !known.is_empty() {
        return known.to_string();
    }
    let mut chars = stem.chars();
    chars.next().map(|first| first.to_uppercase().collect::<String>() + chars.as_str()).unwrap_or(stem)
}

fn process_path(window: HWND) -> Option<String> {
    let mut process_id = 0u32;
    unsafe { GetWindowThreadProcessId(window, Some(&mut process_id)) };
    if process_id == std::process::id() {
        return None;
    }
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id).ok()?;
        let mut buffer = [0u16; 512];
        let mut length = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_FORMAT(0), windows::core::PWSTR(buffer.as_mut_ptr()), &mut length).is_ok();
        let _ = CloseHandle(process);
        ok.then(|| String::from_utf16_lossy(&buffer[..length as usize]))
    }
}

fn title_of(window: HWND) -> String {
    let mut buffer = [0u16; 256];
    let length = unsafe { GetWindowTextW(window, &mut buffer) };
    String::from_utf16_lossy(&buffer[..length.max(0) as usize])
}

fn is_cloaked(window: HWND) -> bool {
    let mut cloaked = 0u32;
    unsafe { DwmGetWindowAttribute(window, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut _, 4).is_ok() && cloaked != 0 }
}

fn is_app_window(window: HWND) -> bool {
    unsafe {
        if !IsWindowVisible(window).as_bool() || GetWindowTextLengthW(window) == 0 || is_cloaked(window) {
            return false;
        }
        let style = GetWindowLongPtrW(window, GWL_EXSTYLE) as u32;
        let owned = GetWindow(window, GW_OWNER).is_ok_and(|owner| !owner.is_invalid());
        let tool = style & WS_EX_TOOLWINDOW.0 != 0;
        let forced = style & WS_EX_APPWINDOW.0 != 0;
        forced || (!tool && !owned)
    }
}

unsafe extern "system" fn collect(window: HWND, data: LPARAM) -> BOOL {
    let list = unsafe { &mut *(data.0 as *mut Vec<HWND>) };
    if is_app_window(window) {
        list.push(window);
    }
    BOOL(1)
}

pub(crate) fn group_windows(entries: Vec<(String, DockWindowInfo)>, foreground: i64) -> Vec<DockApp> {
    let mut apps: Vec<DockApp> = Vec::new();
    for (path, window) in entries {
        let key = path.to_lowercase();
        let active = window.id == foreground;
        match apps.iter_mut().find(|app| app.path.to_lowercase() == key) {
            Some(app) => {
                app.active |= active;
                app.windows.push(window);
            }
            None => apps.push(DockApp { name: pretty_name(&path), path, windows: vec![window], active }),
        }
    }
    apps
}

#[tauri::command]
pub(crate) fn dock_apps() -> Vec<DockApp> {
    let mut handles: Vec<HWND> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut handles as *mut Vec<HWND> as isize));
    }
    let foreground = unsafe { GetForegroundWindow() }.0 as i64;
    let entries = handles
        .into_iter()
        .filter_map(|window| {
            let path = process_path(window)?;
            let exe = Path::new(&path).file_name()?.to_string_lossy().to_lowercase();
            if SKIP_EXES.contains(&exe.as_str()) {
                return None;
            }
            Some((path, DockWindowInfo { id: window.0 as i64, title: title_of(window), minimized: unsafe { IsIconic(window).as_bool() } }))
        })
        .collect();
    group_windows(entries, foreground)
}

fn icon_png(path: &str) -> Option<String> {
    unsafe {
        let mut icon = [HICON::default()];
        let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let mut name = [0u16; 260];
        name[..wide.len().min(260)].copy_from_slice(&wide[..wide.len().min(260)]);
        let found = PrivateExtractIconsW(&name, 0, ICON_SIZE, ICON_SIZE, Some(&mut icon), None, 0);
        if found == 0 || icon[0].is_invalid() {
            return None;
        }
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: ICON_SIZE,
                biHeight: -ICON_SIZE,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let memory = CreateCompatibleDC(None);
        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let bitmap = CreateDIBSection(Some(memory), &info, DIB_RGB_COLORS, &mut bits, None, 0).ok()?;
        let previous = SelectObject(memory, bitmap.into());
        let drawn = DrawIconEx(memory, 0, 0, icon[0], ICON_SIZE, ICON_SIZE, 0, None, DI_NORMAL).is_ok();
        let length = (ICON_SIZE * ICON_SIZE * 4) as usize;
        let mut pixels = std::slice::from_raw_parts(bits as *const u8, length).to_vec();
        SelectObject(memory, previous);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(memory);
        let _ = DestroyIcon(icon[0]);
        if !drawn {
            return None;
        }
        let has_alpha = pixels.chunks_exact(4).any(|pixel| pixel[3] != 0);
        for pixel in pixels.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            if !has_alpha {
                pixel[3] = 255;
            }
        }
        let image = RgbaImage::from_raw(ICON_SIZE as u32, ICON_SIZE as u32, pixels)?;
        let mut bytes = Vec::new();
        image.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png).ok()?;
        Some(STANDARD.encode(bytes))
    }
}

#[tauri::command]
pub(crate) async fn dock_icon(path: String) -> Option<String> {
    let cache = ICONS.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(cached) = cache.lock().ok().and_then(|icons| icons.get(&path).cloned()) {
        return cached;
    }
    let key = path.clone();
    let icon = tauri::async_runtime::spawn_blocking(move || icon_png(&key)).await.ok().flatten();
    if let Ok(mut icons) = cache.lock() {
        icons.insert(path, icon.clone());
    }
    icon
}

fn press_alt() {
    let inputs = [
        INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_MENU, ..Default::default() } } },
        INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_MENU, dwFlags: KEYEVENTF_KEYUP, ..Default::default() } } },
    ];
    unsafe {
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

fn window_of(id: i64) -> HWND {
    HWND(id as *mut _)
}

#[tauri::command]
pub(crate) fn dock_focus(id: i64) -> Result<(), String> {
    let window = window_of(id);
    unsafe {
        if GetForegroundWindow() == window && !IsIconic(window).as_bool() {
            let _ = ShowWindow(window, SW_MINIMIZE);
            return Ok(());
        }
        if IsIconic(window).as_bool() {
            let _ = ShowWindow(window, SW_RESTORE);
        }
        press_alt();
        SetForegroundWindow(window).ok().map_err(|_| "O Windows não deixou trazer a janela para frente.".to_string())
    }
}

#[tauri::command]
pub(crate) fn dock_close(id: i64) -> Result<(), String> {
    unsafe { PostMessageW(Some(window_of(id)), WM_CLOSE, WPARAM(0), LPARAM(0)) }.map_err(|error| error.to_string())
}

fn taskbar_state(set: Option<bool>) -> Option<bool> {
    unsafe {
        let taskbar = FindWindowW(&HSTRING::from("Shell_TrayWnd"), None).ok()?;
        let mut data = APPBARDATA { cbSize: std::mem::size_of::<APPBARDATA>() as u32, hWnd: taskbar, ..Default::default() };
        let state = SHAppBarMessage(ABM_GETSTATE, &mut data) as u32;
        let autohide = state & ABS_AUTOHIDE != 0;
        if let Some(enabled) = set {
            data.lParam = LPARAM(if enabled { ABS_AUTOHIDE as isize } else { 0 });
            SHAppBarMessage(ABM_SETSTATE, &mut data);
        }
        Some(autohide)
    }
}

#[tauri::command]
pub(crate) fn dock_hide_taskbar(enabled: bool) -> Result<(), String> {
    let mut saved = TASKBAR_WAS_AUTOHIDE.lock().map_err(|error| error.to_string())?;
    if enabled {
        if saved.is_none() {
            *saved = taskbar_state(None);
        }
        taskbar_state(Some(true)).ok_or("Não achei a barra de tarefas do Windows.")?;
    } else if let Some(previous) = saved.take() {
        taskbar_state(Some(previous));
    }
    Ok(())
}

fn place(window: &WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    let monitor = window.primary_monitor().map_err(|error| error.to_string())?.ok_or("Sem monitor.")?;
    let scale = monitor.scale_factor();
    let (physical_width, physical_height) = ((width * scale).round() as i32, (height * scale).round() as i32);
    let x = monitor.position().x + (monitor.size().width as i32 - physical_width) / 2;
    let y = monitor.position().y + monitor.size().height as i32 - physical_height;
    window.set_size(tauri::PhysicalSize::new(physical_width as u32, physical_height as u32)).map_err(|error| error.to_string())?;
    window.set_position(tauri::PhysicalPosition::new(x, y)).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn dock_show(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let _ = &BAR_HEIGHT;
    let window = match app.get_webview_window(DOCK_LABEL) {
        Some(window) => window,
        None => {
            let window = WebviewWindowBuilder::new(&app, DOCK_LABEL, WebviewUrl::App("index.html?window=dock".into()))
                .title("Nimbo Dock")
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .resizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .focused(false)
                .visible(false)
                .build()
                .map_err(|error| error.to_string())?;
            crate::buddy::make_window_passive(&window);
            window
        }
    };
    place(&window, width, height)?;
    window.show().map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn dock_resize(app: AppHandle, width: f64, height: f64, bar: f64) -> Result<(), String> {
    if let Ok(mut slot) = BAR_HEIGHT.lock() {
        *slot = bar.clamp(40.0, 120.0);
    }
    let window = app.get_webview_window(DOCK_LABEL).ok_or("O Nimbo Dock está desligado.")?;
    place(&window, width, height)
}

#[tauri::command]
pub(crate) async fn dock_hide(app: AppHandle) -> Result<(), String> {
    let _ = dock_hide_taskbar(false);
    if let Some(window) = app.get_webview_window(DOCK_LABEL) {
        window.destroy().map_err(|error| error.to_string())?;
    }
    Ok(())
}

static BAR_HEIGHT: Mutex<f64> = Mutex::new(70.0);

pub(crate) fn bar_top(app: &AppHandle) -> Option<i32> {
    let window = app.get_webview_window(DOCK_LABEL)?;
    if !window.is_visible().unwrap_or(false) {
        return None;
    }
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    let scale = window.scale_factor().unwrap_or(1.0);
    let bar = BAR_HEIGHT.lock().map(|bar| *bar).unwrap_or(70.0);
    Some(position.y + size.height as i32 - ((bar + 6.0) * scale).round() as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window(id: i64) -> DockWindowInfo {
        DockWindowInfo { id, title: format!("janela {id}"), minimized: false }
    }

    #[test]
    fn windows_of_the_same_program_share_one_icon() {
        let apps = group_windows(
            vec![
                (r"C:\Apps\Code.exe".into(), window(1)),
                (r"C:\Apps\chrome.exe".into(), window(2)),
                (r"c:\apps\code.exe".into(), window(3)),
            ],
            3,
        );
        assert_eq!(apps.len(), 2);
        assert_eq!(apps[0].name, "VS Code");
        assert_eq!(apps[0].windows.len(), 2);
        assert!(apps[0].active);
        assert!(!apps[1].active);
    }

    #[test]
    fn names_are_friendly() {
        assert_eq!(pretty_name(r"C:\x\msedge.exe"), "Edge");
        assert_eq!(pretty_name(r"C:\x\figma.exe"), "Figma");
    }
}
