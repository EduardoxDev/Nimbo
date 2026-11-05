/** "Focus together": the group code, who I am in it, and what changed between two looks. */

/** `shareMusic` off keeps what you listen to out of the group (on when missing). */
export type SquadConfig = { code: string; name: string; id: string; shareMusic?: boolean };
export type SquadMusic = { title: string; artist: string; positionMs: number; durationMs: number };
export type SquadFriend = {
  id: string;
  name: string;
  mood: string;
  focus: { status: "idle" | "running" | "paused"; remainingMs: number };
  distracted: boolean;
  music?: SquadMusic;
  /** When the relay last heard from them (its clock). */
  at?: number;
};
export type SquadPoke = { from: string; fromName: string; kind: "wave" | "focus" };

export const SQUAD_KEY = "nimbo-squad";
/** Friends without a relay of their own meet here (the project's relay). */
export const DEFAULT_SQUAD_SERVER = "https://nimbo-relay.eduardo-wankax.workers.dev";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomIndex(size: number) {
  const bytes = new Uint8Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] % size;
}

export function newSquadCode() {
  return Array.from({ length: 8 }, () => ALPHABET[randomIndex(ALPHABET.length)]).join("");
}

export function newMemberId() {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** "k7qm-2pxa " → "K7QM2PXA", or null when it cannot be a code. */
export function normalizeSquadCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  return code.length === 8 && [...code].every((char) => ALPHABET.includes(char)) ? code : null;
}

/** Shown as "K7QM-2PXA" so it is easy to read out loud. */
export function prettyCode(code: string) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function loadSquad(storage: Pick<Storage, "getItem"> = window.localStorage): SquadConfig | null {
  try {
    const value = JSON.parse(storage.getItem(SQUAD_KEY) ?? "null");
    if (value && typeof value.code === "string" && normalizeSquadCode(value.code) && /^[a-f0-9]{16}$/.test(value.id)) {
      return { code: value.code, name: typeof value.name === "string" ? value.name.slice(0, 24) : "", id: value.id, shareMusic: value.shareMusic !== false };
    }
  } catch {
    // No group.
  }
  return null;
}

/** Friends who just started focusing (not me, not someone who was already focusing). */
export function startedFocusing(before: SquadFriend[], after: SquadFriend[], myId: string) {
  const wasRunning = new Set(before.filter((friend) => friend.focus.status === "running").map((friend) => friend.id));
  const known = new Set(before.map((friend) => friend.id));
  return after.filter((friend) => friend.id !== myId && known.has(friend.id) && friend.focus.status === "running" && !wasRunning.has(friend.id));
}

type Song = { title?: string | null; artist?: string | null };

const songKey = (music: Song) =>
  `${music.title ?? ""}|${music.artist ?? ""}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

/** The same song, however each player writes accents and spaces. */
export function sameSong(a: Song | null | undefined, b: Song | null | undefined) {
  return Boolean(a?.title && b?.title && songKey(a) === songKey(b));
}

/** Friends who just put a song on (they were not playing anything before). */
export function startedListening(before: SquadFriend[], after: SquadFriend[], myId: string) {
  const wasPlaying = new Set(before.filter((friend) => friend.music).map((friend) => friend.id));
  const known = new Set(before.map((friend) => friend.id));
  return after.filter((friend) => friend.id !== myId && known.has(friend.id) && friend.music && !wasPlaying.has(friend.id));
}

/** Where the friend's song is now: what they reported, plus the time since. */
export function positionNow(friend: SquadFriend, now: number) {
  if (!friend.music) return 0;
  const elapsed = friend.at ? Math.max(0, now - friend.at) : 0;
  const position = friend.music.positionMs + elapsed;
  return friend.music.durationMs > 0 ? Math.min(position, friend.music.durationMs) : position;
}

/** How a friend's mascot looks: focused, embarrassed when distracted, or as they are. */
export function friendMood(friend: SquadFriend) {
  if (friend.focus.status === "running") return friend.distracted ? "annoyed" : "working";
  return friend.mood;
}
