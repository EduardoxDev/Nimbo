import { useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  BellPlus,
  BookOpen,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Gauge,
  Minus,
  Pause,
  Play,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useLocale, useTranslation } from "../i18n";
import { Mascot } from "../mascot/Mascot";
import { NIMBO_COLOR } from "../mascot/nimboMood";
import { aiErrorText } from "../assistant/aiErrors";
import type { CalendarEvent } from "../calendar/calendar";
import {
  categoryOf,
  dayKeyOf,
  hourly,
  hoursText,
  labelOf,
  minutes,
  segmentAt,
  stretches,
  summarize,
  type Category,
  type Segment,
} from "./activity";
import { planDay, type Plan } from "./planner";
import { RetroView } from "../retro/RetroView";
import "./Day.css";

export type DayTab = "today" | "xray" | "diary" | "plan" | "retro";
const TABS: DayTab[] = ["today", "xray", "diary", "plan", "retro"];
const COLORS: Record<Category, string> = { work: "#35e985", communication: "#64d2ff", distraction: "#ff6b8b", other: "#8e8e93" };
const GOAL_KEY = "nimbo-distraction-goal";
const END_KEY = "nimbo-plan-end";
export const ACTIVITY_KEY = "nimbo-activity-enabled";

type Todo = { title: string; completed: boolean };

function readTodos(): Todo[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem("nimbo-todos") ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is Todo => !!item && typeof item.title === "string") : [];
  } catch {
    return [];
  }
}

function readNumber(key: string, fallback: number) {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Only this run remembers it.
  }
}

async function loadDay(date: Date): Promise<Segment[]> {
  if (!isTauri()) return [];
  return invoke<Segment[]>("activity_day", { day: dayKeyOf(date) }).catch(() => []);
}

function shiftDay(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export default function DayWindow() {
  const t = useTranslation();
  const copy = t.day;
  const { locale } = useLocale();
  const initial = new URLSearchParams(window.location.search).get("tab") as DayTab | null;
  const [tab, setTab] = useState<DayTab>(initial && TABS.includes(initial) ? initial : "today");
  const [date, setDate] = useState(() => new Date());
  const [segments, setSegments] = useState<Segment[]>([]);
  const [recording, setRecording] = useState(() => {
    try {
      return window.localStorage.getItem(ACTIVITY_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const time = (at: number) => new Date(at).toLocaleTimeString(t.localeTag, { hour: "2-digit", minute: "2-digit" });
  const isToday = dayKeyOf(date) === dayKeyOf(new Date());

  useEffect(() => {
    document.documentElement.classList.add("day-root");
    if (!isTauri()) return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    void listen<DayTab>("day-tab", ({ payload }) => {
      if (TABS.includes(payload)) setTab(payload);
    }).then((unlisten) => (cancelled ? unlisten() : (stop = unlisten)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => void loadDay(date).then((list) => !cancelled && setSegments(list));
    load();
    // Today keeps growing while the window is open.
    const interval = isToday ? window.setInterval(load, 30_000) : 0;
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [date, isToday]);

  const summary = useMemo(() => summarize(segments), [segments]);

  const toggleRecording = () => {
    const next = !recording;
    setRecording(next);
    store(ACTIVITY_KEY, next ? "1" : "0");
    if (isTauri()) void invoke("activity_set_enabled", { enabled: next });
  };

  const clearAll = () => {
    if (!window.confirm(copy.clearConfirm)) return;
    if (isTauri()) void invoke("activity_clear").then(() => setSegments([]));
  };

  const win = isTauri() ? getCurrentWindow() : null;

  return (
    <div className="day">
      <header className="day__top" data-tauri-drag-region>
        <div className="day__brand" data-tauri-drag-region>
          <Mascot mood="greeting" shape="cloud" color={NIMBO_COLOR} seed="nimbo" size={30} label="Nimbo" />
          <strong data-tauri-drag-region>{copy.title}</strong>
        </div>
        <nav className="day__tabs" role="tablist" aria-label={copy.title}>
          {TABS.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "day__tab day__tab--on" : "day__tab"} onClick={() => setTab(id)}>
              {copy.tabs[id]}
            </button>
          ))}
        </nav>
        <div className="day__window" data-tauri-drag-region>
          <button type="button" title={copy.minimize} aria-label={copy.minimize} onClick={() => void win?.minimize()}>
            <Minus size={13} strokeWidth={2.6} />
          </button>
          <button type="button" className="day__close" title={copy.close} aria-label={copy.close} onClick={() => void win?.close()}>
            <X size={14} strokeWidth={2.6} />
          </button>
        </div>
      </header>

      <main className="day__body">
        {(tab === "today" || tab === "diary") && (
          <div className="day__date">
            <button type="button" aria-label={copy.previousDay} title={copy.previousDay} onClick={() => setDate((current) => shiftDay(current, -1))}>
              <ChevronLeft size={16} strokeWidth={2.4} />
            </button>
            <span>{isToday ? copy.today : date.toLocaleDateString(t.localeTag, { weekday: "long", day: "numeric", month: "long" })}</span>
            <button type="button" aria-label={copy.nextDay} title={copy.nextDay} disabled={isToday} onClick={() => setDate((current) => shiftDay(current, 1))}>
              <ChevronRight size={16} strokeWidth={2.4} />
            </button>
          </div>
        )}
        {tab === "today" && <Today segments={segments} summary={summary} time={time} />}
        {tab === "xray" && <XRay />}
        {tab === "diary" && <Diary segments={segments} summary={summary} date={date} time={time} locale={locale} />}
        {tab === "plan" && <PlanView time={time} />}
        {tab === "retro" && <RetroView />}
      </main>

      <footer className="day__privacy">
        <span>{recording ? copy.privacyOn : copy.privacyOff}</span>
        <button type="button" onClick={toggleRecording}>
          {recording ? <Pause size={13} strokeWidth={2.4} /> : <Play size={13} strokeWidth={2.4} />}
          {recording ? copy.pause : copy.resume}
        </button>
        <button type="button" onClick={clearAll}>
          <Trash2 size={13} strokeWidth={2.4} />
          {copy.clear}
        </button>
      </footer>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="day__stat">
      <span>{label}</span>
      <strong style={color ? { color } : undefined}>{value}</strong>
    </div>
  );
}

function Today({ segments, summary, time }: { segments: Segment[]; summary: ReturnType<typeof summarize>; time: (at: number) => string }) {
  const copy = useTranslation().day;
  const [askAt, setAskAt] = useState("");
  const hours = useMemo(() => hourly(segments), [segments]);
  const used = hours.map((hour, index) => ({ index, total: Object.values(hour).reduce((sum, value) => sum + value, 0), hour })).filter((item) => item.total > 0);
  const firstHour = used[0]?.index ?? 8;
  const lastHour = used[used.length - 1]?.index ?? 18;
  const shown = hours.slice(firstHour, lastHour + 1);
  const answer = (() => {
    if (!/^\d{2}:\d{2}$/.test(askAt) || segments.length === 0) return null;
    const [hour, minute] = askAt.split(":").map(Number);
    const at = new Date(segments[0].start);
    at.setHours(hour, minute, 0, 0);
    return segmentAt(segments, at.getTime());
  })();

  if (segments.length === 0) return <p className="day__empty">{copy.empty}</p>;
  return (
    <>
      <section className="day__stats">
        <Stat label={copy.active} value={hoursText(summary.totalMs)} />
        <Stat label={copy.categories.work} value={hoursText(summary.byCategory.work)} color={COLORS.work} />
        <Stat label={copy.categories.communication} value={hoursText(summary.byCategory.communication)} color={COLORS.communication} />
        <Stat label={copy.categories.distraction} value={hoursText(summary.byCategory.distraction)} color={COLORS.distraction} />
        <Stat label={copy.longestFocus} value={hoursText(summary.longestFocusMs)} />
      </section>

      <section className="day__card">
        <h2>{copy.byHour}</h2>
        <div className="day__hours" role="img" aria-label={copy.byHour}>
          {shown.map((hour, index) => (
            <div key={firstHour + index} className="day__hour">
              <div className="day__hour-bar">
                {(Object.keys(COLORS) as Category[]).map((category) =>
                  hour[category] > 0 ? <span key={category} style={{ height: `${Math.min(60, hour[category]) / 0.6}%`, background: COLORS[category] }} /> : null,
                )}
              </div>
              <small>{firstHour + index}h</small>
            </div>
          ))}
        </div>
        <ul className="day__legend">
          {(Object.keys(COLORS) as Category[]).map((category) => (
            <li key={category}>
              <i style={{ background: COLORS[category] }} />
              {copy.categories[category]}
            </li>
          ))}
        </ul>
      </section>

      <section className="day__card day__ask">
        <label>
          <Clock size={14} strokeWidth={2.4} aria-hidden="true" />
          {copy.whatAt}
          <input type="time" value={askAt} onChange={(event) => setAskAt(event.currentTarget.value)} />
        </label>
        {answer && (
          <p>
            <strong>{labelOf(answer)}</strong> · {time(answer.start)}–{time(answer.end)}
            {answer.title && <span className="day__muted"> · {answer.title}</span>}
          </p>
        )}
        {askAt && !answer && <p className="day__muted">{copy.nothingAt}</p>}
      </section>

      <section className="day__card">
        <h2>{copy.timeline}</h2>
        <ol className="day__timeline">
          {stretches(segments)
            .reverse()
            .slice(0, 60)
            .map((item) => (
              <li key={`${item.start}-${item.label}`}>
                <i style={{ background: COLORS[item.category] }} />
                <span className="day__time">
                  {time(item.start)}–{time(item.end)}
                </span>
                <strong>{item.label}</strong>
                <span className="day__muted day__titles">{item.titles.join(" · ")}</span>
              </li>
            ))}
        </ol>
      </section>
    </>
  );
}

function XRay() {
  const t = useTranslation();
  const copy = t.day;
  const [week, setWeek] = useState<{ date: Date; segments: Segment[] }[]>([]);
  const [goal, setGoal] = useState(() => readNumber(GOAL_KEY, 60));

  useEffect(() => {
    const days = Array.from({ length: 7 }, (_, index) => shiftDay(new Date(), index - 6));
    void Promise.all(days.map(async (date) => ({ date, segments: await loadDay(date) }))).then(setWeek);
  }, []);

  const perDay = week.map((day) => ({ ...day, summary: summarize(day.segments) }));
  const all = summarize(week.flatMap((day) => day.segments));
  const busiest = Math.max(1, ...perDay.map((day) => day.summary.totalMs));
  const today = perDay[perDay.length - 1]?.summary;
  const distractions = all.apps.filter((app) => app.category === "distraction").slice(0, 4);
  const overGoal = today ? minutes(today.byCategory.distraction) - goal : 0;

  if (week.length > 0 && all.totalMs === 0) return <p className="day__empty">{copy.empty}</p>;
  return (
    <>
      <section className="day__card">
        <h2>{copy.week}</h2>
        <div className="day__week">
          {perDay.map((day) => (
            <div key={dayKeyOf(day.date)} className="day__weekday">
              <div className="day__week-bar" title={hoursText(day.summary.totalMs)}>
                <span style={{ height: `${(day.summary.byCategory.work / busiest) * 100}%`, background: COLORS.work }} />
                <span style={{ height: `${(day.summary.byCategory.communication / busiest) * 100}%`, background: COLORS.communication }} />
                <span style={{ height: `${(day.summary.byCategory.distraction / busiest) * 100}%`, background: COLORS.distraction }} />
                <span style={{ height: `${(day.summary.byCategory.other / busiest) * 100}%`, background: COLORS.other }} />
              </div>
              <small>{day.date.toLocaleDateString(t.localeTag, { weekday: "short" })}</small>
              <small className="day__muted">{hoursText(day.summary.totalMs)}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="day__card">
        <h2>{copy.topApps}</h2>
        <ul className="day__apps">
          {all.apps.slice(0, 8).map((app) => (
            <li key={app.label}>
              <span>{app.label}</span>
              <div className="day__app-bar">
                <span style={{ width: `${(app.ms / Math.max(1, all.apps[0]?.ms ?? 1)) * 100}%`, background: COLORS[app.category] }} />
              </div>
              <small>{hoursText(app.ms)}</small>
            </li>
          ))}
        </ul>
      </section>

      <section className="day__card day__goal">
        <h2>
          <Gauge size={15} strokeWidth={2.4} aria-hidden="true" /> {copy.goalTitle}
        </h2>
        <label>
          {copy.goalLabel}
          <input
            type="number"
            min={5}
            max={600}
            step={5}
            value={goal}
            onChange={(event) => {
              const value = Math.max(5, Math.min(600, Number(event.currentTarget.value) || 60));
              setGoal(value);
              store(GOAL_KEY, String(value));
            }}
          />
          min
        </label>
        {today && <p className={overGoal > 0 ? "day__warn" : "day__ok"}>{overGoal > 0 ? copy.overGoal(overGoal) : copy.underGoal(Math.max(0, -overGoal))}</p>}
        {distractions.length > 0 && (
          <p className="day__muted">
            {copy.whereItWent}: {distractions.map((app) => `${app.label} (${hoursText(app.ms)})`).join(", ")}
          </p>
        )}
      </section>
    </>
  );
}

function Diary({
  segments,
  summary,
  date,
  time,
  locale,
}: {
  segments: Segment[];
  summary: ReturnType<typeof summarize>;
  date: Date;
  time: (at: number) => string;
  locale: string;
}) {
  const t = useTranslation();
  const copy = t.day;
  const [polished, setPolished] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const isToday = dayKeyOf(date) === dayKeyOf(new Date());
  const done = isToday ? readTodos().filter((todo) => todo.completed).map((todo) => todo.title) : [];
  const workApps = summary.apps.filter((app) => app.category === "work").slice(0, 3).map((app) => app.label);
  const files = [
    ...new Set(
      segments
        .filter((segment) => categoryOf(segment) === "work" && segment.title)
        .map((segment) => segment.title.split(/\s[-–—]\s/)[0].replace(/^[*●•]\s*/, "").trim())
        .filter((name) => name.length > 1 && !/^(sem t[ií]tulo|untitled|novo|new tab|nova guia|无标题)/i.test(name) && !summary.apps.some((app) => app.label.toLowerCase() === name.toLowerCase())),
    ),
  ].slice(0, 5);

  useEffect(() => setPolished(null), [date]);

  const text =
    segments.length === 0
      ? ""
      : copy.diary({
          start: time(summary.first ?? 0),
          end: time(summary.last ?? 0),
          active: hoursText(summary.totalMs),
          work: hoursText(summary.byCategory.work),
          workApps: workApps.join(", "),
          talk: hoursText(summary.byCategory.communication),
          distraction: hoursText(summary.byCategory.distraction),
          focus: hoursText(summary.longestFocusMs),
          files: files.join(", "),
          done: done.join(", "),
        });

  const polish = () => {
    setBusy(true);
    setError("");
    void invoke<string>("lens_ask", { text, task: "diary", language: locale })
      .then((result) => setPolished(result.replace(/\*\*(.+?)\*\*/g, "$1")))
      .catch((failure) => setError(aiErrorText(t, String(failure))))
      .finally(() => setBusy(false));
  };

  const copyText = () => {
    void invoke("copy_translation_result", { text: polished ?? text }).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  if (!text) return <p className="day__empty">{copy.empty}</p>;
  return (
    <section className="day__card day__diary">
      <h2>
        <BookOpen size={15} strokeWidth={2.4} aria-hidden="true" /> {copy.diaryTitle}
      </h2>
      <p className="day__diary-text">{polished ?? text}</p>
      <div className="day__actions">
        <button type="button" className="day__primary" onClick={copyText}>
          <Copy size={14} strokeWidth={2.4} /> {copied ? copy.copied : copy.copy}
        </button>
        <button type="button" disabled={busy} onClick={polish}>
          <Sparkles size={14} strokeWidth={2.4} /> {busy ? copy.writing : copy.polish}
        </button>
      </div>
      {error && <p className="day__warn">{error}</p>}
      <p className="day__muted">{copy.diaryHint}</p>
    </section>
  );
}

function PlanView({ time }: { time: (at: number) => string }) {
  const copy = useTranslation().day;
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [endHour, setEndHour] = useState(() => readNumber(END_KEY, 18));
  const [sent, setSent] = useState(false);
  const tasks = readTodos().filter((todo) => !todo.completed).map((todo) => todo.title);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<{ events: CalendarEvent[] }>("calendar_events", { days: 1 })
      .then((result) => setEvents(result.events.filter((event) => !event.allDay)))
      .catch(() => {});
  }, []);

  const plan: Plan = useMemo(() => planDay(tasks, events, Date.now(), endHour), [tasks.join("\n"), events, endHour]);

  const remind = () => {
    const items = plan.items.filter((item) => item.kind === "task").map((item) => ({ text: item.title, at: item.start }));
    void emitTo("main", "plan-reminders", items).then(() => setSent(true));
  };

  return (
    <section className="day__card day__plan">
      <h2>
        <CalendarClock size={15} strokeWidth={2.4} aria-hidden="true" /> {copy.planTitle}
      </h2>
      <label className="day__end">
        {copy.endOfDay}
        <input
          type="number"
          min={12}
          max={23}
          value={endHour}
          onChange={(event) => {
            const value = Math.max(12, Math.min(23, Number(event.currentTarget.value) || 18));
            setEndHour(value);
            store(END_KEY, String(value));
          }}
        />
        h
      </label>
      {tasks.length === 0 ? (
        <p className="day__muted">{copy.noTasks}</p>
      ) : (
        <ol className="day__blocks">
          {plan.items.map((item) => (
            <li key={`${item.kind}-${item.start}`} className={`day__block day__block--${item.kind}`}>
              <span className="day__time">
                {time(item.start)}–{time(item.end)}
              </span>
              <strong>{item.kind === "break" ? copy.breakBlock : item.title}</strong>
              {item.kind === "event" && <small>{copy.eventBlock}</small>}
            </li>
          ))}
        </ol>
      )}
      {plan.leftover.length > 0 && <p className="day__warn">{copy.leftover(plan.leftover.join(", "))}</p>}
      {plan.items.some((item) => item.kind === "task") && (
        <div className="day__actions">
          <button type="button" className="day__primary" disabled={sent} onClick={remind}>
            <BellPlus size={14} strokeWidth={2.4} /> {sent ? copy.reminded : copy.remindBlocks}
          </button>
        </div>
      )}
      <p className="day__muted">{copy.planHint}</p>
    </section>
  );
}
