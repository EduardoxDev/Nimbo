use serde::Serialize;
use std::{sync::Mutex, thread, time::Duration};
use tauri::{AppHandle, Monitor, WebviewWindow};
use windows::Win32::{Foundation::POINT, UI::WindowsAndMessaging::GetCursorPos};

pub(crate) const PRIMARY: &str = "primary";
pub(crate) const FOLLOW_MOUSE: &str = "mouse";
const FOLLOW_INTERVAL: Duration = Duration::from_millis(600);

static PREFERENCE: Mutex<String> = Mutex::new(String::new());

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MonitorInfo {
    id: String,
    width: u32,
    height: u32,
    primary: bool,
}

pub(crate) fn preference() -> String {
    PREFERENCE
        .lock()
        .map(|value| if value.is_empty() { PRIMARY.to_string() } else { value.clone() })
        .unwrap_or_else(|_| PRIMARY.to_string())
}

fn contains(monitor: &Monitor, x: i32, y: i32) -> bool {
    let position = monitor.position();
    let size = monitor.size();
    x >= position.x && x < position.x + size.width as i32 && y >= position.y && y < position.y + size.height as i32
}

fn cursor() -> Option<(i32, i32)> {
    let mut point = POINT::default();
    unsafe { GetCursorPos(&mut point) }.ok()?;
    Some((point.x, point.y))
}

pub(crate) fn preferred_monitor(window: &WebviewWindow) -> Option<Monitor> {
    let preference = preference();
    if preference == PRIMARY {
        return None;
    }
    let monitors = window.available_monitors().ok()?;
    if preference == FOLLOW_MOUSE {
        let (x, y) = cursor()?;
        return monitors.into_iter().find(|monitor| contains(monitor, x, y));
    }
    monitors.into_iter().find(|monitor| monitor.name().map(String::as_str) == Some(preference.as_str()))
}

pub(crate) fn init(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        let mut last: Option<String> = None;
        loop {
            thread::sleep(FOLLOW_INTERVAL);
            if preference() != FOLLOW_MOUSE {
                last = None;
                continue;
            }
            let Ok(window) = crate::main_window(&app) else { continue };
            let current = preferred_monitor(&window).and_then(|monitor| monitor.name().cloned());
            if current.is_some() && current != last {
                if last.is_some() {
                    let _ = crate::reapply_geometry(&window);
                }
                last = current;
            }
        }
    });
}

#[tauri::command]
pub(crate) fn list_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let window = crate::main_window(&app)?;
    let primary = window.primary_monitor().map_err(|error| error.to_string())?.and_then(|monitor| monitor.name().cloned());
    Ok(window
        .available_monitors()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter_map(|monitor| {
            let id = monitor.name()?.clone();
            Some(MonitorInfo {
                primary: primary.as_deref() == Some(id.as_str()),
                width: monitor.size().width,
                height: monitor.size().height,
                id,
            })
        })
        .collect())
}

#[tauri::command]
pub(crate) fn set_island_monitor(app: AppHandle, preference: String) -> Result<(), String> {
    let preference = preference.trim().chars().take(128).collect::<String>();
    *PREFERENCE.lock().map_err(|error| error.to_string())? = preference;
    let window = crate::main_window(&app)?;
    crate::reapply_geometry(&window)
}
