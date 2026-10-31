use serde::{Deserialize, Serialize};
use std::{
    os::windows::process::CommandExt,
    process::Command,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const REFRESH_AFTER: Duration = Duration::from_secs(10 * 60);
const LIST_SCRIPT: &str = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct LauncherApp {
    #[serde(rename(deserialize = "Name", serialize = "name"))]
    name: String,
    #[serde(rename(deserialize = "AppID", serialize = "id"))]
    id: String,
}

struct Cache {
    apps: Vec<LauncherApp>,
    loaded_at: Option<Instant>,
    loading: bool,
}

static CACHE: Mutex<Cache> = Mutex::new(Cache { apps: Vec::new(), loaded_at: None, loading: false });

pub(crate) fn init() {
    refresh_in_background();
}

fn parse_apps(raw: &str) -> Vec<LauncherApp> {
    let raw = raw.trim().trim_start_matches('\u{feff}');
    let mut apps: Vec<LauncherApp> = if raw.starts_with('[') {
        serde_json::from_str(raw).unwrap_or_default()
    } else {
        serde_json::from_str::<LauncherApp>(raw).map(|app| vec![app]).unwrap_or_default()
    };
    apps.retain(|app| !app.name.trim().is_empty() && !app.id.trim().is_empty());
    apps.sort_by_key(|app| app.name.to_lowercase());
    apps.dedup_by(|a, b| a.name == b.name && a.id == b.id);
    apps
}

fn load() -> Vec<LauncherApp> {
    Command::new("powershell")
        .creation_flags(CREATE_NO_WINDOW)
        .args(["-NoProfile", "-NonInteractive", "-Command", LIST_SCRIPT])
        .output()
        .map(|output| parse_apps(&String::from_utf8_lossy(&output.stdout)))
        .unwrap_or_default()
}

fn refresh_in_background() {
    {
        let Ok(mut cache) = CACHE.lock() else { return };
        if cache.loading {
            return;
        }
        cache.loading = true;
    }
    thread::spawn(|| {
        let apps = load();
        if let Ok(mut cache) = CACHE.lock() {
            if !apps.is_empty() {
                cache.apps = apps;
                cache.loaded_at = Some(Instant::now());
            }
            cache.loading = false;
        }
    });
}

#[tauri::command]
pub(crate) fn launcher_apps() -> Vec<LauncherApp> {
    let (apps, stale) = match CACHE.lock() {
        Ok(cache) => (
            cache.apps.clone(),
            cache.loaded_at.map(|time| time.elapsed() > REFRESH_AFTER).unwrap_or(true),
        ),
        Err(_) => (Vec::new(), true),
    };
    if stale {
        refresh_in_background();
    }
    apps
}

#[tauri::command]
pub(crate) fn launcher_open(id: String) -> Result<(), String> {
    let known = CACHE
        .lock()
        .map(|cache| cache.apps.iter().any(|app| app.id == id))
        .unwrap_or(false);
    if !known {
        return Err("That app is not in the Start menu list.".to_string());
    }
    Command::new("explorer.exe")
        .arg(format!("shell:AppsFolder\\{id}"))
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open the app: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_apps_json_is_parsed_sorted_and_cleaned() {
        let raw = "\u{feff}[{\"Name\":\"Word\",\"AppID\":\"Microsoft.Office.WINWORD.EXE.15\"},{\"Name\":\"calculadora\",\"AppID\":\"Microsoft.WindowsCalculator_8wekyb3d8bbwe!App\"},{\"Name\":\"\",\"AppID\":\"x\"}]";
        let apps = parse_apps(raw);
        assert_eq!(apps.len(), 2);
        assert_eq!(apps[0].name, "calculadora");
    }

    #[test]
    fn a_single_app_is_not_an_array() {
        let apps = parse_apps("{\"Name\":\"Paint\",\"AppID\":\"Microsoft.Paint_8wekyb3d8bbwe!App\"}");
        assert_eq!(apps.len(), 1);
        assert!(parse_apps("garbage").is_empty());
    }
}
