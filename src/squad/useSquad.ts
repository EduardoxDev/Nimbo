import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { distractionOf } from "../life/distraction";
import { DEFAULT_SQUAD_SERVER, loadSquad, SQUAD_KEY, startedFocusing, type SquadConfig, type SquadFriend, type SquadPoke } from "./squad";

const EVERY_MS = 15_000;

type Me = { mood: string; focusStatus: "idle" | "running" | "paused"; remainingMs: number };

/**
 * Keeps this Nimbo in its group: posts how it is doing every 15 s and reads
 * the friends back. Off when there is no group (Settings → Pomodoro).
 */
export function useSquad(me: Me, on: { started: (friend: SquadFriend) => void; poke: (poke: SquadPoke) => void }) {
  const [config, setConfig] = useState<SquadConfig | null>(() => loadSquad());
  const [friends, setFriends] = useState<SquadFriend[]>([]);
  const [error, setError] = useState<string | null>(null);
  const meRef = useRef(me);
  meRef.current = me;
  const onRef = useRef(on);
  onRef.current = on;
  const serverRef = useRef(DEFAULT_SQUAD_SERVER);
  const friendsRef = useRef<SquadFriend[]>([]);

  // The group is set in the Settings window; follow it here.
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      if (event.key === SQUAD_KEY) setConfig(loadSquad());
    };
    window.addEventListener("storage", follow);
    return () => window.removeEventListener("storage", follow);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<{ url: string }>("relay_info")
      .then((info) => {
        if (info.url) serverRef.current = info.url.replace(/\/$/, "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setFriends([]);
    friendsRef.current = [];
    if (!config) return;
    let stopped = false;
    const tick = async () => {
      const current = meRef.current;
      let distracted = false;
      if (current.focusStatus === "running" && isTauri()) {
        const front = await invoke<{ app: string; title: string } | null>("foreground_window").catch(() => null);
        distracted = Boolean(front && distractionOf(front.title, front.app));
      }
      try {
        const response = await fetch(`${serverRef.current}/v1/squads/${config.code}/presence`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: config.id, name: config.name, mood: current.mood, focus: { status: current.focusStatus, remainingMs: current.remainingMs }, distracted }),
        });
        const body = (await response.json()) as { members?: SquadFriend[]; pokes?: SquadPoke[]; error?: string };
        if (stopped) return;
        if (!response.ok) {
          setError(body.error ?? String(response.status));
          return;
        }
        setError(null);
        const next = body.members ?? [];
        startedFocusing(friendsRef.current, next, config.id).forEach((friend) => onRef.current.started(friend));
        (body.pokes ?? []).forEach((poke) => onRef.current.poke(poke));
        friendsRef.current = next;
        setFriends(next);
      } catch {
        if (!stopped) setError("offline");
      }
    };
    void tick();
    const interval = window.setInterval(() => void tick(), EVERY_MS);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [config]);

  const poke = useCallback(
    (to: string, kind: "wave" | "focus") => {
      if (!config) return Promise.resolve(false);
      return fetch(`${serverRef.current}/v1/squads/${config.code}/poke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: config.id, to, kind }),
      })
        .then((response) => response.ok)
        .catch(() => false);
    },
    [config],
  );

  return { config, friends: friends.filter((friend) => friend.id !== config?.id), error, poke };
}
