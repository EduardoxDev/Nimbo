import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import { Row, Section, Toggle } from "../settings/controls";
import type { IslandSettings } from "../App";
import { pinHashOf, validPin } from "./alexa";

type AlexaCode = { code: string; expiresAt: number };

export function AlexaSettings({ settings, update }: { settings: IslandSettings; update: (patch: Partial<IslandSettings>) => void }) {
  const copy = useTranslation().alexa;
  const [code, setCode] = useState<AlexaCode | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!code) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [code]);

  const left = code ? Math.max(0, Math.round((code.expiresAt - now) / 1000)) : 0;
  const expired = Boolean(code) && left === 0;

  const connect = () => {
    if (!isTauri()) return;
    setBusy(true);
    setError("");
    void invoke<AlexaCode>("relay_alexa_code")
      .then((next) => {
        setCode(next);
        setNow(Date.now());
        update({ alexaLinked: true });
      })
      .catch((failure) => setError(String(failure)))
      .finally(() => setBusy(false));
  };

  const savePin = () => {
    if (!validPin(pin)) {
      setError(copy.pinInvalid);
      return;
    }
    setError("");
    void pinHashOf(pin).then((alexaPinHash) => {
      update({ alexaPinHash });
      setPin("");
    });
  };

  return (
    <Section title={copy.title}>
      <Row title={copy.connect} hint={copy.connectHint}>
        <button className="prefs-button" type="button" disabled={busy} onClick={connect}>
          {code && !expired ? copy.newCode : copy.connect}
        </button>
      </Row>
      {code && !expired && (
        <div className="prefs-alexa__code" role="status">
          <strong aria-label={code.code.split("").join(" ")}>{`${code.code.slice(0, 3)} ${code.code.slice(3)}`}</strong>
          <span>{copy.say(code.code.slice(0, 3), code.code.slice(3))}</span>
          <small>{copy.expiresIn(Math.floor(left / 60), left % 60)}</small>
        </div>
      )}
      {expired && <p className="prefs-auto__hint">{copy.expired}</p>}
      <Row title={copy.approve} hint={copy.approveHint}>
        <Toggle label={copy.approve} checked={Boolean(settings.alexaPinHash)} onChange={(enabled) => (enabled ? setError(copy.pinFirst) : update({ alexaPinHash: "" }))} />
      </Row>
      {!settings.alexaPinHash && (
        <div className="prefs-auto__new">
          <input
            value={pin}
            inputMode="numeric"
            type="password"
            maxLength={6}
            placeholder={copy.pinPlaceholder}
            aria-label={copy.pinPlaceholder}
            onChange={(event) => setPin(event.currentTarget.value.replace(/\D/g, ""))}
            onKeyDown={(event) => {
              if (event.key === "Enter") savePin();
            }}
          />
          <button className="prefs-button" type="button" disabled={pin.length < 4} onClick={savePin}>
            {copy.pinSave}
          </button>
        </div>
      )}
      {error && (
        <p className="prefs-auto__hint prefs-alexa__error" role="alert">
          {error}
        </p>
      )}
      <p className="prefs-auto__hint">{copy.privacy}</p>
    </Section>
  );
}
