//! Which apps are using the microphone or the camera right now, from the same
//! record Windows uses for its privacy icons. Nothing is recorded or listened to.

use serde::Serialize;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::System::Registry::{
    RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_READ, RRF_RT_REG_QWORD,
};

const STORE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore";

#[derive(Serialize, Debug, PartialEq)]
pub(crate) struct DeviceUser {
    /// Short name: the program ("Zoom") or the store app ("MSTeams").
    app: String,
    /// Since when, in milliseconds since 1970.
    since: u64,
}

#[derive(Serialize, Debug)]
pub(crate) struct DevicesInUse {
    microphone: Vec<DeviceUser>,
    camera: Vec<DeviceUser>,
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

fn subkeys(path: &str) -> Vec<String> {
    let mut names = Vec::new();
    unsafe {
        let mut key = HKEY::default();
        let path = wide(path);
        if RegOpenKeyExW(HKEY_CURRENT_USER, PCWSTR(path.as_ptr()), Some(0), KEY_READ, &mut key).is_err() {
            return names;
        }
        for index in 0.. {
            let mut buffer = [0u16; 512];
            let mut length = buffer.len() as u32;
            if RegEnumKeyExW(key, index, Some(PWSTR(buffer.as_mut_ptr())), &mut length, None, None, None, None).is_err() {
                break;
            }
            names.push(String::from_utf16_lossy(&buffer[..length as usize]));
        }
        let _ = RegCloseKey(key);
    }
    names
}

fn qword(path: &str, name: &str) -> Option<u64> {
    let mut value = 0u64;
    let mut size = std::mem::size_of::<u64>() as u32;
    let (path, name) = (wide(path), wide(name));
    let result = unsafe {
        RegGetValueW(HKEY_CURRENT_USER, PCWSTR(path.as_ptr()), PCWSTR(name.as_ptr()), RRF_RT_REG_QWORD, None, Some(&mut value as *mut u64 as *mut _), Some(&mut size))
    };
    result.is_ok().then_some(value)
}

/// "C:#Program Files#Zoom#bin#Zoom.exe" → "Zoom"; "MSTeams_8wekyb3d8bbwe" → "MSTeams".
pub(crate) fn short_name(key: &str) -> String {
    let last = key.rsplit('#').next().unwrap_or(key);
    let last = last.strip_suffix(".exe").or_else(|| last.strip_suffix(".EXE")).unwrap_or(last);
    let last = last.split('_').next().unwrap_or(last);
    // Store ids look like "5319275A.WhatsAppDesktop".
    last.rsplit('.').next().unwrap_or(last).to_string()
}

/// FILETIME (100 ns since 1601) to milliseconds since 1970.
fn unix_ms(filetime: u64) -> u64 {
    (filetime / 10_000).saturating_sub(11_644_473_600_000)
}

fn users_of(capability: &str) -> Vec<DeviceUser> {
    let base = format!(r"{STORE}\{capability}");
    let mut keys: Vec<String> = subkeys(&base).into_iter().filter(|name| name != "NonPackaged").map(|name| format!(r"{base}\{name}")).collect();
    let loose = format!(r"{base}\NonPackaged");
    keys.extend(subkeys(&loose).into_iter().map(|name| format!(r"{loose}\{name}")));
    let mut users: Vec<DeviceUser> = keys
        .iter()
        .filter_map(|key| {
            let start = qword(key, "LastUsedTimeStart")?;
            // While in use, Windows leaves the stop time at zero.
            (start > 0 && qword(key, "LastUsedTimeStop") == Some(0)).then(|| DeviceUser {
                app: short_name(key.rsplit('\\').next().unwrap_or(key)),
                since: unix_ms(start),
            })
        })
        .filter(|user| !user.app.eq_ignore_ascii_case("nimbo"))
        .collect();
    users.dedup_by(|a, b| a.app == b.app);
    users
}

#[tauri::command]
pub(crate) async fn devices_in_use() -> Result<DevicesInUse, String> {
    tauri::async_runtime::spawn_blocking(|| DevicesInUse { microphone: users_of("microphone"), camera: users_of("webcam") })
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_names_are_short() {
        assert_eq!(short_name("C:#Program Files#Zoom#bin#Zoom.exe"), "Zoom");
        assert_eq!(short_name("MSTeams_8wekyb3d8bbwe"), "MSTeams");
        assert_eq!(short_name("5319275A.WhatsAppDesktop_cv1g1gvanyjgm"), "WhatsAppDesktop");
        assert_eq!(short_name("C:#Program Files#Google#Chrome#Application#chrome.exe"), "chrome");
    }

    #[test]
    fn windows_times_become_unix() {
        assert_eq!(unix_ms(116_444_736_000_000_000), 0);
    }
}
