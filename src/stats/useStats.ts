import { useSyncExternalStore } from "react";
import { addStat, parseStats, type StatKind, type StatsHistory } from "./stats";

const KEY = "nimbo-stats";
const listeners = new Set<() => void>();
let cache: StatsHistory | null = null;

function read(): StatsHistory {
  if (cache) return cache;
  try {
    cache = parseStats(window.localStorage.getItem(KEY));
  } catch {
    cache = {};
  }
  return cache;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    cache = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function recordStat(kind: StatKind) {
  cache = addStat(read(), kind, Date.now());
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Kept in memory for this run.
  }
  listeners.forEach((listener) => listener());
}

export function useStats() {
  return useSyncExternalStore(subscribe, read, read);
}
