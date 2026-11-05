import React, { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import ReactDOM from "react-dom/client";
import "./base.css";
import "./design/tokens.css";
import { I18nProvider } from "./i18n";
import { installDiagnostics } from "./diagnostics";

installDiagnostics();

window.addEventListener(
  "pointerdown",
  () => {
    document.documentElement.dataset.inputModality = "pointer";
  },
  true,
);

window.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Tab") {
      document.documentElement.dataset.inputModality = "keyboard";
    }
  },
  true,
);

const windowKind = new URLSearchParams(window.location.search).get("window");

// Each window downloads only its own code and styles: a small window no longer carries the whole island.
const windows: Record<string, () => Promise<{ default: ComponentType }>> = {
  translation: () => import("./TranslationWindow"),
  settings: () => import("./SettingsWindow"),
  buddy: () => import("./buddy/BuddyWindow"),
  draw: () => import("./draw/DrawWindow"),
  dock: () => import("./dock/DockWindow"),
  day: () => import("./day/DayWindow"),
  lens: () => import("./lens/LensWindow"),
  music: () => import("./music/MusicWindow"),
  automations: () => import("./automations/AutomationsWindow"),
  memory: () => import("./memory/MemoryWindow"),
};

function pickWindow(): LazyExoticComponent<ComponentType> {
  if (windowKind && windows[windowKind]) return lazy(windows[windowKind]);
  if (windowKind === "mascots" && import.meta.env.DEV) return lazy(() => import("./demo/MascotGallery"));
  return lazy(() => import("./App"));
}

const Window = pickWindow();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <Suspense fallback={null}>
        <Window />
      </Suspense>
    </I18nProvider>
  </React.StrictMode>,
);
