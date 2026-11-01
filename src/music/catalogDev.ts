/**
 * Browser-only stand-in for `music_catalog.rs`, used by `npm run dev` through
 * the `/deezer-api` Vite proxy. Mirrors the Rust mapping; never shipped.
 */
import type { Album, AlbumPage, Artist, ArtistPage, Genre, Shelf, Track } from "./catalog";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any;

async function get(path: string, params: Record<string, string | number> = {}, locale?: string): Promise<Raw> {
  const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
  const response = await fetch(`/deezer-api${path}${query.size ? `?${query}` : ""}`, {
    headers: locale ? { "Accept-Language": locale } : undefined,
  });
  const body = await response.json();
  if (body?.error) throw new Error(body.error.message ?? "catalog error");
  return body;
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

function artist(raw: Raw): Artist {
  return {
    id: raw?.id ?? 0,
    name: raw?.name ?? "",
    picture: text(raw?.picture_medium),
    pictureXl: text(raw?.picture_xl),
    fans: raw?.nb_fan ?? null,
    albumCount: raw?.nb_album ?? null,
  };
}

function album(raw: Raw): Album {
  return {
    id: raw?.id ?? 0,
    title: raw?.title ?? "",
    cover: text(raw?.cover_medium),
    coverXl: text(raw?.cover_xl),
    artistId: raw?.artist?.id ?? null,
    artistName: raw?.artist?.name ?? null,
    releaseDate: text(raw?.release_date),
    recordType: text(raw?.record_type),
    trackCount: raw?.nb_tracks ?? null,
    label: text(raw?.label),
    genres: ((raw?.genres?.data ?? []) as Raw[]).map((genre) => genre.name).filter(Boolean),
  };
}

function track(raw: Raw, from?: Album): Track {
  return {
    id: raw.id,
    title: raw.title ?? "",
    duration: raw.duration ?? 0,
    preview: text(raw.preview),
    explicit: Boolean(raw.explicit_lyrics),
    isrc: text(raw.isrc),
    artistId: raw.artist?.id ?? 0,
    artistName: raw.artist?.name ?? "",
    albumId: raw.album?.id ?? from?.id ?? 0,
    albumTitle: raw.album?.title ?? from?.title ?? "",
    cover: text(raw.album?.cover_medium) ?? from?.cover ?? null,
    coverXl: text(raw.album?.cover_xl) ?? from?.coverXl ?? null,
  };
}

const tracks = (list: Raw, from?: Album) =>
  ((list?.data ?? []) as Raw[]).filter((item) => item.readable !== false).map((item) => track(item, from));

export async function browserCall(command: string, args: Record<string, any>): Promise<unknown> {
  const { locale } = args;
  switch (command) {
    case "music_chart": {
      const chart = await get(`/chart/${args.genreId ?? 0}`, { limit: 40 }, locale);
      return {
        tracks: tracks(chart.tracks),
        albums: (chart.albums?.data ?? []).map(album),
        artists: (chart.artists?.data ?? []).map(artist),
      } satisfies Shelf;
    }
    case "music_genres": {
      const list = await get("/genre", {}, locale);
      return (list.data as Raw[])
        .filter((genre) => genre.id !== 0)
        .map((genre): Genre => ({ id: genre.id, name: genre.name, picture: text(genre.picture_medium) }));
    }
    case "music_search": {
      const q = String(args.query ?? "").trim();
      if (!q) return { tracks: [], albums: [], artists: [] } satisfies Shelf;
      const [songs, artists, albums] = await Promise.all([
        get("/search", { q, limit: 40 }, locale),
        get("/search/artist", { q, limit: 16 }, locale),
        get("/search/album", { q, limit: 24 }, locale),
      ]);
      const lower = q.toLowerCase();
      const closeness = (item: Artist) => {
        const name = item.name.toLowerCase();
        return name === lower ? 2 : name.startsWith(lower) ? 1 : 0;
      };
      const ranked = (artists.data as Raw[]).map(artist);
      ranked.sort((a, b) => closeness(b) - closeness(a) || (b.fans ?? 0) - (a.fans ?? 0));
      return { tracks: tracks(songs), artists: ranked, albums: albums.data.map(album) } satisfies Shelf;
    }
    case "music_artist": {
      const id = args.id;
      const [info, top, albums, related] = await Promise.all([
        get(`/artist/${id}`, {}, locale),
        get(`/artist/${id}/top`, { limit: 20 }, locale),
        get(`/artist/${id}/albums`, { limit: 60 }, locale),
        get(`/artist/${id}/related`, { limit: 12 }, locale).catch(() => ({ data: [] })),
      ]);
      const list = (albums.data as Raw[]).map(album);
      list.sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""));
      return { artist: artist(info), top: tracks(top), albums: list, related: related.data.map(artist) } satisfies ArtistPage;
    }
    case "music_album": {
      const raw = await get(`/album/${args.id}`, {}, locale);
      const info = album(raw);
      return { album: info, tracks: tracks(raw.tracks, info) } satisfies AlbumPage;
    }
    case "music_track":
      return track(await get(`/track/${args.id}`));
    default:
      throw new Error(`Unknown command ${command}`);
  }
}
