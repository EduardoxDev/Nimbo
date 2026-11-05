/**
 * Gmail on the island (src-tauri/src/google.rs): new unread mail of the main inbox becomes a
 * notice with "Open" and "Make it a task". Only once per message, and by default only the
 * ones Gmail marks as important.
 */

export type MailItem = { id: string; threadId: string; from: string; address: string; subject: string; snippet: string; at: number; important: boolean };
export type MailConfig = { onlyImportant: boolean };

export const MAIL_KEY = "nimbo-mail";
const SEEN_KEY = "nimbo-mail-seen";
export const MAIL_CHANGED_KEY = "nimbo-mail-changed";
const MAX_SEEN = 300;

export function loadMailConfig(storage: Pick<Storage, "getItem"> = window.localStorage): MailConfig {
  try {
    const value = JSON.parse(storage.getItem(MAIL_KEY) ?? "null");
    return { onlyImportant: value?.onlyImportant !== false };
  } catch {
    return { onlyImportant: true };
  }
}

export function saveMailConfig(config: MailConfig, storage: Pick<Storage, "setItem"> = window.localStorage) {
  try {
    storage.setItem(MAIL_KEY, JSON.stringify(config));
    storage.setItem(MAIL_CHANGED_KEY, String(Date.now()));
  } catch {
    // Kept for this session only.
  }
}

export function loadSeen(storage: Pick<Storage, "getItem"> = window.localStorage): string[] {
  try {
    const list = JSON.parse(storage.getItem(SEEN_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((id) => typeof id === "string").slice(-MAX_SEEN) : [];
  } catch {
    return [];
  }
}

export function saveSeen(seen: string[], storage: Pick<Storage, "setItem"> = window.localStorage) {
  try {
    storage.setItem(SEEN_KEY, JSON.stringify(seen.slice(-MAX_SEEN)));
  } catch {
    // Seen again next time.
  }
}

/**
 * What to tell now: not seen yet, important when asked, newest first. The first look after
 * connecting only remembers what is there (an inbox full of old news is not news).
 */
export function freshMail(items: MailItem[], seen: string[], config: MailConfig, firstLook: boolean) {
  const known = new Set(seen);
  const unseen = items.filter((item) => !known.has(item.id));
  const nextSeen = [...seen, ...unseen.map((item) => item.id)].slice(-MAX_SEEN);
  if (firstLook) return { tell: [] as MailItem[], seen: nextSeen };
  const tell = unseen.filter((item) => !config.onlyImportant || item.important).sort((a, b) => b.at - a.at);
  return { tell, seen: nextSeen };
}

/** Opens the conversation in Gmail on the web. */
export function gmailLink(threadId: string) {
  return /^[a-zA-Z0-9]+$/.test(threadId) ? `https://mail.google.com/mail/u/0/#inbox/${threadId}` : "https://mail.google.com/mail/u/0/#inbox";
}

/** A task title for answering it. */
export function replyTask(item: Pick<MailItem, "from" | "subject">, prefix: string) {
  return `${prefix} ${item.from}${item.subject ? `: ${item.subject}` : ""}`.slice(0, 200);
}

/** "marca reunião com ana@x.com quinta 15h", "agenda uma call amanhã 10h", "schedule a meeting…". */
export function meetingRequestOf(text: string) {
  return /^(?:ei,?\s+nimbo,?\s+)?(?:marc(?:a|ar|e)|agend(?:a|ar|e)|cri(?:a|ar|e)\s+(?:uma?\s+)?(?:reuni[ãa]o|evento|call|chamada)|schedule|book)\b/i.test(text.trim());
}
