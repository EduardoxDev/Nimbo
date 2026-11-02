import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { sendBuddy } from "../buddy/channel";
import type { BuddyMode } from "../buddy/mode";
import { speak } from "../voice/voice";
import { distractionOf } from "./distraction";
import { bucketOf, parseHabits, prettyApp, recordHabit, suggestHabit } from "./habits";
import { summaryParts, type DaySummary } from "./summary";

export type LifeAction = { label: string; primary?: boolean; run?: () => void };
export type LifeNotice = { id: string; text: string; actions: LifeAction[] };
type Foreground = { app: string; path: string; title: string };

type Copy = {
  focusGuard: (name: string) => string;
  habit: (app: string, weekday: string, hour: number) => string;
  open: string;
  notNow: string;
  summary: (parts: ReturnType<typeof summaryParts>) => string;
  listen: string;
  ok: string;
};

const HABITS_KEY = "nimbo-habits";
const FOCUS_POLL_MS = 5_000;
const IDLE_POLL_MS = 60_000;
const WARN_EVERY_MS = 120_000;
const SUMMARY_HOUR = 18;

function once(key: string) {
  try {
    if (window.localStorage.getItem(key)) return false;
    window.localStorage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}

export function useLifeHelpers({
  focusRunning,
  focusGuard,
  habitTips,
  dailySummary,
  buddyMode,
  localeTag,
  locale,
  today,
  copy,
}: {
  focusRunning: boolean;
  focusGuard: boolean;
  habitTips: boolean;
  dailySummary: boolean;
  buddyMode: BuddyMode;
  localeTag: string;
  locale: string;
  today: () => DaySummary;
  copy: Copy;
}) {
  // A queue, so a new notice waits its turn instead of replacing the one on screen.
  const [queue, setQueue] = useState<LifeNotice[]>([]);
  const notice = queue[0] ?? null;
  const lastWarnRef = useRef(0);
  const copyRef = useRef(copy);
  copyRef.current = copy;
  const todayRef = useRef(today);
  todayRef.current = today;

  const push = useCallback(
    (next: Omit<LifeNotice, "id">) =>
      setQueue((current) =>
        current.some((item) => item.text === next.text) ? current : [...current, { ...next, id: `${Date.now()}-${current.length}` }].slice(-12),
      ),
    [],
  );
  /** Jumps the queue (the "while you were busy" summary). */
  const pushFirst = useCallback((next: Omit<LifeNotice, "id">) => setQueue((current) => [{ ...next, id: `${Date.now()}-first` }, ...current]), []);
  const dismiss = useCallback(() => setQueue((current) => current.slice(1)), []);

  useEffect(() => {
    if (!isTauri() || (!habitTips && !(focusRunning && focusGuard))) return;
    const sample = () =>
      void invoke<Foreground | null>("foreground_window")
        .then((window_) => {
          if (!window_) return;
          const now = new Date();
          if (focusRunning && focusGuard) {
            const name = distractionOf(window_.title, window_.app);
            if (name && Date.now() - lastWarnRef.current > WARN_EVERY_MS) {
              lastWarnRef.current = Date.now();
              const text = copyRef.current.focusGuard(name);
              if (buddyMode !== "off") sendBuddy({ kind: "say", text, page: "focus" });
              else push({ text, actions: [{ label: copyRef.current.ok, primary: true }] });
            }
          }
          if (!habitTips) return;
          let habits = parseHabits(window.localStorage.getItem(HABITS_KEY));
          habits = recordHabit(habits, window_.path, now);
          try {
            window.localStorage.setItem(HABITS_KEY, JSON.stringify(habits));
          } catch {
            return;
          }
          if (now.getMinutes() >= 15) return;
          const suggestion = suggestHabit(habits, now, window_.path);
          if (!suggestion || !once(`nimbo-habit-${bucketOf(now)}-${now.toDateString()}`)) return;
          const weekday = new Intl.DateTimeFormat(localeTag, { weekday: "long" }).format(now);
          push({
            text: copyRef.current.habit(prettyApp(suggestion), weekday, now.getHours()),
            actions: [
              { label: copyRef.current.open, primary: true, run: () => void invoke("open_program", { path: suggestion }).catch(() => {}) },
              { label: copyRef.current.notNow },
            ],
          });
        })
        .catch(() => {});
    sample();
    const interval = window.setInterval(sample, focusRunning && focusGuard ? FOCUS_POLL_MS : IDLE_POLL_MS);
    return () => window.clearInterval(interval);
  }, [focusRunning, focusGuard, habitTips, buddyMode, localeTag, push]);

  useEffect(() => {
    if (!dailySummary) return;
    const check = () => {
      const now = new Date();
      if (now.getHours() !== SUMMARY_HOUR || !once(`nimbo-summary-${now.toDateString()}`)) return;
      const text = copyRef.current.summary(summaryParts(todayRef.current()));
      if (buddyMode !== "off") sendBuddy({ kind: "deliver", text, page: "week" });
      push({
        text,
        actions: [
          { label: copyRef.current.listen, primary: true, run: () => speak(text, locale) },
          { label: copyRef.current.ok },
        ],
      });
    };
    check();
    const interval = window.setInterval(check, 60_000);
    return () => window.clearInterval(interval);
  }, [dailySummary, buddyMode, locale, push]);

  return { notice, pending: queue.length, push, pushFirst, dismiss };
}
