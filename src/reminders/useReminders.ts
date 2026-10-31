import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playChime } from "../focus/useFocusTimer";
import { dueReminder, parseReminders, type Reminder } from "./reminders";

const KEY = "nimbo-reminders";
const TICK_MS = 10_000;

function load() {
  try {
    return parseReminders(window.localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export function useReminders() {
  const [reminders, setReminders] = useState<Reminder[]>(load);
  const [now, setNow] = useState(() => Date.now());
  const chimedRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(reminders));
    } catch {
      // Kept in memory for this run.
    }
  }, [reminders]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  const due = dueReminder(reminders, now);

  useEffect(() => {
    if (!due || chimedRef.current === due.id) return;
    chimedRef.current = due.id;
    playChime();
  }, [due]);

  const add = useCallback((text: string, at: number) => {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    setReminders((current) => [...current, { id, text, at }].slice(-50));
    setNow(Date.now());
  }, []);

  const remove = useCallback((id: string) => setReminders((current) => current.filter((reminder) => reminder.id !== id)), []);

  const snooze = useCallback((id: string, minutes: number) => {
    setReminders((current) => current.map((reminder) => (reminder.id === id ? { ...reminder, at: Date.now() + minutes * 60_000 } : reminder)));
    chimedRef.current = null;
  }, []);

  const upcoming = useMemo(() => [...reminders].sort((a, b) => a.at - b.at), [reminders]);

  return { reminders: upcoming, due, add, remove, snooze };
}

export type Reminders = ReturnType<typeof useReminders>;
