use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use windows::{
    core::BOOL,
    Win32::{
        Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT},
        Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS},
        System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION},
        UI::WindowsAndMessaging::{
            EnumWindows, GetClassNameW, GetCursorPos, GetForegroundWindow, GetWindowLongPtrW, GetWindowTextLengthW,
            GetWindowThreadProcessId, IsIconic, IsWindowVisible, IsZoomed, SetWindowLongPtrW, SystemParametersInfoW,
            GWL_EXSTYLE, SPI_GETWORKAREA, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        },
    },
};

pub(crate) const BUDDY_LABEL: &str = "buddy";
const POLL: Duration = Duration::from_millis(33);
const FULLSCREEN_CHECK: Duration = Duration::from_millis(800);
const MIN_WIDTH: i32 = 160;
const MIN_HEIGHT: i32 = 80;
const SHELL_CLASSES: [&str; 5] = ["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow"];

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Rect {
    pub(crate) left: i32,
    pub(crate) top: i32,
    pub(crate) right: i32,
    pub(crate) bottom: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub(crate) struct Platform {
    pub(crate) left: i32,
    pub(crate) right: i32,
    pub(crate) top: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Scene {
    width: i32,
    height: i32,
    floor: i32,
    platforms: Vec<Platform>,
    app: String,
}

#[derive(Debug, Clone, Copy, Default)]
struct Hitbox {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    capture: bool,
}

static RUNNING: AtomicBool = AtomicBool::new(false);
static HIDDEN_FOR_FULLSCREEN: AtomicBool = AtomicBool::new(false);
static HITBOX: Mutex<Hitbox> = Mutex::new(Hitbox { x: 0.0, y: 0.0, width: 0.0, height: 0.0, capture: false });
static LAST_APP: Mutex<String> = Mutex::new(String::new());

pub(crate) fn visible_platforms(windows: &[Rect], bounds: Rect) -> Vec<Platform> {
    let mut platforms = Vec::new();
    for (index, window) in windows.iter().enumerate() {
        if window.top <= bounds.top + 4 || window.top >= bounds.bottom {
            continue;
        }
        let mut segments = vec![(window.left.max(bounds.left), window.right.min(bounds.right))];
        for above in &windows[..index] {
            if above.top > window.top || above.bottom < window.top {
                continue;
            }
            segments = segments
                .into_iter()
                .flat_map(|(start, end)| {
                    let mut parts = Vec::new();
                    if above.left > start {
                        parts.push((start, end.min(above.left)));
                    }
                    if above.right < end {
                        parts.push((start.max(above.right), end));
                    }
                    parts
                })
                .filter(|(start, end)| end - start > 0)
                .collect();
        }
        platforms.extend(
            segments
                .into_iter()
                .filter(|(start, end)| end - start >= 40)
                .map(|(left, right)| Platform { left: left - bounds.left, right: right - bounds.left, top: window.top - bounds.top }),
        );
    }
    platforms
}

fn class_name(window: HWND) -> String {
    let mut buffer = [0u16; 128];
    let length = unsafe { GetClassNameW(window, &mut buffer) };
    String::from_utf16_lossy(&buffer[..length.max(0) as usize])
}

fn process_of(window: HWND) -> u32 {
    let mut process_id = 0u32;
    unsafe { GetWindowThreadProcessId(window, Some(&mut process_id)) };
    process_id
}

fn is_cloaked(window: HWND) -> bool {
    let mut cloaked = 0u32;
    unsafe {
        DwmGetWindowAttribute(window, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut _, std::mem::size_of::<u32>() as u32).is_ok()
            && cloaked != 0
    }
}

fn frame_of(window: HWND) -> Option<Rect> {
    let mut rect = RECT::default();
    unsafe {
        DwmGetWindowAttribute(window, DWMWA_EXTENDED_FRAME_BOUNDS, &mut rect as *mut RECT as *mut _, std::mem::size_of::<RECT>() as u32).ok()?;
    }
    Some(Rect { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })
}

unsafe extern "system" fn collect(window: HWND, data: LPARAM) -> BOOL {
    let list = unsafe { &mut *(data.0 as *mut Vec<Rect>) };
    let usable = unsafe { IsWindowVisible(window).as_bool() && !IsIconic(window).as_bool() && !IsZoomed(window).as_bool() }
        && unsafe { GetWindowTextLengthW(window) } > 0
        && process_of(window) != std::process::id()
        && !is_cloaked(window)
        && !SHELL_CLASSES.contains(&class_name(window).as_str());
    if usable {
        if let Some(rect) = frame_of(window) {
            if rect.right - rect.left >= MIN_WIDTH && rect.bottom - rect.top >= MIN_HEIGHT {
                list.push(rect);
            }
        }
    }
    BOOL(1)
}

fn top_windows() -> Vec<Rect> {
    let mut list: Vec<Rect> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut list as *mut Vec<Rect> as isize));
    }
    list.truncate(40);
    list
}

fn work_area() -> Option<Rect> {
    let mut rect = RECT::default();
    unsafe {
        SystemParametersInfoW(SPI_GETWORKAREA, 0, Some(&mut rect as *mut RECT as *mut _), SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0)).ok()?;
    }
    Some(Rect { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })
}

fn foreground_app() -> String {
    unsafe {
        let window = GetForegroundWindow();
        let process_id = process_of(window);
        if window.is_invalid() || process_id == std::process::id() {
            return LAST_APP.lock().map(|app| app.clone()).unwrap_or_default();
        }
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) else { return String::new() };
        let mut buffer = [0u16; 512];
        let mut length = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_FORMAT(0), windows::core::PWSTR(buffer.as_mut_ptr()), &mut length).is_ok();
        let _ = CloseHandle(process);
        if !ok {
            return String::new();
        }
        let path = String::from_utf16_lossy(&buffer[..length as usize]);
        let name = path.rsplit('\\').next().unwrap_or("").to_lowercase();
        if let Ok(mut last) = LAST_APP.lock() {
            *last = name.clone();
        }
        name
    }
}

fn bounds_of(window: &WebviewWindow) -> Option<Rect> {
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    Some(Rect { left: position.x, top: position.y, right: position.x + size.width as i32, bottom: position.y + size.height as i32 })
}

fn make_passive(window: &WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize);
        }
    }
}

fn watch(app: AppHandle) {
    let mut ignoring = true;
    let mut last_cursor = (i32::MIN, i32::MIN);
    let mut last_check = Instant::now() - FULLSCREEN_CHECK;
    while RUNNING.load(Ordering::SeqCst) {
        let Some(window) = app.get_webview_window(BUDDY_LABEL) else { break };
        if last_check.elapsed() >= FULLSCREEN_CHECK {
            last_check = Instant::now();
            let covered = crate::fullscreen::screen_is_covered(&window);
            if covered && !HIDDEN_FOR_FULLSCREEN.load(Ordering::SeqCst) {
                if window.hide().is_ok() {
                    HIDDEN_FOR_FULLSCREEN.store(true, Ordering::SeqCst);
                }
            } else if !covered && HIDDEN_FOR_FULLSCREEN.swap(false, Ordering::SeqCst) {
                let _ = window.show();
            }
        }
        let mut point = POINT::default();
        if unsafe { GetCursorPos(&mut point) }.is_ok() {
            if let Some(bounds) = bounds_of(&window) {
                let (x, y) = (point.x - bounds.left, point.y - bounds.top);
                let hitbox = HITBOX.lock().map(|hitbox| *hitbox).unwrap_or_default();
                let inside = hitbox.capture
                    || (x as f64 >= hitbox.x && x as f64 <= hitbox.x + hitbox.width && y as f64 >= hitbox.y && y as f64 <= hitbox.y + hitbox.height);
                if inside == ignoring {
                    ignoring = !inside;
                    let _ = window.set_ignore_cursor_events(ignoring);
                }
                if (x, y) != last_cursor {
                    last_cursor = (x, y);
                    let _ = window.emit_to(BUDDY_LABEL, "buddy-cursor", (x, y));
                }
            }
        }
        thread::sleep(POLL);
    }
    RUNNING.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub(crate) async fn buddy_show(app: AppHandle) -> Result<(), String> {
    let window = match app.get_webview_window(BUDDY_LABEL) {
        Some(window) => window,
        None => {
            let window = WebviewWindowBuilder::new(&app, BUDDY_LABEL, WebviewUrl::App("index.html?window=buddy".into()))
                .title("Nimbo")
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
            if let Some(monitor) = window.primary_monitor().map_err(|error| error.to_string())? {
                window.set_position(PhysicalPosition::new(monitor.position().x, monitor.position().y)).map_err(|error| error.to_string())?;
                window.set_size(PhysicalSize::new(monitor.size().width, monitor.size().height)).map_err(|error| error.to_string())?;
            }
            make_passive(&window);
            window
        }
    };
    window.set_ignore_cursor_events(true).map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    if !RUNNING.swap(true, Ordering::SeqCst) {
        thread::spawn(move || watch(app));
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn buddy_hide(app: AppHandle) -> Result<(), String> {
    RUNNING.store(false, Ordering::SeqCst);
    HIDDEN_FOR_FULLSCREEN.store(false, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window(BUDDY_LABEL) {
        window.destroy().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn buddy_set_hitbox(x: f64, y: f64, width: f64, height: f64, capture: bool) {
    if let Ok(mut hitbox) = HITBOX.lock() {
        *hitbox = Hitbox { x, y, width, height, capture };
    }
}

#[tauri::command]
pub(crate) fn buddy_scene(app: AppHandle) -> Result<Scene, String> {
    let window = app.get_webview_window(BUDDY_LABEL).ok_or("O Nimbo livre está desligado.")?;
    let bounds = bounds_of(&window).ok_or("Sem tamanho de tela.")?;
    let floor = work_area().map(|area| area.bottom.min(bounds.bottom) - bounds.top).unwrap_or(bounds.bottom - bounds.top);
    Ok(Scene {
        width: bounds.right - bounds.left,
        height: bounds.bottom - bounds.top,
        floor,
        platforms: visible_platforms(&top_windows(), bounds).into_iter().filter(|platform| platform.top < floor - 40).collect(),
        app: foreground_app(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(left: i32, top: i32, right: i32, bottom: i32) -> Rect {
        Rect { left, top, right, bottom }
    }

    #[test]
    fn covered_parts_of_a_window_top_are_not_floor() {
        let screen = rect(0, 0, 1920, 1080);
        let platforms = visible_platforms(&[rect(100, 100, 600, 500), rect(400, 300, 1200, 900)], screen);
        assert_eq!(platforms, vec![Platform { left: 100, right: 600, top: 100 }, Platform { left: 600, right: 1200, top: 300 }]);
    }

    #[test]
    fn windows_at_the_screen_top_or_hidden_tops_are_skipped() {
        let screen = rect(0, 0, 1920, 1080);
        assert!(visible_platforms(&[rect(0, 0, 900, 700)], screen).is_empty());
        let fully_covered = visible_platforms(&[rect(0, 50, 1000, 800), rect(200, 300, 700, 600)], screen);
        assert_eq!(fully_covered, vec![Platform { left: 0, right: 1000, top: 50 }]);
    }

    #[test]
    fn platforms_are_relative_to_the_screen() {
        let screen = rect(1920, 0, 3840, 1080);
        assert_eq!(visible_platforms(&[rect(2000, 200, 2400, 600)], screen), vec![Platform { left: 80, right: 480, top: 200 }]);
    }
}
