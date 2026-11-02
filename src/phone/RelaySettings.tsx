import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "../i18n";
import { Row, Section, Toggle } from "../settings/controls";

type RelayInfo = { enabled: boolean; url: string; connected: boolean; pairLink: string | null; qrSvg: string | null; error: string | null };

/** Settings: the iPhone app, reaching this PC from anywhere through the user's own relay. */
export function RelaySettings() {
  const copy = useTranslation().phone;
  const [info, setInfo] = useState<RelayInfo | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isTauri()) return;
    let first = true;
    const load = () =>
      void invoke<RelayInfo>("relay_info")
        .then((next) => {
          setInfo(next);
          if (first) setUrl(next.url);
          first = false;
        })
        .catch(() => {});
    load();
    const interval = window.setInterval(load, 2_000);
    return () => window.clearInterval(interval);
  }, []);

  const configure = (enabled: boolean, address = url) => {
    setError("");
    void invoke<RelayInfo>("relay_configure", { url: address, enabled })
      .then(setInfo)
      .catch((failure) => setError(String(failure)));
  };

  const status = !info?.enabled || !info.url ? copy.relayOff : info.connected ? copy.relayConnected : info.error ?? copy.relayConnecting;

  return (
    <Section title={copy.relayTitle}>
      <Row title={copy.relayToggle} hint={copy.relayHint}>
        <Toggle label={copy.relayToggle} checked={info?.enabled ?? false} disabled={!url.trim()} onChange={(enabled) => configure(enabled)} />
      </Row>
      <div className="prefs-auto__new">
        <input
          value={url}
          placeholder="https://nimbo-relay.seu-nome.workers.dev"
          aria-label={copy.relayUrl}
          spellCheck={false}
          onChange={(event) => setUrl(event.currentTarget.value)}
          onBlur={() => {
            if (info && url.trim() !== info.url) configure(info.enabled, url);
          }}
        />
      </div>
      <p className="prefs-auto__hint">
        <span className={info?.connected ? "prefs-relay__on" : undefined}>● </span>
        {status}
      </p>
      {error && <p className="prefs-auto__hint">{error}</p>}
      {info?.enabled && info.qrSvg && (
        <div className="prefs-phone">
          <img className="prefs-phone__qr" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(info.qrSvg)}`} alt={copy.relayScan} />
          <div className="prefs-phone__side">
            <strong>{copy.relayScan}</strong>
            <span>{copy.relayScanHint}</span>
            <div className="prefs-phone__actions">
              <button type="button" className="prefs-button prefs-button--quiet" onClick={() => void invoke<RelayInfo>("relay_new_room").then(setInfo)}>
                <RefreshCw size={13} strokeWidth={2.4} /> {copy.newCode}
              </button>
            </div>
            <small>{copy.relayPrivacy}</small>
          </div>
        </div>
      )}
    </Section>
  );
}
