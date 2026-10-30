export type LyricLine = {
  timeMs: number;
  text: string;
};

const TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** Parses LRC text (`[mm:ss.xx] line`) into lines sorted by time. Metadata tags are skipped. */
export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const stamps = [...rawLine.matchAll(TIMESTAMP)];
    if (stamps.length === 0) continue;

    const lyric = rawLine.replace(TIMESTAMP, "").trim();
    for (const [, minutes, seconds, fraction = "0"] of stamps) {
      const fractionMs = Number(fraction.padEnd(3, "0").slice(0, 3));
      lines.push({
        timeMs: Number(minutes) * 60_000 + Number(seconds) * 1000 + fractionMs,
        text: lyric,
      });
    }
  }

  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

/** Index of the line being sung at `positionMs`, or -1 before the first line. */
export function activeLyricIndex(lines: LyricLine[], positionMs: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    if (lines[middle].timeMs <= positionMs) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return found;
}

/** `02:57` style clock for track times; hours appear only when needed. */
export function formatTrackTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${String(minutes).padStart(2, "0")}:${seconds}`;
}

/**
 * Title and artist to look lyrics up with. Players without an artist field
 * (files, browser tabs) usually put "Artist - Title" in the title instead.
 */
export function lyricsQueryFor(
  title: string,
  artist: string | null,
): { title: string; artist: string } | null {
  const cleanTitle = title.trim();
  if (artist?.trim()) return { title: cleanTitle, artist: artist.trim() };

  const match = cleanTitle.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (!match) return null;
  // Drop video suffixes such as "(Official Music Video)" or "[Lyric Video]".
  const songTitle = match[2]
    .replace(/\s*[([](official|lyric|audio|video|clipe)[^)\]]*[)\]]\s*$/i, "")
    .trim();
  return { artist: match[1].trim(), title: songTitle };
}
