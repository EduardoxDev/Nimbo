import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { CALENDAR_DEMO, DEMO_EVENTS } from "../demo/calendarDemo";
import { CALENDAR_CHANGED_KEY, ongoingEvent, upcomingReminder, type CalendarEvent } from "./calendar";

const REFRESH_MS = 15 * 60 * 1000;
const DAYS_AHEAD = 7;

type CalendarResult = { events: CalendarEvent[]; failed: string[] };

export function useCalendar(reminderMinutes: number) {
  const [events, setEvents] = useState<CalendarEvent[]>(CALENDAR_DEMO ? DEMO_EVENTS : []);
  const [failed, setFailed] = useState<string[]>([]);
  const [hasSources, setHasSources] = useState(CALENDAR_DEMO);
  const [loaded, setLoaded] = useState(CALENDAR_DEMO);
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const sources = await invoke<unknown[]>("calendar_sources");
      setHasSources(sources.length > 0);
      if (sources.length === 0) {
        setEvents([]);
        setFailed([]);
        return;
      }
      const result = await invoke<CalendarResult>("calendar_events", { days: DAYS_AHEAD });
      setEvents(result.events);
      setFailed(result.failed);
    } catch (error) {
      console.error("Failed to load calendars", error);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_MS);
    const onStorage = (event: StorageEvent) => {
      if (event.key === CALENDAR_CHANGED_KEY) void refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(interval);
  }, []);

  const reminder = useMemo(
    () => upcomingReminder(events, now, reminderMinutes, dismissed),
    [events, now, reminderMinutes, dismissed],
  );

  const ongoing = useMemo(() => ongoingEvent(events, now), [events, now]);

  const dismiss = useCallback((id: string) => {
    setDismissed((current) => new Set(current).add(id));
  }, []);

  return { events, failed, hasSources, loaded, now, reminder, ongoing, dismiss, refresh };
}

export type CalendarState = ReturnType<typeof useCalendar>;
