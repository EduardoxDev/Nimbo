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
  type WaterDay,
  type WaterSettings,
} from "./water";

const STORAGE_KEY = "nimbo-water";
/** Reminders count from when the app opened if nothing was drunk yet today. */
const STARTED_AT = Date.now();

export type WaterTracker = {
  day: WaterDay;
  drankMl: number;
  progress: number;
  reminderDue: boolean;
  nextReminderAt: number | null;
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
      add,
      undo,
      dismiss,
    }),
    [day, settings, now, add, undo, dismiss],
  );
}
