//! What the PC's surroundings look like right now, for trigger rules:
//! the Wi-Fi network it is on and the audio output in use (headphones or not).

use serde::Serialize;
use std::{os::windows::process::CommandExt, process::Command};
use windows::{
    core::GUID,
    Win32::{
        Foundation::PROPERTYKEY,
        Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator},
        System::Com::{StructuredStorage::PropVariantToStringAlloc, CoCreateInstance, CoTaskMemFree, CLSCTX_ALL, STGM_READ},
    },
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// PKEY_Device_FriendlyName.
const FRIENDLY_NAME: PROPERTYKEY = PROPERTYKEY { fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0), pid: 14 };

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContextNow {
    ssid: Option<String>,
    audio_output: Option<String>,
}

/// The "SSID : name" line of `netsh wlan show interfaces` (not BSSID).
pub(crate) fn ssid_of(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        (key.trim() == "SSID").then(|| value.trim().to_string()).filter(|value| !value.is_empty())
    })
}

fn current_ssid() -> Option<String> {
    let output = Command::new("netsh.exe").args(["wlan", "show", "interfaces"]).creation_flags(CREATE_NO_WINDOW).output().ok()?;
    ssid_of(&String::from_utf8_lossy(&output.stdout))
}

fn audio_output() -> Option<String> {
    crate::media_control::run_on_media_thread(|| unsafe {
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|error| error.to_string())?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).map_err(|error| error.to_string())?;
        let store = device.OpenPropertyStore(STGM_READ).map_err(|error| error.to_string())?;
        let value = store.GetValue(&FRIENDLY_NAME).map_err(|error| error.to_string())?;
        let text = PropVariantToStringAlloc(&value).map_err(|error| error.to_string())?;
        let name = text.to_string().unwrap_or_default();
        CoTaskMemFree(Some(text.0 as *const _));
        Ok(name)
    })
    .ok()
    .filter(|name| !name.is_empty())
}

#[tauri::command]
pub(crate) async fn context_now() -> Result<ContextNow, String> {
    tauri::async_runtime::spawn_blocking(|| ContextNow { ssid: current_ssid(), audio_output: audio_output() }).await.map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_network_name_is_read() {
        let output = "    Nome                   : Wi-Fi\n    SSID                   : Casa 5G\n    BSSID                  : aa:bb:cc:dd:ee:ff\n";
        assert_eq!(ssid_of(output).as_deref(), Some("Casa 5G"));
        assert_eq!(ssid_of("    Estado : desconectado"), None);
    }
}
