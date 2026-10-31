import { useCallback, useEffect, useMemo, useState } from "react";
import {
  drankMl,
  drink,
  isReminderDue,
  nextReminderAt,
  parseWaterDay,
  progressOf,
  snooze,
  undoDrink,
  currentDay,
  lastDays,
  parseWaterHistory,
  recordHistory,
  type HistoryDay,
  type WaterDay,
  type WaterHistory,
  type WaterSettings,
} from "./water";

const STORAGE_KEY = "nimbo-water";
const HISTORY_KEY = "nimbo-water-history";
/** Reminders count from when the app opened if nothing was drunk yet today. */
const STARTED_AT = Date.now();

export type WaterTracker = {
  day: WaterDay;
  drankMl: number;
  progress: number;
  reminderDue: boolean;
  nextReminderAt: number | null;
  history: HistoryDay[];
  daysMet: number;
  add: () => void;
  undo: () => void;
  dismiss: () => void;
};

export function useWater(settings: WaterSettings): WaterTracker {
  const [day, setDay] = useState<WaterDay>(() => {
    try {
      return parseWaterDay(window.localStorage.getItem(STORAGE_KEY), Date.now());
    } catch {
      return parseWaterDay(null, Date.now());
    }
  });
  const [now, setNow] = useState(() => Date.now());
  const [history, setHistory] = useState<WaterHistory>(() => {
    try {
      return parseWaterHistory(window.localStorage.getItem(HISTORY_KEY));
    } catch {
      return {};
    }
  });

  useEffect(() => {
    setHistory((current) => {
      const ml = drankMl(day, settings);
      if (current[day.date] === ml) return current;
      const next = recordHistory(current, day.date, ml);
      try {
        window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        return next;
      }
      return next;
    });
  }, [day, settings]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(day));
    } catch {
      // Today's count lives in memory when storage is unavailable.
    }
  }, [day]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const time = Date.now();
      setNow(time);
      setDay((current) => currentDay(current, time));
    }, 20_000);
    return () => window.clearInterval(interval);
  }, []);

  const add = useCallback(() => setDay((current) => drink(current, Date.now())), []);
  const undo = useCallback(() => setDay((current) => undoDrink(current, Date.now())), []);
  const dismiss = useCallback(() => setDay((current) => snooze(current, Date.now())), []);

  return useMemo(
    () => ({
      day,
      drankMl: drankMl(day, settings),
      progress: progressOf(day, settings),
      reminderDue: isReminderDue(day, settings, now, STARTED_AT),
      nextReminderAt: nextReminderAt(day, settings, STARTED_AT),
      history: lastDays(history, now, settings.goalMl),
      daysMet: settings.goalMl > 0 ? Object.values(history).filter((ml) => ml >= settings.goalMl).length : 0,
      add,
      undo,
      dismiss,
    }),
    [day, settings, now, history, add, undo, dismiss],
  );
}
