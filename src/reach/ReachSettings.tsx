import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import { Row, Section, Segmented, Toggle } from "../settings/controls";
import { AWAY_CHOICES, loadReach, saveReach, spokenText, type ReachConfig, type ReachKind } from "./reach";

type Target = { entityId: string; name: string };
type Targets = { speakers: Target[]; lights: Target[]; canSpeak: boolean };

/** Settings → Home: where Nimbo calls you when you are away from the PC. */
export function ReachSettings() {
  const copy = useTranslation().reach;
  const [config, setConfig] = useState<ReachConfig>(() => loadReach());
  const [targets, setTargets] = useState<Targets | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<Targets>("home_assistant_reach_targets")
      .then(setTargets)
      .catch((error) => setMessage(String(error)));
  }, []);

  const update = (next: Partial<ReachConfig>) => {
    const merged = { ...config, ...next };
    setConfig(merged);
    saveReach(merged);
  };
  const toggleKind = (kind: ReachKind, on: boolean) => update({ kinds: { ...config.kinds, [kind]: on } });
  const test = async () => {
    setMessage(null);
    try {
      if (config.light) await invoke("home_assistant_flash", { light: config.light });
      if (config.speaker) await invoke("home_assistant_announce", { speaker: config.speaker, message: spokenText(copy.testMessage) });
      setMessage(copy.tested);
    } catch (error) {
      setMessage(String(error));
    }
  };

  return (
    <Section title={copy.title}>
      <p className="prefs-card__hint">{copy.hint}</p>
      <Row title={copy.speaker} hint={targets && !targets.canSpeak ? copy.noVoice : undefined}>
        <select value={config.speaker ?? ""} aria-label={copy.speaker} onChange={(event) => update({ speaker: event.currentTarget.value || null })}>
          <option value="">{copy.none}</option>
          {targets?.speakers.map((target) => (
            <option key={target.entityId} value={target.entityId}>
              {target.name}
            </option>
          ))}
        </select>
      </Row>
      <Row title={copy.light}>
        <select value={config.light ?? ""} aria-label={copy.light} onChange={(event) => update({ light: event.currentTarget.value || null })}>
          <option value="">{copy.none}</option>
          {targets?.lights.map((target) => (
            <option key={target.entityId} value={target.entityId}>
              {target.name}
            </option>
          ))}
        </select>
      </Row>
      <Row title={copy.away}>
        <Segmented
          label={copy.away}
          value={String(config.awayMinutes)}
          options={AWAY_CHOICES.map((minutes) => ({ value: String(minutes), label: copy.minutes(minutes) }))}
          onChange={(value) => update({ awayMinutes: Number(value) })}
        />
      </Row>
      {(["agents", "meetings", "deliveries"] as const).map((kind) => (
        <Row key={kind} title={copy.kinds[kind]}>
          <Toggle label={copy.kinds[kind]} checked={config.kinds[kind]} onChange={(on) => toggleKind(kind, on)} />
        </Row>
      ))}
      <div className="prefs-auto__new">
        <button className="prefs-button" type="button" disabled={!config.speaker && !config.light} onClick={() => void test()}>
          {copy.test}
        </button>
      </div>
      {message && <p className="prefs-auto__hint">{message}</p>}
    </Section>
  );
}
