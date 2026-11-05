/**
 * Nimbo relay: lets the iPhone app reach the Nimbo on a PC from anywhere.
 *
 * Each PC owns a "room" (random id + secret code, shared by QR code). The PC
 * and the phones connect to the room by WebSocket; the room passes commands
 * from phones to the PC, status from the PC to phones, keeps the latest status
 * for the widgets, and pushes it to the iPhone's island (Live Activity).
 *
 *   GET /v1/rooms/:room/ws?role=pc|phone&key=…   WebSocket (the PC also sends &pc=…, a code only it knows)
 *   GET /v1/rooms/:room/status?key=…             latest status (widgets)
 *   GET /v1/rooms/:room/cover?key=…              album art of what is playing
 *   POST /v1/rooms/:room/command?key=…           one command (widget and island buttons)
 *   POST /v1/rooms/:room/files?key=…&from=…&name=…   a file for the other side (up to 25 MB, kept a day)
 *   GET  /v1/rooms/:room/files?key=…              files waiting
 *   GET|DELETE /v1/rooms/:room/files/:id?key=…    download or remove one
 *   POST /v1/squads/:code/presence|poke           "focus together" with friends (src/squad.ts)
 *   POST /v1/rooms/:room/alexa-code?key=…        a 6-digit code to connect the Alexa skill (src/alexa.ts)
 *   POST /v1/alexa/pair                          the skill trades the code for the room (needs ALEXA_SKILL_SECRET)
 *   GET /v1/vapid                                public key for web notifications
 *   everything else                              the Nimbo web app (mobile/, built for the web)
 */

import { activityOf, hashKey, MAX_MESSAGE, pcAccess, SAVE_STATUS_EVERY, settledStatus, shouldPush, validKey, validRoom, type ActivityState, type IslandStatus } from "./protocol";
import { pushActivity, type ApnsEnv } from "./apns";
import { sendWebPush, validSubscription, type PushSubscription, type WebPushEnv } from "./webpush";
import { Squad, validSquadCode } from "./squad";
import { CODE_TTL_MS, newCode, Pairings, sameSecret, validCode } from "./alexa";
import { attachmentHeader, CHUNK, chunkCount, cleanFileName, MAX_FILE, pruneFiles, validFileId, type FileMeta } from "./files";

export interface Env extends ApnsEnv, WebPushEnv {
  ROOMS: DurableObjectNamespace;
  SQUADS: DurableObjectNamespace;
  PAIRINGS: DurableObjectNamespace;
  /** Shared with the Alexa skill's config.js: npx wrangler secret put ALEXA_SKILL_SECRET */
  ALEXA_SKILL_SECRET?: string;
  /** The web app's files (wrangler.toml [assets]). */
  ASSETS?: Fetcher;
}

const COMMANDS = new Set(["play_pause", "next", "previous", "focus_start", "focus_pause", "focus_skip", "task_toggle", "task_add", "water_add", "lock", "shutdown_cancel", "send_text", "approve", "deny", "ring", "read_later_add", "read_later_done"]);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("Nimbo relay", { headers: { "content-type": "text/plain" } });
    if (url.pathname === "/v1/vapid") return json({ key: env.VAPID_PUBLIC_KEY ?? null });
    // The web app: Safari → Share → Add to Home Screen turns it into an app.
    if (!url.pathname.startsWith("/v1/")) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Nimbo relay", { headers: { "content-type": "text/plain" } });
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/v1/alexa/pair" && request.method === "POST") {
      if (!sameSecret(request.headers.get("x-nimbo-skill"), env.ALEXA_SKILL_SECRET)) return json({ error: "forbidden" }, 403);
      const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
      if (!validCode(body?.code)) return json({ error: "bad_code" }, 400);
      const taken = await env.PAIRINGS.get(env.PAIRINGS.idFromName(body.code)).fetch("https://pairing/take", { method: "POST" });
      if (!taken.ok) return json({ error: "expired" }, 404);
      return json(await taken.json());
    }
    const squad = /^\/v1\/squads\/([A-Z0-9]{8})\/(presence|poke)$/.exec(url.pathname);
    if (squad) {
      if (!validSquadCode(squad[1])) return json({ error: "bad_code" }, 400);
      return env.SQUADS.get(env.SQUADS.idFromName(squad[1])).fetch(request);
    }
    const match = /^\/v1\/rooms\/([a-f0-9]{32})\/(ws|status|cover|command|alexa-code|files(?:\/[a-f0-9]{16})?)$/.exec(url.pathname);
    if (!match || !validRoom(match[1])) return json({ error: "not_found" }, 404);
    if (!validKey(url.searchParams.get("key") ?? "")) return json({ error: "bad_key" }, 403);
    const room = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
    return room.fetch(request);
  },
};

type Stored = {
  keyHash?: string;
  /** The PC's own code, hashed: phones and the Alexa skill never get it. */
  pcKeyHash?: string;
  status?: IslandStatus;
  cover?: string | null;
  inbox?: { id: number; text: string }[];
  tokens?: string[];
  lastActivity?: ActivityState;
  lastPushAt?: number;
  webPush?: PushSubscription[];
  lastNotice?: string;
  files?: FileMeta[];
};

export { Squad, Pairings };

export class Room implements DurableObject {
  /** The latest status, kept in memory; storage only gets it when it settles (see settledStatus). */
  private latest: IslandStatus | null = null;
  private saved = { key: "", at: 0 };

  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {}

  private async get<K extends keyof Stored>(key: K): Promise<Stored[K]> {
    return this.ctx.storage.get(key) as Promise<Stored[K]>;
  }

  private sockets(role: "pc" | "phone") {
    return this.ctx.getWebSockets(role);
  }

  private broadcast(role: "pc" | "phone", message: unknown) {
    const text = JSON.stringify(message);
    for (const socket of this.sockets(role)) {
      try {
        socket.send(text);
      } catch {
        // A closed socket is cleaned up by the runtime.
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const role = url.searchParams.get("role") === "pc" ? "pc" : "phone";
    const keyHash = await hashKey(url.searchParams.get("key") ?? "");
    const stored = await this.get("keyHash");
    if (!stored) {
      // A room is created by its PC; phones cannot invent one.
      if (role !== "pc" || !url.pathname.endsWith("/ws")) return json({ error: "unknown_room" }, 404);
      await this.ctx.storage.put("keyHash", keyHash);
    } else if (stored !== keyHash) {
      return json({ error: "bad_key" }, 403);
    }

    const pcKey = url.searchParams.get("pc");
    const pcHash = pcKey && validKey(pcKey) ? await hashKey(`pc:${pcKey}`) : null;
    const actsAsPc = role === "pc" || (url.pathname.includes("/files") && request.method === "POST" && url.searchParams.get("from") === "pc");
    if (actsAsPc) {
      const access = pcAccess(await this.get("pcKeyHash"), pcHash);
      if (access === "denied") return json({ error: "not_the_pc" }, 403);
      if (access === "claim" && pcHash) await this.ctx.storage.put("pcKeyHash", pcHash);
    }

    if (url.pathname.endsWith("/status")) {
      return json({ status: this.latest ?? (await this.get("status")) ?? null, pcOnline: this.sockets("pc").length > 0 });
    }
    if (url.pathname.endsWith("/cover")) {
      return json({ cover: (await this.get("cover")) ?? null });
    }
    const fileMatch = /\/files(?:\/([a-f0-9]{16}))?$/.exec(url.pathname);
    if (fileMatch) return this.files(request, url, fileMatch[1] ?? null);
    if (url.pathname.endsWith("/alexa-code") && request.method === "POST") {
      const code = newCode(crypto.getRandomValues(new Uint8Array(3)));
      const room = /\/v1\/rooms\/([a-f0-9]{32})\//.exec(url.pathname)?.[1] ?? "";
      const pairing = { room, key: url.searchParams.get("key") ?? "", expiresAt: Date.now() + CODE_TTL_MS };
      await this.env.PAIRINGS.get(this.env.PAIRINGS.idFromName(code)).fetch("https://pairing/store", { method: "POST", body: JSON.stringify(pairing) });
      return json({ code, expiresAt: pairing.expiresAt });
    }
    if (url.pathname.endsWith("/command") && request.method === "POST") {
      const body = (await request.json().catch(() => null)) as { action?: unknown; value?: unknown } | null;
      const action = typeof body?.action === "string" ? body.action : "";
      if (!COMMANDS.has(action)) return json({ ok: false, error: "unknown_command" }, 400);
      if (this.sockets("pc").length === 0) return json({ ok: false, error: "pc_offline" }, 409);
      this.broadcast("pc", { type: "command", action, value: typeof body?.value === "string" ? body.value.slice(0, 10_000) : "" });
      return json({ ok: true });
    }
    if (request.headers.get("upgrade") !== "websocket") return json({ error: "websocket_expected" }, 426);

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [role]);
    if (role === "pc") {
      this.broadcast("phone", { type: "pc", online: true });
    } else {
      server.send(
        JSON.stringify({
          type: "hello",
          status: this.latest ?? (await this.get("status")) ?? null,
          pcOnline: this.sockets("pc").length > 0,
          inbox: (await this.get("inbox")) ?? [],
          files: ((await this.get("files")) ?? []).filter((file) => file.from === "pc"),
        }),
      );
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const role = this.ctx.getTags(socket)[0];
    if (role === "pc") await this.fromPc(message);
    else await this.fromPhone(socket, message);
  }

  private async fromPc(message: Record<string, unknown>) {
    if (message.type === "status" && message.status && typeof message.status === "object") {
      const status = message.status as IslandStatus;
      this.latest = status;
      // The PC sends every 2 s; writing each one would be tens of thousands of writes a day.
      const key = settledStatus(status);
      const now = Date.now();
      if (key !== this.saved.key || now - this.saved.at >= SAVE_STATUS_EVERY) {
        this.saved = { key, at: now };
        await this.ctx.storage.put("status", status);
      }
      this.broadcast("phone", { type: "status", status });
      await this.pushIsland(status);
      await this.notifyWeb(status);
    } else if (message.type === "cover") {
      const cover = typeof message.cover === "string" && message.cover.startsWith("data:image/") ? message.cover : null;
      await this.ctx.storage.put("cover", cover);
      this.broadcast("phone", { type: "cover", cover });
    } else if (message.type === "push_text" && typeof message.text === "string") {
      const inbox = ((await this.get("inbox")) ?? []).concat({ id: Date.now(), text: message.text.slice(0, 10_000) }).slice(-20);
      await this.ctx.storage.put("inbox", inbox);
      this.broadcast("phone", { type: "inbox", item: inbox[inbox.length - 1] });
    }
  }

  private async fromPhone(socket: WebSocket, message: Record<string, unknown>) {
    if (message.type === "command" && typeof message.action === "string" && COMMANDS.has(message.action)) {
      if (this.sockets("pc").length === 0) {
        socket.send(JSON.stringify({ type: "error", code: "pc_offline" }));
        return;
      }
      const value = typeof message.value === "string" ? message.value.slice(0, 10_000) : "";
      this.broadcast("pc", { type: "command", action: message.action, value });
    } else if (message.type === "activity_token" && typeof message.token === "string" && /^[a-f0-9]{16,200}$/i.test(message.token)) {
      const tokens = new Set((await this.get("tokens")) ?? []);
      tokens.add(message.token);
      await this.ctx.storage.put("tokens", [...tokens].slice(-5));
    } else if (message.type === "web_push" && validSubscription(message.subscription)) {
      const subscription = message.subscription as PushSubscription;
      const list = ((await this.get("webPush")) ?? []).filter((item) => item.endpoint !== subscription.endpoint);
      await this.ctx.storage.put("webPush", [...list, subscription].slice(-5));
    } else if (message.type === "ping") {
      socket.send(JSON.stringify({ type: "pong" }));
    }
  }

  /** Files between the PC and the phone: stored in 1 MB pieces, gone after a day. */
  private async files(request: Request, url: URL, id: string | null): Promise<Response> {
    const list = (await this.get("files")) ?? [];
    if (!id && request.method === "GET") return json({ files: list });
    if (!id && request.method === "POST") {
      const from = url.searchParams.get("from") === "pc" ? "pc" : "phone";
      const length = Number(request.headers.get("content-length") ?? "0");
      if (length > MAX_FILE) return json({ ok: false, error: "too_big" }, 413);
      const body = new Uint8Array(await request.arrayBuffer());
      if (body.byteLength === 0) return json({ ok: false, error: "empty" }, 400);
      if (body.byteLength > MAX_FILE) return json({ ok: false, error: "too_big" }, 413);
      const meta: FileMeta = {
        id: [...crypto.getRandomValues(new Uint8Array(8))].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
        name: cleanFileName(url.searchParams.get("name") ?? ""),
        size: body.byteLength,
        type: (request.headers.get("content-type") ?? "application/octet-stream").slice(0, 100),
        from,
        at: Date.now(),
        chunks: chunkCount(body.byteLength),
      };
      for (let index = 0; index < meta.chunks; index += 1) {
        await this.ctx.storage.put(`file:${meta.id}:${index}`, body.slice(index * CHUNK, (index + 1) * CHUNK));
      }
      const { keep, drop } = pruneFiles([meta, ...list], Date.now());
      for (const old of drop) await this.dropChunks(old);
      await this.ctx.storage.put("files", keep);
      this.broadcast(from === "pc" ? "phone" : "pc", { type: "file", file: meta });
      if (from === "pc") await this.notifyFile(meta);
      return json({ ok: true, file: meta });
    }
    const meta = list.find((file) => file.id === id);
    if (!id || !validFileId(id) || !meta) return json({ error: "not_found" }, 404);
    if (request.method === "DELETE") {
      await this.dropChunks(meta);
      await this.ctx.storage.put("files", list.filter((file) => file.id !== id));
      return json({ ok: true });
    }
    const body = new Uint8Array(meta.size);
    for (let index = 0; index < meta.chunks; index += 1) {
      const part = await this.ctx.storage.get<Uint8Array>(`file:${meta.id}:${index}`);
      if (!part) return json({ error: "gone" }, 410);
      body.set(new Uint8Array(part), index * CHUNK);
    }
    return new Response(body, {
      headers: { "content-type": meta.type, "content-length": String(meta.size), "content-disposition": attachmentHeader(meta.name), "cache-control": "no-store", ...CORS },
    });
  }

  private async dropChunks(meta: FileMeta) {
    const keys = Array.from({ length: meta.chunks }, (_, index) => `file:${meta.id}:${index}`);
    for (let start = 0; start < keys.length; start += 128) await this.ctx.storage.delete(keys.slice(start, start + 128));
  }

  /** A file from the PC also arrives as a notification on phones that asked for them. */
  private async notifyFile(meta: FileMeta) {
    const subscriptions = (await this.get("webPush")) ?? [];
    const status = await this.get("status");
    for (const subscription of subscriptions) {
      await sendWebPush(this.env, subscription, { title: status?.pc ?? "Nimbo", body: `📎 ${meta.name}`, tag: `nimbo-file-${meta.id}` }).catch(() => true);
    }
  }

  /** Keeps every registered iPhone island in step, without pushing every second. */
  private async pushIsland(status: IslandStatus) {
    const tokens = (await this.get("tokens")) ?? [];
    if (tokens.length === 0) return;
    const now = Date.now();
    const next = activityOf(status, now);
    if (!shouldPush((await this.get("lastActivity")) ?? null, next, (await this.get("lastPushAt")) ?? 0, now)) return;
    await this.ctx.storage.put({ lastActivity: next, lastPushAt: now });
    const alive: string[] = [];
    for (const token of tokens) {
      if (await pushActivity(this.env, token, next).catch(() => true)) alive.push(token);
    }
    if (alive.length !== tokens.length) await this.ctx.storage.put("tokens", alive);
  }

  /** A new notice on the PC island becomes a notification on phones that asked for it. */
  private async notifyWeb(status: IslandStatus) {
    const notice = status.island?.text ?? "";
    const last = (await this.get("lastNotice")) ?? "";
    if (notice === last) return;
    await this.ctx.storage.put("lastNotice", notice);
    const subscriptions = (await this.get("webPush")) ?? [];
    if (!notice || subscriptions.length === 0) return;
    const alive: PushSubscription[] = [];
    for (const subscription of subscriptions) {
      if (await sendWebPush(this.env, subscription, { title: status.pc ?? "Nimbo", body: notice, tag: "nimbo-island" }).catch(() => true)) alive.push(subscription);
    }
    if (alive.length !== subscriptions.length) await this.ctx.storage.put("webPush", alive);
  }

  async webSocketClose(socket: WebSocket) {
    if (this.ctx.getTags(socket)[0] === "pc" && this.sockets("pc").filter((other) => other !== socket).length === 0) {
      this.broadcast("phone", { type: "pc", online: false });
    }
  }
}
