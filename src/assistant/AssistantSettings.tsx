import { useEffect, useState, type FormEvent } from "react";
import { ExternalLink, Lock } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "../i18n";
import { Row, Section } from "../settings/controls";

const CONSOLE_KEYS_URL = "https://platform.claude.com/settings/keys";

/** Settings > AI agents > Island assistant: the user's own Anthropic API key. */
export function AssistantSettings() {
  const copy = useTranslation().prefs.assistant;
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isTauri()) {
      setHasKey(false);
      return;
    }
    invoke<boolean>("assistant_has_key").then(setHasKey).catch((reason) => setError(String(reason)));
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await invoke("assistant_save_key", { key });
      setKey("");
      setHasKey(true);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await invoke("assistant_delete_key");
      setHasKey(false);
    } catch (reason) {
      setError(String(reason));
    }
  };

  return (
    <Section title={copy.section}>
      <p className="prefs-card__hint">{copy.hint}</p>
      {hasKey ? (
        <Row title={copy.saved} hint={copy.model}>
          <button className="prefs-button prefs-button--quiet" type="button" onClick={() => void remove()}>
            {copy.remove}
          </button>
        </Row>
      ) : (
        <form className="prefs-form" onSubmit={(event) => void save(event)}>
          <label className="prefs-field">
            <span>{copy.key}</span>
            <input
              type="password"
              value={key}
              placeholder={copy.keyPlaceholder}
              autoComplete="off"
              spellCheck={false}
              required
              onChange={(event) => setKey(event.currentTarget.value)}
            />
            <small>
              {copy.getKey}{" "}
              <button
                className="prefs-inline-link"
                type="button"
                onClick={() => void openUrl(CONSOLE_KEYS_URL).catch(() => window.open(CONSOLE_KEYS_URL))}
              >
                platform.claude.com
                <ExternalLink size={11} strokeWidth={2.4} aria-hidden="true" />
              </button>
            </small>
          </label>
          <div className="prefs-form__actions">
            <button className="prefs-button" type="submit" disabled={!key.trim() || saving}>
              {copy.save}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="prefs-error" role="alert">
          {error}
        </p>
      )}
      <p className="prefs-card__hint prefs-card__hint--bottom prefs-card__hint--icon">
        <Lock size={12} strokeWidth={2.2} aria-hidden="true" />
        {copy.privacy}
      </p>
    </Section>
  );
}
