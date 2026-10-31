export type BuddyFx = "confetti" | "hearts";
export type BuddyMessage =
  | { kind: "say"; text: string; page?: string }
  | { kind: "deliver"; text: string; page?: string }
  | { kind: "fx"; fx: BuddyFx }
  | { kind: "attention"; on: boolean };
export type StampedMessage = BuddyMessage & { id: string; at: number };

export const INBOX_KEY = "nimbo-buddy-inbox";
export const VITALS_KEY = "nimbo-vitals";
const FRESH_MS = 5_000;

export type Vital = "sleepy" | "thirsty" | "happy" | null;

export function stamp(message: BuddyMessage, now: number): StampedMessage {
  return { ...message, id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: now };
}

export function sendBuddy(message: BuddyMessage) {
  try {
    window.localStorage.setItem(INBOX_KEY, JSON.stringify(stamp(message, Date.now())));
  } catch {
    // The buddy simply misses this one.
  }
}

export function parseMessage(raw: string | null, now: number): StampedMessage | null {
  try {
    const parsed = raw ? (JSON.parse(raw) as StampedMessage) : null;
    if (!parsed || typeof parsed.id !== "string" || !Number.isFinite(parsed.at) || now - parsed.at > FRESH_MS) return null;
    if (!["say", "deliver", "fx", "attention"].includes(parsed.kind)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function vitalOf({ hour, waterProgress, celebratedAt, now }: { hour: number; waterProgress: number; celebratedAt: number; now: number }): Vital {
  if (now - celebratedAt < 10 * 60_000) return "happy";
  if (hour >= 23 || hour < 5) return "sleepy";
  const expected = Math.min(1, Math.max(0, (hour - 8) / 12));
  if (hour >= 10 && waterProgress < expected - 0.35) return "thirsty";
  return null;
}

export function writeVital(vital: Vital) {
  try {
    window.localStorage.setItem(VITALS_KEY, vital ?? "");
  } catch {
    // Mood stays as it was.
  }
}

export function readVital(): Vital {
  try {
    const value = window.localStorage.getItem(VITALS_KEY);
    return value === "sleepy" || value === "thirsty" || value === "happy" ? value : null;
  } catch {
    return null;
  }
}
