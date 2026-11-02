/**
 * Nimbo relay: lets the iPhone app reach the Nimbo on a PC from anywhere.
 *
 * Each PC owns a "room" (random id + secret code, shared by QR code). The PC
 * and the phones connect to the room by WebSocket; the room passes commands
 * from phones to the PC, status from the PC to phones, keeps the latest status
 * for the widgets, and pushes it to the iPhone's island (Live Activity).
 *
 *   GET /v1/rooms/:room/ws?role=pc|phone&key=…   WebSocket
 *   GET /v1/rooms/:room/status?key=…             latest status (widgets)
 *   GET /v1/rooms/:room/cover?key=…              album art of what is playing
 *   POST /v1/rooms/:room/command?key=…           one command (widget and island buttons)
 *   GET /v1/vapid                                public key for web notifications
 *   everything else                              the Nimbo web app (mobile/, built for the web)
 */

import { activityOf, hashKey, MAX_MESSAGE, shouldPush, validKey, validRoom, type ActivityState, type IslandStatus } from "./protocol";
import { pushActivity, type ApnsEnv } from "./apns";
import { sendWebPush, validSubscription, type PushSubscription, type WebPushEnv } from "./webpush";

export interface Env extends ApnsEnv, WebPushEnv {
  ROOMS: DurableObjectNamespace;
  /** The web app's files (wrangler.toml [assets]). */
  ASSETS?: Fetcher;
}

const COMMANDS = new Set(["play_pause", "next", "previous", "focus_start", "focus_pause", "focus_skip", "task_toggle", "task_add", "water_add", "lock", "shutdown_cancel", "send_text"]);

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" },
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
    const match = /^\/v1\/rooms\/([a-f0-9]{32})\/(ws|status|cover|command)$/.exec(url.pathname);
    if (!match || !validRoom(match[1])) return json({ error: "not_found" }, 404);
    if (!validKey(url.searchParams.get("key") ?? "")) return json({ error: "bad_key" }, 403);
    const room = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
    return room.fetch(request);
  },
};

type Stored = {
  keyHash?: string;
  status?: IslandStatus;
  cover?: string | null;
  inbox?: { id: number; text: string }[];
  tokens?: string[];
  lastActivity?: ActivityState;
  lastPushAt?: number;
  webPush?: PushSubscription[];
  lastNotice?: string;
};

export class Room implements DurableObject {
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

    if (url.pathname.endsWith("/status")) {
      return json({ status: (await this.get("status")) ?? null, pcOnline: this.sockets("pc").length > 0 });
    }
    if (url.pathname.endsWith("/cover")) {
      return json({ cover: (await this.get("cover")) ?? null });
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
          status: (await this.get("status")) ?? null,
          pcOnline: this.sockets("pc").length > 0,
          inbox: (await this.get("inbox")) ?? [],
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
      await this.ctx.storage.put("status", status);
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
