import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import TranslationWindow from "./TranslationWindow";
import SettingsWindow from "./SettingsWindow";
import BuddyWindow from "./buddy/BuddyWindow";
import DrawWindow from "./draw/DrawWindow";
import DockWindow from "./dock/DockWindow";
import LensWindow from "./lens/LensWindow";
import DayWindow from "./day/DayWindow";
import MusicWindow from "./music/MusicWindow";
import AutomationsWindow from "./automations/AutomationsWindow";
import MascotGallery from "./demo/MascotGallery";
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      {windowKind === "translation" ? (
        <TranslationWindow />
      ) : windowKind === "settings" ? (
        <SettingsWindow />
      ) : windowKind === "buddy" ? (
        <BuddyWindow />
      ) : windowKind === "draw" ? (
        <DrawWindow />
      ) : windowKind === "dock" ? (
        <DockWindow />
      ) : windowKind === "day" ? (
        <DayWindow />
      ) : windowKind === "lens" ? (
        <LensWindow />
      ) : windowKind === "music" ? (
        <MusicWindow />
      ) : windowKind === "automations" ? (
        <AutomationsWindow />
      ) : windowKind === "mascots" && import.meta.env.DEV ? (
        <MascotGallery />
      ) : (
        <App />
      )}
    </I18nProvider>
  </React.StrictMode>,
);
