import { useSyncExternalStore } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

type Battery = { level: number; charging: boolean } | null;

const REFRESH_MS = 60_000;
const listeners = new Set<() => void>();
let battery: Battery = null;
let timer = 0;

function refresh() {
  void invoke<{ battery: number | null; charging: boolean; hasBattery: boolean }>("system_stats")
    .then((stats) => {
      battery = stats.hasBattery && stats.battery !== null ? { level: stats.battery, charging: stats.charging } : null;
      listeners.forEach((listener) => listener());
    })
    .catch(() => {});
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1 && isTauri()) {
    refresh();
    timer = window.setInterval(refresh, REFRESH_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.clearInterval(timer);
  };
}

export function useBattery() {
  return useSyncExternalStore(subscribe, () => battery, () => battery);
}
