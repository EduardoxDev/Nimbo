import { labelOf, type Segment } from "../day/activity";

export type MemoryKind = "window" | "file" | "copy";
export type MemoryItem = {
  id: string;
  kind: MemoryKind;
  title: string;
  subtitle: string;
  at: number;
  end: number;
  app?: string;
  path?: string;
  url?: string;
  folder?: boolean;
};
export type RecentFile = { path: string; name: string; folder: boolean; at: number };
export type CopiedText = { id: string; text: string; copiedAt: number };
export type MemoryQuery = { words: string[]; from: number | null; to: number | null; kinds: MemoryKind[] | null; extensions: string[] | null; links: boolean };

const MINUTE = 60_000;
const DAY = 86_400_000;
const NOISE = /^(explorer|nimbo|searchhost|searchapp|shellexperiencehost|startmenuexperiencehost|lockapp|applicationframehost|textinputhost|taskmgr|dock_64|pickerhost|screenclippinghost|shellhost|widgets|gamebar|credentialuibroker|consent|openwith)\.exe$/;
const BROWSER_SUFFIX = /\s[-–—]\s(Google Chrome|Microsoft​?\s?Edge|Mozilla Firefox|Brave|Opera|Vivaldi|Arc)$/i;
const URL_PATTERN = /^https?:\/\/\S+$/i;
const APP_SUFFIX = /\s[-–—|]\s(Visual Studio Code|Cursor|Notion|Microsoft Teams|Teams|Discord|Slack|Spotify Premium|Spotify|WhatsApp|Figma|Obsidian|Word|Excel|PowerPoint|Bloco de Notas|Notepad|Claude)$/i;

const SECRET_FILE = /(\.(key|pem|pfx|p12|ppk|kdbx|keystore|jks|gpg|asc)$)|(^\.env(\..+)?$)|(^id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$)|(^(credentials|secrets?)(\.[a-z]+)?$)/i;
const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const STOP = new Set(
  "a o as os um uma uns umas de do da dos das em no na nos nas por pra para pro com sem sobre que qual quais eu me meu minha voce aquele aquela aquilo esse essa isso este esta isto foi era estava estive tava fazendo fiz vi abri abria olhei li usei copiei mexi tinha tem ter onde quando qual hora horas the a an of in on at to for with about that this those these i my me was were did saw opened open read used copied looked when where what which hour hours".split(" "),
);

const WEEKDAYS: Record<string, number> = {
  domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

const FILE_HINTS: Record<string, string[]> = {
  pdf: ["pdf"],
  planilha: ["xlsx", "xls", "csv"],
  spreadsheet: ["xlsx", "xls", "csv"],
  excel: ["xlsx", "xls", "csv"],
  documento: ["docx", "doc", "pdf", "txt", "md"],
  document: ["docx", "doc", "pdf", "txt", "md"],
  word: ["docx", "doc"],
  apresentacao: ["pptx", "ppt", "key"],
  slides: ["pptx", "ppt"],
  foto: ["png", "jpg", "jpeg", "webp", "heic"],
  imagem: ["png", "jpg", "jpeg", "webp", "gif"],
  print: ["png", "jpg"],
  image: ["png", "jpg", "jpeg", "webp", "gif"],
  video: ["mp4", "mov", "mkv", "webm"],
};

function startOf(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function cleanTitle(segment: Segment) {
  return segment.title.replace(BROWSER_SUFFIX, "").replace(APP_SUFFIX, "").trim();
}

export function buildItems(days: { segments: Segment[] }[], files: RecentFile[], copies: CopiedText[]): MemoryItem[] {
  const items: MemoryItem[] = [];
  const segments = days.flatMap((day) => day.segments).filter((segment) => segment.app && !NOISE.test(segment.app) && segment.title.trim()).sort((a, b) => a.start - b.start);
  for (const segment of segments) {
    const title = cleanTitle(segment);
    const last = items[items.length - 1];
    if (last && last.kind === "window" && last.app === segment.app && last.title === title && segment.start - last.end <= 2 * MINUTE) {
      last.end = Math.max(last.end, segment.end);
      continue;
    }
    items.push({ id: `w${segment.start}`, kind: "window", title, subtitle: labelOf(segment), at: segment.start, end: segment.end, app: segment.app });
  }
  for (const file of files) {
    if (SECRET_FILE.test(file.name)) continue;
    const folder = file.path.slice(0, Math.max(0, file.path.length - file.name.length)).replace(/[\\/]+$/, "");
    items.push({ id: `f${file.path}`, kind: "file", title: file.name, subtitle: folder, at: file.at, end: file.at, path: file.path, folder: file.folder });
  }
  for (const copy of copies) {
    const text = copy.text.trim();
    if (!text) continue;
    items.push({ id: `c${copy.id}`, kind: "copy", title: text.replace(/\s+/g, " ").slice(0, 160), subtitle: "", at: copy.copiedAt, end: copy.copiedAt, url: URL_PATTERN.test(text) ? text : undefined });
  }
  return items.sort((a, b) => b.at - a.at);
}

export function parseQuery(text: string, now: Date): MemoryQuery {
  let rest = ` ${fold(text).replace(/[?!.,;"“”]/g, " ")} `;
  let day: number | null = null;
  let span = DAY;
  let fromHour: number | null = null;
  let toHour: number | null = null;
  const today = startOf(now);
  const take = (pattern: RegExp) => {
    const match = rest.match(pattern);
    if (match) rest = rest.replace(pattern, " ");
    return match;
  };

  if (take(/\s(anteontem|day before yesterday)\s/)) day = today - 2 * DAY;
  else if (take(/\s(ontem|yesterday)\s/)) day = today - DAY;
  else if (take(/\s(hoje|today)\s/)) day = today;
  else if (take(/\s(semana passada|last week)\s/)) {
    day = today - 13 * DAY;
    span = 7 * DAY;
  } else if (take(/\s(essa semana|esta semana|nessa semana|this week)\s/)) {
    day = today - 6 * DAY;
    span = 7 * DAY;
  } else {
    const weekday = take(/\s(domingo|segunda|terca|quarta|quinta|sexta|sabado|sunday|monday|tuesday|wednesday|thursday|friday|saturday)(-feira)?\s/);
    if (weekday) {
      const target = WEEKDAYS[weekday[1]];
      const back = (now.getDay() - target + 7) % 7 || 7;
      day = today - back * DAY;
      take(/\s(passada|passado|last)\s/);
    }
  }

  if (take(/\s(antes do almoco|before lunch)\s/)) [fromHour, toHour] = [8, 12];
  else if (take(/\s(depois do almoco|after lunch)\s/)) [fromHour, toHour] = [13, 16];
  else if (take(/\s(de manha|pela manha|in the morning|morning)\s/)) [fromHour, toHour] = [5, 12];
  else if (take(/\s(a tarde|de tarde|in the afternoon|afternoon)\s/)) [fromHour, toHour] = [12, 18];
  else if (take(/\s(a noite|de noite|at night|tonight|night)\s/)) [fromHour, toHour] = [18, 24];
  else {
    const clock = take(/\s(?:as |at |por volta das |around )?(\d{1,2})(?:h|:|\s?hs?\b)(\d{2})?\s?(pm|am)?\s/) ?? take(/\s(?:as |at )?(\d{1,2})\s?(pm|am)\s/);
    if (clock) {
      let hour = Number(clock[1]);
      const meridiem = clock[3] ?? (clock[2] === "pm" || clock[2] === "am" ? clock[2] : undefined);
      if (meridiem === "pm" && hour < 12) hour += 12;
      const minute = clock[2] && /^\d+$/.test(clock[2]) ? Number(clock[2]) : 0;
      const center = hour * 60 + minute;
      fromHour = (center - 45) / 60;
      toHour = (center + 45) / 60;
    }
  }

  let kinds: MemoryKind[] | null = null;
  let extensions: string[] | null = null;
  let links = false;
  if (take(/\s(links?|sites?|paginas?|pages?|urls?)\s/)) {
    links = true;
    kinds = ["window", "copy"];
  }
  if (take(/\s(copiei|copiado|copiados|copied|clipboard)\s/)) kinds = ["copy"];
  for (const [hint, list] of Object.entries(FILE_HINTS)) {
    if (take(new RegExp(`\\s(${hint}s?)\\s`))) {
      extensions = [...(extensions ?? []), ...list];
      kinds = ["file"];
    }
  }
  if (take(/\s(arquivos?|files?|pastas?|folders?)\s/)) kinds = ["file"];

  const words = rest.split(/\s+/).filter((word) => word.length > 1 && !STOP.has(word));
  const base = day ?? (fromHour !== null ? today : null);
  const from = base === null ? null : base + (fromHour !== null ? fromHour * 60 * MINUTE : 0);
  const to = base === null ? null : fromHour !== null && toHour !== null ? base + toHour * 60 * MINUTE : base + span;
  return { words, from, to, kinds, extensions, links };
}

function extensionOf(name: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

export function search(items: MemoryItem[], query: MemoryQuery, limit = 60): MemoryItem[] {
  const scored: { item: MemoryItem; score: number }[] = [];
  for (const item of items) {
    if (query.kinds && !query.kinds.includes(item.kind)) continue;
    if (query.from !== null && item.end < query.from) continue;
    if (query.to !== null && item.at > query.to) continue;
    if (query.extensions && !(item.kind === "file" && query.extensions.includes(extensionOf(item.title)))) continue;
    if (query.links && item.kind === "copy" && !item.url) continue;
    if (query.links && item.kind === "window" && !/^(chrome|msedge|firefox|brave|opera|vivaldi|arc)\.exe$/.test(item.app ?? "")) continue;
    const title = fold(item.title);
    const all = `${title} ${fold(item.subtitle)} ${fold(item.app ?? "")}`;
    if (!query.words.every((word) => all.includes(word))) continue;
    const inTitle = query.words.filter((word) => title.includes(word)).length;
    const minutes = item.kind === "window" ? Math.min(60, (item.end - item.at) / MINUTE) : 5;
    scored.push({ item, score: inTitle * 10 + minutes / 6 });
  }
  if (query.words.length === 0) return scored.map((entry) => entry.item).sort((a, b) => b.at - a.at).slice(0, limit);
  return scored
    .sort((a, b) => b.score - a.score || b.item.at - a.item.at)
    .slice(0, limit)
    .map((entry) => entry.item);
}

export function groupByDay(items: MemoryItem[]) {
  const groups: { day: number; items: MemoryItem[] }[] = [];
  for (const item of [...items].sort((a, b) => b.at - a.at)) {
    const day = startOf(new Date(item.at));
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}
