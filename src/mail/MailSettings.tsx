import { useEffect, useState, type FormEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "../i18n";
import { Row, Section, Toggle } from "../settings/controls";
import { loadMailConfig, MAIL_CHANGED_KEY, saveMailConfig } from "./mail";

type GoogleStatus = { connected: boolean; email: string | null; hasClient: boolean; redirectUri: string };

const CONSOLE = "https://console.cloud.google.com/apis/credentials";

/** Settings → Calendar: connect Gmail (read-only) to get important mail on the island. */
export function MailSettings() {
  const copy = useTranslation().mail;
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [config, setConfig] = useState(() => loadMailConfig());

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<GoogleStatus>("google_status").then(setStatus).catch((error) => setMessage(String(error)));
  }, []);

  const changed = () => {
    try {
      window.localStorage.setItem(MAIL_CHANGED_KEY, String(Date.now()));
    } catch {
      // The island picks it up on its next look.
    }
  };
  const connect = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(copy.waiting);
    try {
      setStatus(await invoke<GoogleStatus>("google_connect", { clientId, clientSecret: secret }));
      setSecret("");
      setMessage(null);
      changed();
    } catch (error) {
      const text = String(error);
      setMessage(text.includes("INVALID_CLIENT_ID") ? copy.badId : text.includes("INVALID_CLIENT_SECRET") ? copy.badSecret : text.includes("SIGN_IN_TIMEOUT") ? copy.timeout : text);
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    await invoke("google_disconnect").catch(() => {});
    setStatus((current) => (current ? { ...current, connected: false, email: null, hasClient: false } : current));
    changed();
  };

  return (
    <Section title={copy.title}>
      <p className="prefs-card__hint">{copy.hint}</p>
      {status?.connected ? (
        <>
          <Row title={copy.connected} hint={status.email ?? undefined}>
            <button className="prefs-button prefs-button--quiet" type="button" onClick={() => void disconnect()}>
              {copy.disconnect}
            </button>
          </Row>
          <Row title={copy.onlyImportant} hint={copy.onlyImportantHint}>
            <Toggle
              label={copy.onlyImportant}
              checked={config.onlyImportant}
              onChange={(onlyImportant) => {
                setConfig({ onlyImportant });
                saveMailConfig({ onlyImportant });
              }}
            />
          </Row>
        </>
      ) : (
        <form className="prefs-form" onSubmit={(event) => void connect(event)}>
          <ol className="prefs-steps">
            {copy.steps.map((step, index) => (
              <li key={index}>{index === 4 ? step(status?.redirectUri ?? "http://127.0.0.1:43828/callback") : step("")}</li>
            ))}
          </ol>
          <div className="prefs-form__actions">
            <button className="prefs-button prefs-button--quiet" type="button" onClick={() => void openUrl(CONSOLE).catch(() => {})}>
              {copy.openConsole}
            </button>
          </div>
          <label className="prefs-field">
            <span>{copy.clientId}</span>
            <input value={clientId} spellCheck={false} autoComplete="off" placeholder="123…apps.googleusercontent.com" onChange={(event) => setClientId(event.currentTarget.value)} required />
          </label>
          <label className="prefs-field">
            <span>{copy.clientSecret}</span>
            <input type="password" value={secret} spellCheck={false} autoComplete="off" onChange={(event) => setSecret(event.currentTarget.value)} required />
          </label>
          <div className="prefs-form__actions">
            <button className="prefs-button" type="submit" disabled={busy || !clientId.trim() || !secret.trim()}>
              {busy ? copy.connecting : copy.connect}
            </button>
          </div>
        </form>
      )}
      {message && <p className="prefs-auto__hint">{message}</p>}
    </Section>
  );
}
