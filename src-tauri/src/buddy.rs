use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use windows::{
    core::BOOL,
    Win32::{
        Foundation::{CloseHandle, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
        Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS},
        UI::Shell::{DefSubclassProc, SetWindowSubclass},
        System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION},
        UI::WindowsAndMessaging::{
            EnumWindows, FindWindowW, GetClassNameW, GetCursorPos, GetForegroundWindow, GetWindowLongPtrW, GetWindowTextLengthW,
            GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, IsZoomed, SetForegroundWindow, SetWindowLongPtrW, SetWindowPos,
            SystemParametersInfoW, MA_NOACTIVATE, WM_MOUSEACTIVATE,
            GWL_EXSTYLE, HWND_TOPMOST, SPI_GETWORKAREA, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS, WS_EX_NOACTIVATE,
            WS_EX_TOOLWINDOW,
        },
    },
};

pub(crate) const BUDDY_LABEL: &str = "buddy";
const POLL: Duration = Duration::from_millis(50);
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
    has_left: bool,
    has_right: bool,
    dock: bool,
}

const DOCK_CLASSES: [&str; 3] = ["MyDockAPP", "RocketDock", "ObjectDock"];

fn dock_running() -> bool {
    DOCK_CLASSES.iter().any(|class| unsafe {
        FindWindowW(&windows::core::HSTRING::from(*class), None).is_ok_and(|window| !window.is_invalid() && IsWindowVisible(window).as_bool())
    })
}

#[derive(Debug, Clone, Serialize, Default)]
pub(crate) struct ForegroundWindow {
    pub(crate) app: String,
    pub(crate) path: String,
    pub(crate) title: String,
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
static FOLLOW_CURSOR: AtomicBool = AtomicBool::new(false);
const CURSOR_EVERY: Duration = Duration::from_millis(250);
static HIDDEN_FOR_FULLSCREEN: AtomicBool = AtomicBool::new(false);
static HITBOX: Mutex<Hitbox> = Mutex::new(Hitbox { x: 0.0, y: 0.0, width: 0.0, height: 0.0, capture: false });
static LAST_APP: Mutex<String> = Mutex::new(String::new());
static MONITOR: Mutex<Option<Rect>> = Mutex::new(None);

fn monitor_rect() -> Option<Rect> {
    MONITOR.lock().ok().and_then(|monitor| *monitor)
}

fn set_monitor(rect: Rect) {
    if let Ok(mut monitor) = MONITOR.lock() {
        *monitor = Some(rect);
    }
}

fn place(window: &WebviewWindow, rect: Rect) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    unsafe {
        SetWindowPos(hwnd, Some(HWND_TOPMOST), rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top, SWP_NOACTIVATE)
            .map_err(|error| error.to_string())
    }
}

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

unsafe extern "system" fn collect_open(window: HWND, data: LPARAM) -> BOOL {
    let list = unsafe { &mut *(data.0 as *mut Vec<ForegroundWindow>) };
    let usable = unsafe { IsWindowVisible(window).as_bool() && GetWindowTextLengthW(window) > 0 }
        && unsafe { GetWindowLongPtrW(window, GWL_EXSTYLE) } as u32 & WS_EX_TOOLWINDOW.0 == 0
        && process_of(window) != std::process::id()
        && !is_cloaked(window)
        && !SHELL_CLASSES.contains(&class_name(window).as_str());
    if usable {
        if let Some(path) = process_path(process_of(window)) {
            let app = path.rsplit('\\').next().unwrap_or("").to_lowercase();
            list.push(ForegroundWindow { app, path, title: window_title(window) });
        }
    }
    BOOL(1)
}

/// Every window on the taskbar, front to back (minimised ones too).
pub(crate) fn open_windows() -> Vec<ForegroundWindow> {
    let mut list: Vec<ForegroundWindow> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect_open), LPARAM(&mut list as *mut Vec<ForegroundWindow> as isize));
    }
    list.truncate(60);
    list
}

fn work_area() -> Option<Rect> {
    let mut rect = RECT::default();
    unsafe {
        SystemParametersInfoW(SPI_GETWORKAREA, 0, Some(&mut rect as *mut RECT as *mut _), SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0)).ok()?;
    }
    Some(Rect { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })
}

fn process_path(process_id: u32) -> Option<String> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id).ok()?;
        let mut buffer = [0u16; 512];
        let mut length = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_FORMAT(0), windows::core::PWSTR(buffer.as_mut_ptr()), &mut length).is_ok();
        let _ = CloseHandle(process);
        ok.then(|| String::from_utf16_lossy(&buffer[..length as usize]))
    }
}

fn window_title(window: HWND) -> String {
    let mut buffer = [0u16; 256];
    let length = unsafe { GetWindowTextW(window, &mut buffer) };
    String::from_utf16_lossy(&buffer[..length.max(0) as usize])
}

pub(crate) fn foreground() -> Option<ForegroundWindow> {
    let window = unsafe { GetForegroundWindow() };
    let process_id = process_of(window);
    if window.is_invalid() || process_id == std::process::id() {
        return None;
    }
    let path = process_path(process_id)?;
    let app = path.rsplit('\\').next().unwrap_or("").to_lowercase();
    Some(ForegroundWindow { app, path, title: window_title(window) })
}

fn foreground_app() -> String {
    match foreground() {
        Some(window) => {
            if let Ok(mut last) = LAST_APP.lock() {
                *last = window.app.clone();
            }
            window.app
        }
        None => LAST_APP.lock().map(|app| app.clone()).unwrap_or_default(),
    }
}

fn neighbors(window: &WebviewWindow, bounds: Rect) -> (bool, bool) {
    let monitors = window.available_monitors().unwrap_or_default();
    let left = monitors.iter().any(|monitor| monitor.position().x + monitor.size().width as i32 == bounds.left);
    let right = monitors.iter().any(|monitor| monitor.position().x == bounds.right);
    (left, right)
}

const NO_ACTIVATE_SUBCLASS: usize = 0x4e494d;

unsafe extern "system" fn no_activate(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM, _id: usize, _data: usize) -> LRESULT {
    if message == WM_MOUSEACTIVATE {
        return LRESULT(MA_NOACTIVATE as isize);
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

pub(crate) fn make_window_passive(window: &WebviewWindow) {
    make_passive(window);
}

fn make_passive(window: &WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize);
            let _ = SetWindowSubclass(hwnd, Some(no_activate), NO_ACTIVATE_SUBCLASS, 0);
        }
    }
}

fn give_focus_back(window: &WebviewWindow, previous: &mut Option<isize>) {
    let Ok(own) = window.hwnd() else { return };
    let foreground = unsafe { GetForegroundWindow() };
    if foreground.is_invalid() {
        return;
    }
    if foreground == own {
        if let Some(raw) = *previous {
            unsafe {
                let _ = SetForegroundWindow(HWND(raw as *mut _));
            }
        }
    } else if process_of(foreground) != std::process::id() {
        *previous = Some(foreground.0 as isize);
    }
}

fn raise_above_docks(window: &WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    }
}

fn watch(app: AppHandle) {
    let mut ignoring = true;
    let mut last_cursor = (i32::MIN, i32::MIN);
    let mut last_check = Instant::now() - FULLSCREEN_CHECK;
    let mut previous_foreground: Option<isize> = None;
    let mut last_emit = Instant::now() - CURSOR_EVERY;
    while RUNNING.load(Ordering::SeqCst) {
        let Some(window) = app.get_webview_window(BUDDY_LABEL) else { break };
        if !HITBOX.lock().map(|hitbox| hitbox.capture).unwrap_or(false) {
            give_focus_back(&window, &mut previous_foreground);
        }
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
            if !covered {
                raise_above_docks(&window);
            }
        }
        let mut point = POINT::default();
        if unsafe { GetCursorPos(&mut point) }.is_ok() {
            if let Some(bounds) = monitor_rect() {
                let (x, y) = (point.x - bounds.left, point.y - bounds.top);
                let hitbox = HITBOX.lock().map(|hitbox| *hitbox).unwrap_or_default();
                let inside = hitbox.capture
                    || (x as f64 >= hitbox.x && x as f64 <= hitbox.x + hitbox.width && y as f64 >= hitbox.y && y as f64 <= hitbox.y + hitbox.height);
                if inside == ignoring {
                    ignoring = !inside;
                    let _ = window.set_ignore_cursor_events(ignoring);
                }
                let due = FOLLOW_CURSOR.load(Ordering::SeqCst) || last_emit.elapsed() >= CURSOR_EVERY;
                if (x, y) != last_cursor && due {
                    last_cursor = (x, y);
                    last_emit = Instant::now();
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
                let rect = Rect {
                    left: monitor.position().x,
                    top: monitor.position().y,
                    right: monitor.position().x + monitor.size().width as i32,
                    bottom: monitor.position().y + monitor.size().height as i32,
                };
                set_monitor(rect);
                place(&window, rect)?;
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
pub(crate) fn buddy_follow_cursor(enabled: bool) {
    FOLLOW_CURSOR.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
pub(crate) fn buddy_place(app: AppHandle, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
    let window = app.get_webview_window(BUDDY_LABEL).ok_or("O Nimbo livre está desligado.")?;
    let monitor = monitor_rect().ok_or("Sem tamanho de tela.")?;
    let left = monitor.left + x.clamp(0, (monitor.right - monitor.left - 1).max(0));
    let top = monitor.top + y.clamp(0, (monitor.bottom - monitor.top - 1).max(0));
    place(&window, Rect { left, top, right: left + width.max(1), bottom: top + height.max(1) })
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
    let bounds = monitor_rect().ok_or("Sem tamanho de tela.")?;
    let (has_left, has_right) = neighbors(&window, bounds);
    let own_dock = crate::dock::bar_top(&app).map(|top| top - bounds.top);
    let floor = work_area().map(|area| area.bottom.min(bounds.bottom) - bounds.top).unwrap_or(bounds.bottom - bounds.top);
    let floor = own_dock.map_or(floor, |top| top.min(floor));
    Ok(Scene {
        width: bounds.right - bounds.left,
        height: bounds.bottom - bounds.top,
        floor,
        platforms: visible_platforms(&top_windows(), bounds).into_iter().filter(|platform| platform.top < floor - 40).collect(),
        app: foreground_app(),
        has_left,
        has_right,
        dock: own_dock.is_none() && dock_running(),
    })
}

#[tauri::command]
pub(crate) async fn buddy_move_monitor(app: AppHandle, direction: String) -> Result<bool, String> {
    let window = app.get_webview_window(BUDDY_LABEL).ok_or("O Nimbo livre está desligado.")?;
    let bounds = monitor_rect().ok_or("Sem tamanho de tela.")?;
    let target = window.available_monitors().map_err(|error| error.to_string())?.into_iter().find(|monitor| {
        if direction == "left" {
            monitor.position().x + monitor.size().width as i32 == bounds.left
        } else {
            monitor.position().x == bounds.right
        }
    });
    let Some(monitor) = target else { return Ok(false) };
    let rect = Rect {
        left: monitor.position().x,
        top: monitor.position().y,
        right: monitor.position().x + monitor.size().width as i32,
        bottom: monitor.position().y + monitor.size().height as i32,
    };
    set_monitor(rect);
    place(&window, rect)?;
    Ok(true)
}

#[tauri::command]
pub(crate) fn foreground_window() -> Option<ForegroundWindow> {
    foreground()
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
