import { useEffect, useState, type FormEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { IslandSettings } from "../App";
import { useTranslation } from "../i18n";
import { Row, Section, Stepper, Toggle } from "../settings/controls";
import { CALENDAR_CHANGED_KEY, type CalendarSource } from "./calendar";
import { loadAutopilot, saveAutopilot } from "../autopilot/autopilot";

function announceChange() {
  try {
    localStorage.setItem(CALENDAR_CHANGED_KEY, String(Date.now()));
  } catch {
    return;
  }
}

export function CalendarSettingsPage({
  settings,
  update,
}: {
  settings: IslandSettings;
  update: (patch: Partial<IslandSettings>) => void;
}) {
  const t = useTranslation();
  const copy = t.prefs.calendarPrefs;
  const appearance = t.prefs.appearance;
  const autopilotCopy = t.autopilot;
  const [autopilot, setAutopilot] = useState(() => loadAutopilot());
  const [sources, setSources] = useState<CalendarSource[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<CalendarSource[]>("calendar_sources")
      .then(setSources)
      .catch((failure) => setError(String(failure)));
  }, []);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!isTauri()) return;
    setBusy(true);
    setError("");
    try {
      setSources(await invoke<CalendarSource[]>("calendar_add_source", { name, url }));
      setName("");
      setUrl("");
      announceChange();
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (index: number) => {
    try {
      setSources(await invoke<CalendarSource[]>("calendar_remove_source", { index }));
      announceChange();
    } catch (failure) {
      setError(String(failure));
    }
  };

  return (
    <>
      <Section title={copy.section}>
        <Row title={copy.reminder}>
          <Stepper
            value={settings.calendarReminderMinutes}
            min={0}
            max={60}
            step={5}
            format={(value) => (value === 0 ? copy.off : `${value} min`)}
            decreaseLabel={`${appearance.decrease} ${copy.reminder}`}
            increaseLabel={`${appearance.increase} ${copy.reminder}`}
            onChange={(calendarReminderMinutes) => update({ calendarReminderMinutes })}
          />
        </Row>
        <Row title={copy.meetingMode} hint={copy.meetingHint}>
          <Toggle label={copy.meetingMode} checked={settings.meetingMode} onChange={(meetingMode) => update({ meetingMode })} />
        </Row>
        <Row title={autopilotCopy.title} hint={autopilotCopy.hint}>
          <Toggle
            label={autopilotCopy.title}
            checked={autopilot.meetings}
            onChange={(meetings) => {
              setAutopilot({ meetings });
              saveAutopilot({ meetings });
            }}
          />
        </Row>
        {sources.map((source, index) => (
          <Row key={`${source.name}-${index}`} title={source.name} hint={source.host}>
            <button className="prefs-button prefs-button--quiet" type="button" onClick={() => void remove(index)}>
              {copy.remove}
            </button>
          </Row>
        ))}
      </Section>
      <Section title={copy.add}>
        <form className="prefs-form" onSubmit={(event) => void add(event)}>
          <label className="prefs-field">
            <span>{copy.name}</span>
            <input
              type="text"
              value={name}
              maxLength={40}
              placeholder={copy.namePlaceholder}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <label className="prefs-field">
            <span>{copy.url}</span>
            <input
              type="password"
              value={url}
              placeholder={copy.urlPlaceholder}
              autoComplete="off"
              spellCheck={false}
              required
              onChange={(event) => setUrl(event.currentTarget.value)}
            />
            <small>{copy.urlHint}</small>
          </label>
          <div className="prefs-form__actions">
            <button className="prefs-button" type="submit" disabled={busy || !url.trim()}>
              {busy ? copy.adding : copy.add}
            </button>
          </div>
        </form>
        <p className="prefs-card__hint prefs-card__hint--bottom">{copy.hint}</p>
        {error && (
          <p className="prefs-error" role="alert">
            {error}
          </p>
        )}
      </Section>
    </>
  );
}
