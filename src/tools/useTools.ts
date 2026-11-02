import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { LocaleCode, Translations } from "../i18n/types";
import type { LifeAction } from "../life/useLifeHelpers";
import { playingAmbient, startAmbient, stopAmbient, type AmbientKind } from "./ambient";
import { convertText, loadRates, RATES_KEY, ratesStale, type Rates } from "./convert";
import { checkText } from "./scam";
import { loadAmbientVolumes } from "./SoundsPanel";
import {
  addToPalette,
  colorName,
  diagnose,
  friendlyApp,
  FRIENDS_KEY,
  hexToRgb,
  hourIn,
  loadFriends,
  loadSnippets,
  momentOf,
  PALETTE_KEY,
  rgbText,
  SNIPPETS_KEY,
  type Checkup,
  type ToolCommand,
} from "./tools";

type Push = (notice: { text: string; actions: LifeAction[] }) => void;
type Clip = { id: string; kind: string; text?: string; copiedAt: number } | null;
export type ToolNotice = { text: string; color: string; actions: { label: string; primary?: boolean; onClick: () => void }[] };

const PRINTS_EVERY_MS = 3 * 60_000;

function copyText(text: string) {
  if (isTauri()) void invoke("copy_translation_result", { text }).catch(() => {});
  else void navigator.clipboard.writeText(text).catch(() => {});
}

/** The picked colour tints the island, but dark ones would be unreadable on it. */
export function readableOn(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return "#f5f5f7";
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance < 0.35 ? "#f5f5f7" : hex;
}

function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The small tools: expander, paste queue, eyedropper, read aloud, converter,
 * scam check, screenshot library, ambient sound, break game, "shut down when
 * done", the PC checkup and friends' clocks.
 */
export function useTools(input: {
  t: Translations;
  locale: LocaleCode;
  push: Push;
  openPage: (page: "sounds" | "game") => void;
  newestClip: Clip;
  settings: { toolConvert: boolean; toolScam: boolean; toolPrints: boolean; breakGame: boolean; ambientWithFocus: AmbientKind | "off"; readRate: number };
  focus: { status: "idle" | "running" | "paused"; phase: string };
  liveRunning: boolean;
}) {
  const ref = useRef(input);
  ref.current = input;
  const { t } = input;
  const [notice, setNotice] = useState<ToolNotice | null>(null);
  const [collecting, setCollecting] = useState<string[] | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [shutdownArmed, setShutdownArmed] = useState(false);

  // ---------- Text expander: the list lives in Settings → Tools ----------
  useEffect(() => {
    if (!isTauri()) return;
    const send = () => void invoke("keys_set_snippets", { snippets: loadSnippets(readStorage(SNIPPETS_KEY)) }).catch(() => {});
    send();
    const follow = (event: StorageEvent) => {
      if (event.key === SNIPPETS_KEY) send();
    };
    window.addEventListener("storage", follow);
    return () => window.removeEventListener("storage", follow);
  }, []);

  // ---------- Copies: paste queue, scam check, converter ----------
  const lastClipRef = useRef<string | null>(null);
  const ratesRef = useRef<Rates | null>(loadRates(readStorage(RATES_KEY)));
  useEffect(() => {
    const clip = input.newestClip;
    if (!clip) return;
    const previous = lastClipRef.current;
    lastClipRef.current = clip.id;
    if (previous === null || previous === clip.id || clip.kind !== "text" || !clip.text || Date.now() - clip.copiedAt > 15_000) return;
    const text = clip.text;
    const { settings, push } = ref.current;
    const copy = ref.current.t.tools;
    if (collecting) {
      setCollecting((items) => (items ? [...items, text].slice(0, 30) : items));
      return;
    }
    if (settings.toolScam) {
      const scam = checkText(text);
      if (scam) {
        const reasons = scam.reasons.map((reason) => copy.scamReasons[reason]).join("; ");
        push({
          text: `${scam.level === "danger" ? copy.scamDanger(scam.brand, scam.host) : copy.scamWarn(scam.host)} ${reasons.charAt(0).toUpperCase()}${reasons.slice(1)}.`,
          actions: [
            { label: copy.understood, primary: true },
            { label: copy.clearClipboard, run: () => copyText(" ") },
          ],
        });
        return;
      }
    }
    if (settings.toolConvert) {
      const now = new Date();
      const tryConvert = () => convertText(text, { rates: ratesRef.current, localeTag: ref.current.t.localeTag, now });
      const show = (result: ReturnType<typeof tryConvert>) => {
        if (!result) return;
        push({ text: copy.convertNotice(result.from, result.value), actions: [{ label: copy.copyResult, primary: true, run: () => copyText(result.value) }, { label: ref.current.t.life.ok }] });
      };
      const result = tryConvert();
      // Money needs fresh rates; fetch once a day, then convert.
      if (!result && ratesStale(ratesRef.current, now) && /\d/.test(text) && text.length <= 40) {
        void fetch("https://api.frankfurter.app/latest")
          .then((response) => response.json())
          .then((body: { date: string; rates: Record<string, number> }) => {
            ratesRef.current = { base: "EUR", date: body.date, rates: body.rates };
            try {
              window.localStorage.setItem(RATES_KEY, JSON.stringify(ratesRef.current));
            } catch {
              // Fetched again next time.
            }
            show(tryConvert());
          })
          .catch(() => {});
      } else show(result);
    }
  }, [input.newestClip?.id]);

  const startQueue = useCallback(() => setCollecting([]), []);
  useEffect(() => {
    if (!isTauri()) return;
    let stop: (() => void) | null = null;
    void listen<number>("paste-queue", ({ payload }) => {
      const copy = ref.current.t.tools;
      if (payload > 0) setNotice({ text: copy.queueLeft(payload), color: "#35e985", actions: [{ label: copy.cancel, onClick: () => void invoke("keys_paste_queue", { items: [] }).then(() => setNotice(null)) }] });
      else {
        setNotice(null);
        ref.current.push({ text: copy.queueDone, actions: [{ label: ref.current.t.life.ok, primary: true }] });
      }
    }).then((unlisten) => (stop = unlisten));
    return () => stop?.();
  }, []);

  // ---------- Eyedropper ----------
  const pickColor = useCallback(() => {
    if (!isTauri()) return;
    void invoke("keys_pick_color")
      .then(() => setPicking("#ffffff"))
      .catch((error) => ref.current.push({ text: String(error), actions: [{ label: ref.current.t.life.ok, primary: true }] }));
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    const stops: (() => void)[] = [];
    void listen<{ hex: string }>("color-preview", ({ payload }) => setPicking(payload.hex)).then((stop) => stops.push(stop));
    void listen("color-pick-cancelled", () => setPicking(null)).then((stop) => stops.push(stop));
    void listen<{ hex: string }>("color-picked", ({ payload }) => {
      setPicking(null);
      const hex = payload.hex.toLowerCase();
      copyText(hex);
      try {
        const palette = JSON.parse(window.localStorage.getItem(PALETTE_KEY) ?? "[]");
        window.localStorage.setItem(PALETTE_KEY, JSON.stringify(addToPalette(Array.isArray(palette) ? palette : [], hex)));
      } catch {
        // The palette misses this one.
      }
      const { t: current, locale } = ref.current;
      const rgb = hexToRgb(hex);
      ref.current.push({
        text: current.tools.picked(hex, colorName(hex, locale)),
        actions: [
          { label: current.tools.copyHex, primary: true, run: () => copyText(hex) },
          ...(rgb ? [{ label: current.tools.copyRgb, run: () => copyText(rgbText(rgb)) }] : []),
        ],
      });
    }).then((stop) => stops.push(stop));
    return () => stops.forEach((stop) => stop());
  }, []);

  // ---------- Read aloud ----------
  const [reading, setReading] = useState(false);
  const readAloud = useCallback(() => {
    if (!isTauri() || !("speechSynthesis" in window)) return;
    void invoke<string>("keys_copy_selection")
      .then((text) => {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        const lang = ref.current.t.localeTag;
        utterance.lang = lang;
        utterance.rate = ref.current.settings.readRate;
        // Prefer the natural (online) voices Windows has for the language.
        const voices = window.speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
        utterance.voice = voices.find((voice) => /natural|online/i.test(voice.name)) ?? voices[0] ?? null;
        utterance.onend = () => setReading(false);
        utterance.onerror = () => setReading(false);
        setReading(true);
        window.speechSynthesis.speak(utterance);
      })
      .catch(() => ref.current.push({ text: ref.current.t.tools.readFailed, actions: [{ label: ref.current.t.life.ok, primary: true }] }));
  }, []);

  // ---------- Screenshot library ----------
  useEffect(() => {
    if (!input.settings.toolPrints || !isTauri()) return;
    const scan = () => void invoke("prints_scan").catch(() => {});
    const first = window.setTimeout(scan, 20_000);
    const interval = window.setInterval(scan, PRINTS_EVERY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [input.settings.toolPrints]);

  // ---------- Ambient sound during focus, game on breaks ----------
  const ambientStartedRef = useRef<AmbientKind | null>(null);
  const focusing = input.focus.status === "running" && input.focus.phase === "focus";
  useEffect(() => {
    const kind = input.settings.ambientWithFocus;
    if (focusing && kind !== "off") {
      if (!playingAmbient().includes(kind)) {
        startAmbient(kind, loadAmbientVolumes()[kind]);
        ambientStartedRef.current = kind;
      }
    } else if (ambientStartedRef.current) {
      stopAmbient(ambientStartedRef.current);
      ambientStartedRef.current = null;
    }
  }, [focusing, input.settings.ambientWithFocus]);
  const onBreak = input.focus.status === "running" && input.focus.phase !== "focus";
  useEffect(() => {
    if (!onBreak || !ref.current.settings.breakGame) return;
    const copy = ref.current.t.game;
    ref.current.push({ text: copy.offer, actions: [{ label: copy.offerPlay, primary: true, run: () => ref.current.openPage("game") }, { label: ref.current.t.life.notNow }] });
  }, [onBreak]);

  // ---------- Shut down when downloads and copies are done ----------
  const wasRunningRef = useRef(false);
  useEffect(() => {
    const running = input.liveRunning;
    const finished = wasRunningRef.current && !running;
    wasRunningRef.current = running;
    if (!shutdownArmed || !finished) return;
    setShutdownArmed(false);
    const copy = ref.current.t.tools;
    void invoke("pc_tool", { name: "shutdown_timer", minutes: 1 }).catch(() => {});
    ref.current.push({ text: copy.shutdownSoon, actions: [{ label: copy.shutdownCancel, primary: true, run: () => void invoke("pc_tool", { name: "shutdown_timer", minutes: 0 }).catch(() => {}) }] });
  }, [input.liveRunning, shutdownArmed]);

  // ---------- PC checkup ----------
  const checkup = useCallback(() => {
    if (!isTauri()) return;
    const copy = ref.current.t.tools;
    setNotice({ text: copy.doctorWorking, color: "#35e985", actions: [] });
    void invoke<Checkup>("pc_checkup")
      .then((result) => {
        setNotice(null);
        const finding = diagnose(result)[0];
        const ok = { label: ref.current.t.life.ok };
        if (finding.kind === "cpu" || finding.kind === "memory") {
          const name = friendlyApp(finding.app.name);
          const text = finding.kind === "cpu" ? copy.doctorCpu(name, Math.round(finding.app.cpu)) : copy.doctorMemory(name, (finding.app.memoryMb / 1024).toFixed(1), Math.round(finding.used));
          ref.current.push({
            text,
            actions: finding.app.canClose
              ? [{ label: copy.closeApp(name), primary: true, run: () => void invoke("pc_close_app", { name: finding.app.name }).catch((error) => ref.current.push({ text: String(error), actions: [ok] })) }, ok]
              : [{ ...ok, primary: true }],
          });
        } else if (finding.kind === "disk") ref.current.push({ text: copy.doctorDisk(Math.round(finding.freeGb)), actions: [{ label: copy.cleanDisk, primary: true, run: () => void invoke("open_settings_window").catch(() => {}) }, ok] });
        else if (finding.kind === "uptime") ref.current.push({ text: copy.doctorUptime(finding.days), actions: [{ ...ok, primary: true }] });
        else ref.current.push({ text: copy.doctorFine(Math.round(result.cpu), Math.round(result.memoryUsed), Math.round(result.diskFreeGb)), actions: [{ ...ok, primary: true }] });
      })
      .catch((error) => {
        setNotice(null);
        ref.current.push({ text: String(error), actions: [{ label: ref.current.t.life.ok, primary: true }] });
      });
  }, []);

  const onTool = useCallback(
    (tool: ToolCommand) => {
      const { t: current, push } = ref.current;
      const copy = current.tools;
      if (tool === "queue") startQueue();
      else if (tool === "color") pickColor();
      else if (tool === "doctor") checkup();
      else if (tool === "sounds") ref.current.openPage("sounds");
      else if (tool === "game") ref.current.openPage("game");
      else if (tool === "shutdown") {
        if (!ref.current.liveRunning) push({ text: copy.shutdownNothing, actions: [{ label: current.life.ok, primary: true }] });
        else {
          setShutdownArmed(true);
          push({ text: copy.shutdownArmed, actions: [{ label: copy.shutdownCancel, primary: true, run: () => setShutdownArmed(false) }] });
        }
      } else if (tool === "friends") {
        const friends = loadFriends(readStorage(FRIENDS_KEY));
        const now = new Date();
        const text = friends.length
          ? friends
              .map((friend) => {
                const at = hourIn(friend.zone, now);
                return at ? `${friend.name} ${String(at.hour).padStart(2, "0")}:${String(at.minute).padStart(2, "0")} ${copy.moments[momentOf(at.hour)]}` : friend.name;
              })
              .join(" · ")
          : copy.friendsNone;
        push({ text, actions: [{ label: current.life.ok, primary: true }] });
      }
    },
    [startQueue, pickColor, checkup],
  );

  const copy = t.tools;
  // The tool waiting on the user right now, shown above other notices.
  const topNotice: ToolNotice | null = picking
    ? { text: copy.pickHint(picking), color: readableOn(picking), actions: [{ label: copy.cancel, onClick: () => setPicking(null) }] }
    : collecting
      ? {
          text: copy.queueCollecting(collecting.length),
          color: "#35e985",
          actions: [
            {
              label: copy.queueReady,
              primary: true,
              onClick: () => {
                const items = collecting;
                setCollecting(null);
                if (!items.length || !isTauri()) return;
                void invoke<number>("keys_paste_queue", { items }).then((count) =>
                  setNotice({ text: copy.queueStarted(count), color: "#35e985", actions: [{ label: copy.cancel, onClick: () => void invoke("keys_paste_queue", { items: [] }).then(() => setNotice(null)) }] }),
                );
              },
            },
            { label: copy.cancel, onClick: () => setCollecting(null) },
          ],
        }
      : reading
        ? { text: copy.readingAloud, color: "#64d2ff", actions: [{ label: copy.stop, primary: true, onClick: () => window.speechSynthesis.cancel() }] }
        : notice;

  return { topNotice, onTool, pickColor, readAloud, shutdownArmed };
}
