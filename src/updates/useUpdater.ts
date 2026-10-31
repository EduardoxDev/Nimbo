import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";

const DISMISSED_KEY = "nimbo-update-dismissed";
const FIRST_CHECK_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UpdaterState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "latest" }
  | { status: "available"; version: string }
  | { status: "downloading"; version: string; percent: number | null }
  | { status: "error" };

export function downloadPercent(downloaded: number, total: number | null): number | null {
  if (!total || total <= 0) return null;
  return Math.min(100, Math.round((downloaded / total) * 100));
}

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(version: string) {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    return;
  }
}

export function useUpdater({ background }: { background: boolean }) {
  const updateRef = useRef<Update | null>(null);
  const [state, setState] = useState<UpdaterState>({ status: "idle" });
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);

  const checkNow = useCallback(async (quiet = false) => {
    if (!isTauri()) return;
    if (!quiet) setState({ status: "checking" });
    try {
      const update = await check();
      updateRef.current = update;
      if (update) {
        setState({ status: "available", version: update.version });
      } else if (!quiet) {
        setState({ status: "latest" });
      }
    } catch (error) {
      console.error("Failed to check for updates", error);
      if (!quiet) setState({ status: "error" });
    }
  }, []);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    let downloaded = 0;
    let total: number | null = null;
    setState({ status: "downloading", version: update.version, percent: 0 });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? null;
        if (event.event === "Progress") downloaded += event.data.chunkLength;
        setState({ status: "downloading", version: update.version, percent: downloadPercent(downloaded, total) });
      });
    } catch (error) {
      console.error("Failed to install the update", error);
      setState({ status: "error" });
    }
  }, []);

  const dismiss = useCallback(() => {
    if (state.status !== "available") return;
    writeDismissed(state.version);
    setDismissed(state.version);
  }, [state]);

  useEffect(() => {
    if (!background || !isTauri()) return;
    const first = window.setTimeout(() => void checkNow(true), FIRST_CHECK_DELAY_MS);
    const every = window.setInterval(() => void checkNow(true), CHECK_INTERVAL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, [background, checkNow]);

  const showNotice =
    state.status === "downloading" || (state.status === "available" && state.version !== dismissed);

  return { state, showNotice, checkNow, install, dismiss };
}
