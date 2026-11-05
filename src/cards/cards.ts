/**
 * Live cards made on request ("acompanha o dólar", "placar do Flamengo"). The recipe comes
 * from the AI and the values from src-tauri/src/cards.rs; this file keeps them, decides when
 * to refresh, when a value crosses the alert, and what the island shows.
 */

export type CardAlert = { op: "above" | "below"; value: number };
export type CardRecipe = { title: string; url: string; path: string; prefix: string; unit: string; refreshMinutes: number; alert: CardAlert | null };
export type LiveCard = CardRecipe & { id: string; value: string; previous: string | null; updatedAt: number; alerted: boolean };

export const CARDS_KEY = "nimbo-cards";
export const MAX_CARDS = 6;

export function loadCards(storage: Pick<Storage, "getItem"> = window.localStorage): LiveCard[] {
  try {
    const list = JSON.parse(storage.getItem(CARDS_KEY) ?? "[]");
    if (!Array.isArray(list)) return [];
    return list
      .filter((card) => card && typeof card.id === "string" && typeof card.url === "string" && card.url.startsWith("https://") && typeof card.path === "string")
      .slice(0, MAX_CARDS)
      .map((card) => ({
        id: card.id,
        title: String(card.title ?? "").slice(0, 40),
        url: card.url,
        path: card.path,
        prefix: String(card.prefix ?? "").slice(0, 8),
        unit: String(card.unit ?? "").slice(0, 8),
        refreshMinutes: Math.min(240, Math.max(5, Number(card.refreshMinutes) || 15)),
        alert: card.alert && (card.alert.op === "above" || card.alert.op === "below") && Number.isFinite(card.alert.value) ? card.alert : null,
        value: String(card.value ?? ""),
        previous: card.previous == null ? null : String(card.previous),
        updatedAt: Number(card.updatedAt) || 0,
        alerted: card.alerted === true,
      }));
  } catch {
    return [];
  }
}

export function saveCards(cards: LiveCard[], storage: Pick<Storage, "setItem"> = window.localStorage) {
  try {
    storage.setItem(CARDS_KEY, JSON.stringify(cards.slice(0, MAX_CARDS)));
  } catch {
    // Kept for this session only.
  }
}

/** "acompanha o dólar", "fica de olho no bitcoin", "track the euro" → what to follow. */
export function cardRequestOf(text: string): string | null {
  const match = text
    .trim()
    .match(/^(?:ei,?\s+nimbo,?\s+)?(?:acompanh[ae]r?|monitor[ae]r?|fica(?:r)? de olho (?:em|no|na|nos|nas)|cria(?:r)? (?:um )?cart[ãa]o (?:d[eoa]s?|para|pra|com)|mostra(?:r)? ao vivo|track|watch|keep an eye on|make a (?:live )?card (?:for|with))\s+(.+?)[.!?]*$/i);
  return match ? match[1].trim() : null;
}

/** "para de acompanhar o dólar", "tira o cartão do bitcoin", "stop tracking the euro" → which. */
export function cardStopOf(text: string): string | null {
  const match = text
    .trim()
    .match(/^(?:para(?:r)? de (?:acompanhar|monitorar)|tira(?:r)? o cart[ãa]o (?:d[eoa]s?)?|remove(?:r)? o cart[ãa]o (?:d[eoa]s?)?|stop (?:tracking|watching)|remove the (?:live )?card (?:for )?)\s*(.+?)[.!?]*$/i);
  return match ? match[1].trim().replace(/^(?:o|a|os|as|the)\s+/i, "") : null;
}

const fold = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function findCard(cards: LiveCard[], name: string) {
  const wanted = fold(name);
  return cards.find((card) => fold(card.title).includes(wanted) || wanted.includes(fold(card.title))) ?? null;
}

/** "5.4210" or "5,42" → 5.421; null when it is not a number. */
export function numberOf(value: string) {
  const clean = value.trim().replace(/\s/g, "");
  const normalized = /,\d{1,2}$/.test(clean) && !clean.includes(".") ? clean.replace(",", ".") : clean.replace(/,/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) && normalized !== "" ? number : null;
}

/** The alert fires once when the value crosses it, and re-arms when it goes back. */
export function crossed(card: Pick<LiveCard, "alert" | "alerted">, value: string): { fire: boolean; alerted: boolean } {
  const number = numberOf(value);
  if (!card.alert || number === null) return { fire: false, alerted: card.alerted };
  const beyond = card.alert.op === "above" ? number >= card.alert.value : number <= card.alert.value;
  return { fire: beyond && !card.alerted, alerted: beyond };
}

export function isDue(card: Pick<LiveCard, "updatedAt" | "refreshMinutes">, now: number) {
  return now - card.updatedAt >= card.refreshMinutes * 60_000;
}

/** Numbers shown the local way, with the trend since the last look. */
export function cardText(card: Pick<LiveCard, "title" | "prefix" | "unit" | "value" | "previous">, localeTag: string) {
  const number = numberOf(card.value);
  const value = number === null ? card.value : number.toLocaleString(localeTag, { maximumFractionDigits: Math.abs(number) < 10 ? 2 : Math.abs(number) < 1000 ? 1 : 0 });
  const before = card.previous === null ? null : numberOf(card.previous);
  const trend = number === null || before === null || number === before ? "" : number > before ? " ▲" : " ▼";
  return `${card.title} · ${card.prefix}${value}${card.unit}${trend}`;
}
