use crate::clipboard_history::parse_shortcut_binding;
use serde::{Deserialize, Serialize};
use std::{
    sync::{mpsc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};
use windows::{
    core::w,
    Win32::{
        Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM},
        System::LibraryLoader::GetModuleHandleW,
        UI::{
            Input::KeyboardAndMouse::{RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_NOREPEAT},
            WindowsAndMessaging::{
                CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, PostMessageW, RegisterClassW,
                TranslateMessage, HWND_MESSAGE, MSG, WINDOW_EX_STYLE, WINDOW_STYLE, WM_APP, WM_HOTKEY, WNDCLASSW,
            },
        },
    },
};

pub(crate) const ACTIONS: [&str; 5] = ["toggle", "playPause", "nextPage", "settings", "launcher"];
const FIRST_HOTKEY_ID: i32 = 0x4E00;
const APPLY_MESSAGE: u32 = WM_APP + 0x61;

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct ShortcutRequest {
    action: String,
    shortcut: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub(crate) struct ShortcutResult {
    action: String,
    shortcut: String,
    error: Option<String>,
}

type Pending = (Vec<ShortcutRequest>, mpsc::Sender<Vec<ShortcutResult>>);

static APP: OnceLock<AppHandle> = OnceLock::new();
static WINDOW: Mutex<Option<isize>> = Mutex::new(None);
static PENDING: Mutex<Option<Pending>> = Mutex::new(None);
static ACTIVE: Mutex<Vec<i32>> = Mutex::new(Vec::new());

pub(crate) fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
    thread::spawn(|| {
        if let Err(error) = run_loop() {
            crate::diagnostics::log("shortcuts", &format!("failed to start: {error}"));
        }
    });
}

fn action_id(action: &str) -> Option<i32> {
    ACTIONS.iter().position(|item| *item == action).map(|index| FIRST_HOTKEY_ID + index as i32)
}

pub(crate) fn validate(requests: &[ShortcutRequest]) -> Vec<Result<(i32, u32, u32), String>> {
    let mut seen: Vec<String> = Vec::new();
    requests
        .iter()
        .map(|request| {
            let id = action_id(&request.action).ok_or_else(|| "Unknown action.".to_string())?;
            let binding = parse_shortcut_binding(&request.shortcut)
                .ok_or_else(|| "Use a key with Ctrl, Alt, Shift or Win.".to_string())?;
            let key = format!("{}-{}", binding.modifiers, binding.key_code);
            if seen.contains(&key) {
                return Err("This shortcut is already used by another action.".to_string());
            }
            seen.push(key);
            Ok((id, binding.modifiers, binding.key_code))
        })
        .collect()
}

#[tauri::command]
pub(crate) fn set_global_shortcuts(shortcuts: Vec<ShortcutRequest>) -> Result<Vec<ShortcutResult>, String> {
    let requests: Vec<ShortcutRequest> = shortcuts
        .into_iter()
        .filter(|request| !request.shortcut.trim().is_empty())
        .collect();
    let started = Instant::now();
    let hwnd = loop {
        if let Some(hwnd) = *WINDOW.lock().map_err(|error| error.to_string())? {
            break hwnd;
        }
        if started.elapsed() >= Duration::from_secs(2) {
            return Err("Shortcut service is not ready yet.".to_string());
        }
        thread::sleep(Duration::from_millis(25));
    };
    let (sender, receiver) = mpsc::channel();
    *PENDING.lock().map_err(|error| error.to_string())? = Some((requests, sender));
    unsafe { PostMessageW(Some(HWND(hwnd as *mut _)), APPLY_MESSAGE, WPARAM(0), LPARAM(0)) }
        .map_err(|error| error.to_string())?;
    receiver.recv_timeout(Duration::from_secs(2)).map_err(|error| error.to_string())
}

fn apply(hwnd: HWND, requests: Vec<ShortcutRequest>) -> Vec<ShortcutResult> {
    if let Ok(mut active) = ACTIVE.lock() {
        for id in active.drain(..) {
            let _ = unsafe { UnregisterHotKey(Some(hwnd), id) };
        }
    }
    let checks = validate(&requests);
    requests
        .into_iter()
        .zip(checks)
        .map(|(request, check)| {
            let error = match check {
                Ok((id, modifiers, key_code)) => {
                    match unsafe { RegisterHotKey(Some(hwnd), id, HOT_KEY_MODIFIERS(modifiers | MOD_NOREPEAT.0), key_code) } {
                        Ok(()) => {
                            if let Ok(mut active) = ACTIVE.lock() {
                                active.push(id);
                            }
                            None
                        }
                        Err(_) => {
                            crate::diagnostics::log("shortcuts", &format!("{} is taken by another app", request.shortcut));
                            Some("Another app is already using this shortcut.".to_string())
                        }
                    }
                }
                Err(error) => Some(error),
            };
            ShortcutResult { action: request.action, shortcut: request.shortcut, error }
        })
        .collect()
}

fn run_loop() -> Result<(), String> {
    unsafe {
        let class_name = w!("NimboGlobalShortcuts");
        let module = GetModuleHandleW(None).map_err(|error| error.to_string())?;
        let instance = HINSTANCE(module.0);
        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: instance,
            lpszClassName: class_name,
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            return Err("could not register the shortcut window".to_string());
        }
        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE(0),
            class_name,
            w!("Nimbo Global Shortcuts"),
            WINDOW_STYLE(0),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(instance),
            None,
        )
        .map_err(|error| error.to_string())?;
        *WINDOW.lock().map_err(|error| error.to_string())? = Some(hwnd.0 as isize);
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).into() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    Ok(())
}

unsafe extern "system" fn window_proc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if message == WM_HOTKEY {
        let index = (wparam.0 as i32 - FIRST_HOTKEY_ID) as usize;
        if let (Some(app), Some(action)) = (APP.get(), ACTIONS.get(index)) {
            if *action == "settings" {
                let _ = crate::open_settings_window(app.clone());
            } else {
                if *action == "toggle" || *action == "launcher" {
                    crate::fullscreen::user_changed_visibility();
                    let _ = crate::show_island(app);
                }
                let _ = app.emit_to(crate::WINDOW_LABEL, "global-shortcut", *action);
            }
        }
        return LRESULT(0);
    }
    if message == APPLY_MESSAGE {
        if let Some((requests, sender)) = PENDING.lock().ok().and_then(|mut pending| pending.take()) {
            let _ = sender.send(apply(hwnd, requests));
        }
        return LRESULT(0);
    }
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(action: &str, shortcut: &str) -> ShortcutRequest {
        ShortcutRequest { action: action.to_string(), shortcut: shortcut.to_string() }
    }

    #[test]
    fn duplicates_and_bare_keys_are_rejected() {
        let checks = validate(&[
            request("toggle", "Ctrl+Alt+Space"),
            request("launcher", "Ctrl+Alt+Space"),
            request("playPause", "P"),
            request("unknown", "Ctrl+K"),
        ]);
        assert!(checks[0].is_ok());
        assert!(checks[1].is_err());
        assert!(checks[2].is_err());
        assert!(checks[3].is_err());
    }
}
