import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { useTranslation } from "../i18n";
import { Row, Section, Segmented, Stepper, Toggle } from "../settings/controls";
import { LAUNCHER_DEMO_APPS } from "../demo/launcherDemo";
import type { LauncherApp } from "../launcher/launcher";
import { MAX_ROUTINE_APPS, ROUTINE_KINDS, type Routine, type RoutineKind, type Routines } from "./routines";

export function RoutineSettings({ routines, onChange }: { routines: Routines; onChange: (routines: Routines) => void }) {
  const copy = useTranslation().routines;
  const [apps, setApps] = useState<LauncherApp[]>(isTauri() ? [] : LAUNCHER_DEMO_APPS);

  useEffect(() => {
    if (!isTauri()) return;
    let timer = 0;
    let attempts = 0;
    // The list of Start menu apps loads in the background on first use.
    const load = () =>
      void invoke<LauncherApp[]>("launcher_apps")
        .then((list) => {
          setApps([...list].sort((a, b) => a.name.localeCompare(b.name)));
          attempts += 1;
          if (list.length === 0 && attempts < 8) timer = window.setTimeout(load, 800);
        })
        .catch(() => {});
    load();
    return () => window.clearTimeout(timer);
  }, []);

  const change = (kind: RoutineKind, patch: Partial<Routine>) => onChange({ ...routines, [kind]: { ...routines[kind], ...patch } });

  return (
    <>
      <p className="prefs-routines__intro">{copy.hint}</p>
      {ROUTINE_KINDS.map((kind) => {
        const routine = routines[kind];
        const free = apps.filter((app) => !routine.apps.some((chosen) => chosen.id === app.id));
        return (
          <Section key={kind} title={copy.names[kind]}>
            <Row title={copy.apps} hint={copy.appsHint}>
              <div className="prefs-routines__apps">
                {routine.apps.map((app) => (
                  <span className="prefs-routines__chip" key={app.id}>
                    {app.name}
                    <button
                      type="button"
                      aria-label={copy.removeApp(app.name)}
                      title={copy.removeApp(app.name)}
                      onClick={() => change(kind, { apps: routine.apps.filter((other) => other.id !== app.id) })}
                    >
                      <X size={11} strokeWidth={2.6} />
                    </button>
                  </span>
                ))}
                {routine.apps.length < MAX_ROUTINE_APPS && (
                  <select
                    className="prefs-routines__select"
                    aria-label={copy.addApp}
                    value=""
                    disabled={free.length === 0}
                    onChange={(event) => {
                      const app = free.find((item) => item.id === event.currentTarget.value);
                      if (app) change(kind, { apps: [...routine.apps, { name: app.name, id: app.id }] });
                    }}
                  >
                    <option value="">{apps.length ? copy.addApp : copy.loadingApps}</option>
                    {free.map((app) => (
                      <option key={app.id} value={app.id}>
                        {app.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </Row>
            <Row title={copy.focus}>
              <Segmented
                label={copy.focus}
                value={routine.focus}
                options={(["keep", "start", "stop"] as const).map((value) => ({ value, label: copy.focusOptions[value] }))}
                onChange={(focus) => change(kind, { focus })}
              />
            </Row>
            <Row title={copy.ac} hint={copy.acHint}>
              <div className="prefs-routines__pair">
                {routine.ac === "on" && (
                  <Stepper
                    value={routine.acTemperature}
                    min={16}
                    max={30}
                    step={1}
                    format={(value) => `${value}°C`}
                    decreaseLabel={copy.colder}
                    increaseLabel={copy.warmer}
                    onChange={(acTemperature) => change(kind, { acTemperature })}
                  />
                )}
                <Segmented
                  label={copy.ac}
                  value={routine.ac}
                  options={(["keep", "on", "off"] as const).map((value) => ({ value, label: copy.acOptions[value] }))}
                  onChange={(ac) => change(kind, { ac })}
                />
              </div>
            </Row>
            <Row title={copy.music} hint={routine.music === "play" ? copy.musicHint : undefined}>
              <Segmented
                label={copy.music}
                value={routine.music}
                options={(["keep", "play", "pause"] as const).map((value) => ({ value, label: copy.musicOptions[value] }))}
                onChange={(music) => change(kind, { music })}
              />
            </Row>
            {routine.music === "play" && (
              <div className="prefs-field prefs-routines__field">
                <input
                  value={routine.musicQuery}
                  placeholder={copy.musicPlaceholder}
                  aria-label={copy.musicPlaceholder}
                  maxLength={120}
                  spellCheck={false}
                  onChange={(event) => change(kind, { musicQuery: event.currentTarget.value })}
                />
              </div>
            )}
            <Row title={copy.speak} hint={kind === "start" ? copy.speakStartHint : copy.speakEndHint}>
              <Toggle label={copy.speak} checked={routine.speak} onChange={(speak) => change(kind, { speak })} />
            </Row>
            <Row title={copy.time} hint={copy.timeHint}>
              <div className="prefs-routines__pair">
                <input
                  className="prefs-routines__time"
                  type="time"
                  aria-label={copy.time}
                  value={routine.time}
                  onChange={(event) => change(kind, { time: event.currentTarget.value })}
                />
                {routine.time && (
                  <button className="prefs-button prefs-button--quiet prefs-routines__clear" type="button" onClick={() => change(kind, { time: "" })}>
                    {copy.noTime}
                  </button>
                )}
              </div>
            </Row>
          </Section>
        );
      })}
    </>
  );
}
