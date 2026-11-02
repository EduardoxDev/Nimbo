/**
 * Alexa pairing: the PC asks for a short code, the user says it to the
 * "Nimbo" skill, and the skill trades it for the room id and secret. Codes
 * last ten minutes, work once, and only the skill (with ALEXA_SKILL_SECRET)
 * can trade them.
 *
 *   POST /v1/rooms/:room/alexa-code?key=…   (PC)    → { code }
 *   POST /v1/alexa/pair  { code }           (skill) → { room, key }
 */

export const CODE_TTL_MS = 10 * 60_000;

export type Pairing = { room: string; key: string; expiresAt: number };

export function newCode(random: Uint8Array) {
  const value = ((random[0] << 16) | (random[1] << 8) | random[2]) % 1_000_000;
  return String(value).padStart(6, "0");
}

export function validCode(code: unknown): code is string {
  return typeof code === "string" && /^\d{6}$/.test(code);
}

export function codeFromSpeech(spoken: unknown) {
  const digits = String(spoken ?? "").replace(/\D/g, "");
  return digits.length > 0 && digits.length <= 6 ? digits.padStart(6, "0") : null;
}

export function sameSecret(given: string | null, expected: string | undefined) {
  if (!expected || expected.length < 24 || !given || given.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < given.length; index += 1) difference |= given.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

export function stillValid(pairing: Pairing | undefined, now: number): pairing is Pairing {
  return Boolean(pairing) && (pairing as Pairing).expiresAt > now;
}

export class Pairings implements DurableObject {
  constructor(private ctx: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/store" && request.method === "POST") {
      const pairing = (await request.json()) as Pairing;
      await this.ctx.storage.put("pairing", pairing);
      await this.ctx.storage.setAlarm(pairing.expiresAt);
      return new Response("ok");
    }
    if (url.pathname === "/take" && request.method === "POST") {
      const pairing = (await this.ctx.storage.get("pairing")) as Pairing | undefined;
      await this.ctx.storage.deleteAll();
      if (!stillValid(pairing, Date.now())) return new Response("expired", { status: 404 });
      return Response.json({ room: pairing.room, key: pairing.key });
    }
    return new Response("not found", { status: 404 });
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
