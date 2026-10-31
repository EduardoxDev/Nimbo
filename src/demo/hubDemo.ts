import { isTauri } from "@tauri-apps/api/core";

export const HUB_DEMO =
  import.meta.env.DEV &&
  !isTauri() &&
  new URLSearchParams(window.location.search).get("demo") === "hub";
