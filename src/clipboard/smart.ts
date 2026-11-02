/**
 * Smart clipboard: recognises what was just copied and offers the obvious
 * next step on the island (open a link, map an address, track a parcel…).
 * Everything runs on this PC; links only open when the user clicks.
 */

export type SmartMatch =
  | { kind: "url"; url: string }
  | { kind: "email"; email: string }
  | { kind: "phone"; digits: string }
  | { kind: "address"; query: string }
  | { kind: "tracking"; code: string }
  | { kind: "color"; hex: string; rgb: string }
  | { kind: "math"; expression: string; result: string }
  | { kind: "error"; text: string }
  | { kind: "file"; path: string; name: string };

const URL_PATTERN = /^https?:\/\/[^\s<>"]+$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
/** Correios-style codes: two letters, nine digits, two letters (AA123456789BR). */
const TRACKING_PATTERN = /^[A-Z]{2}\d{9}[A-Z]{2}$/;
const CEP_PATTERN = /\b\d{5}-?\d{3}\b/;
const STREET_PATTERN = /\b(rua|r\.|avenida|av\.|alameda|travessa|rodovia|estrada|praça|praca|largo|street|st\.|avenue|ave\.|road|rd\.)\s+\S+/i;
const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
/** Error messages and stack traces from terminals, browsers and apps. */
const ERROR_PATTERN =
  /\b(?:[A-Z][a-zA-Z]*(?:Error|Exception)\b|Traceback \(most recent call last\)|panicked at|Uncaught|ENOENT|EACCES|ECONNREFUSED|ETIMEDOUT|Segmentation fault|npm ERR!|error(?:\[E\d+\])?:|fatal:|FAILED|Erro:|Falha ao|cannot find module|is not defined|undefined is not|command not found|n[aã]o [eé] reconhecido)/i;
/** A file Nimbo can summarise, copied as a path (Explorer's "Copy as path"). */
const FILE_PATTERN = /^"?([a-z]:\\[^"<>|?*]+\.(pdf|txt|md))"?$/i;

export function smartMatchOf(raw: string): SmartMatch | null {
  const text = raw.trim();
  if (!text) return null;
  // Errors can be long (a whole stack trace); everything else is short.
  if (text.length >= 12 && text.length <= 6000 && ERROR_PATTERN.test(text)) return { kind: "error", text };
  const file = FILE_PATTERN.exec(text);
  if (file) return { kind: "file", path: file[1], name: file[1].split("\\").pop() ?? file[1] };
  if (text.length > 300) return null;
  const single = !/\s/.test(text);

  if (single && URL_PATTERN.test(text)) return { kind: "url", url: text };
  if (single && EMAIL_PATTERN.test(text)) return { kind: "email", email: text };
  if (single && TRACKING_PATTERN.test(text.toUpperCase()) && /^[a-z]{2}\d{9}[a-z]{2}$/i.test(text)) {
    return { kind: "tracking", code: text.toUpperCase() };
  }

  const hex = text.match(HEX_PATTERN);
  // A bare "123" or "abcdef" is too ambiguous; colours need the # or letters and digits together.
  if (hex && (text.startsWith("#") || (/[a-f]/i.test(hex[1]) && /\d/.test(hex[1]) && hex[1].length === 6))) {
    const full = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    const value = Number.parseInt(full, 16);
    return { kind: "color", hex: `#${full.toLowerCase()}`, rgb: `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})` };
  }

  const phone = phoneDigits(text);
  if (phone) return { kind: "phone", digits: phone };

  const math = calculate(text);
  if (math !== null) return { kind: "math", expression: text, result: math };

  if (text.length >= 10 && (CEP_PATTERN.test(text) || (STREET_PATTERN.test(text) && /\d/.test(text)))) {
    return { kind: "address", query: text.replace(/\s+/g, " ") };
  }
  return null;
}

/** Brazilian numbers in any common spelling, as 55 + DDD + number. */
function phoneDigits(text: string): string | null {
  if (!/^[+\d\s().-]{10,20}$/.test(text)) return null;
  let digits = text.replace(/\D/g, "");
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  // DDD (11–99) + 8 digits (landline) or 9 starting with 9 (mobile).
  const valid = /^[1-9][1-9]\d{8}$/.test(digits) || /^[1-9][1-9]9\d{8}$/.test(digits);
  // Only when it looks typed as a phone (separators or +55), not any 11-digit id.
  const shaped = /[()\s.-]|^\+/.test(text);
  return valid && shaped ? `55${digits}` : null;
}

/** Evaluates + − × ÷ % and parentheses without eval; null when it is not a sum. */
export function calculate(text: string): string | null {
  const source = text.replace(/×/g, "*").replace(/÷/g, "/").replace(/\s+/g, "");
  if (!/^[\d.,+\-*/%()]+$/.test(source) || !/\d[+\-*/%]+[\d(]/.test(source)) return null;
  // Brazilian decimals: "1.234,5" or "2,5" → 1234.5 / 2.5.
  const normalized = source.replace(/(\d)\.(?=\d{3}(\D|$))/g, "$1").replace(/,/g, ".");
  const tokens = normalized.match(/\d+(?:\.\d+)?|[+\-*/%()]/g);
  if (!tokens || tokens.join("") !== normalized) return null;

  let at = 0;
  const peek = () => tokens[at];
  const take = () => tokens[at++];
  const expression = (): number => {
    let value = term();
    while (peek() === "+" || peek() === "-") value = take() === "+" ? value + term() : value - term();
    return value;
  };
  const term = (): number => {
    let value = factor();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = take();
      const right = factor();
      value = op === "*" ? value * right : op === "/" ? value / right : value % right;
    }
    return value;
  };
  const factor = (): number => {
    const token = take();
    if (token === "-") return -factor();
    if (token === "(") {
      const value = expression();
      if (take() !== ")") throw new Error("unbalanced");
      return value;
    }
    const value = Number(token);
    if (Number.isNaN(value)) throw new Error("not a number");
    return value;
  };
  try {
    const value = expression();
    if (at !== tokens.length || !Number.isFinite(value)) return null;
    return String(Math.round(value * 1e10) / 1e10);
  } catch {
    return null;
  }
}

/** Where each action goes. Only https and mailto, built here from the match. */
export function smartLink(match: SmartMatch): string | null {
  switch (match.kind) {
    case "url":
      return match.url;
    case "email":
      return `mailto:${match.email}`;
    case "phone":
      return `https://wa.me/${match.digits}`;
    case "address":
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(match.query)}`;
    case "tracking":
      return `https://www.google.com/search?q=${encodeURIComponent(`rastreio ${match.code}`)}`;
    default:
      return null;
  }
}
