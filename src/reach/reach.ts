/**
 * "Nimbo finds you around the house": when something matters and you are away from the PC,
 * the notice goes beyond the screen. A speaker says it (Home Assistant's voice) and a light
 * blinks. The phone already gets every island notice through the relay.
 */

export type ReachKind = "agents" | "meetings" | "deliveries";
export type ReachConfig = {
  speaker: string | null;
  light: string | null;
  /** Away means the keyboard and mouse have been still this long. */
  awayMinutes: number;
  kinds: Record<ReachKind, boolean>;
};

export const REACH_KEY = "nimbo-reach";
export const AWAY_CHOICES = [2, 5, 10] as const;
/** Two calls in a row would be nagging: one per this long. */
const QUIET_BETWEEN_MS = 2 * 60_000;

export const DEFAULT_REACH: ReachConfig = { speaker: null, light: null, awayMinutes: 5, kinds: { agents: true, meetings: true, deliveries: true } };

const entity = (value: unknown, domain: string) =>
  typeof value === "string" && new RegExp(`^${domain}\\.[a-z0-9_]{1,255}$`).test(value) ? value : null;

export function loadReach(storage: Pick<Storage, "getItem"> = window.localStorage): ReachConfig {
  try {
    const value = JSON.parse(storage.getItem(REACH_KEY) ?? "null");
    if (!value || typeof value !== "object") return DEFAULT_REACH;
    const kinds = value.kinds ?? {};
    return {
      speaker: entity(value.speaker, "media_player"),
      light: entity(value.light, "light"),
      awayMinutes: AWAY_CHOICES.includes(value.awayMinutes) ? value.awayMinutes : DEFAULT_REACH.awayMinutes,
      kinds: { agents: kinds.agents !== false, meetings: kinds.meetings !== false, deliveries: kinds.deliveries !== false },
    };
  } catch {
    return DEFAULT_REACH;
  }
}

export function saveReach(config: ReachConfig, storage: Pick<Storage, "setItem"> = window.localStorage) {
  try {
    storage.setItem(REACH_KEY, JSON.stringify(config));
  } catch {
    // Kept for this session only.
  }
}

/** Something to say, you are away long enough, this kind is on and the last call was a while ago. */
export function shouldReach(config: ReachConfig, kind: ReachKind, idleSeconds: number, lastAt: number, now: number) {
  if (!config.speaker && !config.light) return false;
  if (!config.kinds[kind]) return false;
  if (idleSeconds < config.awayMinutes * 60) return false;
  return now - lastAt >= QUIET_BETWEEN_MS;
}

/** What the speaker reads: no emoji, no symbols that voices spell out, short. */
export function spokenText(text: string) {
  return text
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s*[·•|]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
