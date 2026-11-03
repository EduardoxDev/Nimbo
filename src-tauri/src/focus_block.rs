use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, ShowWindow, SW_MINIMIZE};

pub(crate) fn may_minimize(front_app: &str, expected_app: &str) -> bool {
    !front_app.is_empty() && front_app.eq_ignore_ascii_case(expected_app) && !front_app.eq_ignore_ascii_case("nimbo.exe") && !front_app.eq_ignore_ascii_case("explorer.exe")
}

#[tauri::command]
pub(crate) fn focus_minimize_foreground(app: String) -> Result<bool, String> {
    let Some(front) = crate::buddy::foreground() else { return Ok(false) };
    if !may_minimize(&front.app, &app) {
        return Ok(false);
    }
    let window = unsafe { GetForegroundWindow() };
    if window.is_invalid() {
        return Ok(false);
    }
    let _ = unsafe { ShowWindow(window, SW_MINIMIZE) };
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_detected_app_is_minimized_never_nimbo_or_the_desktop() {
        assert!(may_minimize("chrome.exe", "Chrome.exe"));
        assert!(!may_minimize("code.exe", "chrome.exe"));
        assert!(!may_minimize("nimbo.exe", "nimbo.exe"));
        assert!(!may_minimize("explorer.exe", "explorer.exe"));
        assert!(!may_minimize("", ""));
    }
}
