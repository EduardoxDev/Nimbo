//! Typing helpers that need to see keys in every app:
//! - text expander: ";email" becomes your e-mail as soon as you type it;
//! - paste queue: each Ctrl+V pastes the next item of a list you copied;
//! - eyedropper: the next click anywhere picks the colour under the mouse.
//!
//! One low-level keyboard hook and one mouse hook, on their own thread, only
//! after one of these is turned on. Typed text never leaves this module: it
//! keeps the last few characters to compare with the triggers, nothing else.

use serde::{Deserialize, Serialize};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};
use windows::Win32::{
    Foundation::{LPARAM, LRESULT, POINT, WPARAM},
    Graphics::Gdi::{GetDC, GetPixel, ReleaseDC},
    UI::{
        Input::KeyboardAndMouse::{
            GetAsyncKeyState, GetKeyState, GetKeyboardLayout, SendInput, ToUnicodeEx, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
            KEYEVENTF_UNICODE, VIRTUAL_KEY, VK_BACK, VK_CAPITAL, VK_CONTROL, VK_ESCAPE, VK_LWIN, VK_MENU, VK_PACKET, VK_RETURN, VK_RWIN, VK_SHIFT,
        },
        WindowsAndMessaging::{
            CallNextHookEx, GetForegroundWindow, GetMessageW, GetWindowThreadProcessId, SetWindowsHookExW, KBDLLHOOKSTRUCT, LLKHF_INJECTED, LLMHF_INJECTED, MSG,
            MSLLHOOKSTRUCT, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_SYSKEYDOWN,
        },
    },
};

const BUFFER: usize = 40;
const MAX_SNIPPETS: usize = 100;
const MAX_EXPANSION: usize = 4_000;
const MAX_QUEUE: usize = 30;

#[derive(Deserialize, Clone)]
pub(crate) struct Snippet {
    trigger: String,
    text: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Picked {
    hex: String,
}

static APP: OnceLock<AppHandle> = OnceLock::new();
static STARTED: AtomicBool = AtomicBool::new(false);
static SNIPPETS: Mutex<Vec<Snippet>> = Mutex::new(Vec::new());
static TYPED: Mutex<String> = Mutex::new(String::new());
static QUEUE: Mutex<Vec<String>> = Mutex::new(Vec::new());
static PICKING: AtomicBool = AtomicBool::new(false);
/// While the expander types its own text, the hook does not read it back.
static EXPANDING: AtomicBool = AtomicBool::new(false);
static SWALLOW_UP: AtomicBool = AtomicBool::new(false);
static LAST_PREVIEW: Mutex<Option<Instant>> = Mutex::new(None);

fn emit<T: Serialize + Clone>(event: &str, payload: T) {
    if let Some(app) = APP.get() {
        let _ = app.emit_to(crate::WINDOW_LABEL, event, payload);
    }
}

fn pressed(key: VIRTUAL_KEY) -> bool {
    unsafe { (GetAsyncKeyState(key.0 as i32) as u16 & 0x8000) != 0 }
}

/// The character a key makes on the keyboard layout of the app in front, without
/// disturbing dead keys (so "´" + "a" still gives "á").
fn char_of(info: &KBDLLHOOKSTRUCT) -> Option<char> {
    unsafe {
        let mut state = [0u8; 256];
        for key in [VK_SHIFT, VK_CONTROL, VK_MENU] {
            if pressed(key) {
                state[key.0 as usize] = 0x80;
            }
        }
        if GetKeyState(VK_CAPITAL.0 as i32) & 1 != 0 {
            state[VK_CAPITAL.0 as usize] = 0x01;
        }
        let thread = GetWindowThreadProcessId(GetForegroundWindow(), None);
        let layout = GetKeyboardLayout(thread);
        let mut buffer = [0u16; 4];
        // Flag 4: do not change the keyboard state (Windows 10 1607+).
        let count = ToUnicodeEx(info.vkCode, info.scanCode, &state, &mut buffer, 4, Some(layout));
        if count != 1 {
            return None;
        }
        char::from_u32(buffer[0] as u32).filter(|c| !c.is_control())
    }
}

/// The trigger the typed text now ends with, if any (the longest one wins).
pub(crate) fn matching<'a>(typed: &str, snippets: &'a [Snippet]) -> Option<&'a Snippet> {
    snippets.iter().filter(|snippet| !snippet.trigger.is_empty() && typed.ends_with(&snippet.trigger)).max_by_key(|snippet| snippet.trigger.chars().count())
}

/// {data} and {hora} become today's date and the time now.
pub(crate) fn fill_placeholders(text: &str, now: chrono::DateTime<chrono::Local>) -> String {
    text.replace("{data}", &now.format("%d/%m/%Y").to_string())
        .replace("{date}", &now.format("%d/%m/%Y").to_string())
        .replace("{hora}", &now.format("%H:%M").to_string())
        .replace("{time}", &now.format("%H:%M").to_string())
}

/// Marks the keys the Nimbo sends, so its own hook can tell them apart.
const NIMBO_TAG: usize = 0x4E49_4D42;

fn key_input(key: VIRTUAL_KEY, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: key, wScan: 0, dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) }, time: 0, dwExtraInfo: NIMBO_TAG } },
    }
}

fn unicode_input(unit: u16, up: bool) -> INPUT {
    let flags = if up { KEYEVENTF_UNICODE | KEYEVENTF_KEYUP } else { KEYEVENTF_UNICODE };
    INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(0), wScan: unit, dwFlags: flags, time: 0, dwExtraInfo: NIMBO_TAG } } }
}

/// Erases the trigger and types the text. Line breaks are Shift+Enter, so chats do not send early.
fn type_expansion(erase: usize, text: String) {
    EXPANDING.store(true, Ordering::SeqCst);
    thread::spawn(move || {
        // Let the key that completed the trigger reach the app first.
        thread::sleep(Duration::from_millis(30));
        let mut inputs: Vec<INPUT> = Vec::new();
        for _ in 0..erase {
            inputs.push(key_input(VK_BACK, false));
            inputs.push(key_input(VK_BACK, true));
        }
        for line_index in 0..text.split('\n').count() {
            let line = text.split('\n').nth(line_index).unwrap_or_default();
            if line_index > 0 {
                inputs.push(key_input(VK_SHIFT, false));
                inputs.push(key_input(VK_RETURN, false));
                inputs.push(key_input(VK_RETURN, true));
                inputs.push(key_input(VK_SHIFT, true));
            }
            for unit in line.trim_end_matches('\r').encode_utf16() {
                inputs.push(unicode_input(unit, false));
                inputs.push(unicode_input(unit, true));
            }
        }
        unsafe {
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
        // The keys above are queued; let them pass the hook before reading keys again.
        thread::sleep(Duration::from_millis(60));
        EXPANDING.store(false, Ordering::SeqCst);
    });
}

fn after_paste() {
    thread::spawn(|| {
        // The app reads the clipboard on Ctrl+V; give it a moment before the next item goes in.
        thread::sleep(Duration::from_millis(180));
        let next = QUEUE.lock().ok().and_then(|mut queue| if queue.is_empty() { None } else { Some(queue.remove(0)) });
        let left = QUEUE.lock().map(|queue| queue.len()).unwrap_or(0);
        match next {
            Some(text) => {
                if let Ok(mut clipboard) = arboard::Clipboard::new() {
                    let _ = clipboard.set_text(text);
                }
                emit("paste-queue", left + 1);
            }
            None => emit("paste-queue", 0usize),
        }
    });
}

unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && (wparam.0 as u32 == WM_KEYDOWN || wparam.0 as u32 == WM_SYSKEYDOWN) {
        let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        // Keys other programs simulate (on-screen keyboard, voice typing, remote access) count
        // like typed ones; only the expander's own typing and Unicode packets are skipped.
        let own = EXPANDING.load(Ordering::SeqCst) || info.vkCode == VK_PACKET.0 as u32 || (info.flags.0 & LLKHF_INJECTED.0 != 0 && info.dwExtraInfo == NIMBO_TAG);
        if !own {
            let key = VIRTUAL_KEY(info.vkCode as u16);
            if key == VK_ESCAPE && PICKING.swap(false, Ordering::SeqCst) {
                emit("color-pick-cancelled", ());
            }
            let ctrl = pressed(VK_CONTROL);
            if ctrl && info.vkCode == 'V' as u32 && QUEUE.lock().map(|queue| !queue.is_empty()).unwrap_or(false) {
                after_paste();
            }
            if let Ok(mut typed) = TYPED.lock() {
                if key == VK_BACK {
                    typed.pop();
                } else if ctrl || pressed(VK_LWIN) || pressed(VK_RWIN) || (pressed(VK_MENU) && !ctrl) {
                    typed.clear();
                } else if let Some(c) = char_of(info) {
                    typed.push(c);
                    let excess = typed.chars().count().saturating_sub(BUFFER);
                    if excess > 0 {
                        *typed = typed.chars().skip(excess).collect();
                    }
                    let snippets = SNIPPETS.lock().map(|list| list.clone()).unwrap_or_default();
                    if let Some(snippet) = matching(&typed, &snippets) {
                        let erase = snippet.trigger.chars().count();
                        let text = fill_placeholders(&snippet.text, chrono::Local::now());
                        typed.clear();
                        type_expansion(erase, text);
                    }
                } else if key == VK_RETURN {
                    typed.clear();
                }
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

fn color_at(point: POINT) -> Option<String> {
    unsafe {
        let screen = GetDC(None);
        let value = GetPixel(screen, point.x, point.y);
        ReleaseDC(None, screen);
        if value.0 == u32::MAX {
            return None;
        }
        let (red, green, blue) = (value.0 & 0xff, (value.0 >> 8) & 0xff, (value.0 >> 16) & 0xff);
        Some(format!("#{red:02x}{green:02x}{blue:02x}"))
    }
}

unsafe extern "system" fn mouse_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
        let message = wparam.0 as u32;
        // Clicks from accessibility tools count too; the Nimbo never sends clicks of its own here.
        let real = info.flags & LLMHF_INJECTED == 0 || info.dwExtraInfo != NIMBO_TAG;
        if real && PICKING.load(Ordering::SeqCst) {
            if message == WM_MOUSEMOVE {
                let due = LAST_PREVIEW.lock().map(|mut last| {
                    let due = last.is_none_or(|at| at.elapsed() > Duration::from_millis(70));
                    if due {
                        *last = Some(Instant::now());
                    }
                    due
                });
                if due.unwrap_or(false) {
                    if let Some(hex) = color_at(info.pt) {
                        emit("color-preview", Picked { hex });
                    }
                }
            } else if message == WM_LBUTTONDOWN {
                PICKING.store(false, Ordering::SeqCst);
                SWALLOW_UP.store(true, Ordering::SeqCst);
                if let Some(hex) = color_at(info.pt) {
                    emit("color-picked", Picked { hex });
                }
                // The click that picks a colour does not reach the app below.
                return LRESULT(1);
            }
        }
        if real && message == WM_LBUTTONUP && SWALLOW_UP.swap(false, Ordering::SeqCst) {
            return LRESULT(1);
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

fn ensure_hooks(app: &AppHandle) -> Result<(), String> {
    let _ = APP.set(app.clone());
    if STARTED.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    thread::Builder::new()
        .name("nimbo-keys".to_string())
        .spawn(move || unsafe {
            let keyboard = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), None, 0);
            let mouse = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), None, 0);
            let _ = ready_tx.send(keyboard.is_ok() && mouse.is_ok());
            let mut message = MSG::default();
            while GetMessageW(&mut message, None, 0, 0).as_bool() {}
        })
        .map_err(|error| error.to_string())?;
    if ready_rx.recv_timeout(Duration::from_secs(3)).unwrap_or(false) {
        Ok(())
    } else {
        STARTED.store(false, Ordering::SeqCst);
        Err("O Windows não deixou acompanhar o teclado.".to_string())
    }
}

/// The text expander's list; an empty list turns it off.
#[tauri::command]
pub(crate) fn keys_set_snippets(app: AppHandle, snippets: Vec<Snippet>) -> Result<(), String> {
    let clean: Vec<Snippet> = snippets
        .into_iter()
        .filter(|snippet| snippet.trigger.chars().count() >= 2 && !snippet.text.is_empty())
        .map(|snippet| Snippet { trigger: snippet.trigger.chars().take(30).collect(), text: snippet.text.chars().take(MAX_EXPANSION).collect() })
        .take(MAX_SNIPPETS)
        .collect();
    let any = !clean.is_empty();
    if let Ok(mut list) = SNIPPETS.lock() {
        *list = clean;
    }
    if any {
        ensure_hooks(&app)?;
    }
    Ok(())
}

/// Starts a paste queue: the first item goes to the clipboard, each Ctrl+V brings the next.
#[tauri::command]
pub(crate) fn keys_paste_queue(app: AppHandle, items: Vec<String>) -> Result<usize, String> {
    let mut items: Vec<String> = items.into_iter().filter(|item| !item.is_empty()).take(MAX_QUEUE).collect();
    if items.is_empty() {
        if let Ok(mut queue) = QUEUE.lock() {
            queue.clear();
        }
        return Ok(0);
    }
    ensure_hooks(&app)?;
    let first = items.remove(0);
    arboard::Clipboard::new().and_then(|mut clipboard| clipboard.set_text(first)).map_err(|error| error.to_string())?;
    let count = items.len() + 1;
    if let Ok(mut queue) = QUEUE.lock() {
        *queue = items;
    }
    Ok(count)
}

/// The next click anywhere picks a colour; Esc cancels.
#[tauri::command]
pub(crate) fn keys_pick_color(app: AppHandle) -> Result<(), String> {
    ensure_hooks(&app)?;
    PICKING.store(true, Ordering::SeqCst);
    Ok(())
}

/// The text selected in the app in front: copies it with Ctrl+C, reads it and puts
/// back what was on the clipboard before.
#[tauri::command]
pub(crate) async fn keys_copy_selection() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        // The shortcut's own keys (Alt+Shift…) must be up, or the app sees Alt+Shift+Ctrl+C.
        let until = Instant::now() + Duration::from_millis(1_500);
        while [VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN].iter().any(|key| pressed(*key)) && Instant::now() < until {
            thread::sleep(Duration::from_millis(20));
        }
        let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
        let before = clipboard.get_text().ok();
        let _ = clipboard.clear();
        let copy_key = VIRTUAL_KEY('C' as u16);
        let inputs = [key_input(VK_CONTROL, false), key_input(copy_key, false), key_input(copy_key, true), key_input(VK_CONTROL, true)];
        unsafe {
            SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        }
        let mut text = String::new();
        for _ in 0..15 {
            thread::sleep(Duration::from_millis(40));
            if let Ok(copied) = clipboard.get_text() {
                if !copied.trim().is_empty() {
                    text = copied;
                    break;
                }
            }
        }
        if let Some(before) = before {
            let _ = clipboard.set_text(before);
        }
        if text.trim().is_empty() {
            Err("Selecione um texto primeiro.".to_string())
        } else {
            Ok(text.chars().take(20_000).collect())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn snippet(trigger: &str, text: &str) -> Snippet {
        Snippet { trigger: trigger.to_string(), text: text.to_string() }
    }

    #[test]
    fn the_longest_trigger_at_the_end_wins() {
        let list = vec![snippet(";e", "curto"), snippet(";email", "eu@x.com"), snippet(";obg", "Obrigado!")];
        assert_eq!(matching("meu ;email", &list).map(|s| s.text.as_str()), Some("eu@x.com"));
        assert_eq!(matching("oi ;obg", &list).map(|s| s.text.as_str()), Some("Obrigado!"));
        assert!(matching("nada aqui", &list).is_none());
        assert!(matching(";emai", &list).is_none());
    }

    /// Types into a text box of its own and reads it back: `cargo test keys::tests::types -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn types_unicode_into_a_text_box() {
        use windows::core::w;
        use windows::Win32::UI::Input::KeyboardAndMouse::SetFocus;
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DispatchMessageW, GetWindowTextW, PeekMessageW, SetForegroundWindow, ShowWindow, TranslateMessage, ES_MULTILINE, PM_REMOVE, SW_SHOW,
            WINDOW_EX_STYLE, WINDOW_STYLE, WS_OVERLAPPEDWINDOW, WS_VISIBLE,
        };
        unsafe {
            let edit = CreateWindowExW(
                WINDOW_EX_STYLE(0),
                w!("EDIT"),
                w!(""),
                WS_OVERLAPPEDWINDOW | WS_VISIBLE | WINDOW_STYLE(ES_MULTILINE as u32),
                200,
                200,
                500,
                200,
                None,
                None,
                None,
                None,
            )
            .expect("edit");
            let _ = ShowWindow(edit, SW_SHOW);
            let _ = SetForegroundWindow(edit);
            let _ = SetFocus(Some(edit));
            let pump = |ms: u64| {
                let until = Instant::now() + Duration::from_millis(ms);
                let mut message = MSG::default();
                while Instant::now() < until {
                    while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                        let _ = TranslateMessage(&message);
                        DispatchMessageW(&message);
                    }
                    thread::sleep(Duration::from_millis(5));
                }
            };
            pump(300);
            println!("foreground ok: {}", GetForegroundWindow() == edit);
            type_expansion(0, "Olá, ação! Muito obrigado.
Segunda linha ✓".to_string());
            pump(1500);
            let mut buffer = [0u16; 256];
            let length = GetWindowTextW(edit, &mut buffer);
            println!("typed: {:?}", String::from_utf16_lossy(&buffer[..length as usize]));
        }
    }

    #[test]
    fn placeholders_become_the_date_and_time() {
        let now = chrono::Local.with_ymd_and_hms(2026, 11, 2, 9, 5, 0).unwrap();
        assert_eq!(fill_placeholders("Hoje é {data}, {hora}", now), "Hoje é 02/11/2026, 09:05");
    }
}
