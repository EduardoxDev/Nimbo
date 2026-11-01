import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Track } from "./catalog";

/** Shapes returned by `src-tauri/src/spotify.rs`. */
export type SpotifyStatus = {
  connected: boolean;
  clientId: string | null;
  name: string | null;
  premium: boolean | null;
  redirectUri: string;
};

export type SpotifyItem = {
  id: string;
  title: string;
  artists: string;
  album: string;
  cover: string | null;
  isrc: string | null;
};

export type SpotifyState = {
  isPlaying: boolean;
  progressMs: number;
  durationMs: number;
  shuffle: boolean;
  repeat: "off" | "context" | "track";
  volume: number | null;
  device: string | null;
  item: SpotifyItem | null;
};

export const SPOTIFY_DASHBOARD = "https://developer.spotify.com/dashboard";
export const SPOTIFY_REDIRECT = "http://127.0.0.1:43827/callback";

const wanted = (track: Track) => ({ title: track.title, artist: track.artistName, isrc: track.isrc ?? null });

export const spotify = {
  available: () => isTauri(),
  status: () => invoke<SpotifyStatus>("spotify_status"),
  connect: (clientId: string) => invoke<SpotifyStatus>("spotify_connect", { clientId }),
  disconnect: () => invoke<void>("spotify_disconnect"),
  play: (tracks: Track[], index: number) =>
    invoke<{ found: number; device: string }>("spotify_play", { tracks: tracks.map(wanted), index }),
  queue: (track: Track) => invoke<void>("spotify_queue", { track: wanted(track) }),
  state: () => invoke<SpotifyState | null>("spotify_state"),
  control: (action: "play" | "pause" | "next" | "previous" | "seek" | "volume" | "shuffle" | "repeat", value?: number) =>
    invoke<void>("spotify_control", { action, value: value ?? null }),
};

/** Errors the Rust side names with a code, so the window can explain them in the user's language. */
export type SpotifyErrorCode = "PREMIUM_REQUIRED" | "NO_DEVICE" | "NOT_ON_SPOTIFY" | "NOT_REGISTERED" | "INVALID_CLIENT_ID" | "SIGN_IN_TIMEOUT";

export function spotifyErrorCode(error: unknown): SpotifyErrorCode | null {
  const text = String(error);
  const codes: SpotifyErrorCode[] = ["PREMIUM_REQUIRED", "NO_DEVICE", "NOT_ON_SPOTIFY", "NOT_REGISTERED", "INVALID_CLIENT_ID", "SIGN_IN_TIMEOUT"];
  return codes.find((code) => text.includes(code)) ?? null;
}

const simplify = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s*[([].*?[)\]]\s*/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Which of our queued songs Spotify is playing: same recording code, else same title and first artist. */
export function matchQueue(queue: Track[], item: SpotifyItem): number {
  if (item.isrc) {
    const byIsrc = queue.findIndex((track) => track.isrc && track.isrc.toUpperCase() === item.isrc?.toUpperCase());
    if (byIsrc >= 0) return byIsrc;
  }
  const title = simplify(item.title);
  const artist = simplify(item.artists.split(",")[0] ?? "");
  return queue.findIndex((track) => simplify(track.title) === title && simplify(track.artistName).includes(artist));
}

/** A Track for something Spotify plays that is not in our queue (its own suggestions, say). */
export function trackFromSpotify(item: SpotifyItem, durationMs: number): Track {
  let hash = 0;
  for (const char of item.id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return {
    id: -Math.abs(hash || 1),
    title: item.title,
    duration: Math.round(durationMs / 1000),
    preview: null,
    explicit: false,
    isrc: item.isrc,
    artistId: 0,
    artistName: item.artists,
    albumId: 0,
    albumTitle: item.album,
    cover: item.cover,
    coverXl: item.cover,
  };
}
