import { isTauri } from "@tauri-apps/api/core";
import type { LauncherApp } from "../launcher/launcher";

export const LAUNCHER_DEMO =
  import.meta.env.DEV &&
  !isTauri() &&
  new URLSearchParams(window.location.search).get("demo") === "launcher";

const DEMO_NAMES = [
  "Calculadora",
  "Configurações",
  "Discord",
  "Excel",
  "Explorador de Arquivos",
  "Google Chrome",
  "Notion",
  "Paint",
  "Spotify",
  "Steam",
  "Terminal",
  "Visual Studio Code",
  "WhatsApp",
  "Word",
];

export const LAUNCHER_DEMO_APPS: LauncherApp[] = LAUNCHER_DEMO ? DEMO_NAMES.map((name) => ({ name, id: name })) : [];
