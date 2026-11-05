/**
 * Shared rules of the Nimbo relay: rooms, codes and what the iPhone's island
 * (Live Activity) shows for a given island status. Pure functions, tested in
 * tests/relay.test.mjs.
 */

export type IslandStatus = {
  pc?: string;
  island?: { text: string; color: string | null } | null;
  music?: { title: string; artist: string | null; playing: boolean; positionMs: number | null; durationMs: number | null } | null;
  focus?: { status: "idle" | "running" | "paused"; phase: string; remainingMs: number; totalMs: number };
  water?: { drankMl: number; goalMl: number };
  tasks?: { id: string; title: string; completed: boolean }[];
  notices?: string[];
  /** An AI agent waiting for a yes or no; the phone can answer it. */
  approval?: { id: string; agent: string; question: string } | null;
  /** The latest copied text, when the user shares it (never secrets). */
  clipboard?: { text: string; copiedAt: number } | null;
  /** What is in front on the PC, when the user shares it. */
  now?: { app: string; title: string; url?: string | null } | null;
  /** What the user was doing when they left the PC, to continue on the phone. */
  handoff?: { kind: "page" | "music"; title: string; subtitle: string; url: string; at: number } | null;
  /** Links saved to read later, unread only. */
  readLater?: { id: string; url: string }[];
};

/** What the Live Activity (Dynamic Island and lock screen) shows. */
export type ActivityState = {
  kind: "focus" | "music" | "notice" | "idle";
  title: string;
  subtitle: string;
  /** 0..1, or -1 when there is no progress to show. */
  progress: number;
  /** When a running countdown ends (ms since 1970), so iOS can tick it without pushes. */
  endsAt: number;
  color: string;
};

export const MAX_MESSAGE = 900_000;

export function validRoom(room: string) {
  return /^[a-f0-9]{32}$/.test(room);
}

export function validKey(key: string) {
  return /^[a-f0-9]{48}$/.test(key);
}

export async function hashKey(key: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`nimbo:${key}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function activityOf(status: IslandStatus | null, now: number): ActivityState {
  const focus = status?.focus;
  if (focus && focus.status !== "idle") {
    const running = focus.status === "running";
    return {
      kind: "focus",
      title: focus.phase === "focus" ? "Foco" : "Pausa",
      subtitle: status?.music?.title ?? status?.pc ?? "Nimbo",
      progress: focus.totalMs > 0 ? Math.min(1, Math.max(0, 1 - focus.remainingMs / focus.totalMs)) : -1,
      endsAt: running ? now + focus.remainingMs : 0,
      color: focus.phase === "focus" ? "#ff9f0a" : "#35e985",
    };
  }
  if (status?.island?.text) {
    return { kind: "notice", title: status.island.text, subtitle: status.pc ?? "Nimbo", progress: -1, endsAt: 0, color: status.island.color ?? "#64d2ff" };
  }
  const music = status?.music;
  if (music) {
    const progress = music.durationMs && music.positionMs !== null ? Math.min(1, music.positionMs / music.durationMs) : -1;
    return { kind: "music", title: music.title, subtitle: music.artist ?? "", progress, endsAt: 0, color: "#ff375f" };
  }
  return { kind: "idle", title: "Nimbo", subtitle: status?.pc ?? "", progress: -1, endsAt: 0, color: "#64d2ff" };
}

/**
 * Pushes cost battery and Apple rate limits: only when what the island shows
 * really changes (not every second of a countdown or song), at most every 10 s.
 */
export function shouldPush(previous: ActivityState | null, next: ActivityState, lastPushAt: number, now: number) {
  if (now - lastPushAt < 10_000) return false;
  if (!previous) return true;
  const endsMoved = Math.abs(previous.endsAt - next.endsAt) > 5_000;
  return previous.kind !== next.kind || previous.title !== next.title || previous.subtitle !== next.subtitle || previous.color !== next.color || endsMoved;
}

/**
 * Who may connect as the PC. Phones and the Alexa skill know the room code, so the PC also
 * sends a code of its own that is never shared. Rooms made before it are claimed by the
 * first PC that shows one; after that, a connection as "pc" without it is turned away.
 */
export function pcAccess(storedHash: string | undefined, givenHash: string | null): "ok" | "claim" | "legacy" | "denied" {
  if (!givenHash) return storedHash ? "denied" : "legacy";
  if (!storedHash) return "claim";
  return storedHash === givenHash ? "ok" : "denied";
}

/** The saved status is rewritten when this changes, or once a minute: not for every second of a song. */
export const SAVE_STATUS_EVERY = 60_000;

export function settledStatus(status: IslandStatus & { mascot?: unknown }) {
  const { mascot: _drawing, ...rest } = status;
  return JSON.stringify({
    ...rest,
    music: rest.music ? { ...rest.music, positionMs: null } : rest.music,
    focus: rest.focus ? { ...rest.focus, remainingMs: Math.round(rest.focus.remainingMs / 60_000) } : rest.focus,
  });
}
