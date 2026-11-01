import { invoke, isTauri } from "@tauri-apps/api/core";
import { catalog, type Track } from "./catalog";

// ---------- Playlists ----------

export const PLAYLISTS_KEY = "nimbo-music-playlists";
const PLAYLIST_LIMIT = 500;

export type Playlist = { id: string; name: string; tracks: Track[]; createdAt: number };

const isTrack = (item: unknown): item is Track =>
  typeof (item as Track)?.id === "number" && typeof (item as Track)?.title === "string";

export function loadPlaylists(): Playlist[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PLAYLISTS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => typeof item?.id === "string" && typeof item?.name === "string" && Array.isArray(item?.tracks))
      .map((item) => ({
        id: item.id,
        name: item.name.slice(0, 80),
        tracks: (item.tracks as unknown[]).filter(isTrack),
        createdAt: typeof item.createdAt === "number" ? item.createdAt : 0,
      }));
  } catch {
    return [];
  }
}

export function savePlaylists(playlists: Playlist[]) {
  try {
    // Preview links expire within the hour, so they are never stored.
    const stored = playlists.map((playlist) => ({ ...playlist, tracks: playlist.tracks.map((track) => ({ ...track, preview: null })) }));
    window.localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(stored));
  } catch {
    // Full or blocked storage: the playlists still work for this session.
  }
}

export function createPlaylist(playlists: Playlist[], name: string, first?: Track): Playlist[] {
  const playlist: Playlist = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim().slice(0, 80),
    tracks: first ? [first] : [],
    createdAt: Date.now(),
  };
  return [playlist, ...playlists];
}

export function addToPlaylist(playlists: Playlist[], id: string, track: Track): Playlist[] {
  return playlists.map((playlist) =>
    playlist.id !== id || playlist.tracks.some((item) => item.id === track.id)
      ? playlist
      : { ...playlist, tracks: [...playlist.tracks, track].slice(0, PLAYLIST_LIMIT) },
  );
}

export function removeFromPlaylist(playlists: Playlist[], id: string, trackId: number): Playlist[] {
  return playlists.map((playlist) =>
    playlist.id === id ? { ...playlist, tracks: playlist.tracks.filter((track) => track.id !== trackId) } : playlist,
  );
}

export function moveInPlaylist(playlists: Playlist[], id: string, from: number, to: number): Playlist[] {
  return playlists.map((playlist) => {
    if (playlist.id !== id) return playlist;
    const tracks = [...playlist.tracks];
    const [item] = tracks.splice(from, 1);
    if (!item) return playlist;
    tracks.splice(to, 0, item);
    return { ...playlist, tracks };
  });
}

/** Up to four different covers for the mosaic. */
export function mosaicOf(tracks: Track[]): string[] {
  const covers: string[] = [];
  for (const track of tracks) {
    if (track.cover && !covers.includes(track.cover)) covers.push(track.cover);
    if (covers.length === 4) break;
  }
  return covers;
}

// ---------- Hand-off from the island ----------

/**
 * The island (and the voice assistant) asks the music window to play
 * something through localStorage: the window may not exist yet, and a
 * stored request survives until it opens and picks it up.
 */
export const PENDING_KEY = "nimbo-music-pending";
const PENDING_TTL_MS = 60_000;

type Pending = { tracks: Track[]; index: number; at: number };

export async function playInNimboMusic(tracks: Track[], index = 0) {
  if (tracks.length === 0) return;
  try {
    const request: Pending = { tracks: tracks.map((track) => ({ ...track, preview: null })), index, at: Date.now() };
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(request));
  } catch {
    return;
  }
  if (isTauri()) await invoke("open_music_window");
}

export function takePending(): { tracks: Track[]; index: number } | null {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    window.localStorage.removeItem(PENDING_KEY);
    const parsed = JSON.parse(raw) as Partial<Pending>;
    if (!Array.isArray(parsed.tracks) || typeof parsed.at !== "number" || Date.now() - parsed.at > PENDING_TTL_MS) return null;
    const tracks = parsed.tracks.filter(isTrack);
    if (tracks.length === 0) return null;
    return { tracks, index: Math.min(Math.max(0, Number(parsed.index) || 0), tracks.length - 1) };
  } catch {
    return null;
  }
}

/**
 * "Toca Anitta" / "play Daft Punk One More Time". An exact artist name plays
 * that artist's hits; anything else plays the best matching song.
 */
export async function playByQuery(query: string, locale: string): Promise<{ title: string; artist: string } | null> {
  const clean = query.trim();
  if (!clean) return null;
  const results = await catalog.search(clean, locale);
  const artist = results.artists[0];
  if (artist && artist.name.toLowerCase() === clean.toLowerCase()) {
    const page = await catalog.artist(artist.id, locale);
    if (page.top.length > 0) {
      await playInNimboMusic(page.top, 0);
      return { title: page.top[0].title, artist: artist.name };
    }
  }
  const track = results.tracks[0];
  if (!track) return null;
  await playInNimboMusic(results.tracks.slice(0, 20), 0);
  return { title: track.title, artist: track.artistName };
}

/** Pulls the song out of "toca …", "coloca …", "play …" and friends. */
export function playRequestOf(text: string): string | null {
  const match = text
    .trim()
    .match(/^(?:ei,?\s+nimbo,?\s+)?(?:toca(?:r)?|toque|coloca(?:r)?|coloque|bota(?:r)?|põe|poe|play|播放)\s+(?:a\s+música\s+|a\s+musica\s+|música\s+|musica\s+|the\s+song\s+|some\s+)?(.+?)[.!?。]*$/i);
  if (!match) return null;
  const query = match[1].trim();
  // "toca a próxima" and "play music" are the old media controls, not a search.
  if (/^(a\s+)?(próxima|proxima|anterior|música|musica|music|next|previous)$/i.test(query)) return null;
  return query;
}
