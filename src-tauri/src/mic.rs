//! "You're on mute!": the state of the default microphone (muted in Windows or
//! by the laptop's mute key, its volume and how loud it hears you), read only
//! while a call is on. Nothing is recorded: the meter is the same one the
//! Sound settings show.

use serde::Serialize;
use windows::Win32::{
    Media::Audio::{
        eCapture, eCommunications,
        Endpoints::{IAudioEndpointVolume, IAudioMeterInformation},
        IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
    },
    System::Com::{CoCreateInstance, CLSCTX_ALL},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MicState {
    muted: bool,
    /// 0..1, the Windows microphone level.
    volume: f32,
    /// 0..1, how loud the microphone hears you right now.
    peak: f32,
}

fn default_microphone() -> Result<IMMDevice, String> {
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|error| format!("Não consegui abrir o áudio do Windows: {error}"))?;
        enumerator
            .GetDefaultAudioEndpoint(eCapture, eCommunications)
            .map_err(|_| "Nenhum microfone encontrado.".to_string())
    }
}

#[tauri::command]
pub(crate) async fn mic_state() -> Result<MicState, String> {
    crate::media_control::media_task(|| unsafe {
        let device = default_microphone()?;
        let volume: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None).map_err(|error| error.to_string())?;
        let meter: Option<IAudioMeterInformation> = device.Activate(CLSCTX_ALL, None).ok();
        Ok(MicState {
            muted: volume.GetMute().map(|value| value.as_bool()).unwrap_or(false),
            volume: volume.GetMasterVolumeLevelScalar().unwrap_or(1.0),
            peak: meter.and_then(|meter| meter.GetPeakValue().ok()).unwrap_or(0.0),
        })
    })
    .await
}

/// Turns the microphone back on (and up, if it was all the way down).
#[tauri::command]
pub(crate) async fn mic_unmute() -> Result<(), String> {
    crate::media_control::media_task(|| unsafe {
        let device = default_microphone()?;
        let volume: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None).map_err(|error| error.to_string())?;
        volume.SetMute(false, std::ptr::null()).map_err(|error| error.to_string())?;
        if volume.GetMasterVolumeLevelScalar().unwrap_or(1.0) < 0.05 {
            volume.SetMasterVolumeLevelScalar(0.7, std::ptr::null()).map_err(|error| error.to_string())?;
        }
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    /// Needs a real microphone: `cargo test mic -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn reads_the_real_microphone() {
        let state = tauri::async_runtime::block_on(super::mic_state()).expect("microphone");
        println!("muted={} volume={} peak={}", state.muted, state.volume, state.peak);
        assert!((0.0..=1.0).contains(&state.volume));
    }
}
