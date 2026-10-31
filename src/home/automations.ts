import type { HomeServiceCall } from "./homeStore";

export type HomeAutomation = {
  id: string;
  enabled: boolean;
  time: string;
  days: number[];
  entityId: string;
  entityName: string;
  action: "on" | "off";
  temperature: number | null;
};

export const AUTOMATIONS_KEY = "nimbo-home-automations";
const RAN_KEY = "nimbo-home-automations-ran";
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function minuteKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function normalizeAutomations(value: unknown): HomeAutomation[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is HomeAutomation => {
      const automation = item as Partial<HomeAutomation>;
      return (
        typeof automation?.id === "string" &&
        typeof automation.time === "string" &&
        TIME_PATTERN.test(automation.time) &&
        Array.isArray(automation.days) &&
        typeof automation.entityId === "string" &&
        (automation.action === "on" || automation.action === "off")
      );
    })
    .map((automation) => ({
      ...automation,
      enabled: automation.enabled !== false,
      entityName: typeof automation.entityName === "string" ? automation.entityName : automation.entityId,
      days: automation.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
      temperature: typeof automation.temperature === "number" ? automation.temperature : null,
    }));
}

export function loadAutomations(): HomeAutomation[] {
  try {
    return normalizeAutomations(JSON.parse(localStorage.getItem(AUTOMATIONS_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function saveAutomations(automations: HomeAutomation[]) {
  try {
    localStorage.setItem(AUTOMATIONS_KEY, JSON.stringify(automations));
  } catch {
    return;
  }
}

export function loadRan(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(RAN_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveRan(ran: Record<string, string>) {
  try {
    localStorage.setItem(RAN_KEY, JSON.stringify(ran));
  } catch {
    return;
  }
}

export function dueAutomations(automations: HomeAutomation[], now: Date, ran: Record<string, string>) {
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const key = minuteKey(now);
  return automations.filter(
    (automation) =>
      automation.enabled &&
      automation.time === time &&
      (automation.days.length === 0 || automation.days.includes(now.getDay())) &&
      ran[automation.id] !== key,
  );
}

export function callsFor(automation: HomeAutomation): HomeServiceCall[] {
  if (automation.action === "off") {
    return [{ domain: "climate", service: "turn_off", entityId: automation.entityId }];
  }
  const calls: HomeServiceCall[] = [{ domain: "climate", service: "turn_on", entityId: automation.entityId }];
  if (automation.temperature !== null) {
    calls.push({
      domain: "climate",
      service: "set_temperature",
      entityId: automation.entityId,
      data: { temperature: automation.temperature },
    });
  }
  return calls;
}
