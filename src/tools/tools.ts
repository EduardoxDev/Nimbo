/** Small pure helpers for the tools: colour names, the PC checkup, friends' clocks and snippets. */

// ---------- Colours ----------
export type Rgb = { r: number; g: number; b: number };

export function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function rgbText(rgb: Rgb) {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

/** A small named palette; the nearest one names the picked colour. */
const NAMED: [string, string, string, string][] = [
  ["#000000", "preto", "black", "黑色"],
  ["#ffffff", "branco", "white", "白色"],
  ["#808080", "cinza", "grey", "灰色"],
  ["#c0c0c0", "prata", "silver", "银色"],
  ["#2f4f4f", "grafite", "dark slate", "深灰色"],
  ["#ff0000", "vermelho", "red", "红色"],
  ["#8b0000", "vinho", "dark red", "酒红色"],
  ["#ff7f50", "coral", "coral", "珊瑚色"],
  ["#ffa500", "laranja", "orange", "橙色"],
  ["#ffd700", "dourado", "gold", "金色"],
  ["#ffff00", "amarelo", "yellow", "黄色"],
  ["#f5f5dc", "bege", "beige", "米色"],
  ["#8b4513", "marrom", "brown", "棕色"],
  ["#808000", "oliva", "olive", "橄榄色"],
  ["#00ff00", "verde-limão", "lime", "青柠色"],
  ["#008000", "verde", "green", "绿色"],
  ["#2e8b57", "verde-mar", "sea green", "海绿色"],
  ["#40e0d0", "turquesa", "turquoise", "绿松石色"],
  ["#008080", "azul petróleo", "teal", "青色"],
  ["#00ffff", "ciano", "cyan", "青蓝色"],
  ["#87ceeb", "azul-céu", "sky blue", "天蓝色"],
  ["#0000ff", "azul", "blue", "蓝色"],
  ["#000080", "azul-marinho", "navy", "海军蓝"],
  ["#4b0082", "índigo", "indigo", "靛蓝色"],
  ["#800080", "roxo", "purple", "紫色"],
  ["#ee82ee", "violeta", "violet", "紫罗兰色"],
  ["#e6e6fa", "lavanda", "lavender", "薰衣草色"],
  ["#ff00ff", "magenta", "magenta", "洋红色"],
  ["#ffc0cb", "rosa", "pink", "粉色"],
  ["#ff1493", "pink choque", "hot pink", "深粉色"],
];

export function colorName(hex: string, locale: "pt-BR" | "en" | "zh-CN") {
  const rgb = hexToRgb(hex);
  if (!rgb) return "";
  let best = NAMED[0];
  let bestDistance = Infinity;
  for (const entry of NAMED) {
    const other = hexToRgb(entry[0])!;
    // Weighted for how eyes see green brighter than blue.
    const d = 0.3 * (rgb.r - other.r) ** 2 + 0.59 * (rgb.g - other.g) ** 2 + 0.11 * (rgb.b - other.b) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = entry;
    }
  }
  return locale === "en" ? best[2] : locale === "zh-CN" ? best[3] : best[1];
}

export const PALETTE_KEY = "nimbo-palette";

export function addToPalette(palette: string[], hex: string) {
  return [hex.toLowerCase(), ...palette.filter((item) => item !== hex.toLowerCase())].slice(0, 12);
}

// ---------- PC checkup ----------
export type AppUse = { name: string; processes: number; memoryMb: number; cpu: number; canClose: boolean };
export type Checkup = { cpu: number; memoryUsed: number; memoryTotalGb: number; diskFreeGb: number; diskTotalGb: number; uptimeHours: number; apps: AppUse[] };
export type Finding =
  | { kind: "cpu"; app: AppUse }
  | { kind: "memory"; app: AppUse; used: number }
  | { kind: "disk"; freeGb: number }
  | { kind: "uptime"; days: number }
  | { kind: "fine" };

const FRIENDLY_APPS: Record<string, string> = {
  chrome: "Chrome",
  msedge: "Edge",
  firefox: "Firefox",
  code: "VS Code",
  discord: "Discord",
  teams: "Teams",
  "ms-teams": "Teams",
  spotify: "Spotify",
  steam: "Steam",
  steamwebhelper: "Steam",
  msedgewebview2: "apps com Edge WebView",
  whatsapp: "WhatsApp",
  "whatsapp.root": "WhatsApp",
  obs64: "OBS",
  photoshop: "Photoshop",
};

export function friendlyApp(name: string) {
  return FRIENDLY_APPS[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

/** The most useful finding first: a busy CPU, a full memory, a full disk, days without restarting. */
export function diagnose(checkup: Checkup): Finding[] {
  const findings: Finding[] = [];
  const byCpu = [...checkup.apps].sort((a, b) => b.cpu - a.cpu)[0];
  const byMemory = [...checkup.apps].sort((a, b) => b.memoryMb - a.memoryMb)[0];
  if (checkup.cpu >= 70 && byCpu && byCpu.cpu >= 20) findings.push({ kind: "cpu", app: byCpu });
  if (checkup.memoryUsed >= 80 && byMemory) findings.push({ kind: "memory", app: byMemory, used: checkup.memoryUsed });
  if (checkup.diskFreeGb < 10 || (checkup.diskTotalGb > 0 && checkup.diskFreeGb / checkup.diskTotalGb < 0.07)) findings.push({ kind: "disk", freeGb: checkup.diskFreeGb });
  if (checkup.uptimeHours >= 24 * 5) findings.push({ kind: "uptime", days: Math.floor(checkup.uptimeHours / 24) });
  return findings.length ? findings : [{ kind: "fine" }];
}

// ---------- Friends' clocks ----------
export type FriendClock = { name: string; zone: string };
export type FriendMoment = "sleeping" | "waking" | "working" | "evening";
export const FRIENDS_KEY = "nimbo-friend-clocks";

export const COMMON_ZONES = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/Buenos_Aires",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Berlin",
  "Africa/Luanda",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export function hourIn(zone: string, now: Date) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? NaN);
    const minute = Number(parts.find((part) => part.type === "minute")?.value ?? NaN);
    return Number.isFinite(hour) ? { hour, minute } : null;
  } catch {
    return null;
  }
}

export function momentOf(hour: number): FriendMoment {
  if (hour >= 23 || hour < 7) return "sleeping";
  if (hour < 9) return "waking";
  if (hour < 18) return "working";
  return "evening";
}

export function loadFriends(raw: string | null): FriendClock[] {
  try {
    const value = JSON.parse(raw ?? "[]");
    return Array.isArray(value)
      ? value.filter((item) => item && typeof item.name === "string" && typeof item.zone === "string" && hourIn(item.zone, new Date()) !== null).slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

// ---------- Text expander ----------
export type Snippet = { trigger: string; text: string };
export const SNIPPETS_KEY = "nimbo-snippets";

export function loadSnippets(raw: string | null): Snippet[] {
  try {
    const value = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? value.filter((item) => item && typeof item.trigger === "string" && typeof item.text === "string").slice(0, 100) : [];
  } catch {
    return [];
  }
}

/** Triggers start with ";" so they never fire inside normal words. */
export function cleanTrigger(input: string) {
  const word = input.trim().replace(/\s+/g, "").replace(/^;+/, "").slice(0, 24);
  return word ? `;${word}` : "";
}

// ---------- Launcher commands ----------
export type ToolCommand = "queue" | "shutdown" | "doctor" | "sounds" | "game" | "color" | "friends";

const TOOL_COMMANDS: [RegExp, ToolCommand][] = [
  [/^(fila( de colagem)?|colar em (ordem|sequ[eê]ncia)|paste queue|粘贴队列)$/i, "queue"],
  [/^(desliga(r)? (o pc )?quando (terminar|acabar)|quando (terminar|acabar),? desliga(r)?|shut ?down when (done|finished)|完成后关机)$/i, "shutdown"],
  [/^(por que (o )?pc (est[aá]|t[aá]) lento\??|pc lento|m[eé]dico( do pc)?|exame( do pc)?|why is (my )?pc slow\??|pc checkup|电脑为什么慢|体检)$/i, "doctor"],
  [/^(sons?( ambiente)?|chuva|lareira|ondas|ru[ií]do( marrom)?|ambient( sounds?)?|rain|白噪音|环境音)$/i, "sounds"],
  [/^(jog(o|ar)|joguinho|pega-?gotas|game|play|小游戏)$/i, "game"],
  [/^(conta-?gotas|pegar (uma )?cor|cor da tela|eyedropper|pick (a )?colou?r|取色)$/i, "color"],
  [/^(rel[oó]gio( dos amigos)?|fusos?( hor[aá]rios?)?|amigos|world clock|friends'? clocks?|time zones|朋友的时钟)$/i, "friends"],
];

export function toolCommandOf(query: string): ToolCommand | null {
  const text = query.trim();
  return TOOL_COMMANDS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}
