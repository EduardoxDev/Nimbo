import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import TranslationWindow from "./TranslationWindow";
import SettingsWindow from "./SettingsWindow";
import MascotGallery from "./demo/MascotGallery";
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
      ) : windowKind === "mascots" && import.meta.env.DEV ? (
        <MascotGallery />
      ) : (
        <App />
      )}
    </I18nProvider>
  </React.StrictMode>,
);
