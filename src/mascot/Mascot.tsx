import { useEffect, useId, useRef, useState } from "react";
import { hashSeed, mascotFrame, type MascotMood, type MascotShape } from "./engine";
import "./Mascot.css";

type Listener = (time: number) => void;

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
  label,
}: {
  mood: MascotMood;
  shape: MascotShape;
  color: string;
  size: number;
  seed?: string;
  showDot?: boolean;
  label?: string;
}) {
  const maskId = `mascot-${useId().replace(/:/g, "")}`;
  const ref = useRef<SVGSVGElement>(null);
  const [time, setTime] = useState(0);
  const numericSeed = hashSeed(seed);

  useEffect(() => {
    if (reducedMotion()) return;
    let last = 0;
    const interval = size < 28 ? 1 / 24 : 1 / 50;
    return subscribe((now) => {
      if (now - last < interval) return;
      last = now;
      setTime(now);
    });
  }, [size]);

  let gaze: { x: number; y: number } | null = null;
  if (pointer && performance.now() - pointer.at < 2500 && ref.current) {
    const rect = ref.current.getBoundingClientRect();
    const dx = pointer.x - (rect.left + rect.width / 2);
    const dy = pointer.y - (rect.top + rect.height / 2);
    gaze = { x: Math.max(-1, Math.min(1, dx / 220)), y: Math.max(-1, Math.min(1, dy / 140)) };
  }

  const current = mascotFrame({ shape, mood, t: time, seed: numericSeed, gaze });

  return (
    <svg
      ref={ref}
      className={`mascot mascot--${mood}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <mask id={maskId}>
          <rect width="100" height="100" fill="#fff" />
          {current.eyes.map((eye, index) =>
            eye.style === "open" ? (
              <ellipse key={index} cx={eye.cx} cy={eye.cy} rx={eye.rx} ry={Math.max(0.6, eye.ry)} fill="#000" />
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
      <g transform={`translate(0 ${current.offsetY}) rotate(${current.rotation} 50 50) translate(50 50) scale(${current.scale}) translate(-50 -50)`}>
        <path d={current.body} fill={color} mask={`url(#${maskId})`} />
      </g>
      {showDot && current.dot && (
        <circle className="mascot__dot" cx="20" cy="20" r="8" fill={current.dot} stroke="#0b0b0f" strokeWidth="3.5" />
      )}
      {mood === "sleeping" && (
        <text className="mascot__z" x="76" y="24" fontSize="18" fontWeight="700" fill={color}>
          z
        </text>
      )}
    </svg>
  );
}
