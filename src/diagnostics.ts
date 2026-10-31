import { invoke, isTauri } from "@tauri-apps/api/core";

const MAX_PER_MINUTE = 30;

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function installDiagnostics() {
  if (!isTauri()) return;
  let windowStart = Date.now();
  let sent = 0;

  const send = (parts: unknown[]) => {
    const now = Date.now();
    if (now - windowStart > 60_000) {
      windowStart = now;
      sent = 0;
    }
    if (sent >= MAX_PER_MINUTE) return;
    sent += 1;
    const view = new URLSearchParams(window.location.search).get("window") ?? "island";
    void invoke("diagnostics_log", { message: `${view}: ${parts.map(describe).join(" ")}` }).catch(() => {});
  };

  const original = console.error.bind(console);
  console.error = (...parts: unknown[]) => {
    original(...parts);
    send(parts);
  };
  window.addEventListener("error", (event) => send([event.error ?? event.message]));
  window.addEventListener("unhandledrejection", (event) => send(["unhandled", event.reason]));
}
