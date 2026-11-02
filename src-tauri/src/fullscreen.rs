use std::{
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Manager, WebviewWindow};
use windows::Win32::{
    Foundation::{HWND, RECT},
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    UI::Shell::{SHQueryUserNotificationState, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN},
    UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId, IsIconic,
        IsWindowVisible, IsZoomed,
    },
};

const POLL_INTERVAL: Duration = Duration::from_millis(800);
const SHELL_WINDOW_CLASSES: [&str; 4] = ["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"];

static ENABLED: AtomicBool = AtomicBool::new(true);
static HIDDEN_FOR_FULLSCREEN: AtomicBool = AtomicBool::new(false);
static SHOWN_BY_USER: AtomicBool = AtomicBool::new(false);
static COVERED: AtomicBool = AtomicBool::new(false);

pub(crate) fn init(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || loop {
        if let Some(window) = app.get_webview_window(crate::WINDOW_LABEL) {
            tick(&window);
        }
        thread::sleep(POLL_INTERVAL);
    });
}

pub(crate) fn user_changed_visibility() {
    HIDDEN_FOR_FULLSCREEN.store(false, Ordering::SeqCst);
    SHOWN_BY_USER.store(true, Ordering::SeqCst);
}

/// Whether a full-screen app, game or presentation is in front right now.
#[tauri::command]
pub(crate) fn fullscreen_now() -> bool {
    COVERED.load(Ordering::SeqCst)
}

#[tauri::command]
pub(crate) fn set_hide_in_fullscreen(enabled: bool) {
    ENABLED.store(enabled, Ordering::SeqCst);
}

fn tick(window: &WebviewWindow) {
    let covered = island_screen_is_covered(window);
    COVERED.store(covered, Ordering::SeqCst);
    if !covered {
        SHOWN_BY_USER.store(false, Ordering::SeqCst);
    }

    if covered && ENABLED.load(Ordering::SeqCst) && !SHOWN_BY_USER.load(Ordering::SeqCst) {
        if window.is_visible().unwrap_or(false) && window.hide().is_ok() {
            HIDDEN_FOR_FULLSCREEN.store(true, Ordering::SeqCst);
        }
    } else if HIDDEN_FOR_FULLSCREEN.swap(false, Ordering::SeqCst) {
        let _ = window.show();
    }
}

pub(crate) fn screen_is_covered(window: &WebviewWindow) -> bool {
    island_screen_is_covered(window)
}

fn island_screen_is_covered(window: &WebviewWindow) -> bool {
    let Ok(island) = window.hwnd() else {
        return false;
    };
    if exclusive_fullscreen_running() {
        return true;
    }

    unsafe {
        let foreground = GetForegroundWindow();
        if foreground.is_invalid() || is_own_window(foreground) || is_shell_window(foreground) {
            return false;
        }
        if !IsWindowVisible(foreground).as_bool()
            || IsIconic(foreground).as_bool()
            || IsZoomed(foreground).as_bool()
        {
            return false;
        }

        let monitor = MonitorFromWindow(foreground, MONITOR_DEFAULTTONEAREST);
        if monitor != MonitorFromWindow(island, MONITOR_DEFAULTTONEAREST) {
            return false;
        }

        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let mut rect = RECT::default();
        GetMonitorInfoW(monitor, &mut info).as_bool()
            && GetWindowRect(foreground, &mut rect).is_ok()
            && covers(&rect, &info.rcMonitor)
    }
}

fn exclusive_fullscreen_running() -> bool {
    matches!(
        unsafe { SHQueryUserNotificationState() },
        Ok(state) if state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_PRESENTATION_MODE
    )
}

fn is_own_window(window: HWND) -> bool {
    let mut process_id = 0u32;
    unsafe { GetWindowThreadProcessId(window, Some(&mut process_id)) };
    process_id == std::process::id()
}

fn is_shell_window(window: HWND) -> bool {
    let mut buffer = [0u16; 64];
    let length = unsafe { GetClassNameW(window, &mut buffer) };
    let class = String::from_utf16_lossy(&buffer[..length.max(0) as usize]);
    SHELL_WINDOW_CLASSES.contains(&class.as_str())
}

fn covers(window: &RECT, monitor: &RECT) -> bool {
    window.left <= monitor.left
        && window.top <= monitor.top
        && window.right >= monitor.right
        && window.bottom >= monitor.bottom
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(left: i32, top: i32, right: i32, bottom: i32) -> RECT {
        RECT { left, top, right, bottom }
    }

    #[test]
    fn only_windows_covering_the_whole_monitor_count_as_fullscreen() {
        let monitor = rect(0, 0, 1920, 1080);
        assert!(covers(&rect(0, 0, 1920, 1080), &monitor));
        assert!(covers(&rect(-8, -8, 1928, 1088), &monitor));
        assert!(!covers(&rect(0, 0, 1920, 1040), &monitor));
        assert!(!covers(&rect(1920, 0, 3840, 1080), &monitor));
    }
}
