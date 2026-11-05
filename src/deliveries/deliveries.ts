/**
 * Deliveries and rides live on the island. The phone's notifications reach Windows through
 * Phone Link (src-tauri/src/notifications.rs); the ones from iFood, Uber, 99, Rappi, Mercado
 * Livre… become a progress bar ("Saiu para entrega · ~12 min") instead of a plain notice.
 */

export type DeliveryKind = "food" | "ride" | "package";
export type DeliveryStage = "confirmed" | "preparing" | "onTheWay" | "arriving" | "arrived" | "cancelled";
export type Delivery = {
  service: string;
  name: string;
  kind: DeliveryKind;
  color: string;
  stage: DeliveryStage;
  /** When it should arrive (from "12 min" or "chega às 19:40"), or null. */
  etaAt: number | null;
  updatedAt: number;
};
export type IncomingNotification = { app: string; title: string; body: string };

type Service = { id: string; name: string; kind: DeliveryKind; color: string; match: RegExp };

// Most specific first: "Uber Eats" before "Uber", "99Food" before "99".
const SERVICES: Service[] = [
  { id: "ifood", name: "iFood", kind: "food", color: "#ea1d2c", match: /\bifood\b/i },
  { id: "ubereats", name: "Uber Eats", kind: "food", color: "#06c167", match: /\buber\s*eats\b/i },
  { id: "99food", name: "99Food", kind: "food", color: "#ffd400", match: /\b99\s*food\b/i },
  { id: "rappi", name: "Rappi", kind: "food", color: "#ff441f", match: /\brappi\b/i },
  { id: "keeta", name: "Keeta", kind: "food", color: "#ffd100", match: /\bkeeta\b/i },
  { id: "zedelivery", name: "Zé Delivery", kind: "food", color: "#ffc800", match: /\bz[ée]\s*delivery\b/i },
  { id: "uber", name: "Uber", kind: "ride", color: "#e5e5ea", match: /\buber\b/i },
  { id: "99", name: "99", kind: "ride", color: "#ffd400", match: /^\s*99\s*(?:pop|t[áa]xi|app)?\s*$|\b99\s*(?:pop|t[áa]xi)\b/i },
  { id: "indrive", name: "inDrive", kind: "ride", color: "#c1f11d", match: /\bindrive\b/i },
  { id: "mercadolivre", name: "Mercado Livre", kind: "package", color: "#ffe600", match: /\bmercado\s*(?:livre|libre)\b/i },
  { id: "shopee", name: "Shopee", kind: "package", color: "#ee4d2d", match: /\bshopee\b/i },
  { id: "amazon", name: "Amazon", kind: "package", color: "#ff9900", match: /\bamazon\b/i },
  { id: "aliexpress", name: "AliExpress", kind: "package", color: "#ff4747", match: /\baliexpress\b/i },
  { id: "magalu", name: "Magalu", kind: "package", color: "#0086ff", match: /\bmagalu\b|\bmagazine\s*luiza\b/i },
  { id: "shein", name: "Shein", kind: "package", color: "#e5e5ea", match: /\bshein\b/i },
  { id: "correios", name: "Correios", kind: "package", color: "#f8d117", match: /\bcorreios\b/i },
  { id: "loggi", name: "Loggi", kind: "package", color: "#00baff", match: /\bloggi\b/i },
];

// Checked from the last stage back, so "o pedido saiu e está chegando" counts as arriving.
const STAGES: [DeliveryStage, RegExp][] = [
  ["cancelled", /cancelad|\bcancel+ed\b/i],
  // "Será entregue hoje" is a promise, not an arrival.
  ["arriving", /ser[áa] entregue hoje|entrega (?:prevista )?(?:para )?hoje|arriv(?:es|ing) today/i],
  ["arrived", /\bchegou\b|foi entregue|(?<!ser[áa] )(?<!vai ser )\bentregue\b|est[áa] (?:te )?esperando|est[áa] aqui|\bdelivered\b|\barrived\b|\bis here\b|waiting for you/i],
  ["arriving", /\bchegando\b|est[áa] (?:bem )?(?:perto|pr[óo]xim)|quase a[íi]|saiu para (?:a )?entrega|\bnearby\b|almost there|\barriving\b|out for delivery/i],
  ["onTheWay", /a caminho|\bem rota\b|em tr[âa]nsito|\bretirad|\bcoletad|on (?:its|the|their) way|picked up|in transit/i],
  ["preparing", /preparando|em preparo|sendo preparad|\bpreparing\b/i],
  ["confirmed", /confirmad|aceit|recebemos|encontramos|motorista encontrado|aprovad|\bconfirmed\b|\baccepted\b|driver found/i],
];

const PROGRESS: Record<DeliveryStage, number> = { confirmed: 0.12, preparing: 0.35, onTheWay: 0.6, arriving: 0.85, arrived: 1, cancelled: 1 };

/** Done ones stay a moment so you see them land; stuck ones leave by themselves. */
const KEEP_DONE_MS = 3 * 60_000;
const KEEP_FOOD_OR_RIDE_MS = 90 * 60_000;
const KEEP_PACKAGE_MS = 12 * 60 * 60_000;

function serviceOf(notification: IncomingNotification) {
  // Phone Link shows the phone app's name in the app or in the first line.
  const text = `${notification.app}\n${notification.title}`;
  return SERVICES.find((service) => service.match.test(text) || service.match.test(notification.app.trim()));
}

function stageOf(text: string) {
  return STAGES.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

/** "12 min", "30-40 minutos" (the later end), or "chega às 19:40" / "até 19h40". */
export function etaOf(text: string, now: number): number | null {
  const clock = /(?:[àa]s|at|at[ée]|by)\s*(\d{1,2})(?::|h)(\d{2})/i.exec(text);
  if (clock) {
    const at = new Date(now);
    at.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
    // A time earlier than now is tomorrow's (or a mistake): only trust the next 12 hours.
    const time = at.getTime() < now ? at.getTime() + 86_400_000 : at.getTime();
    return time - now <= 12 * 60 * 60_000 ? time : null;
  }
  const minutes = /(\d{1,3})(?:\s*(?:-|a|to)\s*(\d{1,3}))?\s*min/i.exec(text);
  if (!minutes) return null;
  const value = Number(minutes[2] ?? minutes[1]);
  return value > 0 && value <= 180 ? now + value * 60_000 : null;
}

/**
 * A notification in, the deliveries out. `handled` says it was a delivery (so the island
 * shows it as one instead of a plain notice); `landed` is set when one just arrived or ended.
 */
export function receive(list: Delivery[], notification: IncomingNotification, now: number) {
  const service = serviceOf(notification);
  if (!service) return { list, handled: false, landed: null as Delivery | null };
  const text = `${notification.title}\n${notification.body}`;
  const stage = stageOf(text);
  // A package in transit for days is not live: only the day it goes out for delivery.
  if (!stage || (service.kind === "package" && stage !== "arriving" && stage !== "arrived")) {
    return { list, handled: false, landed: null };
  }
  const previous = list.find((item) => item.service === service.id);
  const next: Delivery = {
    service: service.id,
    name: service.name,
    kind: service.kind,
    color: service.color,
    stage,
    etaAt: stage === "arrived" || stage === "cancelled" ? null : etaOf(text, now) ?? previous?.etaAt ?? null,
    updatedAt: now,
  };
  const landed = (stage === "arrived" || stage === "cancelled") && previous?.stage !== stage ? next : null;
  return { list: [next, ...list.filter((item) => item.service !== service.id)], handled: true, landed };
}

/** Drops the ones that finished a while ago or stopped getting news. */
export function prune(list: Delivery[], now: number) {
  return list.filter((item) => {
    const age = now - item.updatedAt;
    if (item.stage === "arrived" || item.stage === "cancelled") return age < KEEP_DONE_MS;
    return age < (item.kind === "package" ? KEEP_PACKAGE_MS : KEEP_FOOD_OR_RIDE_MS);
  });
}

export type DeliveryCopy = {
  stage: Record<DeliveryKind, Record<DeliveryStage, string>>;
  minutes: (count: number) => string;
};

const ICON: Record<DeliveryKind, string> = { food: "🛵", ride: "🚗", package: "📦" };

/** The island's line and ring for the most urgent delivery (the one arriving soonest). */
export function deliverySummary(list: Delivery[], copy: DeliveryCopy, now: number) {
  if (list.length === 0) return null;
  const order: DeliveryStage[] = ["arrived", "arriving", "onTheWay", "preparing", "confirmed", "cancelled"];
  const main = [...list].sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage) || b.updatedAt - a.updatedAt)[0];
  const minutes = main.etaAt ? Math.max(1, Math.round((main.etaAt - now) / 60_000)) : null;
  const eta = minutes !== null && main.etaAt! > now ? ` · ${copy.minutes(minutes)}` : "";
  return {
    text: `${ICON[main.kind]} ${main.name} · ${copy.stage[main.kind][main.stage]}${eta}`,
    progress: PROGRESS[main.stage],
    color: main.stage === "cancelled" ? "#ff453a" : main.color,
    delivery: main,
  };
}
