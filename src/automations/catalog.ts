import type { Action, Rule, Trigger } from "../rules/rules";

export type TriggerKind = Trigger["kind"];
export type ActionKind = Action["kind"];

export const TRIGGER_KINDS: TriggerKind[] = ["time", "focusStart", "focusEnd", "meetingStart", "claudeDone", "headphones", "battery", "charging", "wifi", "app", "idle", "startup"];
export const ACTION_KINDS: ActionKind[] = ["notify", "say", "music", "pause", "volume", "focus", "open", "url", "claude", "lock", "dark", "ac", "macro", "routine"];

export const TRIGGER_COLORS: Record<TriggerKind, string> = {
  time: "#ff9f0a",
  focusStart: "#ff453a",
  focusEnd: "#30d158",
  meetingStart: "#ff6961",
  claudeDone: "#bf8cff",
  headphones: "#5ac8fa",
  battery: "#ffd60a",
  charging: "#30d158",
  wifi: "#64d2ff",
  app: "#0a84ff",
  idle: "#8e8e93",
  startup: "#5e5ce6",
};

export function defaultTrigger(kind: TriggerKind): Trigger {
  switch (kind) {
    case "time":
      return { kind, time: "09:00", days: [1, 2, 3, 4, 5] };
    case "battery":
      return { kind, below: 20 };
    case "wifi":
      return { kind, ssid: "" };
    case "app":
      return { kind, app: "" };
    case "idle":
      return { kind, minutes: 10 };
    default:
      return { kind } as Trigger;
  }
}

export function defaultAction(kind: ActionKind): Action {
  switch (kind) {
    case "music":
      return { kind, query: "" };
    case "routine":
      return { kind, routine: "start" };
    case "ac":
      return { kind, on: true, temperature: 23 };
    case "dark":
      return { kind, on: true };
    case "open":
      return { kind, app: "" };
    case "macro":
      return { kind, name: "" };
    case "notify":
      return { kind, text: "" };
    case "volume":
      return { kind, level: 30 };
    case "say":
      return { kind, text: "" };
    case "url":
      return { kind, url: "" };
    case "claude":
      return { kind, prompt: "" };
    default:
      return { kind } as Action;
  }
}

export function actionReady(action: Action) {
  switch (action.kind) {
    case "open":
      return action.app.trim().length > 0;
    case "macro":
      return action.name.trim().length > 0;
    case "notify":
    case "say":
      return action.text.trim().length > 0;
    case "url":
      return action.url.trim().length > 3;
    case "claude":
      return action.prompt.trim().length > 0;
    default:
      return true;
  }
}

export function triggerReady(trigger: Trigger) {
  switch (trigger.kind) {
    case "wifi":
      return trigger.ssid.trim().length > 0;
    case "app":
      return trigger.app.trim().length > 0;
    case "time":
      return /^\d{2}:\d{2}$/.test(trigger.time);
    default:
      return true;
  }
}

export type Recipe = { id: string; trigger: Trigger; actions: Action[] };

export const RECIPES: Recipe[] = [
  { id: "focus-quiet", trigger: { kind: "focusStart" }, actions: [{ kind: "pause" }, { kind: "volume", level: 15 }] },
  { id: "focus-done", trigger: { kind: "focusEnd" }, actions: [{ kind: "say", text: "Foco concluído! Levanta, estica e bebe água." }] },
  { id: "morning", trigger: { kind: "time", time: "09:00", days: [1, 2, 3, 4, 5] }, actions: [{ kind: "routine", routine: "start" }] },
  { id: "meeting", trigger: { kind: "meetingStart" }, actions: [{ kind: "pause" }, { kind: "say", text: "Reunião começando. Boa!" }] },
  { id: "claude", trigger: { kind: "claudeDone" }, actions: [{ kind: "say", text: "O Claude terminou. Vem ver!" }] },
  { id: "headphones", trigger: { kind: "headphones" }, actions: [{ kind: "music", query: "" }] },
  { id: "battery", trigger: { kind: "battery", below: 20 }, actions: [{ kind: "notify", text: "Bateria baixa: liga o carregador." }] },
  { id: "away", trigger: { kind: "idle", minutes: 15 }, actions: [{ kind: "pause" }, { kind: "lock" }] },
  { id: "night", trigger: { kind: "time", time: "23:00" }, actions: [{ kind: "dark", on: true }, { kind: "volume", level: 20 }] },
];

export function ruleFromParts(trigger: Trigger, actions: Action[], text: string, name?: string): Omit<Rule, "id" | "enabled"> {
  return { text, name, trigger, action: actions[0], actions };
}
