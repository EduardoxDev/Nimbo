import { createElement, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { hashSeed, mascotFrame, type MascotMood, type MascotShape } from "./engine";
import type { MascotAccessory } from "./accessories";
import { AccessoryShape } from "./MascotAccessory";
import { domName, flatten, mascotNodes, shapeOf, type MascotNode } from "./mascotNodes";
import "./Mascot.css";

type Listener = (time: number) => void;

const DIZZY_CLICKS = 5;
const DIZZY_WINDOW_MS = 2_000;
const DIZZY_MS = 4_500;
const ANNOYED_AFTER_MS = 4_000;
/** Below this size only the face is drawn: no mouth, cheeks, arms or antenna. */
const DETAIL_SIZE = 28;

function mix(hex: string, target: string, amount: number) {
  const parse = (value: string) => {
    const clean = value.replace("#", "");
    const full = clean.length === 3 ? clean.replace(/./g, "$&$&") : clean.slice(0, 6);
    return [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16));
  };
  const from = parse(hex);
  const to = parse(target);
  if (from.some(Number.isNaN) || to.some(Number.isNaN)) return hex;
  return `#${from.map((value, index) => Math.round(value + (to[index] - value) * amount).toString(16).padStart(2, "0")).join("")}`;
}

type Subscription = { listener: Listener; interval: number };

const listeners = new Set<Subscription>();
let timer = 0;
let pointer: { x: number; y: number; at: number } | null = null;

function schedule() {
  timer = 0;
  if (listeners.size === 0) return;
  let wait = Infinity;
  listeners.forEach((entry) => {
    wait = Math.min(wait, entry.interval);
  });
  timer = window.setTimeout(tick, wait * 1000);
}

function tick() {
  const now = performance.now() / 1000;
  listeners.forEach((entry) => entry.listener(now));
  schedule();
}

function subscribe(listener: Listener, interval: number) {
  const entry = { listener, interval };
  listeners.add(entry);
  if (!timer) schedule();
  return () => {
    listeners.delete(entry);
  };
}

if (typeof window !== "undefined") {
  window.addEventListener(
    "pointermove",
    (event) => {
      pointer = { x: event.clientX, y: event.clientY, at: performance.now() };
    },
    { passive: true },
  );
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Mascot({
  mood,
  shape,
  color,
  size,
  seed = "nimbo",
  showDot = true,
  glow = false,
  interactive = false,
  onReaction,
  label,
  accessory = null,
  aura = null,
  fps,
  forceMotion = false,
}: {
  mood: MascotMood;
  shape: MascotShape;
  color: string;
  size: number;
  seed?: string;
  showDot?: boolean;
  glow?: boolean;
  interactive?: boolean;
  onReaction?: (reaction: "dizzy" | "annoyed") => void;
  label?: string;
  accessory?: MascotAccessory | null;
  aura?: "sparkle" | "wings" | null;
  fps?: number;
  /** Animate even when Windows asks for reduced motion (the user opted in). */
  forceMotion?: boolean;
}) {
  const maskId = `mascot-${useId().replace(/:/g, "")}`;
  const ref = useRef<SVGSVGElement>(null);
  const [time, setTime] = useState(0);
  const numericSeed = hashSeed(seed);
  const [reaction, setReaction] = useState<"dizzy" | "annoyed" | null>(null);
  const clicksRef = useRef<number[]>([]);
  const hoverTimerRef = useRef(0);
  const reactionTimerRef = useRef(0);
  const [pokedAt, setPokedAt] = useState<number | null>(null);

  useEffect(
    () => () => {
      window.clearTimeout(hoverTimerRef.current);
      window.clearTimeout(reactionTimerRef.current);
    },
    [],
  );

  const react = (next: "dizzy" | "annoyed", duration: number | null) => {
    setReaction(next);
    onReaction?.(next);
    window.clearTimeout(reactionTimerRef.current);
    if (duration !== null) reactionTimerRef.current = window.setTimeout(() => setReaction(null), duration);
  };

  const interactions = interactive
    ? {
        onClick: () => {
          const now = performance.now();
          setPokedAt(now / 1000);
          clicksRef.current = [...clicksRef.current.filter((time) => now - time < DIZZY_WINDOW_MS), now];
          if (clicksRef.current.length >= DIZZY_CLICKS) {
            clicksRef.current = [];
            react("dizzy", DIZZY_MS);
          }
        },
        onPointerEnter: () => {
          window.clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = window.setTimeout(() => {
            setReaction((current) => current ?? "annoyed");
            onReaction?.("annoyed");
          }, ANNOYED_AFTER_MS);
        },
        onPointerLeave: () => {
          window.clearTimeout(hoverTimerRef.current);
          setReaction((current) => (current === "annoyed" ? null : current));
        },
      }
    : {};
  const shownMood: MascotMood = reaction ?? mood;

  const elementsRef = useRef(new Map<string, Element>());
  const appliedRef = useRef(new Map<string, Record<string, string | number>>());
  const shapeRef = useRef("");
  const liveRef = useRef<{ mood: MascotMood; pokedAt: number | null; color: string; detail: boolean; aura: typeof aura; glow: boolean; showDot: boolean }>(null!);
  const detail = size >= DETAIL_SIZE;
  liveRef.current = { mood: shownMood, pokedAt, color, detail, aura, glow, showDot };

  const paintFor = (tint: string, dot: string | null) => ({
    color: tint,
    light: mix(tint, "#ffffff", 0.55),
    shade: mix(tint, "#3a3f66", 0.38),
    accent: dot ?? tint,
    ids: { body: `${maskId}-body`, bulb: `${maskId}-bulb`, glow: `${maskId}-glow`, clip: `${maskId}-clip` },
  });

  const gazeOf = () => {
    if (!pointer || performance.now() - pointer.at >= 2500 || !ref.current) return null;
    const rect = ref.current.getBoundingClientRect();
    const dx = pointer.x - (rect.left + rect.width / 2);
    const dy = pointer.y - (rect.top + rect.height / 2);
    return { x: Math.max(-1, Math.min(1, dx / 220)), y: Math.max(-1, Math.min(1, dy / 140)) };
  };

  const build = (t: number, gaze: { x: number; y: number } | null) => {
    const live = liveRef.current;
    const frame = mascotFrame({ shape, mood: live.mood, t, seed: numericSeed, gaze, poke: live.pokedAt === null ? null : t - live.pokedAt });
    const nodes = mascotNodes(frame, { detail: live.detail, paint: paintFor(live.color, frame.dot), aura: live.aura, glow: live.glow, showDot: live.showDot, mood: live.mood, time: t });
    return { frame, nodes, shape: `${shapeOf(nodes.before)}|${shapeOf(nodes.body)}|${shapeOf(nodes.after)}` };
  };

  const patch = (key: string, attrs: Record<string, string | number>) => {
    const element = elementsRef.current.get(key);
    if (!element) return false;
    const applied = appliedRef.current.get(key) ?? {};
    for (const [name, value] of Object.entries(attrs)) {
      if (applied[name] !== value) element.setAttribute(domName(name), String(value));
    }
    appliedRef.current.set(key, attrs);
    return true;
  };

  useEffect(() => {
    if (!forceMotion && reducedMotion()) return;
    let last = 0;
    const interval = fps ? 1 / fps : size < 28 ? 1 / 12 : 1 / 30;
    return subscribe((now) => {
      if (now - last < interval * 0.8) return;
      last = now;
      const next = build(now, gazeOf());
      if (next.shape !== shapeRef.current) {
        setTime(now);
        return;
      }
      const all = flatten([...next.nodes.before, ...next.nodes.body, ...next.nodes.after]);
      const complete =
        all.every((node) => patch(node.key, node.attrs)) &&
        patch("clip", { d: next.nodes.clip }) &&
        patch("figure", { transform: next.nodes.transform });
      if (!complete) setTime(now);
    }, interval);
  }, [size, fps, forceMotion, shape, numericSeed]);

  const current = build(time, null);
  shapeRef.current = current.shape;
  const paint = paintFor(color, current.frame.dot);

  const keep = (key: string, attrs: Record<string, string | number>) => (element: Element | null) => {
    if (element) {
      elementsRef.current.set(key, element);
      appliedRef.current.set(key, attrs);
    } else {
      elementsRef.current.delete(key);
      appliedRef.current.delete(key);
    }
  };

  const render = (node: MascotNode, extra?: ReactNode): ReactNode =>
    createElement(
      node.tag,
      { key: node.key, ref: keep(node.key, node.attrs), ...node.attrs },
      node.text ?? (node.children ? [...node.children.map((child) => render(child)), extra] : extra),
    );

  return (
    <svg
      ref={ref}
      className={`mascot mascot--${shownMood}${interactive ? " mascot--interactive" : ""}`}
      {...interactions}
      overflow="visible"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <radialGradient id={paint.ids.glow}>
          <stop offset="0.35" stopColor={paint.accent} stopOpacity="0.55" />
          <stop offset="1" stopColor={paint.accent} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={paint.ids.body} cx="0.36" cy="0.28" r="0.85">
          <stop offset="0" stopColor={paint.light} />
          <stop offset="0.55" stopColor={color} />
          <stop offset="1" stopColor={paint.shade} />
        </radialGradient>
        <radialGradient id={paint.ids.bulb}>
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor={paint.accent} />
          <stop offset="1" stopColor={paint.accent} stopOpacity="0" />
        </radialGradient>
        <clipPath id={paint.ids.clip}>
          <path ref={keep("clip", { d: current.nodes.clip })} d={current.nodes.clip} />
        </clipPath>
      </defs>
      {current.nodes.before.map((node) => render(node))}
      <g ref={keep("figure", { transform: current.nodes.transform })} transform={current.nodes.transform}>
        {current.nodes.body.map((node) => render(node))}
        {accessory && !(accessory === "sunglasses" && shownMood === "sleeping") && <AccessoryShape accessory={accessory} eyes={current.frame.eyes} />}
      </g>
      {current.nodes.after.map((node) => render(node))}
    </svg>
  );
}
