/**
 * Calls and privacy from which apps are using the microphone and camera
 * (`devices_in_use` in Rust). Nothing is listened to or recorded.
 */

export type DeviceUser = { app: string; since: number };
export type DevicesInUse = { microphone: DeviceUser[]; camera: DeviceUser[] };
export type LiveCall = { id: string; app: string; since: number };

const NAMES: Record<string, string> = {
  msteams: "Teams",
  teams: "Teams",
  "ms-teams": "Teams",
  zoom: "Zoom",
  cpthost: "Zoom",
  chrome: "Chrome",
  msedge: "Edge",
  firefox: "Firefox",
  brave: "Brave",
  opera: "Opera",
  discord: "Discord",
  discordcanary: "Discord",
  slack: "Slack",
  whatsappdesktop: "WhatsApp",
  whatsapp: "WhatsApp",
  skype: "Skype",
  webex: "Webex",
  ciscocollabhost: "Webex",
  telegram: "Telegram",
  obs64: "OBS",
  windowscamera: "Câmera",
  windowssoundrecorder: "Gravador de Som",
};

/** Apps where the microphone on means a call or meeting. */
const CALL_APPS = new Set(["Teams", "Zoom", "Chrome", "Edge", "Firefox", "Brave", "Opera", "Discord", "Slack", "WhatsApp", "Skype", "Webex", "Telegram"]);

export function prettyDevice(app: string) {
  return NAMES[app.toLowerCase()] ?? app;
}

/** A call is the microphone in use by a calling app, or by any app that also has the camera. */
export function liveCallOf(devices: DevicesInUse): LiveCall | null {
  const cameraApps = new Set(devices.camera.map((user) => user.app.toLowerCase()));
  const user =
    devices.microphone.find((item) => CALL_APPS.has(prettyDevice(item.app))) ??
    devices.microphone.find((item) => cameraApps.has(item.app.toLowerCase()));
  if (!user) return null;
  return { id: `call-${user.app.toLowerCase()}-${user.since}`, app: prettyDevice(user.app), since: user.since };
}

export type DeviceStart = { device: "microphone" | "camera"; app: string };

/** Apps that started using the microphone or camera since the last look. */
export function newDeviceUsers(previous: DevicesInUse | null, current: DevicesInUse): DeviceStart[] {
  if (!previous) return [];
  const starts: DeviceStart[] = [];
  for (const device of ["camera", "microphone"] as const) {
    const before = new Set(previous[device].map((user) => user.app.toLowerCase()));
    for (const user of current[device]) {
      if (!before.has(user.app.toLowerCase())) starts.push({ device, app: prettyDevice(user.app) });
    }
  }
  return starts;
}

export function minutesSince(since: number, now: number) {
  return Math.max(0, Math.floor((now - since) / 60_000));
}
