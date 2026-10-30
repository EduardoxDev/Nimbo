//! Watches the system volume and the built-in screen's brightness and tells the
//! island when they change, so it can show its own HUD.
//!
//! Polling keeps this simple and cheap: the volume is one COM call every
//! 120 ms; brightness goes through WMI every 700 ms and is skipped for good on
//! machines that do not expose it (most external monitors).

use serde::{Deserialize, Serialize};
use std::{
    sync::OnceLock,
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

const VOLUME_POLL: Duration = Duration::from_millis(120);
const BRIGHTNESS_EVERY: u32 = 6;
/// The default output can change (headphones plugged in); re-open it now and then.
const ENDPOINT_REFRESH: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct VolumeReading {
    level: f32,
    muted: bool,
}

#[derive(Deserialize)]
#[serde(rename = "WmiMonitorBrightness")]
#[serde(rename_all = "PascalCase")]
struct MonitorBrightness {
    current_brightness: u8,
}

static STARTED: OnceLock<()> = OnceLock::new();

/// A change worth showing: level moved by at least half a percent, or mute flipped.
fn volume_changed(previous: Option<VolumeReading>, next: VolumeReading) -> bool {
    match previous {
        None => false,
        Some(previous) => previous.muted != next.muted || (previous.level - next.level).abs() >= 0.005,
    }
}

fn read_volume(endpoint: &windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume) -> Option<VolumeReading> {
    unsafe {
        Some(VolumeReading {
            level: endpoint.GetMasterVolumeLevelScalar().ok()?,
            muted: endpoint.GetMute().ok()?.as_bool(),
        })
    }
}

fn watch(app: AppHandle) {
    // COM for this thread; WMI needs it too and sets it up with the right security.
    let com = wmi::COMLibrary::new().ok();
    let brightness = com.and_then(|com| wmi::WMIConnection::with_namespace_path("root\\WMI", com).ok());
    let mut brightness = brightness;

    let mut endpoint = crate::media_control::default_endpoint_volume().ok();
    let mut opened_at = Instant::now();
    let mut last_volume: Option<VolumeReading> = None;
    let mut last_brightness: Option<u8> = None;
    let mut tick: u32 = 0;

    loop {
        thread::sleep(VOLUME_POLL);
        tick = tick.wrapping_add(1);

        if endpoint.is_none() || opened_at.elapsed() > ENDPOINT_REFRESH {
            endpoint = crate::media_control::default_endpoint_volume().ok();
            opened_at = Instant::now();
        }
        if let Some(reading) = endpoint.as_ref().and_then(read_volume) {
            if volume_changed(last_volume, reading) {
                let _ = app.emit("hud-volume", reading);
            }
            last_volume = Some(reading);
        } else {
            endpoint = None;
        }

        if tick % BRIGHTNESS_EVERY == 0 {
            if let Some(connection) = brightness.as_ref() {
                match connection.query::<MonitorBrightness>() {
                    Ok(readings) => match readings.first().map(|reading| reading.current_brightness) {
                        Some(level) => {
                            if last_brightness.is_some_and(|previous| previous != level) {
                                let _ = app.emit("hud-brightness", serde_json::json!({ "level": f32::from(level) / 100.0 }));
                            }
                            last_brightness = Some(level);
                        }
                        // No built-in panel: stop asking.
                        None => brightness = None,
                    },
                    Err(_) => brightness = None,
                }
            }
        }
    }
}

/// Starts the watcher once, at app start.
pub(crate) fn init(app: &AppHandle) {
    if STARTED.set(()).is_ok() {
        let app = app.clone();
        thread::Builder::new()
            .name("nimbo-hud".into())
            .spawn(move || watch(app))
            .ok();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_real_changes_trigger_the_hud() {
        let base = VolumeReading { level: 0.5, muted: false };
        assert!(!volume_changed(None, base));
        assert!(!volume_changed(Some(base), VolumeReading { level: 0.502, muted: false }));
        assert!(volume_changed(Some(base), VolumeReading { level: 0.52, muted: false }));
        assert!(volume_changed(Some(base), VolumeReading { level: 0.5, muted: true }));
    }
}
