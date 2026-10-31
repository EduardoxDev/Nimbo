import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "../i18n";
import { Row, Section, Segmented, Stepper, Toggle } from "../settings/controls";
import { loadAutomations, saveAutomations, type HomeAutomation } from "./automations";
import { homeApi, type HomeEntity } from "./homeStore";

const WEEK = [1, 2, 3, 4, 5, 6, 0];

export function AutomationsSettings() {
  const t = useTranslation();
  const copy = t.prefs.automations;
  const [automations, setAutomations] = useState<HomeAutomation[]>(loadAutomations);
  const [climates, setClimates] = useState<HomeEntity[]>([]);
  const [time, setTime] = useState("22:00");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [entityId, setEntityId] = useState("");
  const [action, setAction] = useState<"on" | "off">("on");
  const [temperature, setTemperature] = useState(23);
  const weekday = new Intl.DateTimeFormat(t.localeTag, { weekday: "short" });
  const dayName = (day: number) => weekday.format(new Date(2026, 10, 1 + day)).replace(/\.$/, "");

  useEffect(() => {
    void homeApi
      .island()
      .then(({ entities }) => {
        const list = entities.filter((entity) => entity.domain === "climate");
        setClimates(list);
        setEntityId((current) => current || list[0]?.entityId || "");
      })
      .catch(() => setClimates([]));
  }, []);

  const update = (next: HomeAutomation[]) => {
    setAutomations(next);
    saveAutomations(next);
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    const entity = climates.find((item) => item.entityId === entityId);
    if (!entity) return;
    update([
      ...automations,
      {
        id: `${Date.now().toString(36)}`,
        enabled: true,
        time,
        days: [...days].sort(),
        entityId,
        entityName: entity.name,
        action,
        temperature: action === "on" ? temperature : null,
      },
    ]);
  };

  const describe = (automation: HomeAutomation) => {
    const when = automation.days.length === 0 || automation.days.length === 7 ? copy.everyDay : automation.days.map(dayName).join(", ");
    const what =
      automation.action === "off"
        ? copy.turnOffDescription(automation.entityName)
        : copy.turnOnDescription(automation.entityName, automation.temperature);
    return `${when} · ${what}`;
  };

  return (
    <Section title={copy.section}>
      {automations.length === 0 && <p className="prefs-card__hint">{copy.empty}</p>}
      {automations.map((automation) => (
        <Row key={automation.id} title={automation.time} hint={describe(automation)}>
          <span className="prefs-shortcut">
            <Toggle
              label={copy.enabled}
              checked={automation.enabled}
              onChange={(enabled) => update(automations.map((item) => (item.id === automation.id ? { ...item, enabled } : item)))}
            />
            <button
              className="prefs-button prefs-button--quiet"
              type="button"
              onClick={() => update(automations.filter((item) => item.id !== automation.id))}
            >
              {copy.remove}
            </button>
          </span>
        </Row>
      ))}
      {climates.length === 0 ? (
        <p className="prefs-card__hint prefs-card__hint--bottom">{copy.noClimate}</p>
      ) : (
        <form className="prefs-form" onSubmit={add}>
          <div className="prefs-automation">
            <label className="prefs-field">
              <span>{copy.time}</span>
              <input type="time" value={time} required onChange={(event) => setTime(event.currentTarget.value)} />
            </label>
            {climates.length > 1 && (
              <label className="prefs-field">
                <span>{copy.device}</span>
                <select value={entityId} onChange={(event) => setEntityId(event.currentTarget.value)}>
                  {climates.map((entity) => (
                    <option key={entity.entityId} value={entity.entityId}>
                      {entity.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="prefs-days" role="group" aria-label={copy.days}>
            {WEEK.map((day) => (
              <button
                key={day}
                type="button"
                className={`prefs-day${days.includes(day) ? " prefs-day--on" : ""}`}
                aria-pressed={days.includes(day)}
                onClick={() => setDays((current) => (current.includes(day) ? current.filter((item) => item !== day) : [...current, day]))}
              >
                {dayName(day)}
              </button>
            ))}
          </div>
          <Row title={copy.action}>
            <Segmented
              label={copy.action}
              value={action}
              options={[
                { value: "on", label: copy.turnOn },
                { value: "off", label: copy.turnOff },
              ]}
              onChange={setAction}
            />
          </Row>
          {action === "on" && (
            <Row title={copy.temperature}>
              <Stepper
                value={temperature}
                min={16}
                max={30}
                step={1}
                format={(value) => `${value}°`}
                decreaseLabel={`${t.prefs.appearance.decrease} ${copy.temperature}`}
                increaseLabel={`${t.prefs.appearance.increase} ${copy.temperature}`}
                onChange={setTemperature}
              />
            </Row>
          )}
          <div className="prefs-form__actions">
            <button className="prefs-button" type="submit" disabled={!entityId}>
              {copy.add}
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}
