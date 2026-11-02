/** "Read later": links saved from the launcher or the phone, offered back in a free moment. */

export type ReadLaterItem = { id: string; url: string; addedAt: number; readAt: number | null };

export const READ_LATER_KEY = "nimbo-read-later";
export const READ_LATER_REMINDED_KEY = "nimbo-read-later-reminded";
const MAX_ITEMS = 60;
/** At most one nudge every three hours, and only in waking hours. */
const REMIND_EVERY_MS = 3 * 60 * 60 * 1000;

const URL_PATTERN = /^https?:\/\/[^\s]+$/i;

export function isLink(text: string) {
  return URL_PATTERN.test(text.trim());
}

/** "ler depois https://…", "read later https://…", "稍后读 https://…" or a bare link. */
export function readLaterRequestOf(query: string): string | null {
  const text = query.trim();
  const asked = /^(?:ler\s+depois|guardar(?:\s+pra|\s+para)?\s+ler|read\s+later|save\s+for\s+later|稍后读)\s*:?\s+(\S+)$/i.exec(text)?.[1];
  const url = asked ?? text;
  return isLink(url) ? url : null;
}

export function loadReadLater(storage: Pick<Storage, "getItem"> = window.localStorage): ReadLaterItem[] {
  try {
    const parsed = JSON.parse(storage.getItem(READ_LATER_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ReadLaterItem =>
        item && typeof item.id === "string" && typeof item.url === "string" && isLink(item.url) && typeof item.addedAt === "number",
    );
  } catch {
    return [];
  }
}

export function addReadLater(items: ReadLaterItem[], url: string, now: number): ReadLaterItem[] {
  const clean = url.trim();
  if (!isLink(clean)) return items;
  const rest = items.filter((item) => item.url !== clean);
  return [{ id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, url: clean, addedAt: now, readAt: null }, ...rest].slice(0, MAX_ITEMS);
}

export function markRead(items: ReadLaterItem[], id: string, now: number): ReadLaterItem[] {
  return items.map((item) => (item.id === id ? { ...item, readAt: now } : item));
}

export function unread(items: ReadLaterItem[]) {
  return items.filter((item) => item.readAt === null);
}

/** "github.com/EduardoxDev/Nimbo" instead of the whole link. */
export function shortLink(url: string) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, "");
    const label = `${parsed.hostname.replace(/^www\./, "")}${path}`;
    return label.length > 60 ? `${label.slice(0, 57)}…` : label;
  } catch {
    return url.slice(0, 60);
  }
}

/** The oldest unread link, when now is a free moment and the last nudge was long enough ago. */
export function readLaterDue(
  items: ReadLaterItem[],
  context: { now: number; lastRemindedAt: number; busy: boolean },
): ReadLaterItem | null {
  if (context.busy) return null;
  const hour = new Date(context.now).getHours();
  if (hour < 9 || hour >= 22) return null;
  if (context.now - context.lastRemindedAt < REMIND_EVERY_MS) return null;
  const waiting = unread(items).filter((item) => context.now - item.addedAt > 20 * 60 * 1000);
  return waiting.length ? waiting[waiting.length - 1] : null;
}
