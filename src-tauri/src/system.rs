use serde::Serialize;
use std::{collections::HashMap, path::Path, sync::Mutex};
use windows::{
    core::{Interface, PWSTR},
    Devices::Radios::{Radio, RadioKind, RadioState},
    Win32::{
        Foundation::{CloseHandle, FILETIME, LPARAM, WPARAM},
        Media::Audio::{
            eConsole, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
            ISimpleAudioVolume, MMDeviceEnumerator,
        },
        System::{
            Com::{CoCreateInstance, CLSCTX_ALL},
            Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS},
            Registry::{RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_DWORD, RRF_RT_REG_DWORD},
            SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX},
            Threading::{GetSystemTimes, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION},
        },
        UI::WindowsAndMessaging::{SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE},
    },
};

const PERSONALIZE_KEY: windows::core::PCWSTR =
    windows::core::w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize");
const MAX_APP_SESSIONS: usize = 8;

static LAST_CPU_TIMES: Mutex<Option<(u64, u64)>> = Mutex::new(None);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SystemStats {
    cpu: Option<f64>,
    memory: f64,
    memory_used_gb: f64,
    memory_total_gb: f64,
    battery: Option<u8>,
    charging: bool,
    has_battery: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Toggles {
    wifi: Option<bool>,
    bluetooth: Option<bool>,
    dark_mode: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppVolume {
    pid: u32,
    name: String,
    volume: f32,
    muted: bool,
}

fn ticks(time: FILETIME) -> u64 {
    (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)
}

pub(crate) fn cpu_usage(previous: Option<(u64, u64)>, idle: u64, total: u64) -> Option<f64> {
    let (previous_idle, previous_total) = previous?;
    let total_delta = total.checked_sub(previous_total)?;
    let idle_delta = idle.checked_sub(previous_idle)?;
    if total_delta == 0 {
        return None;
    }
    Some((1.0 - idle_delta as f64 / total_delta as f64).clamp(0.0, 1.0) * 100.0)
}

#[tauri::command]
pub(crate) fn system_stats() -> Result<SystemStats, String> {
    let (mut idle, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
    unsafe { GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)) }.map_err(|error| error.to_string())?;
    let idle = ticks(idle);
    let total = ticks(kernel) + ticks(user);
    let cpu = {
        let mut last = LAST_CPU_TIMES.lock().map_err(|error| error.to_string())?;
        let usage = cpu_usage(*last, idle, total);
        *last = Some((idle, total));
        usage
    };

    let mut memory = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
    unsafe { GlobalMemoryStatusEx(&mut memory) }.map_err(|error| error.to_string())?;
    let gib = 1024.0 * 1024.0 * 1024.0;
    let total_gb = memory.ullTotalPhys as f64 / gib;
    let used_gb = (memory.ullTotalPhys - memory.ullAvailPhys) as f64 / gib;

    let mut power = SYSTEM_POWER_STATUS::default();
    let power_ok = unsafe { GetSystemPowerStatus(&mut power) }.is_ok();
    let has_battery = power_ok && power.BatteryFlag != 128 && power.BatteryFlag != 255;

    Ok(SystemStats {
        cpu,
        memory: f64::from(memory.dwMemoryLoad),
        memory_used_gb: (used_gb * 10.0).round() / 10.0,
        memory_total_gb: (total_gb * 10.0).round() / 10.0,
        battery: (has_battery && power.BatteryLifePercent <= 100).then_some(power.BatteryLifePercent),
        charging: has_battery && power.ACLineStatus == 1,
        has_battery,
    })
}

fn radios() -> Vec<Radio> {
    Radio::GetRadiosAsync()
        .ok()
        .and_then(|operation| pollster::block_on(operation).ok())
        .map(|list| list.into_iter().collect())
        .unwrap_or_default()
}

fn radio_state(radios: &[Radio], kind: RadioKind) -> Option<bool> {
    radios
        .iter()
        .find(|radio| radio.Kind().ok() == Some(kind))
        .and_then(|radio| radio.State().ok())
        .map(|state| state == RadioState::On)
}

fn dark_mode_enabled() -> bool {
    let mut value = 1u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    let result = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            PERSONALIZE_KEY,
            windows::core::w!("AppsUseLightTheme"),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut value as *mut u32 as *mut _),
            Some(&mut size),
        )
    };
    result.is_ok() && value == 0
}

#[tauri::command]
pub(crate) async fn system_toggles() -> Result<Toggles, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let list = radios();
        Toggles {
            wifi: radio_state(&list, RadioKind::WiFi),
            bluetooth: radio_state(&list, RadioKind::Bluetooth),
            dark_mode: dark_mode_enabled(),
        }
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn system_set_radio(kind: String, enabled: bool) -> Result<(), String> {
    let kind = match kind.as_str() {
        "wifi" => RadioKind::WiFi,
        "bluetooth" => RadioKind::Bluetooth,
        _ => return Err("Unknown radio.".to_string()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let list = radios();
        let radio = list
            .iter()
            .find(|radio| radio.Kind().ok() == Some(kind))
            .ok_or_else(|| "This PC has no such radio.".to_string())?;
        let state = if enabled { RadioState::On } else { RadioState::Off };
        let operation = radio.SetStateAsync(state).map_err(|error| error.to_string())?;
        pollster::block_on(operation).map(|_| ()).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) fn system_set_dark_mode(enabled: bool) -> Result<(), String> {
    let value: u32 = if enabled { 0 } else { 1 };
    for name in [windows::core::w!("AppsUseLightTheme"), windows::core::w!("SystemUsesLightTheme")] {
        let status = unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                PERSONALIZE_KEY,
                name,
                REG_DWORD.0,
                Some(&value as *const u32 as *const _),
                std::mem::size_of::<u32>() as u32,
            )
        };
        if status.is_err() {
            return Err("Could not change the Windows theme.".to_string());
        }
    }
    let topic: Vec<u16> = "ImmersiveColorSet\0".encode_utf16().collect();
    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            WPARAM(0),
            LPARAM(topic.as_ptr() as isize),
            SMTO_ABORTIFHUNG,
            200,
            None,
        )
    };
    Ok(())
}

fn process_name(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; 520];
        let mut size = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut size);
        let _ = CloseHandle(handle);
        result.ok()?;
        let path = String::from_utf16_lossy(&buffer[..size as usize]);
        Path::new(&path).file_stem().map(|stem| stem.to_string_lossy().to_string())
    }
}

fn friendly(name: &str) -> String {
    let known: HashMap<&str, &str> = [
        ("chrome", "Chrome"),
        ("msedge", "Edge"),
        ("firefox", "Firefox"),
        ("spotify", "Spotify"),
        ("discord", "Discord"),
        ("discordcanary", "Discord"),
        ("whatsapp", "WhatsApp"),
        ("steam", "Steam"),
        ("teams", "Teams"),
        ("ms-teams", "Teams"),
        ("vlc", "VLC"),
    ]
    .into_iter()
    .collect();
    known
        .get(name.to_lowercase().as_str())
        .map(|value| value.to_string())
        .unwrap_or_else(|| {
            let mut chars = name.chars();
            chars.next().map(|first| first.to_uppercase().collect::<String>() + chars.as_str()).unwrap_or_default()
        })
}

fn sessions() -> Result<Vec<(u32, ISimpleAudioVolume)>, String> {
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|error| error.to_string())?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).map_err(|error| error.to_string())?;
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None).map_err(|error| error.to_string())?;
        let list = manager.GetSessionEnumerator().map_err(|error| error.to_string())?;
        let count = list.GetCount().map_err(|error| error.to_string())?;
        let mut found = Vec::new();
        for index in 0..count {
            let Ok(control) = list.GetSession(index) else { continue };
            let Ok(control2) = control.cast::<IAudioSessionControl2>() else { continue };
            let Ok(pid) = control2.GetProcessId() else { continue };
            if pid == 0 || pid == std::process::id() {
                continue;
            }
            if let Ok(volume) = control.cast::<ISimpleAudioVolume>() {
                found.push((pid, volume));
            }
        }
        Ok(found)
    }
}

#[tauri::command]
pub(crate) async fn system_app_volumes() -> Result<Vec<AppVolume>, String> {
    crate::media_control::media_task(|| {
        let mut apps: Vec<AppVolume> = Vec::new();
        for (pid, volume) in sessions()? {
            let Some(name) = process_name(pid) else { continue };
            let level = unsafe { volume.GetMasterVolume() }.unwrap_or(1.0);
            let muted = unsafe { volume.GetMute() }.map(|value| value.as_bool()).unwrap_or(false);
            let name = friendly(&name);
            if apps.iter().any(|app| app.name == name) {
                continue;
            }
            apps.push(AppVolume { pid, name, volume: level, muted });
        }
        apps.truncate(MAX_APP_SESSIONS);
        Ok(apps)
    })
    .await
}

#[tauri::command]
pub(crate) async fn system_set_app_volume(pid: u32, volume: f32, muted: bool) -> Result<(), String> {
    let volume = volume.clamp(0.0, 1.0);
    crate::media_control::media_task(move || {
        let targets: Vec<ISimpleAudioVolume> = sessions()?
            .into_iter()
            .filter(|(session_pid, _)| *session_pid == pid)
            .map(|(_, control)| control)
            .collect();
        if targets.is_empty() {
            return Err("That app is no longer playing sound.".to_string());
        }
        for control in targets {
            unsafe {
                control.SetMasterVolume(volume, std::ptr::null()).map_err(|error| error.to_string())?;
                control.SetMute(muted, std::ptr::null()).map_err(|error| error.to_string())?;
            }
        }
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_usage_needs_two_samples() {
        assert_eq!(cpu_usage(None, 10, 100), None);
        assert_eq!(cpu_usage(Some((10, 100)), 60, 200), Some(50.0));
        assert_eq!(cpu_usage(Some((10, 100)), 10, 100), None);
    }

    #[test]
    fn process_names_become_friendly() {
        assert_eq!(friendly("spotify"), "Spotify");
        assert_eq!(friendly("DiscordCanary"), "Discord");
        assert_eq!(friendly("obs64"), "Obs64");
    }
}
