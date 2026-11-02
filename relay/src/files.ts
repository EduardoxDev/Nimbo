/**
 * Files between the PC and the phone ("AirDrop" for Windows), kept in the
 * room's own storage for a day. Pure helpers, tested in tests/relay.test.mjs.
 */

export type FileMeta = {
  id: string;
  name: string;
  size: number;
  type: string;
  /** Who sent it; the other side is the one that receives it. */
  from: "pc" | "phone";
  at: number;
  chunks: number;
};

export const MAX_FILE = 25 * 1024 * 1024;
/** Durable Object values are capped at 2 MB; 1 MB chunks leave room to spare. */
export const CHUNK = 1024 * 1024;
export const KEEP_MS = 24 * 60 * 60 * 1000;
export const KEEP_FILES = 10;

export function validFileId(id: string) {
  return /^[a-f0-9]{16}$/.test(id);
}

/** A file name that is safe to store and to send back in a header. */
export function cleanFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = [...base]
    .filter((char) => char >= " " && !'<>:"|?*'.includes(char))
    .join("")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120);
  return cleaned || "arquivo";
}

export function chunkCount(size: number) {
  return Math.max(1, Math.ceil(size / CHUNK));
}

/** Which files stay: younger than a day, newest first, at most KEEP_FILES. */
export function pruneFiles(files: FileMeta[], now: number): { keep: FileMeta[]; drop: FileMeta[] } {
  const sorted = [...files].sort((a, b) => b.at - a.at);
  const keep = sorted.filter((file, index) => now - file.at < KEEP_MS && index < KEEP_FILES);
  return { keep, drop: sorted.filter((file) => !keep.includes(file)) };
}

/** Content-Disposition that keeps accents (RFC 6266 filename*). */
export function attachmentHeader(name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
