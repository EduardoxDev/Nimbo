/**
 * "Focus together": friends share an 8-letter code and see each other's
 * mascot focusing. Each Nimbo posts its presence every few seconds; whoever
 * stops posting leaves the group by itself. Nothing else is stored.
 *
 *   POST /v1/squads/:code/presence   { id, name, mood, focus, distracted } → { members, pokes }
 *   POST /v1/squads/:code/poke       { from, to, kind }
 */

export type SquadMember = {
  id: string;
  name: string;
  mood: string;
  focus: { status: "idle" | "running" | "paused"; remainingMs: number };
  distracted: boolean;
  at: number;
};

export type SquadPoke = { from: string; fromName: string; to: string; kind: "wave" | "focus"; at: number };

export const SQUAD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const MAX_MEMBERS = 12;
/** Gone after missing about four presence posts. */
export const MEMBER_TTL_MS = 60_000;
const MOODS = new Set(["idle", "greeting", "thinking", "working", "waiting", "done", "error", "sleeping", "annoyed", "dizzy"]);

export function validSquadCode(code: string) {
  return code.length === 8 && [...code].every((char) => SQUAD_ALPHABET.includes(char));
}

export function validMemberId(id: unknown): id is string {
  return typeof id === "string" && /^[a-f0-9]{16}$/.test(id);
}

/** Only what the island shows, cut to size; null when it is not a member. */
export function cleanMember(input: unknown, now: number): SquadMember | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, any>;
  if (!validMemberId(value.id)) return null;
  const name = typeof value.name === "string" ? [...value.name].filter((char) => char >= " ").join("").trim().slice(0, 24) : "";
  const status = value.focus?.status === "running" || value.focus?.status === "paused" ? value.focus.status : "idle";
  const remaining = Number(value.focus?.remainingMs);
  return {
    id: value.id,
    name: name || "Nimbo",
    mood: MOODS.has(value.mood) ? value.mood : "idle",
    focus: { status, remainingMs: Number.isFinite(remaining) ? Math.max(0, Math.min(remaining, 4 * 3_600_000)) : 0 },
    distracted: value.distracted === true,
    at: now,
  };
}

/** Updates one member, drops the ones that went quiet, refuses a full group. */
export function upsertMember(members: SquadMember[], member: SquadMember, now: number): SquadMember[] | null {
  const alive = members.filter((other) => now - other.at < MEMBER_TTL_MS && other.id !== member.id);
  if (alive.length >= MAX_MEMBERS) return null;
  return [...alive, member].sort((a, b) => a.name.localeCompare(b.name));
}

/** The pokes waiting for one member (handed over once) and the ones left. */
export function takePokes(pokes: SquadPoke[], id: string, now: number): { mine: SquadPoke[]; rest: SquadPoke[] } {
  const fresh = pokes.filter((poke) => now - poke.at < 10 * 60_000);
  return { mine: fresh.filter((poke) => poke.to === id), rest: fresh.filter((poke) => poke.to !== id) };
}

type SquadStored = { members?: SquadMember[]; pokes?: SquadPoke[] };

function reply(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" },
  });
}

export class Squad implements DurableObject {
  constructor(private ctx: DurableObjectState) {}

  private async get<K extends keyof SquadStored>(key: K): Promise<SquadStored[K]> {
    return this.ctx.storage.get(key) as Promise<SquadStored[K]>;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return reply({ error: "post_expected" }, 405);
    const url = new URL(request.url);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const now = Date.now();
    const members = (await this.get("members")) ?? [];

    if (url.pathname.endsWith("/presence")) {
      const member = cleanMember(body, now);
      if (!member) return reply({ error: "bad_member" }, 400);
      const next = upsertMember(members, member, now);
      if (!next) return reply({ error: "full" }, 409);
      const { mine, rest } = takePokes((await this.get("pokes")) ?? [], member.id, now);
      await this.ctx.storage.put({ members: next, pokes: rest });
      return reply({ members: next, pokes: mine });
    }

    if (url.pathname.endsWith("/poke")) {
      const from = members.find((member) => member.id === body?.from);
      const to = members.find((member) => member.id === body?.to);
      if (!from || !to || from.id === to.id) return reply({ error: "not_in_group" }, 404);
      const kind = body?.kind === "focus" ? "focus" : "wave";
      const pokes = ((await this.get("pokes")) ?? []).concat({ from: from.id, fromName: from.name, to: to.id, kind, at: now }).slice(-50);
      await this.ctx.storage.put("pokes", pokes);
      return reply({ ok: true });
    }
    return reply({ error: "not_found" }, 404);
  }
}
