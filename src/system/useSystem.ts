import { useCallback, useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { SYSTEM_DEMO, SYSTEM_DEMO_APPS, SYSTEM_DEMO_STATS } from "../demo/systemDemo";

export type SystemStats = {
  cpu: number | null;
  memory: number;
  memoryUsedGb: number;
  memoryTotalGb: number;
  battery: number | null;
  charging: boolean;
  hasBattery: boolean;
};
export type SystemToggles = { wifi: boolean | null; bluetooth: boolean | null; darkMode: boolean };
export type AppVolume = { pid: number; name: string; volume: number; muted: boolean };

const STATS_MS = 2_000;
const SLOW_MS = 10_000;

export function useSystem(active: boolean) {
  const [stats, setStats] = useState<SystemStats | null>(SYSTEM_DEMO ? SYSTEM_DEMO_STATS : null);
  const [toggles, setToggles] = useState<SystemToggles | null>(
    SYSTEM_DEMO ? { wifi: true, bluetooth: false, darkMode: true } : null,
  );
  const [apps, setApps] = useState<AppVolume[]>(SYSTEM_DEMO ? SYSTEM_DEMO_APPS : []);
  const [error, setError] = useState("");

  const refreshSlow = useCallback(() => {
    void invoke<SystemToggles>("system_toggles").then(setToggles).catch(() => {});
    void invoke<AppVolume[]>("system_app_volumes").then(setApps).catch(() => {});
  }, []);

  useEffect(() => {
    if (!active || !isTauri()) return;
    const readStats = () => void invoke<SystemStats>("system_stats").then(setStats).catch(() => {});
    readStats();
    refreshSlow();
    const fast = window.setInterval(readStats, STATS_MS);
    const slow = window.setInterval(refreshSlow, SLOW_MS);
    return () => {
      window.clearInterval(fast);
      window.clearInterval(slow);
    };
  }, [active, refreshSlow]);

  const run = useCallback(
    (command: string, args: Record<string, unknown>, optimistic: () => void) => {
      optimistic();
      setError("");
      if (!isTauri()) return;
      void invoke(command, args)
        .catch((failure) => setError(String(failure)))
        .finally(refreshSlow);
    },
    [refreshSlow],
  );

  const setRadio = (kind: "wifi" | "bluetooth", enabled: boolean) =>
    run("system_set_radio", { kind, enabled }, () =>
      setToggles((current) => (current ? { ...current, [kind]: enabled } : current)),
    );

  const setDarkMode = (enabled: boolean) =>
    run("system_set_dark_mode", { enabled }, () =>
      setToggles((current) => (current ? { ...current, darkMode: enabled } : current)),
    );

  const setAppVolume = (app: AppVolume, volume: number, muted: boolean) => {
    setApps((current) => current.map((item) => (item.pid === app.pid ? { ...item, volume, muted } : item)));
    if (!isTauri()) return;
    void invoke("system_set_app_volume", { pid: app.pid, volume, muted }).catch((failure) => setError(String(failure)));
  };

  return { stats, toggles, apps, error, setRadio, setDarkMode, setAppVolume };
}

export type SystemState = ReturnType<typeof useSystem>;
export { SLOW_MS };
