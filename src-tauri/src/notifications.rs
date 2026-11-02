//! Phone notifications on the island: Windows' "Phone Link" already mirrors
//! the phone's notifications into Windows; Nimbo reads those (with the user's
//! permission) and shows them on the island. Optionally any app's notifications.

use serde::Serialize;
use std::{
    collections::HashSet,
    sync::atomic::{AtomicBool, AtomicU32, Ordering},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use windows::{
    UI::Notifications::{
        KnownNotificationBindings,
        Management::{UserNotificationListener, UserNotificationListenerAccessStatus},
        NotificationKinds,
    },
    Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED},
};

static RUNNING: AtomicBool = AtomicBool::new(false);
static ONLY_PHONE: AtomicBool = AtomicBool::new(true);
static GENERATION: AtomicU32 = AtomicU32::new(0);

#[derive(Serialize, Clone)]
struct Incoming {
    app: String,
    title: String,
    body: String,
}

/// Phone Link's name in the languages Windows ships it in.
pub(crate) fn is_phone_app(name: &str) -> bool {
    let lower = name.to_lowercase();
    ["vincular ao celular", "phone link", "link to windows", "your phone", "seu telefone", "手机连接", "连接至 windows"].iter().any(|known| lower.contains(known))
}

fn read_all(listener: &UserNotificationListener) -> windows::core::Result<Vec<(u32, Incoming)>> {
    let list = listener.GetNotificationsAsync(NotificationKinds::Toast)?.get()?;
    let mut found = Vec::new();
    for item in list {
        let id = item.Id()?;
        let app = item.AppInfo().and_then(|info| info.DisplayInfo()).and_then(|info| info.DisplayName()).map(|name| name.to_string_lossy()).unwrap_or_default();
        let mut texts = Vec::new();
        if let Ok(binding) = item.Notification().and_then(|notification| notification.Visual()).and_then(|visual| visual.GetBinding(&KnownNotificationBindings::ToastGeneric()?)) {
            for element in binding.GetTextElements()? {
                let text = element.Text()?.to_string_lossy();
                if !text.trim().is_empty() {
                    texts.push(text);
                }
            }
        }
        let title = texts.first().cloned().unwrap_or_default();
        let body = texts.iter().skip(1).cloned().collect::<Vec<_>>().join(" ");
        found.push((id, Incoming { app, title, body }));
    }
    Ok(found)
}

/// Asks Windows for permission (first time) and starts watching.
#[tauri::command]
pub(crate) async fn notifications_start(app: AppHandle, only_phone: bool) -> Result<String, String> {
    ONLY_PHONE.store(only_phone, Ordering::SeqCst);
    let status = tauri::async_runtime::spawn_blocking(|| -> Result<UserNotificationListenerAccessStatus, String> {
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let listener = UserNotificationListener::Current().map_err(|error| format!("O Windows não deixou ler notificações: {error}"))?;
        let status = listener.GetAccessStatus().map_err(|error| error.to_string())?;
        if status == UserNotificationListenerAccessStatus::Allowed {
            return Ok(status);
        }
        listener.RequestAccessAsync().and_then(|operation| operation.get()).map_err(|error| format!("O Windows não deixou ler notificações: {error}"))
    })
    .await
    .map_err(|error| error.to_string())??;
    if status != UserNotificationListenerAccessStatus::Allowed {
        return Ok("denied".to_string());
    }
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Ok("allowed".to_string());
    }
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    thread::spawn(move || {
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let Ok(listener) = UserNotificationListener::Current() else {
            RUNNING.store(false, Ordering::SeqCst);
            return;
        };
        // What is already in the action center is old news.
        let mut seen: HashSet<u32> = read_all(&listener).unwrap_or_default().into_iter().map(|(id, _)| id).collect();
        while RUNNING.load(Ordering::SeqCst) && GENERATION.load(Ordering::SeqCst) == generation {
            thread::sleep(Duration::from_secs(4));
            let Ok(items) = read_all(&listener) else { continue };
            for (id, incoming) in items {
                if !seen.insert(id) || incoming.app.eq_ignore_ascii_case("nimbo") {
                    continue;
                }
                if ONLY_PHONE.load(Ordering::SeqCst) && !is_phone_app(&incoming.app) {
                    continue;
                }
                let _ = app.emit_to(crate::WINDOW_LABEL, "windows-notification", incoming);
            }
            if seen.len() > 2_000 {
                seen.clear();
            }
        }
    });
    Ok("allowed".to_string())
}

#[tauri::command]
pub(crate) fn notifications_stop() {
    RUNNING.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phone_link_is_recognised() {
        assert!(is_phone_app("Vincular ao Celular"));
        assert!(is_phone_app("Phone Link"));
        assert!(!is_phone_app("Microsoft Teams"));
    }
}
