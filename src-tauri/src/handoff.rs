use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
use windows::Win32::System::Variant::{VARIANT, VT_I4};
use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, IUIAutomationValuePattern, TreeScope_Descendants, UIA_ControlTypePropertyId, UIA_EditControlTypeId, UIA_ValuePatternId};
use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

const BROWSERS: &[&str] = &["chrome.exe", "msedge.exe", "brave.exe", "opera.exe", "vivaldi.exe", "firefox.exe", "arc.exe"];

pub(crate) fn normalize(raw: &str) -> Option<String> {
    let text = raw.trim();
    if text.is_empty() || text.contains(char::is_whitespace) || text.len() > 2000 {
        return None;
    }
    let lower = text.to_lowercase();
    if lower.starts_with("chrome://") || lower.starts_with("edge://") || lower.starts_with("about:") || lower.starts_with("file:") || lower.starts_with("view-source:") {
        return None;
    }
    let url = if lower.starts_with("http://") || lower.starts_with("https://") { text.to_string() } else { format!("https://{text}") };
    let host = url.split("://").nth(1)?.split(['/', '?', '#']).next()?;
    (host.contains('.') || host.starts_with("localhost")).then_some(url)
}

fn address_bar() -> Option<String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
        let window = GetForegroundWindow();
        if window.is_invalid() {
            return None;
        }
        let root = automation.ElementFromHandle(window).ok()?;
        let mut control = VARIANT::default();
        (*control.Anonymous.Anonymous).vt = VT_I4;
        (*control.Anonymous.Anonymous).Anonymous.lVal = UIA_EditControlTypeId.0;
        let condition = automation.CreatePropertyCondition(UIA_ControlTypePropertyId, &control).ok()?;
        let edit = root.FindFirst(TreeScope_Descendants, &condition).ok()?;
        let pattern: IUIAutomationValuePattern = edit.GetCurrentPatternAs(UIA_ValuePatternId).ok()?;
        let value = pattern.CurrentValue().ok()?;
        Some(value.to_string())
    }
}

#[tauri::command]
pub(crate) async fn browser_url() -> Result<Option<String>, String> {
    let Some(front) = crate::buddy::foreground() else { return Ok(None) };
    if !BROWSERS.contains(&front.app.to_lowercase().as_str()) {
        return Ok(None);
    }
    let raw = tauri::async_runtime::spawn_blocking(address_bar).await.map_err(|error| error.to_string())?;
    Ok(raw.as_deref().and_then(normalize))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn address_bar_text_becomes_a_link() {
        assert_eq!(normalize("github.com/EduardoxDev/Nimbo").as_deref(), Some("https://github.com/EduardoxDev/Nimbo"));
        assert_eq!(normalize("https://www.youtube.com/watch?v=abc").as_deref(), Some("https://www.youtube.com/watch?v=abc"));
        assert_eq!(normalize("localhost:3000/app").as_deref(), Some("https://localhost:3000/app"));
        assert_eq!(normalize("http://localhost:1420").as_deref(), Some("http://localhost:1420"));
    }

    #[test]
    fn searches_and_browser_pages_are_not_links() {
        assert_eq!(normalize("como fazer bolo"), None);
        assert_eq!(normalize("chrome://settings"), None);
        assert_eq!(normalize("file:///C:/secret.txt"), None);
        assert_eq!(normalize(""), None);
        assert_eq!(normalize("nimbo"), None);
    }
}
