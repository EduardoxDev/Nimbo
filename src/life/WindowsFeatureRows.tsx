import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import { Row } from "../settings/controls";

type Features = { onlineSpeech: boolean; backgroundRecording: boolean };

export function WindowsFeatureRows() {
  const copy = useTranslation().life;
  const [features, setFeatures] = useState<Features | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    const load = () => void invoke<Features>("windows_features").then(setFeatures).catch(() => {});
    load();
    window.addEventListener("focus", load);
    const interval = window.setInterval(load, 5_000);
    return () => {
      window.removeEventListener("focus", load);
      window.clearInterval(interval);
    };
  }, []);

  const open = (page: "speech" | "captures") => {
    if (isTauri()) void invoke("open_windows_settings", { page }).catch(() => {});
  };

  const status = (on: boolean | undefined) => (
    <span className={`prefs-status${on ? " prefs-status--on" : ""}`}>{on === undefined ? "…" : on ? copy.on : copy.off}</span>
  );

  return (
    <>
      <Row title={copy.speechStatus} hint={copy.speechStatusHint}>
        <div className="prefs-inline">
          {status(features?.onlineSpeech)}
          <button className="prefs-button prefs-button--quiet" type="button" onClick={() => open("speech")}>
            {copy.openWindows}
          </button>
        </div>
      </Row>
      <Row title={copy.clipStatus} hint={copy.clipStatusHint}>
        <div className="prefs-inline">
          {status(features?.backgroundRecording)}
          <button className="prefs-button prefs-button--quiet" type="button" onClick={() => open("captures")}>
            {copy.openWindows}
          </button>
        </div>
      </Row>
    </>
  );
}
