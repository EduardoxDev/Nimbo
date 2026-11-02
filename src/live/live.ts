/** Live activities on the island: downloads and file copies (src-tauri/src/live.rs). */

export type LiveDownload = { id: string; name: string; bytes: number; speed: number };
export type LiveCopy = { percent: number; title: string };
export type LiveState = { downloads: LiveDownload[]; copies: LiveCopy[] };

export const EMPTY_LIVE: LiveState = { downloads: [], copies: [] };

export function formatBytes(bytes: number, localeTag: string) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value < 10 && unit > 0 ? 1 : 0;
  return `${value.toLocaleString(localeTag, { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${units[unit]}`;
}

/** Copies first (they have a real percent), then the fastest download. */
export function liveSummary(
  state: LiveState,
  copy: { copying: (percent: number) => string; downloading: (name: string, detail: string) => string; more: (count: number) => string },
  localeTag: string,
): { text: string; progress: number | null } | null {
  const extra = (count: number) => (count > 1 ? ` ${copy.more(count - 1)}` : "");
  if (state.copies.length > 0) {
    const percent = Math.max(...state.copies.map((item) => item.percent));
    return { text: copy.copying(percent) + extra(state.copies.length + state.downloads.length), progress: percent / 100 };
  }
  if (state.downloads.length > 0) {
    const main = [...state.downloads].sort((a, b) => b.speed - a.speed)[0];
    const name = main.name.length > 28 ? `${main.name.slice(0, 26)}…` : main.name;
    const detail = main.speed > 0 ? `${formatBytes(main.speed, localeTag)}/s` : formatBytes(main.bytes, localeTag);
    return { text: copy.downloading(name, detail) + extra(state.downloads.length), progress: null };
  }
  return null;
}
