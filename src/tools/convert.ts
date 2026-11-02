/**
 * Instant converter: copied "120 USD", "5 miles", "3pm PST" or "350°F" becomes
 * the value the user is used to. Currency rates come from the European Central
 * Bank (frankfurter.app, free, no key), cached for a day.
 */

export type Conversion = { from: string; to: string; value: string };
export type Rates = { base: "EUR"; date: string; rates: Record<string, number> };

export const RATES_KEY = "nimbo-rates";

const CURRENCY_SIGNS: [RegExp, string][] = [
  [/^(?:us\$|u\$s|usd)$/i, "USD"],
  [/^(?:r\$|brl|reais?)$/i, "BRL"],
  [/^(?:€|eur|euros?)$/i, "EUR"],
  [/^(?:£|gbp|libras?)$/i, "GBP"],
  [/^(?:¥|jpy|ienes?)$/i, "JPY"],
  [/^(?:cny|rmb|yuan|元)$/i, "CNY"],
  [/^(?:cad|c\$)$/i, "CAD"],
  [/^(?:aud|a\$)$/i, "AUD"],
  [/^(?:chf)$/i, "CHF"],
  [/^(?:mxn)$/i, "MXN"],
  [/^\$$/, "USD"],
];

function currencyOf(sign: string) {
  return CURRENCY_SIGNS.find(([pattern]) => pattern.test(sign.trim()))?.[1] ?? null;
}

/** "1.234,56" (pt) and "1,234.56" (en) both become 1234.56. */
export function parseAmount(text: string): number | null {
  const clean = text.replace(/\s/g, "");
  if (!/^\d[\d.,]*$/.test(clean)) return null;
  const lastComma = clean.lastIndexOf(",");
  const lastDot = clean.lastIndexOf(".");
  let normal = clean;
  if (lastComma > lastDot) normal = clean.replace(/\./g, "").replace(",", ".");
  else if (lastDot > lastComma && lastComma !== -1) normal = clean.replace(/,/g, "");
  else if (lastComma === -1 && /^\d{1,3}(\.\d{3})+$/.test(clean)) normal = clean.replace(/\./g, "");
  const value = Number(normal);
  return Number.isFinite(value) ? value : null;
}

function format(value: number, localeTag: string, digits = 2) {
  return value.toLocaleString(localeTag, { maximumFractionDigits: digits });
}

export function homeCurrency(localeTag: string) {
  return localeTag.startsWith("pt") ? "BRL" : localeTag.startsWith("zh") ? "CNY" : "USD";
}

function convertMoney(amount: number, from: string, to: string, rates: Rates | null): number | null {
  if (!rates || from === to) return null;
  const inEur = (code: string) => (code === "EUR" ? 1 : rates.rates[code]);
  const fromRate = inEur(from);
  const toRate = inEur(to);
  if (!fromRate || !toRate) return null;
  return (amount / fromRate) * toRate;
}

const UNITS: { pattern: RegExp; to: string; factor?: number; convert?: (value: number) => number; digits?: number }[] = [
  { pattern: /^(?:mi|miles?|milhas?)$/i, to: "km", factor: 1.609344, digits: 1 },
  { pattern: /^(?:km|quil[oô]metros?)$/i, to: "mi", factor: 1 / 1.609344, digits: 1 },
  { pattern: /^(?:lbs?|pounds?)$/i, to: "kg", factor: 0.45359237, digits: 1 },
  { pattern: /^(?:oz|ounces?)$/i, to: "g", factor: 28.3495, digits: 0 },
  { pattern: /^(?:ft|feet|foot|p[eé]s?)$/i, to: "m", factor: 0.3048, digits: 2 },
  { pattern: /^(?:in|inch(?:es)?|polegadas?|")$/i, to: "cm", factor: 2.54, digits: 1 },
  { pattern: /^(?:gal|gallons?|gal[oõ]es)$/i, to: "L", factor: 3.785411784, digits: 1 },
  { pattern: /^(?:mph)$/i, to: "km/h", factor: 1.609344, digits: 0 },
  { pattern: /^(?:°?f|ºf|fahrenheit)$/i, to: "°C", convert: (value) => ((value - 32) * 5) / 9, digits: 0 },
  { pattern: /^(?:°?c|ºc|celsius)$/i, to: "°F", convert: (value) => (value * 9) / 5 + 32, digits: 0 },
];

const ZONES: Record<string, number> = {
  PST: -8, PDT: -7, PT: -7, MST: -7, MDT: -6, CST: -6, CDT: -5, CT: -5, EST: -5, EDT: -4, ET: -4,
  UTC: 0, GMT: 0, BST: 1, CET: 1, CEST: 2, WET: 0, WEST: 1, EET: 2, EEST: 3, IST: 5.5, JST: 9, KST: 9, AEST: 10, AEDT: 11, BRT: -3,
};

/** "3pm PST" or "15:30 CET" in the user's own time. */
function convertTime(text: string, now: Date, localeTag: string): Conversion | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+([A-Z]{2,4})$/i.exec(text.trim());
  if (!match) return null;
  const zone = ZONES[match[4].toUpperCase()];
  if (zone === undefined) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute) - zone * 3_600_000;
  const local = new Date(utc);
  const value = local.toLocaleTimeString(localeTag, { hour: "2-digit", minute: "2-digit" });
  const dayShift = local.getDate() - now.getDate();
  return { from: text.trim(), to: "local", value: dayShift === 0 ? value : `${value} (${dayShift > 0 ? "+1" : "-1"})` };
}

/** What a copied text converts to, or null when it is not an amount, a unit or a time. */
export function convertText(text: string, input: { rates: Rates | null; localeTag: string; now: Date }): Conversion | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 40) return null;
  const time = convertTime(trimmed, input.now, input.localeTag);
  if (time) return time;
  const money = /^(us\$|u\$s|r\$|c\$|a\$|[$€£¥])?\s*([\d][\d.,\s]*)\s*([a-z]{3}|reais?|euros?|libras?|yuan|元)?$/i.exec(trimmed);
  if (money && (money[1] || money[3])) {
    const code = currencyOf(money[1] ?? money[3] ?? "");
    const amount = parseAmount(money[2]);
    const home = homeCurrency(input.localeTag);
    const target = code === home ? (home === "USD" ? "BRL" : "USD") : home;
    if (code && amount !== null) {
      const converted = convertMoney(amount, code, target, input.rates);
      if (converted !== null) {
        const value = converted.toLocaleString(input.localeTag, { style: "currency", currency: target });
        return { from: trimmed, to: target, value };
      }
    }
  }
  const unit = /^(-?[\d][\d.,]*)\s*(°?[a-zçº"]+(?:\/h)?|º[cf])$/i.exec(trimmed);
  if (unit) {
    const amount = unit[1].startsWith("-") ? -(parseAmount(unit[1].slice(1)) ?? NaN) : parseAmount(unit[1]);
    const rule = UNITS.find((item) => item.pattern.test(unit[2]));
    if (rule && amount !== null && Number.isFinite(amount)) {
      const value = rule.convert ? rule.convert(amount) : amount * (rule.factor ?? 1);
      return { from: trimmed, to: rule.to, value: `${format(value, input.localeTag, rule.digits ?? 2)} ${rule.to}` };
    }
  }
  return null;
}

export function loadRates(raw: string | null): Rates | null {
  try {
    const value = JSON.parse(raw ?? "null");
    return value && typeof value.date === "string" && value.rates && typeof value.rates === "object" ? (value as Rates) : null;
  } catch {
    return null;
  }
}

/** Rates from the day before are fine; older ones are fetched again. */
export function ratesStale(rates: Rates | null, now: Date) {
  if (!rates) return true;
  return now.getTime() - new Date(`${rates.date}T00:00:00Z`).getTime() > 3 * 86_400_000;
}
