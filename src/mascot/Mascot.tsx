import { useEffect, useId, useRef, useState } from "react";
import { hashSeed, mascotFrame, type MascotFrame, type MascotMood, type MascotShape } from "./engine";
import type { MascotAccessory } from "./accessories";
import { AccessoryShape } from "./MascotAccessory";
import "./Mascot.css";

type Listener = (time: number) => void;

const DIZZY_CLICKS = 5;
const DIZZY_WINDOW_MS = 2_000;
const DIZZY_MS = 4_500;
const ANNOYED_AFTER_MS = 4_000;
/** Below this size only the face is drawn: no mouth, cheeks, arms or antenna. */
const DETAIL_SIZE = 28;
const INK = "#1c1b29";

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

function Eye({ eye, detail }: { eye: MascotFrame["eyes"][number]; detail: boolean }) {
  if (eye.style === "spiral") {
    return <circle cx={eye.cx} cy={eye.cy} r="4.6" fill="none" stroke={INK} strokeWidth="2.4" strokeDasharray="20 6" strokeLinecap="round" />;
  }
  if (eye.style === "happy") {
    return (
      <path
        d={`M${eye.cx - 5} ${eye.cy + 2} Q${eye.cx} ${eye.cy - 5.5} ${eye.cx + 5} ${eye.cy + 2}`}
        fill="none"
        stroke={INK}
        strokeWidth="3.4"
        strokeLinecap="round"
      />
    );
  }
  if (eye.style === "closed") {
    return (
      <path
        d={`M${eye.cx - 5} ${eye.cy} Q${eye.cx} ${eye.cy + 3.5} ${eye.cx + 5} ${eye.cy}`}
        fill="none"
        stroke={INK}
        strokeWidth="3"
        strokeLinecap="round"
      />
    );
  }
  const ry = Math.max(0.8, eye.ry);
  return (
    <g>
      <ellipse cx={eye.cx} cy={eye.cy} rx={eye.rx} ry={ry} fill={INK} />
      {detail && ry > 3 && (
        <>
          <circle cx={eye.cx + 1.4} cy={eye.cy - ry * 0.42} r="1.9" fill="#fff" />
          <circle cx={eye.cx - 1.5} cy={eye.cy + ry * 0.38} r="0.9" fill="#fff" fillOpacity="0.75" />
        </>
      )}
    </g>
  );
}

function Mouth({ mouth }: { mouth: MascotFrame["mouth"] }) {
  const { cx, cy } = mouth;
  const stroke = { fill: "none", stroke: INK, strokeWidth: 2.4, strokeLinecap: "round" as const };
  switch (mouth.style) {
    case "smile":
      return <path d={`M${cx - 4} ${cy - 1} Q${cx} ${cy + 3} ${cx + 4} ${cy - 1}`} {...stroke} />;
    case "grin":
      return (
        <g>
          <path d={`M${cx - 6} ${cy - 2} Q${cx} ${cy + 7} ${cx + 6} ${cy - 2} Z`} fill={INK} stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
          <path d={`M${cx - 2.6} ${cy + 2.4} Q${cx} ${cy + 0.6} ${cx + 2.6} ${cy + 2.4}`} fill="#ff7a9a" />
        </g>
      );
    case "o":
      return <ellipse cx={cx} cy={cy + 1} rx="2.4" ry="3" fill={INK} />;
    case "flat":
      return <path d={`M${cx - 3.5} ${cy} L${cx + 3.5} ${cy}`} {...stroke} />;
    case "hmm":
      return <path d={`M${cx - 2} ${cy + 0.5} Q${cx + 2} ${cy - 1.5} ${cx + 5} ${cy}`} {...stroke} />;
    case "wavy":
      return <path d={`M${cx - 6} ${cy} q1.5 -2.5 3 0 t3 0 t3 0 t3 0`} {...stroke} strokeWidth={2} />;
  }
}

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

  const poke = pokedAt === null ? null : time - pokedAt;
  const current = mascotFrame({ shape, mood: shownMood, t: time, seed: numericSeed, gaze, poke });
  const detail = size >= DETAIL_SIZE;
  const light = mix(color, "#ffffff", 0.55);
  const shade = mix(color, "#3a3f66", 0.38);
  const accent = current.dot ?? color;
  const { x: squashX, y: squashY } = current.squash;

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
          <stop offset="0.35" stopColor={accent} stopOpacity="0.55" />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${maskId}-body`} cx="0.36" cy="0.28" r="0.85">
          <stop offset="0" stopColor={light} />
          <stop offset="0.55" stopColor={color} />
          <stop offset="1" stopColor={shade} />
        </radialGradient>
        <radialGradient id={`${maskId}-bulb`}>
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor={accent} />
          <stop offset="1" stopColor={accent} stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${maskId}-clip`}>
          <path d={current.body} />
        </clipPath>
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
      {detail && (
        <ellipse
          className="mascot__shadow"
          cx="50"
          cy="91"
          rx={24 + current.offsetY * 1.2}
          ry="3.2"
          fill="#000"
          fillOpacity={Math.max(0.08, 0.28 + current.offsetY * 0.03)}
        />
      )}
      <g
        transform={`translate(0 ${current.offsetY}) rotate(${current.rotation} 50 50) translate(50 84) scale(${current.scale * squashX} ${current.scale * squashY}) translate(-50 -84)`}
      >
        {detail && current.antenna && (
          <g className="mascot__antenna">
            <path
              d={`M50 24 Q${(50 + current.antenna.tip[0]) / 2 - 3} ${current.antenna.tip[1] + 10} ${current.antenna.tip[0]} ${current.antenna.tip[1] + 4}`}
              fill="none"
              stroke={shade}
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            {current.antenna.on && <circle cx={current.antenna.tip[0]} cy={current.antenna.tip[1]} r="9" fill={`url(#${maskId}-bulb)`} />}
            <circle cx={current.antenna.tip[0]} cy={current.antenna.tip[1]} r="3.6" fill={current.antenna.on ? accent : shade} />
            <circle cx={current.antenna.tip[0] - 1} cy={current.antenna.tip[1] - 1.2} r="1.1" fill="#fff" fillOpacity="0.85" />
          </g>
        )}
        {detail &&
          current.arms.map((arm, index) => (
            <g key={index} className="mascot__arm">
              <path d={`M${arm.shoulder[0]} ${arm.shoulder[1]} L${arm.hand[0]} ${arm.hand[1]}`} stroke={shade} strokeWidth="9.5" strokeLinecap="round" />
              <path d={`M${arm.shoulder[0]} ${arm.shoulder[1]} L${arm.hand[0]} ${arm.hand[1]}`} stroke={color} strokeWidth="7" strokeLinecap="round" />
            </g>
          ))}
        <path className="mascot__body" d={current.body} fill={`url(#${maskId}-body)`} />
        <g clipPath={`url(#${maskId}-clip)`}>
          <path d={current.body} fill="none" stroke={shade} strokeOpacity="0.35" strokeWidth="5" />
          <ellipse cx="36" cy="27" rx="13" ry="6" fill="#fff" fillOpacity="0.6" transform="rotate(-22 36 27)" />
          <circle cx="53" cy="22" r="2.2" fill="#fff" fillOpacity="0.55" />
        </g>
        {detail &&
          current.cheeks.map((cheek, index) => (
            <ellipse key={index} cx={cheek.cx} cy={cheek.cy} rx="5" ry="3" fill="#ff7a9a" fillOpacity="0.38" />
          ))}
        {current.eyes.map((eye, index) => (
          <Eye key={index} eye={eye} detail={detail} />
        ))}
        {detail && <Mouth mouth={current.mouth} />}
        {accessory && !(accessory === "sunglasses" && shownMood === "sleeping") && <AccessoryShape accessory={accessory} eyes={current.eyes} />}
      </g>
      {showDot && current.dot && !(detail && current.antenna) && (
        <circle className="mascot__dot" cx="20" cy="20" r="8" fill={current.dot} stroke="#0b0b0f" strokeWidth="3.5" />
      )}
      {shownMood === "sleeping" && (
        <text className="mascot__z" x="76" y="24" fontSize="18" fontWeight="700" fill={light}>
          z
        </text>
      )}
    </svg>
  );
}
