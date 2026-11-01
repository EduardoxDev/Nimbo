import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Track } from "./catalog";

/** Shapes returned by `src-tauri/src/youtube.rs`. */
export type YouTubeStatus = { configured: boolean; ownKey: boolean; builtIn: boolean };
export type YouTubeCandidate = { id: string; title: string; channel: string; seconds: number };

export const GOOGLE_CONSOLE = "https://console.cloud.google.com/apis/library/youtube.googleapis.com";
const CACHE_KEY = "nimbo-music-youtube";
const CACHE_LIMIT = 3000;

export type YouTubeErrorCode = "YT_NO_KEY" | "YT_QUOTA" | "YT_KEY";

export function youtubeErrorCode(error: unknown): YouTubeErrorCode | null {
  const text = String(error);
  return (["YT_NO_KEY", "YT_QUOTA", "YT_KEY"] as const).find((code) => text.includes(code)) ?? null;
}

// ---------- Found videos, kept on this PC so a song costs one search ever ----------

type CacheEntry = (string | YouTubeCandidate)[];

function readCache(): Record<string, CacheEntry> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, CacheEntry>) : {};
  } catch {
    return {};
  }
}

/** Older versions kept only ids; those come back without a title. */
const asCandidate = (item: string | YouTubeCandidate): YouTubeCandidate =>
  typeof item === "string" ? { id: item, title: "", channel: "", seconds: 0 } : item;

function remember(trackId: number, ids: YouTubeCandidate[]) {
  try {
    const cache = readCache();
    delete cache[trackId];
    cache[trackId] = ids;
    const keys = Object.keys(cache);
    // Oldest entries go first once the cache is full.
    for (const old of keys.slice(0, Math.max(0, keys.length - CACHE_LIMIT))) delete cache[old];
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Without storage the song is simply searched again next time.
  }
}

export const youtube = {
  available: () => isTauri(),
  status: () => invoke<YouTubeStatus>("youtube_status"),
  saveKey: (key: string) => invoke<YouTubeStatus>("youtube_save_key", { key }),
  deleteKey: () => invoke<YouTubeStatus>("youtube_delete_key"),
  /** Videos for a song, best first: from this PC's cache, else one search. */
  async videosFor(track: Track): Promise<YouTubeCandidate[]> {
    const cached = readCache()[track.id];
    if (Array.isArray(cached) && cached.length) return cached.map(asCandidate);
    if (!isTauri()) return [];
    const found = await invoke<YouTubeCandidate[]>("youtube_find", {
      title: track.title,
      artist: track.artistName,
      seconds: track.duration || null,
    });
    if (found.length) remember(track.id, found);
    return found;
  },
  /** "Not this one": the chosen version goes first for next time too. */
  prefer(trackId: number, list: YouTubeCandidate[], id: string) {
    const chosen = list.find((candidate) => candidate.id === id);
    if (chosen) remember(trackId, [chosen, ...list.filter((candidate) => candidate.id !== id)]);
  },
};

// ---------- The IFrame Player API ----------

/* Only the parts of `YT.Player` Nimbo uses. */
export type YTPlayer = {
  loadVideoById: (id: string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volume: number) => void;
  mute: () => void;
  unMute: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  destroy: () => void;
};

type YTNamespace = {
  Player: new (
    element: HTMLElement,
    options: {
      width?: string;
      height?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
        onError?: (event: { data: number }) => void;
      };
    },
  ) => YTPlayer;
};

let apiReady: Promise<YTNamespace> | null = null;

/** Loads YouTube's player script once per window. */
export function loadYouTubeApi(): Promise<YTNamespace> {
  const host = window as unknown as { YT?: YTNamespace & { loaded?: number }; onYouTubeIframeAPIReady?: () => void };
  if (host.YT?.Player && host.YT.loaded) return Promise.resolve(host.YT);
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve, reject) => {
    const previous = host.onYouTubeIframeAPIReady;
    host.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (host.YT) resolve(host.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      apiReady = null;
      reject(new Error("Could not load the YouTube player"));
    };
    document.head.appendChild(script);
  });
  return apiReady;
}

/** Player states from the IFrame API. */
export const YT_STATE = { ended: 0, playing: 1, paused: 2, buffering: 3, cued: 5 } as const;
