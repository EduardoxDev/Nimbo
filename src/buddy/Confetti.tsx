import { useEffect, useRef } from "react";
import type { BuddyFx } from "./channel";

const COLORS = ["#5ac8fa", "#ff9f0a", "#ff375f", "#bf8cff", "#35e985", "#ffd60a"];
const DURATION_MS = 3_200;

type Piece = { x: number; y: number; vx: number; vy: number; spin: number; angle: number; color: string; size: number; heart: boolean };

export function FxLayer({ fx, origin, onDone }: { fx: { kind: BuddyFx; id: string } | null; origin: { x: number; y: number }; onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!fx || !canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * ratio;
    canvas.height = window.innerHeight * ratio;
    context.scale(ratio, ratio);
    const hearts = fx.kind === "hearts";
    const pieces: Piece[] = Array.from({ length: hearts ? 14 : 140 }, () => ({
      x: origin.x,
      y: origin.y,
      vx: (Math.random() - 0.5) * (hearts ? 160 : 900),
      vy: hearts ? -120 - Math.random() * 120 : -400 - Math.random() * 700,
      spin: (Math.random() - 0.5) * 12,
      angle: Math.random() * Math.PI,
      color: hearts ? "#ff375f" : COLORS[Math.floor(Math.random() * COLORS.length)],
      size: hearts ? 10 + Math.random() * 6 : 5 + Math.random() * 6,
      heart: hearts,
    }));
    const started = performance.now();
    let last = started;
    let raf = 0;
    const draw = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      const life = (now - started) / DURATION_MS;
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      context.globalAlpha = Math.max(0, 1 - life * life);
      for (const piece of pieces) {
        piece.vy += (piece.heart ? -20 : 900) * dt;
        piece.vx *= 1 - 0.8 * dt;
        piece.x += piece.vx * dt;
        piece.y += piece.vy * dt;
        piece.angle += piece.spin * dt;
        context.save();
        context.translate(piece.x, piece.y);
        context.fillStyle = piece.color;
        if (piece.heart) {
          context.font = `${piece.size}px sans-serif`;
          context.fillText("♥", 0, 0);
        } else {
          context.rotate(piece.angle);
          context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
        }
        context.restore();
      }
      if (life < 1) raf = requestAnimationFrame(draw);
      else {
        context.clearRect(0, 0, window.innerWidth, window.innerHeight);
        doneRef.current();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [fx, origin.x, origin.y]);

  return <canvas ref={canvasRef} className="buddy-fx" aria-hidden="true" />;
}
