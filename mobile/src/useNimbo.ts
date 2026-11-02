import { useCallback, useEffect, useRef, useState } from "react";
import type { IslandStatus } from "./shared/protocol";
import type { Pairing } from "./pairing";

export type Status = IslandStatus & { mascot?: string };
export type InboxItem = { id: number; text: string };
export type FileItem = { id: string; name: string; size: number; type: string; from: "pc" | "phone"; at: number };
export type Link = "relay" | "lan" | "offline";

/**
 * The live island of the paired PC. Prefers the relay (works anywhere), and
 * falls back to the home-Wi-Fi page when the relay is not set up.
 */
export function useNimbo(pairing: Pairing | null) {
  const [status, setStatus] = useState<Status | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  const [pcOnline, setPcOnline] = useState(false);
  const [link, setLink] = useState<Link>("offline");
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  // Relay: one WebSocket, reopened with a growing pause when it drops.
  useEffect(() => {
    if (!pairing?.relay || !pairing.room || !pairing.key) return;
    let closed = false;
    let wait = 1_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const base = pairing.relay.replace(/^http/, "ws").replace(/\/$/, "");
    const connect = () => {
      const socket = new WebSocket(`${base}/v1/rooms/${pairing.room}/ws?role=phone&key=${pairing.key}`);
      socketRef.current = socket;
      socket.onopen = () => {
        wait = 1_000;
        setLink("relay");
        setError(null);
      };
      socket.onmessage = (event) => {
        let message: Record<string, any>;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (message.type === "hello") {
          setStatus(message.status);
          setPcOnline(Boolean(message.pcOnline));
          setInbox(Array.isArray(message.inbox) ? [...message.inbox].reverse() : []);
          setFiles(Array.isArray(message.files) ? message.files : []);
        } else if (message.type === "status") {
          setStatus(message.status);
          setPcOnline(true);
        } else if (message.type === "cover") {
          setCover(typeof message.cover === "string" ? message.cover : null);
        } else if (message.type === "pc") {
          setPcOnline(Boolean(message.online));
        } else if (message.type === "file" && message.file) {
          setFiles((items) => [message.file, ...items.filter((item) => item.id !== message.file.id)].slice(0, 10));
        } else if (message.type === "inbox" && message.item) {
          setInbox((items) => [message.item, ...items].slice(0, 20));
        } else if (message.type === "error" && message.code === "pc_offline") {
          setPcOnline(false);
        }
      };
      socket.onclose = () => {
        socketRef.current = null;
        if (closed) return;
        setLink("offline");
        timer = setTimeout(connect, wait);
        wait = Math.min(wait * 2, 30_000);
      };
      socket.onerror = () => setError("relay");
    };
    connect();
    // Cover art when first connecting (later ones arrive with each new song).
    fetch(`${pairing.relay.replace(/\/$/, "")}/v1/rooms/${pairing.room}/cover?key=${pairing.key}`)
      .then((response) => response.json())
      .then((body) => typeof body.cover === "string" && setCover(body.cover))
      .catch(() => {});
    return () => {
      closed = true;
      clearTimeout(timer);
      socketRef.current?.close();
    };
  }, [pairing?.relay, pairing?.room, pairing?.key]);

  // Home Wi-Fi only: poll the PC's own page.
  useEffect(() => {
    if (!pairing?.lan || pairing.relay) return;
    const lan = new URL(pairing.lan);
    const key = lan.searchParams.get("k") ?? "";
    let since = 0;
    let lastTrack = "";
    let stop = false;
    const poll = async () => {
      try {
        const response = await fetch(`${lan.origin}/api/status?k=${key}&inbox=${since}`);
        const body = await response.json();
        if (stop) return;
        setStatus(body.status);
        setPcOnline(true);
        setLink("lan");
        for (const item of body.inbox ?? []) {
          since = Math.max(since, item.id);
          setInbox((items) => [item, ...items].slice(0, 20));
        }
        const track = `${body.status?.music?.title}${body.status?.music?.artist}`;
        if (track !== lastTrack) {
          lastTrack = track;
          fetch(`${lan.origin}/api/cover?k=${key}`).then((r) => r.json()).then((r) => setCover(r.cover ?? null)).catch(() => {});
        }
      } catch {
        if (!stop) {
          setLink("offline");
          setPcOnline(false);
        }
      }
    };
    void poll();
    const interval = setInterval(poll, 2_000);
    return () => {
      stop = true;
      clearInterval(interval);
    };
  }, [pairing?.lan, pairing?.relay]);

  /** A command for the PC: play_pause, focus_start, task_toggle (id), task_add (title), send_text (text)… */
  const send = useCallback(
    async (action: string, value = ""): Promise<boolean> => {
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "command", action, value }));
        return true;
      }
      if (pairing?.lan) {
        const lan = new URL(pairing.lan);
        const key = lan.searchParams.get("k") ?? "";
        const path = action === "send_text" ? "/api/send" : "/api/command";
        const body = action === "send_text" ? { text: value } : { action, value };
        return fetch(`${lan.origin}${path}`, { method: "POST", headers: { "X-Nimbo-Key": key, "Content-Type": "application/json" }, body: JSON.stringify(body) })
          .then((response) => response.json())
          .then((result) => Boolean(result.ok))
          .catch(() => false);
      }
      return false;
    },
    [pairing?.lan],
  );

  /** Registers this iPhone's Live Activity so the relay can keep it current. */
  const registerActivityToken = useCallback((token: string) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "activity_token", token }));
  }, []);

  /** Web app notifications: the relay pushes the island's notices to this subscription. */
  const registerWebPush = useCallback((subscription: PushSubscriptionJSON) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type: "web_push", subscription }));
    return true;
  }, []);

  /** Where a file from the PC can be downloaded (works anywhere, through the relay). */
  const fileUrl = useCallback(
    (id: string) => (pairing?.relay && pairing.room && pairing.key ? `${pairing.relay.replace(/\/$/, "")}/v1/rooms/${pairing.room}/files/${id}?key=${pairing.key}` : null),
    [pairing?.relay, pairing?.room, pairing?.key],
  );

  /** Sends a picked file (photo, PDF…) to the PC, up to 25 MB. */
  const sendFile = useCallback(
    async (file: { uri: string; name: string; mimeType?: string | null; size?: number | null }): Promise<"ok" | "too_big" | "no_relay" | "failed"> => {
      if (!pairing?.relay || !pairing.room || !pairing.key) return "no_relay";
      if ((file.size ?? 0) > 25 * 1024 * 1024) return "too_big";
      try {
        const blob = await (await fetch(file.uri)).blob();
        const url = `${pairing.relay.replace(/\/$/, "")}/v1/rooms/${pairing.room}/files?key=${pairing.key}&from=phone&name=${encodeURIComponent(file.name)}`;
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": file.mimeType || "application/octet-stream" }, body: blob });
        if (response.status === 413) return "too_big";
        return response.ok ? "ok" : "failed";
      } catch {
        return "failed";
      }
    },
    [pairing?.relay, pairing?.room, pairing?.key],
  );

  return { status, cover, pcOnline, link, inbox, files, error, send, fileUrl, sendFile, registerActivityToken, registerWebPush };
}
