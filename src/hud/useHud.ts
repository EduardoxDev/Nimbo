import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type HudState =
  | { kind: "volume"; level: number; muted: boolean }
  | { kind: "brightness"; level: number }
  | { kind: "track"; title: string; artist: string | null };

const SHOW_MS = { volume: 1600, brightness: 1600, track: 4000 };
const WHEEL_STEP = 0.04;
const WHEEL_THROTTLE_MS = 60;

export const HUD_DEMO =
  import.meta.env.DEV &&
  !isTauri() &&
  new URLSearchParams(window.location.search).get("demo") === "hud";

/**
 * What the closed island shows for a moment when the volume, the brightness
 * or the track changes. Each kind can be turned off in settings.
 */
export function useHud(options: {
  volume: boolean;
  brightness: boolean;
  track: boolean;
  trackTitle: string | null;
  trackArtist: string | null;
}) {
  const [hud, setHud] = useState<HudState | null>(
    HUD_DEMO ? { kind: "volume", level: 0.62, muted: false } : null,
  );
  const timerRef = useRef<number | undefined>(undefined);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const show = useCallback((next: HudState) => {
    setHud(next);
    window.clearTimeout(timerRef.current);
    if (!HUD_DEMO) timerRef.current = window.setTimeout(() => setHud(null), SHOW_MS[next.kind]);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const stops: (() => void)[] = [];
    let cancelled = false;
    const keep = (stop: () => void) => (cancelled ? stop() : stops.push(stop));
    void listen<{ level: number; muted: boolean }>("hud-volume", (event) => {
      if (optionsRef.current.volume) show({ kind: "volume", ...event.payload });
    }).then(keep);
    void listen<{ level: number }>("hud-brightness", (event) => {
      if (optionsRef.current.brightness) show({ kind: "brightness", level: event.payload.level });
    }).then(keep);
    return () => {
      cancelled = true;
      stops.forEach((stop) => stop());
      window.clearTimeout(timerRef.current);
    };
  }, [show]);

  // A new track (not the first one seen after launch) gets a short "now playing".
  const lastTrackRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const key = options.trackTitle ? `${options.trackTitle}␟${options.trackArtist ?? ""}` : null;
    const previous = lastTrackRef.current;
    lastTrackRef.current = key;
    if (previous === undefined || !key || key === previous || !optionsRef.current.track) return;
    show({ kind: "track", title: options.trackTitle ?? "", artist: options.trackArtist });
  }, [options.trackTitle, options.trackArtist, show]);

  // Scrolling over the closed island nudges the system volume.
  const lastWheelRef = useRef(0);
  const nudgeVolume = useCallback(async (direction: 1 | -1) => {
    const now = Date.now();
    if (now - lastWheelRef.current < WHEEL_THROTTLE_MS || !isTauri()) return;
    lastWheelRef.current = now;
    try {
      const current = await invoke<{ level: number; muted: boolean }>("get_system_volume");
      const level = Math.min(1, Math.max(0, Math.round((current.level + direction * WHEEL_STEP) * 100) / 100));
      await invoke("set_system_volume", { level, muted: false });
    } catch (error) {
      console.error("Failed to change the volume", error);
    }
  }, []);

  return { hud, nudgeVolume };
}
