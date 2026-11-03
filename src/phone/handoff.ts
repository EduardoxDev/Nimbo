export type Handoff = { kind: "page" | "music"; title: string; subtitle: string; url: string; at: number };
export type FrontNow = { app: string; title: string; url?: string | null };
export type MusicNow = { title: string; artist: string | null; playing: boolean };

export const AWAY_SECONDS = 180;
export const HANDOFF_TTL_MS = 3 * 3_600_000;

export const BROWSER_APPS = /^(chrome|msedge|brave|opera|vivaldi|firefox|arc)\.exe$/i;

export function musicLink(title: string, artist: string | null) {
  return `https://open.spotify.com/search/${encodeURIComponent([title, artist].filter(Boolean).join(" "))}`;
}

export function handoffOf(front: FrontNow | null, music: MusicNow | null, at: number): Handoff | null {
  if (front?.url) return { kind: "page", title: front.title || front.url, subtitle: front.app, url: front.url, at };
  if (music?.playing && music.title) return { kind: "music", title: music.title, subtitle: music.artist ?? "", url: musicLink(music.title, music.artist), at };
  return null;
}

export function wentAway(previousIdle: number, idle: number) {
  return previousIdle < AWAY_SECONDS && idle >= AWAY_SECONDS;
}

export function freshHandoff(handoff: Handoff | null, now: number) {
  return handoff && now - handoff.at <= HANDOFF_TTL_MS ? handoff : null;
}
