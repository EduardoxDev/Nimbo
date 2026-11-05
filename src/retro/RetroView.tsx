import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Copy, Download, RotateCcw } from "lucide-react";
import { useTranslation } from "../i18n";
import type { Translations } from "../i18n/types";
import { Mascot } from "../mascot/Mascot";
import type { MascotMood } from "../mascot/engine";
import { NIMBO_COLOR } from "../mascot/nimboMood";
import type { Segment } from "../day/activity";
import { parseStats } from "../stats/stats";
import { parseWaterHistory } from "../water/water";
import { buildRetro, clockOfNight, lastDayKeys, MUSIC_LOG_KEY, type MusicLog, type Retro } from "./retro";
import "./Retro.css";

const SLIDE_MS = 5_500;

type Slide = { id: string; mood: MascotMood; color: string; eyebrow: string; big: string; caption: string; aura?: boolean; headphones?: boolean };

function read(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Reads only the two settings the retro needs, so the day window doesn't load the whole island.
function readGoals() {
  let saved: { focusMinutes?: unknown; waterGoalMl?: unknown } = {};
  try {
    saved = JSON.parse(read("nimbo-settings") ?? "{}") ?? {};
  } catch {
    // Broken settings fall back to the defaults below.
  }
  const number = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback);
  return { focusMinutes: number(saved.focusMinutes, 25), waterGoalMl: number(saved.waterGoalMl, 2000) };
}

function readMusic(): MusicLog {
  try {
    const value = JSON.parse(read(MUSIC_LOG_KEY) ?? "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function hours(ms: number) {
  return Math.round(ms / 3_600_000);
}

function shortDate(key: string, localeTag: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(localeTag, { day: "numeric", month: "short" });
}

function slidesOf(retro: Retro, t: Translations): Slide[] {
  const copy = t.retro;
  const date = (key: string) => shortDate(key, t.localeTag);
  const slides: Slide[] = [
    { id: "intro", mood: "greeting", color: "#5ac8fa", eyebrow: copy.introEyebrow(date(retro.from), date(retro.to)), big: copy.introBig, caption: copy.introCaption },
    {
      id: "focus",
      mood: "working",
      color: "#ff9f0a",
      eyebrow: copy.focusEyebrow,
      big: retro.focusSessions > 0 ? copy.hours(Math.max(1, Math.round(retro.focusMinutes / 60))) : "0",
      caption:
        retro.focusSessions > 0
          ? copy.focusCaption(retro.focusSessions, retro.bestFocusDay ? date(retro.bestFocusDay.date) : "", retro.bestFocusDay?.sessions ?? 0)
          : copy.focusNone,
    },
    { id: "todos", mood: "done", color: "#35e985", eyebrow: copy.todosEyebrow, big: String(retro.todos), caption: retro.todos > 0 ? copy.todosCaption(retro.agents) : copy.todosNone },
  ];
  if (retro.topApps[0]) {
    slides.push({
      id: "apps",
      mood: "thinking",
      color: "#bf8cff",
      eyebrow: copy.appsEyebrow,
      big: retro.topApps[0].label,
      caption: copy.appsCaption(hours(retro.topApps[0].ms), retro.topApps.slice(1).map((app) => app.label), hours(retro.activeMs)),
    });
  }
  if (retro.latestNight) {
    slides.push({ id: "night", mood: "sleeping", color: "#5e5ce6", eyebrow: copy.nightEyebrow, big: clockOfNight(retro.latestNight.minutes), caption: copy.nightCaption(date(retro.latestNight.date)) });
  }
  if (retro.topSong) {
    slides.push({ id: "music", mood: "greeting", color: "#ff375f", eyebrow: copy.musicEyebrow, big: retro.topSong.name, caption: copy.musicCaption(retro.topSong.plays, retro.songs), headphones: true });
  }
  slides.push({ id: "water", mood: "done", color: "#5ac8fa", eyebrow: copy.waterEyebrow, big: String(retro.waterDaysMet), caption: copy.waterCaption });
  slides.push({ id: "you", mood: "done", color: "#ffd60a", eyebrow: copy.youEyebrow, big: copy.archetypes[retro.archetype].name, caption: copy.archetypes[retro.archetype].text, aura: true });
  return slides;
}

/** The share card: 1080×1350, ready to paste in a post or a chat. */
export async function shareImage(retro: Retro, t: Translations): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  const background = ctx.createLinearGradient(0, 0, 1080, 1350);
  background.addColorStop(0, "#1b1440");
  background.addColorStop(0.55, "#0e1d3d");
  background.addColorStop(1, "#05070d");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 1080, 1350);
  const glow = ctx.createRadialGradient(540, 360, 40, 540, 360, 420);
  glow.addColorStop(0, "rgba(255, 214, 10, 0.28)");
  glow.addColorStop(1, "rgba(255, 214, 10, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1080, 800);

  const svg = renderToStaticMarkup(<Mascot mood="done" shape="cloud" color={NIMBO_COLOR} seed="nimbo" size={360} showDot={false} />).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode().catch(() => undefined);
  if (image.complete && image.naturalWidth > 0) ctx.drawImage(image, 360, 150, 360, 360);

  const copy = t.retro;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = "600 38px 'Segoe UI', sans-serif";
  ctx.fillText(copy.cardTitle, 540, 100);
  ctx.fillStyle = "#ffd60a";
  ctx.font = "800 72px 'Segoe UI', sans-serif";
  ctx.fillText(copy.archetypes[retro.archetype].name, 540, 600);

  const rows: [string, string, string][] = [
    [copy.hours(Math.round(retro.focusMinutes / 60)), copy.cardFocus, "#ff9f0a"],
    [String(retro.todos), copy.cardTodos, "#35e985"],
    [retro.topApps[0]?.label ?? "—", copy.cardApp, "#bf8cff"],
    [retro.topSong?.name ?? "—", copy.cardSong, "#ff375f"],
  ];
  rows.forEach(([value, label, color], index) => {
    const x = index % 2 === 0 ? 290 : 790;
    const y = 760 + Math.floor(index / 2) * 230;
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.beginPath();
    ctx.roundRect(x - 230, y - 80, 460, 190, 36);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.font = "800 56px 'Segoe UI', sans-serif";
    const text = value.length > 18 ? `${value.slice(0, 17)}…` : value;
    ctx.fillText(text, x, y + 10, 420);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "600 30px 'Segoe UI', sans-serif";
    ctx.fillText(label, x, y + 70);
  });
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = "600 30px 'Segoe UI', sans-serif";
  ctx.fillText("Nimbo · github.com/EduardoxDev/Nimbo", 540, 1290);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("png"))), "image/png"));
}

export function RetroView() {
  const t = useTranslation();
  const copy = t.retro;
  const [retro, setRetro] = useState<Retro | null>(null);
  const [index, setIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const now = Date.now();
    const settings = readGoals();
    const days = lastDayKeys(now);
    void Promise.all(
      days.map((day) => (isTauri() ? invoke<Segment[]>("activity_day", { day }).catch(() => [] as Segment[]) : Promise.resolve([] as Segment[]))),
    ).then((lists) => {
      if (cancelled) return;
      setRetro(
        buildRetro({
          now,
          stats: parseStats(read("nimbo-stats")),
          water: parseWaterHistory(read("nimbo-water-history")),
          waterGoalMl: settings.waterGoalMl,
          focusMinutes: settings.focusMinutes,
          activity: Object.fromEntries(days.map((day, position) => [day, lists[position]])),
          music: readMusic(),
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const slides = useMemo(() => (retro ? slidesOf(retro, t) : []), [retro, t]);
  const last = index >= slides.length - 1;

  useEffect(() => {
    if (!slides.length || last) return;
    const timer = window.setTimeout(() => setIndex((value) => Math.min(slides.length - 1, value + 1)), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [index, slides.length, last]);

  if (!retro || slides.length === 0) return <p className="retro__loading">{copy.loading}</p>;
  const slide = slides[Math.min(index, slides.length - 1)];

  return (
    <div className="retro" style={{ "--retro-color": slide.color } as CSSProperties}>
      <div className="retro__bars" aria-hidden="true">
        {slides.map((item, position) => (
          <span key={item.id} className={position < index ? "retro__bar retro__bar--done" : position === index ? "retro__bar retro__bar--now" : "retro__bar"} />
        ))}
      </div>
      <button className="retro__nav retro__nav--back" type="button" aria-label={copy.back} onClick={() => setIndex((value) => Math.max(0, value - 1))} />
      <button className="retro__nav retro__nav--next" type="button" aria-label={copy.next} onClick={() => setIndex((value) => Math.min(slides.length - 1, value + 1))} />
      <div className="retro__slide" key={slide.id}>
        <Mascot mood={slide.mood} shape="cloud" color={NIMBO_COLOR} seed="nimbo" size={120} glow showDot={false} aura={slide.aura ? "sparkle" : null} accessory={slide.headphones ? "headphones" : null} forceMotion />
        <span className="retro__eyebrow">{slide.eyebrow}</span>
        <strong className="retro__big">{slide.big}</strong>
        <p className="retro__caption">{slide.caption}</p>
        {last && (
          <div className="retro__actions">
            <button
              className="retro__share n-pressable"
              type="button"
              onClick={() =>
                void shareImage(retro, t)
                  .then((blob) => navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]))
                  .then(() => setNotice(copy.copied))
                  .catch(() => setNotice(copy.copyFailed))
              }
            >
              <Copy size={15} strokeWidth={2.4} />
              {copy.share}
            </button>
            {isTauri() && (
              <button
                className="retro__again"
                type="button"
                onClick={() =>
                  void shareImage(retro, t)
                    .then((blob) => blob.arrayBuffer())
                    .then((buffer) => invoke<string>("share_save_png", { name: `retrospectiva-${retro.to}`, bytes: Array.from(new Uint8Array(buffer)) }))
                    .then(() => setNotice(copy.saved))
                    .catch(() => setNotice(copy.copyFailed))
                }
              >
                <Download size={14} strokeWidth={2.4} />
                {copy.save}
              </button>
            )}
            <button className="retro__again" type="button" onClick={() => setIndex(0)}>
              <RotateCcw size={14} strokeWidth={2.4} />
              {copy.again}
            </button>
          </div>
        )}
        {notice && last && <span className="retro__notice">{notice}</span>}
      </div>
    </div>
  );
}
