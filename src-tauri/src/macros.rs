//! "Teach it once": records the clicks and keys of a short task and replays
//! them on request. Stored only on this PC. Pressing Esc three times stops a
//! recording; holding Esc stops a replay.

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::{
    Foundation::{LPARAM, LRESULT, WPARAM},
    UI::{
        Input::KeyboardAndMouse::{
            GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, MOUSEEVENTF_LEFTDOWN,
            MOUSEEVENTF_LEFTUP, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL, MOUSEINPUT, MOUSE_EVENT_FLAGS, VIRTUAL_KEY, VK_ESCAPE,
        },
        WindowsAndMessaging::{
            CallNextHookEx, GetMessageW, PostThreadMessageW, SetCursorPos, SetWindowsHookExW, UnhookWindowsHookEx, KBDLLHOOKSTRUCT, LLKHF_INJECTED,
            LLMHF_INJECTED, MSG, MSLLHOOKSTRUCT, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEWHEEL,
            WM_QUIT, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
        },
    },
};

const MAX_RECORDING: Duration = Duration::from_secs(180);
const MAX_PAUSE_MS: u64 = 2_000;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum Step {
    Key { vk: u16, up: bool, wait: u64 },
    Mouse { x: i32, y: i32, button: String, up: bool, wait: u64 },
    Wheel { x: i32, y: i32, delta: i32, wait: u64 },
}

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct Macro {
    id: String,
    name: String,
    steps: Vec<Step>,
    created: u64,
}

#[derive(Serialize)]
pub(crate) struct MacroInfo {
    id: String,
    name: String,
    steps: usize,
    seconds: u64,
}

struct Recording {
    steps: Vec<Step>,
    last: Instant,
    escapes: Vec<Instant>,
    thread: u32,
}

static APP: OnceLock<AppHandle> = OnceLock::new();
static RECORDING: Mutex<Option<Recording>> = Mutex::new(None);
static PENDING: Mutex<Vec<Step>> = Mutex::new(Vec::new());

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?.join("macros");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn push(step_of: impl FnOnce(u64) -> Step) {
    if let Ok(mut slot) = RECORDING.lock() {
        if let Some(recording) = slot.as_mut() {
            let wait = recording.last.elapsed().as_millis() as u64;
            recording.last = Instant::now();
            recording.steps.push(step_of(wait.min(MAX_PAUSE_MS)));
        }
    }
}

/// Three Esc presses within two seconds end the recording; they are not kept.
fn escape_pressed() -> bool {
    let Ok(mut slot) = RECORDING.lock() else { return false };
    let Some(recording) = slot.as_mut() else { return false };
    let now = Instant::now();
    recording.escapes.retain(|time| now.duration_since(*time) < Duration::from_secs(2));
    recording.escapes.push(now);
    recording.escapes.len() >= 3
}

unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        if info.flags.0 & LLKHF_INJECTED.0 == 0 {
            let message = wparam.0 as u32;
            let up = message == WM_KEYUP || message == WM_SYSKEYUP;
            if message == WM_KEYDOWN || message == WM_SYSKEYDOWN || up {
                let vk = info.vkCode as u16;
                push(|wait| Step::Key { vk, up, wait });
                if vk == VK_ESCAPE.0 && !up && escape_pressed() {
                    stop_recording();
                }
            }
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

unsafe extern "system" fn mouse_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let info = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
        if info.flags & LLMHF_INJECTED == 0 {
            let (x, y) = (info.pt.x, info.pt.y);
            match wparam.0 as u32 {
                WM_LBUTTONDOWN => push(|wait| Step::Mouse { x, y, button: "left".into(), up: false, wait }),
                WM_LBUTTONUP => push(|wait| Step::Mouse { x, y, button: "left".into(), up: true, wait }),
                WM_RBUTTONDOWN => push(|wait| Step::Mouse { x, y, button: "right".into(), up: false, wait }),
                WM_RBUTTONUP => push(|wait| Step::Mouse { x, y, button: "right".into(), up: true, wait }),
                WM_MOUSEWHEEL => {
                    let delta = ((info.mouseData >> 16) as u16) as i16 as i32;
                    push(|wait| Step::Wheel { x, y, delta, wait });
                }
                _ => {}
            }
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

/// Drops the Esc presses that ended the recording, and an unmatched last press.
pub(crate) fn tidy(mut steps: Vec<Step>) -> Vec<Step> {
    let mut removed = 0;
    while removed < 6 {
        match steps.last() {
            Some(Step::Key { vk, .. }) if *vk == VK_ESCAPE.0 => {
                steps.pop();
                removed += 1;
            }
            _ => break,
        }
    }
    if let Some(Step::Mouse { up: false, .. }) = steps.last() {
        steps.pop();
    }
    steps
}

fn stop_recording() {
    let Ok(mut slot) = RECORDING.lock() else { return };
    let Some(recording) = slot.take() else { return };
    let steps = tidy(recording.steps);
    let count = steps.len();
    if let Ok(mut pending) = PENDING.lock() {
        *pending = steps;
    }
    unsafe {
        let _ = PostThreadMessageW(recording.thread, WM_QUIT, WPARAM(0), LPARAM(0));
    }
    if let Some(app) = APP.get() {
        let _ = app.emit("macro-recorded", count);
    }
}

#[tauri::command]
pub(crate) fn macro_record_start(app: AppHandle) -> Result<(), String> {
    let _ = APP.set(app);
    if RECORDING.lock().map_err(|error| error.to_string())?.is_some() {
        return Err("Já estou gravando.".to_string());
    }
    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    thread::spawn(move || unsafe {
        let thread_id = windows::Win32::System::Threading::GetCurrentThreadId();
        let keyboard = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), None, 0);
        let mouse = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), None, 0);
        let (Ok(keyboard), Ok(mouse)) = (keyboard, mouse) else {
            let _ = ready_tx.send(Err("O Windows não deixou gravar.".to_string()));
            return;
        };
        if let Ok(mut slot) = RECORDING.lock() {
            *slot = Some(Recording { steps: Vec::new(), last: Instant::now(), escapes: Vec::new(), thread: thread_id });
        }
        let _ = ready_tx.send(Ok(()));
        // A safety net: very long recordings stop by themselves.
        thread::spawn(|| {
            thread::sleep(MAX_RECORDING);
            stop_recording();
        });
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {}
        let _ = UnhookWindowsHookEx(keyboard);
        let _ = UnhookWindowsHookEx(mouse);
    });
    ready_rx.recv_timeout(Duration::from_secs(3)).map_err(|_| "O Windows não deixou gravar.".to_string())?
}

#[tauri::command]
pub(crate) fn macro_record_stop() {
    stop_recording();
}

fn info(item: &Macro) -> MacroInfo {
    let total: u64 = item.steps.iter().map(|step| match step {
        Step::Key { wait, .. } | Step::Mouse { wait, .. } | Step::Wheel { wait, .. } => *wait,
    }).sum();
    MacroInfo { id: item.id.clone(), name: item.name.clone(), steps: item.steps.len(), seconds: total / 1000 }
}

fn load_all(app: &AppHandle) -> Vec<Macro> {
    let Ok(dir) = dir(app) else { return Vec::new() };
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    let mut list: Vec<Macro> = entries
        .flatten()
        .filter_map(|entry| fs::read_to_string(entry.path()).ok())
        .filter_map(|text| serde_json::from_str(&text).ok())
        .collect();
    list.sort_by(|a, b| b.created.cmp(&a.created));
    list
}

#[tauri::command]
pub(crate) fn macro_save(app: AppHandle, name: String) -> Result<MacroInfo, String> {
    let steps = std::mem::take(&mut *PENDING.lock().map_err(|error| error.to_string())?);
    if steps.is_empty() {
        return Err("Nada foi gravado.".to_string());
    }
    let created = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|time| time.as_millis() as u64).unwrap_or(0);
    let name: String = name.trim().chars().take(60).collect();
    let item = Macro { id: format!("m{created}"), name: if name.is_empty() { "Ação gravada".to_string() } else { name }, steps, created };
    fs::write(dir(&app)?.join(format!("{}.json", item.id)), serde_json::to_string(&item).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    Ok(info(&item))
}

#[tauri::command]
pub(crate) fn macro_list(app: AppHandle) -> Vec<MacroInfo> {
    load_all(&app).iter().map(info).collect()
}

#[tauri::command]
pub(crate) fn macro_delete(app: AppHandle, id: String) -> Result<(), String> {
    if !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Invalid id.".to_string());
    }
    fs::remove_file(dir(&app)?.join(format!("{id}.json"))).map_err(|error| error.to_string())
}

fn send(input: INPUT) {
    unsafe {
        SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
    }
}

fn mouse(flags: MOUSE_EVENT_FLAGS, data: i32) -> INPUT {
    INPUT { r#type: INPUT_MOUSE, Anonymous: INPUT_0 { mi: MOUSEINPUT { dx: 0, dy: 0, mouseData: data as u32, dwFlags: flags, time: 0, dwExtraInfo: 0 } } }
}

/// Replays a recording by id or by name. Holding Esc stops it.
#[tauri::command]
pub(crate) async fn macro_run(app: AppHandle, id: String) -> Result<String, String> {
    let wanted = id.to_lowercase();
    let item = load_all(&app)
        .into_iter()
        .find(|item| item.id == id || item.name.to_lowercase() == wanted)
        .or_else(|| load_all(&app).into_iter().find(|item| item.name.to_lowercase().contains(&wanted)))
        .ok_or_else(|| format!("Não achei a ação “{id}”."))?;
    let name = item.name.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // A moment for the island or launcher to get out of the way.
        thread::sleep(Duration::from_millis(400));
        for step in &item.steps {
            if unsafe { GetAsyncKeyState(VK_ESCAPE.0 as i32) } as u16 & 0x8000 != 0 {
                return Err("Parei a ação: Esc apertado.".to_string());
            }
            match step {
                Step::Key { vk, up, wait } => {
                    thread::sleep(Duration::from_millis(*wait));
                    let flags = if *up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) };
                    send(INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(*vk), wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } } });
                }
                Step::Mouse { x, y, button, up, wait } => {
                    thread::sleep(Duration::from_millis(*wait));
                    unsafe {
                        let _ = SetCursorPos(*x, *y);
                    }
                    let flags = match (button.as_str(), up) {
                        ("right", false) => MOUSEEVENTF_RIGHTDOWN,
                        ("right", true) => MOUSEEVENTF_RIGHTUP,
                        (_, false) => MOUSEEVENTF_LEFTDOWN,
                        (_, true) => MOUSEEVENTF_LEFTUP,
                    };
                    send(mouse(flags, 0));
                }
                Step::Wheel { x, y, delta, wait } => {
                    thread::sleep(Duration::from_millis(*wait));
                    unsafe {
                        let _ = SetCursorPos(*x, *y);
                    }
                    send(mouse(MOUSEEVENTF_WHEEL, *delta));
                }
            }
        }
        Ok(format!("Ação “{name}” feita."))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_stop_keys_are_not_replayed() {
        let esc = |up| Step::Key { vk: VK_ESCAPE.0, up, wait: 0 };
        let steps = vec![Step::Key { vk: 65, up: false, wait: 0 }, Step::Key { vk: 65, up: true, wait: 10 }, esc(false), esc(true), esc(false), esc(true), esc(false)];
        assert_eq!(tidy(steps).len(), 2);
    }
}
