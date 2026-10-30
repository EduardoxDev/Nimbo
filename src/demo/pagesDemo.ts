import { isTauri } from "@tauri-apps/api/core";

/**
 * Design preview for the Tasks, Clipboard and Tweaks pages: open the Vite dev
 * server with `?demo=pages`. Never active in the desktop app or in builds.
 */
export const PAGES_DEMO =
  import.meta.env.DEV &&
  !isTauri() &&
  new URLSearchParams(window.location.search).get("demo") === "pages";

const minutesAgo = (minutes: number) => Date.now() - minutes * 60_000;

export const DEMO_CLIPBOARD_ITEMS = [
  { id: "c1", kind: "text" as const, hash: "c1", createdAt: minutesAgo(2), copiedAt: minutesAgo(2), preview: "https://github.com/EduardoxDev/Nimbo", text: "https://github.com/EduardoxDev/Nimbo", favorite: true, note: "Repositório" },
  { id: "c2", kind: "text" as const, hash: "c2", createdAt: minutesAgo(9), copiedAt: minutesAgo(9), preview: "Reunião com o time às 15h — levar o plano da Casa", text: "Reunião com o time às 15h — levar o plano da Casa" },
  { id: "c3", kind: "text" as const, hash: "c3", createdAt: minutesAgo(26), copiedAt: minutesAgo(26), preview: "npm run tauri dev", text: "npm run tauri dev" },
  { id: "c4", kind: "text" as const, hash: "c4", createdAt: minutesAgo(64), copiedAt: minutesAgo(64), preview: "Broadlink RM4 Mini — emissor infravermelho Wi-Fi", text: "Broadlink RM4 Mini — emissor infravermelho Wi-Fi" },
];
