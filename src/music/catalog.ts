import { invoke, isTauri } from "@tauri-apps/api/core";

/** Shapes returned by `src-tauri/src/music_catalog.rs`. */
export type Track = {
  id: number;
  title: string;
  /** Full song length in seconds; the preview itself is 30 s. */
  duration: number;
  preview: string | null;
  explicit: boolean;
  /** Recording code; finds the same song on Spotify. */
  isrc?: string | null;
  artistId: number;
  artistName: string;
  albumId: number;
  albumTitle: string;
  cover: string | null;
  coverXl: string | null;
};

export type Album = {
  id: number;
  title: string;
  cover: string | null;
  coverXl: string | null;
  artistId: number | null;
  artistName: string | null;
  releaseDate: string | null;
  recordType: string | null;
  trackCount: number | null;
  /** Record label and genres; filled on album pages. */
  label?: string | null;
  genres?: string[];
};

export type Artist = {
  id: number;
  name: string;
  picture: string | null;
  pictureXl: string | null;
  fans: number | null;
  albumCount: number | null;
};

export type Genre = { id: number; name: string; picture: string | null };

export type Shelf = { tracks: Track[]; albums: Album[]; artists: Artist[] };
export type ArtistPage = { artist: Artist; top: Track[]; albums: Album[]; related: Artist[] };
export type AlbumPage = { album: Album; tracks: Track[] };

export type LyricsAnswer = { synced: string | null; plain: string | null; instrumental: boolean };

export type ExternalService ="spotify" | "spotifyWeb" | "youtube" | "deezer";

type Commands = {
  music_chart: [{ genreId: number; locale: string }, Shelf];
  music_genres: [{ locale: string }, Genre[]];
  music_search: [{ query: string; locale: string }, Shelf];
  music_artist: [{ id: number; locale: string }, ArtistPage];
  music_album: [{ id: number; locale: string }, AlbumPage];
  music_track: [{ id: number }, Track];
};

/**
 * In the app the Rust side talks to Deezer (it sends no CORS headers). In
 * `npm run dev` on a plain browser, the Vite proxy stands in for it.
 */
async function call<K extends keyof Commands>(command: K, args: Commands[K][0]): Promise<Commands[K][1]> {
  if (isTauri()) return invoke<Commands[K][1]>(command, args);
  if (import.meta.env.DEV) {
    const { browserCall } = await import("./catalogDev");
    return browserCall(command, args) as Promise<Commands[K][1]>;
  }
  throw new Error("Nimbo Music needs the desktop app");
}

const cache = new Map<string, Promise<unknown>>();

/** Keeps answers for the session so going back is instant. Failures are not kept. */
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const promise = load().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, promise);
  return promise;
}

export const catalog = {
  chart: (genreId: number, locale: string) =>
    cached(`chart:${genreId}:${locale}`, () => call("music_chart", { genreId, locale })),
  genres: (locale: string) => cached(`genres:${locale}`, () => call("music_genres", { locale })),
  search: (query: string, locale: string) =>
    cached(`search:${query.toLowerCase()}:${locale}`, () => call("music_search", { query, locale })),
  artist: (id: number, locale: string) => cached(`artist:${id}:${locale}`, () => call("music_artist", { id, locale })),
  album: (id: number, locale: string) => cached(`album:${id}:${locale}`, () => call("music_album", { id, locale })),
  /** Lyrics from LRCLIB (the same source as the island). Only title, artist, album and length leave the PC. */
  lyrics: (track: Track) =>
    cached(`lyrics:${track.id}`, async (): Promise<LyricsAnswer | null> => {
      if (isTauri()) {
        return invoke<LyricsAnswer | null>("fetch_lyrics", {
          title: track.title,
          artist: track.artistName,
          album: track.albumTitle || null,
          durationMs: track.duration * 1000,
        });
      }
      const query = new URLSearchParams({ track_name: track.title, artist_name: track.artistName });
      const found = (await (await fetch(`https://lrclib.net/api/search?${query}`)).json()) as {
        syncedLyrics?: string | null;
        plainLyrics?: string | null;
        instrumental?: boolean;
      }[];
      const best = found.find((item) => item.plainLyrics || item.syncedLyrics || item.instrumental);
      return best ? { synced: best.syncedLyrics ?? null, plain: best.plainLyrics ?? null, instrumental: Boolean(best.instrumental) } : null;
    }),
  /** Never cached: it exists to get a preview link that has not expired. */
  track: (id: number) => call("music_track", { id }),
  openExternal: async (service: ExternalService, track: Pick<Track, "title" | "artistName">) => {
    if (isTauri()) {
      await invoke("music_open_external", { service, title: track.title, artist: track.artistName });
      return;
    }
    const query = encodeURIComponent(`${track.title} ${track.artistName}`);
    window.open(
      service === "youtube"
        ? `https://music.youtube.com/search?q=${query}`
        : service === "deezer"
          ? `https://www.deezer.com/search/${query}`
          : `https://open.spotify.com/search/${query}`,
      "_blank",
    );
  },
};

// ---------- Saved songs ----------

export const LIKES_KEY = "nimbo-music-likes";
export const RECENT_KEY = "nimbo-music-recent";
export const VOLUME_KEY = "nimbo-music-volume";
const RECENT_LIMIT = 50;

/** Saved copies drop the preview: its link expires within the hour. */
function stripPreview(track: Track): Track {
  return { ...track, preview: null };
}

export function loadTracks(key: string): Track[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Track => typeof item?.id === "number" && typeof item?.title === "string")
      : [];
  } catch {
    return [];
  }
}

export function saveTracks(key: string, tracks: Track[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(tracks.map(stripPreview)));
  } catch {
    // Storage can be full or blocked; the list still works for this session.
  }
}

export const MOTION_KEY = "nimbo-music-motion";

/** "system" follows Windows' animation effects; the others override it here only. */
export type MotionPreference = "system" | "on" | "off";

export function loadMotion(): MotionPreference {
  try {
    const value = window.localStorage.getItem(MOTION_KEY);
    return value === "on" || value === "off" ? value : "system";
  } catch {
    return "system";
  }
}

export function saveMotion(value: MotionPreference) {
  try {
    window.localStorage.setItem(MOTION_KEY, value);
  } catch {
    // Falls back to following Windows next time.
  }
}

export function loadVolume(): number {
  try {
    const value = Number(window.localStorage.getItem(VOLUME_KEY));
    return window.localStorage.getItem(VOLUME_KEY) !== null && value >= 0 && value <= 1 ? value : 0.8;
  } catch {
    return 0.8;
  }
}

export function saveVolume(value: number) {
  try {
    window.localStorage.setItem(VOLUME_KEY, String(value));
  } catch {
    // Not worth surfacing: the next session starts at the default volume.
  }
}

export function withRecent(recent: Track[], track: Track): Track[] {
  return [track, ...recent.filter((item) => item.id !== track.id)].slice(0, RECENT_LIMIT);
}

export function toggleLike(likes: Track[], track: Track): Track[] {
  return likes.some((item) => item.id === track.id)
    ? likes.filter((item) => item.id !== track.id)
    : [track, ...likes];
}

// ---------- Formatting ----------

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

export function yearOf(date: string | null): string | null {
  return date && /^\d{4}/.test(date) ? date.slice(0, 4) : null;
}

/** Average colour of a cover, nudged to stay readable under white text. */
export function dominantColor(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      try {
        const size = 16;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, size, size);
        const { data } = context.getImageData(0, 0, size, size);
        let r = 0;
        let g = 0;
        let b = 0;
        let weight = 0;
        for (let index = 0; index < data.length; index += 4) {
          const max = Math.max(data[index], data[index + 1], data[index + 2]);
          const min = Math.min(data[index], data[index + 1], data[index + 2]);
          // Favour saturated pixels so grey borders do not wash the colour out.
          const w = 1 + (max - min) / 32;
          r += data[index] * w;
          g += data[index + 1] * w;
          b += data[index + 2] * w;
          weight += w;
        }
        const scale = (value: number) => Math.round(Math.min(200, (value / weight) * 0.85));
        resolve(`rgb(${scale(r)}, ${scale(g)}, ${scale(b)})`);
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });
}
