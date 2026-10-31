import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { sendBuddy, vitalOf, writeVital, type BuddyMessage, type Vital } from "./channel";
import { LEVEL_KEY } from "./pet";
import type { BuddyMode } from "./mode";

type Copy = {
  goalDone: string;
  levelUp: (level: number) => string;
  focusDone: string;
  thirsty: string;
  lateNight: string;
  claudeDone: (text: string) => string;
  claudeFailed: string;
};

const VITAL_MS = 60_000;

function shorten(text: string, limit: number) {
  const single = text.split(/\s+/).join(" ").trim();
  return single.length > limit ? `${single.slice(0, limit - 1)}…` : single;
}

export function useBuddyDirector({
  mode,
  level,
  waterProgress,
  waterReminderDue,
  reminder,
  approvalPending,
  copy,
  onOpenPage,
}: {
  mode: BuddyMode;
  level: number;
  waterProgress: number;
  waterReminderDue: boolean;
  reminder: { id: string; text: string } | null;
  approvalPending: boolean;
  copy: Copy;
  onOpenPage: (page: string) => void;
}) {
  const [vital, setVital] = useState<Vital>(null);
  const celebratedAtRef = useRef(0);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const copyRef = useRef(copy);
  copyRef.current = copy;
  const openRef = useRef(onOpenPage);
  openRef.current = onOpenPage;
  const waterRef = useRef(waterProgress);
  waterRef.current = waterProgress;

  const tell = useCallback((message: BuddyMessage) => {
    if (modeRef.current === "off") return;
    sendBuddy(message);
  }, []);

  const celebrate = useCallback((text?: string) => {
    celebratedAtRef.current = Date.now();
    const send = () => {
      sendBuddy({ kind: "fx", fx: "confetti" });
      if (text && modeRef.current !== "off") window.setTimeout(() => sendBuddy({ kind: "say", text }), 300);
    };
    if (modeRef.current === "off" && isTauri()) {
      void invoke("buddy_show").then(send).catch(() => {});
    } else {
      send();
    }
  }, []);

  const focusDone = useCallback(() => celebrate(copyRef.current.focusDone), [celebrate]);

  const refreshVital = useCallback(() => {
    const next = vitalOf({ hour: new Date().getHours(), waterProgress: waterRef.current, celebratedAt: celebratedAtRef.current, now: Date.now() });
    setVital(next);
    writeVital(next);
  }, []);

  useEffect(() => {
    refreshVital();
    const interval = window.setInterval(refreshVital, VITAL_MS);
    return () => window.clearInterval(interval);
  }, [refreshVital]);

  const levelRef = useRef<number | null>(null);
  useEffect(() => {
    try {
      window.localStorage.setItem(LEVEL_KEY, String(level));
    } catch {
      // The buddy keeps its old look.
    }
    if (levelRef.current !== null && level > levelRef.current) celebrate(copyRef.current.levelUp(level));
    levelRef.current = level;
  }, [level, celebrate]);

  const goalRef = useRef<number | null>(null);
  useEffect(() => {
    if (goalRef.current !== null && goalRef.current < 1 && waterProgress >= 1) {
      celebrate(copyRef.current.goalDone);
      refreshVital();
    }
    goalRef.current = waterProgress;
  }, [waterProgress, celebrate, refreshVital]);

  const thirstRef = useRef(false);
  useEffect(() => {
    if (waterReminderDue && !thirstRef.current) tell({ kind: "say", text: copyRef.current.thirsty, page: "water" });
    thirstRef.current = waterReminderDue;
  }, [waterReminderDue, tell]);

  const reminderRef = useRef<string | null>(null);
  useEffect(() => {
    if (reminder && reminder.id !== reminderRef.current) tell({ kind: "deliver", text: reminder.text });
    reminderRef.current = reminder?.id ?? null;
  }, [reminder, tell]);

  useEffect(() => {
    tell({ kind: "attention", on: approvalPending });
  }, [approvalPending, mode, tell]);

  useEffect(() => {
    const check = () => {
      const now = new Date();
      const key = `nimbo-late-${now.toDateString()}`;
      if (now.getHours() !== 23) return;
      try {
        if (window.localStorage.getItem(key)) return;
        window.localStorage.setItem(key, "1");
      } catch {
        return;
      }
      tell({ kind: "say", text: copyRef.current.lateNight });
    };
    check();
    const interval = window.setInterval(check, VITAL_MS);
    return () => window.clearInterval(interval);
  }, [tell]);

  useEffect(() => {
    if (!isTauri()) return;
    const stops: (() => void)[] = [];
    let cancelled = false;
    const keep = (stop: () => void) => (cancelled ? stop() : stops.push(stop));
    void listen<{ text?: string; failed?: boolean }>("claude-task-finished", ({ payload }) => {
      const text = payload?.failed ? copyRef.current.claudeFailed : copyRef.current.claudeDone(shorten(payload?.text ?? "", 90));
      tell({ kind: "deliver", text, page: "agents" });
    }).then(keep);
    void listen<{ page?: string }>("buddy-open", ({ payload }) => {
      if (payload?.page) openRef.current(payload.page);
    }).then(keep);
    return () => {
      cancelled = true;
      stops.forEach((stop) => stop());
    };
  }, [tell]);

  return { vital, celebrate, focusDone };
}
