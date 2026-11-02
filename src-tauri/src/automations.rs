use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "automations";

#[tauri::command]
pub(crate) async fn automations_open(app: AppHandle) -> Result<(), String> {
    let window = match app.get_webview_window(LABEL) {
        Some(window) => window,
        None => WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("index.html?window=automations".into()))
            .title("Nimbo Automações")
            .inner_size(1040.0, 680.0)
            .min_inner_size(820.0, 560.0)
            .center()
            .decorations(false)
            .transparent(true)
            .resizable(true)
            .shadow(true)
            .visible(false)
            .build()
            .map_err(|error| error.to_string())?,
    };
    if window.is_minimized().unwrap_or(false) {
        window.unminimize().map_err(|error| error.to_string())?;
    }
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}
