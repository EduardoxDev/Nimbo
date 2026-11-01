import { useEffect, useId, useRef, useState } from "react";
import { hashSeed, mascotFrame, type MascotMood, type MascotShape } from "./engine";
import type { MascotAccessory } from "./accessories";
import { AccessoryShape } from "./MascotAccessory";
import "./Mascot.css";

type Listener = (time: number) => void;

const DIZZY_CLICKS = 5;
const DIZZY_WINDOW_MS = 2_000;
const DIZZY_MS = 4_500;
const ANNOYED_AFTER_MS = 4_000;

const listeners = new Set<Listener>();
let frame = 0;
let pointer: { x: number; y: number; at: number } | null = null;

function tick(now: number) {
  listeners.forEach((listener) => listener(now / 1000));
  frame = listeners.size > 0 ? requestAnimationFrame(tick) : 0;
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  if (!frame) frame = requestAnimationFrame(tick);
  return () => {
    listeners.delete(listener);
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

  useEffect(() => {
    if (!forceMotion && reducedMotion()) return;
    let last = 0;
    const interval = fps ? 1 / fps : size < 28 ? 1 / 12 : 1 / 30;
    return subscribe((now) => {
      if (now - last < interval) return;
      last = now;
      setTime(now);
    });
  }, [size, fps, forceMotion]);

  let gaze: { x: number; y: number } | null = null;
  if (pointer && performance.now() - pointer.at < 2500 && ref.current) {
    const rect = ref.current.getBoundingClientRect();
    const dx = pointer.x - (rect.left + rect.width / 2);
    const dy = pointer.y - (rect.top + rect.height / 2);
    gaze = { x: Math.max(-1, Math.min(1, dx / 220)), y: Math.max(-1, Math.min(1, dy / 140)) };
  }

  const current = mascotFrame({ shape, mood: shownMood, t: time, seed: numericSeed, gaze });

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
        <radialGradient id={`${maskId}-glow`}>
          <stop offset="0.35" stopColor={current.dot ?? color} stopOpacity="0.55" />
          <stop offset="1" stopColor={current.dot ?? color} stopOpacity="0" />
        </radialGradient>
        <mask id={maskId}>
          <rect width="100" height="100" fill="#fff" />
          {current.eyes.map((eye, index) =>
            eye.style === "open" ? (
              <ellipse key={index} cx={eye.cx} cy={eye.cy} rx={eye.rx} ry={Math.max(0.6, eye.ry)} fill="#000" />
            ) : eye.style === "spiral" ? (
              <circle key={index} cx={eye.cx} cy={eye.cy} r="4.6" fill="none" stroke="#000" strokeWidth="2.6" strokeDasharray="20 6" />
            ) : eye.style === "happy" ? (
              <path
                key={index}
                d={`M${eye.cx - 5.5} ${eye.cy + 2} Q${eye.cx} ${eye.cy - 6} ${eye.cx + 5.5} ${eye.cy + 2}`}
                fill="none"
                stroke="#000"
                strokeWidth="4.2"
                strokeLinecap="round"
              />
            ) : (
              <line
                key={index}
                x1={eye.cx - 5.5}
                y1={eye.cy + 1}
                x2={eye.cx + 5.5}
                y2={eye.cy + 1}
                stroke="#000"
                strokeWidth="4.2"
                strokeLinecap="round"
              />
            ),
          )}
        </mask>
      </defs>
      {aura === "wings" && (
        <g className="mascot__wings" transform={`translate(0 ${current.offsetY})`} fill="#ffffff" fillOpacity="0.85">
          <path d={`M22 50 Q${2 - Math.sin(time * 9) * 6} ${34 - Math.sin(time * 9) * 8} ${6 - Math.sin(time * 9) * 4} 58 Q14 60 22 58 Z`} />
          <path d={`M78 50 Q${98 + Math.sin(time * 9) * 6} ${34 - Math.sin(time * 9) * 8} ${94 + Math.sin(time * 9) * 4} 58 Q86 60 78 58 Z`} />
        </g>
      )}
      {aura && (
        <g className="mascot__sparkles" fill="#ffd60a">
          <path d="M12 18 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 Z" />
          <path d="M86 70 l1.5 4 l4 1.5 l-4 1.5 l-1.5 4 l-1.5 -4 l-4 -1.5 l4 -1.5 Z" />
          <path d="M90 14 l1 3 l3 1 l-3 1 l-1 3 l-1 -3 l-3 -1 l3 -1 Z" />
        </g>
      )}
      {glow && <circle className="mascot__glow" cx="50" cy="52" r="58" fill={`url(#${maskId}-glow)`} />}
      <g transform={`translate(0 ${current.offsetY}) rotate(${current.rotation} 50 50) translate(50 50) scale(${current.scale}) translate(-50 -50)`}>
        <path d={current.body} fill={color} mask={`url(#${maskId})`} />
        {accessory && !(accessory === "sunglasses" && shownMood === "sleeping") && <AccessoryShape accessory={accessory} eyes={current.eyes} />}
      </g>
      {current.hands.map((hand, index) => (
        <circle key={index} className="mascot__hand" cx={hand.cx} cy={hand.cy + current.offsetY} r={hand.r} fill={color} />
      ))}
      {showDot && current.dot && (
        <circle className="mascot__dot" cx="20" cy="20" r="8" fill={current.dot} stroke="#0b0b0f" strokeWidth="3.5" />
      )}
      {shownMood === "sleeping" && (
        <text className="mascot__z" x="76" y="24" fontSize="18" fontWeight="700" fill={color}>
          z
        </text>
      )}
    </svg>
  );
}
