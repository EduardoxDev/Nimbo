/**
 * Scam check for copied links and messages, all on this PC: look-alike domains
 * ("paypa1.com", "itau-seguro.xyz"), brands on someone else's site, hidden
 * destinations and "urgent Pix" messages. It warns; it never blocks.
 */

export type ScamReason = "lookalike" | "brandElsewhere" | "shortener" | "ipAddress" | "punycode" | "riskyTld" | "atSign" | "pixUrgency";
export type ScamCheck = { level: "danger" | "warn"; reasons: ScamReason[]; brand: string | null; host: string | null };

/** Brands people get phished with in Brazil and abroad, with their real domains. */
const BRANDS: { name: string; domains: string[] }[] = [
  { name: "Itaú", domains: ["itau.com.br"] },
  { name: "Bradesco", domains: ["bradesco.com.br"] },
  { name: "Banco do Brasil", domains: ["bb.com.br"] },
  { name: "Caixa", domains: ["caixa.gov.br"] },
  { name: "Santander", domains: ["santander.com.br"] },
  { name: "Nubank", domains: ["nubank.com.br"] },
  { name: "Inter", domains: ["bancointer.com.br", "inter.co"] },
  { name: "Mercado Livre", domains: ["mercadolivre.com.br", "mercadolibre.com"] },
  { name: "Mercado Pago", domains: ["mercadopago.com.br"] },
  { name: "PayPal", domains: ["paypal.com"] },
  { name: "Amazon", domains: ["amazon.com", "amazon.com.br"] },
  { name: "Netflix", domains: ["netflix.com"] },
  { name: "Microsoft", domains: ["microsoft.com", "live.com", "office.com"] },
  { name: "Apple", domains: ["apple.com", "icloud.com"] },
  { name: "Google", domains: ["google.com", "gmail.com"] },
  { name: "Instagram", domains: ["instagram.com"] },
  { name: "Facebook", domains: ["facebook.com"] },
  { name: "WhatsApp", domains: ["whatsapp.com"] },
  { name: "Correios", domains: ["correios.com.br"] },
  { name: "Receita Federal", domains: ["gov.br"] },
  { name: "Shopee", domains: ["shopee.com.br"] },
  { name: "Magalu", domains: ["magazineluiza.com.br", "magalu.com"] },
  { name: "Steam", domains: ["steampowered.com", "steamcommunity.com"] },
];

const SHORTENERS = ["bit.ly", "tinyurl.com", "cutt.ly", "is.gd", "t.co", "encurtador.com.br", "rebrand.ly", "shorturl.at", "goo.su", "tiny.cc"];
const RISKY_TLDS = ["xyz", "top", "click", "shop", "online", "site", "live", "icu", "buzz", "monster", "rest", "cfd", "sbs", "lol", "zip", "mov"];
const URGENCY = /(pix|boleto|transfer[eê]ncia|pagamento|conta|cart[aã]o|senha|c[oó]digo)[^.!?]{0,60}(urgente|agora|hoje|bloquead|suspens|vence|expira|imediat)|(urgente|bloquead|suspens)[^.!?]{0,60}(pix|conta|cart[aã]o|senha)/i;

/** "www.itau.com.br" → "itau.com.br"; keeps the two-part endings Brazil uses. */
export function registrableDomain(host: string) {
  const parts = host.toLowerCase().replace(/\.$/, "").split(".");
  const twoPart = parts.length >= 3 && ["com", "gov", "org", "net", "edu", "co"].includes(parts[parts.length - 2]) && parts[parts.length - 1].length === 2;
  return parts.slice(twoPart ? -3 : -2).join(".");
}

/** The look-alike tricks: 1 for l, 0 for o, rn for m, and so on. */
export function unconfuse(text: string) {
  return text.toLowerCase().replace(/rn/g, "m").replace(/vv/g, "w").replace(/[10]/g, (digit) => (digit === "1" ? "l" : "o")).replace(/5/g, "s").replace(/3/g, "e").replace(/@/g, "a");
}

function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

function brandKey(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "");
}

export function checkLink(raw: string): ScamCheck | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase();
  const domain = registrableDomain(host);
  const reasons: ScamReason[] = [];
  let brand: string | null = null;

  const official = BRANDS.find((item) => item.domains.some((real) => domain === real || host.endsWith(`.${real}`)));
  if (!official) {
    const label = unconfuse(domain.split(".")[0]);
    const whole = unconfuse(host.replace(/[.-]/g, ""));
    for (const item of BRANDS) {
      const key = brandKey(item.name);
      const realLabels = item.domains.map((real) => real.split(".")[0]);
      if (realLabels.some((real) => label !== real && real.length >= 5 && distance(label, real) <= 2)) {
        reasons.push("lookalike");
        brand = item.name;
        break;
      }
      if (key.length >= 4 && whole.includes(key)) {
        reasons.push("brandElsewhere");
        brand = item.name;
        break;
      }
    }
  }
  if (SHORTENERS.includes(domain)) reasons.push("shortener");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) reasons.push("ipAddress");
  if (host.split(".").some((part) => part.startsWith("xn--"))) reasons.push("punycode");
  if (RISKY_TLDS.includes(host.split(".").pop() ?? "")) reasons.push("riskyTld");
  if (url.username || raw.includes("@") && raw.indexOf("@") < raw.indexOf(host)) reasons.push("atSign");

  if (!reasons.length) return null;
  const danger = reasons.includes("lookalike") || reasons.includes("brandElsewhere") || reasons.includes("punycode") || reasons.includes("atSign") || (reasons.includes("ipAddress") && reasons.length > 1);
  return { level: danger ? "danger" : "warn", reasons, brand, host };
}

/** A copied message (not just a link): an "urgent Pix" story plus any link in it. */
export function checkText(text: string): ScamCheck | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const links = trimmed.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  const linkChecks = links.map(checkLink).filter((check): check is ScamCheck => check !== null);
  const urgent = URGENCY.test(trimmed);
  const worst = linkChecks.find((check) => check.level === "danger") ?? linkChecks[0] ?? null;
  if (!urgent) return worst;
  const reasons: ScamReason[] = ["pixUrgency", ...(worst?.reasons ?? [])];
  return { level: worst || links.length ? "danger" : "warn", reasons, brand: worst?.brand ?? null, host: worst?.host ?? null };
}
