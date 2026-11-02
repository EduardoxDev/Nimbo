import { useEffect, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Gamepad2 } from "lucide-react";
import { useTranslation } from "../i18n";
import type { IslandTab } from "../IslandTabs";
import { PageChrome } from "../island/PageChrome";
import { Mascot } from "../mascot/Mascot";
import { NIMBO_COLOR } from "../mascot/nimboMood";
import "./Tools.css";

export const GAME_RECORD_KEY = "nimbo-game-record";
const GAME_SECONDS = 30;

type Drop = { x: number; y: number; speed: number; gold: boolean };

/**
 * Break game: 30 seconds catching drops with the mascot (move the mouse).
 * Gold drops are worth 3. The record stays on this PC.
 */
export function GamePanel<Page extends string>({
  pages,
  currentPage,
  showPageIcons,
  onPageChange,
}: {
  pages: IslandTab<Page>[];
  currentPage: Page;
  showPageIcons: boolean;
  onPageChange: (page: Page) => void;
}) {
  const copy = useTranslation().game;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"ready" | "playing" | "over">("ready");
  const [score, setScore] = useState(0);
  const [left, setLeft] = useState(GAME_SECONDS);
  const [record, setRecord] = useState(() => {
    try {
      return Number(window.localStorage.getItem(GAME_RECORD_KEY)) || 0;
    } catch {
      return 0;
    }
  });
  const pointerRef = useRef(0.5);

  useEffect(() => {
    if (state !== "playing") return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const mascot = new Image();
    mascot.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      renderToStaticMarkup(<Mascot mood="greeting" shape="cloud" color={NIMBO_COLOR} seed="nimbo" size={64} showDot={false} />).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '),
    )}`;
    const drops: Drop[] = [];
    let points = 0;
    let x = canvas.width / 2;
    let last = performance.now();
    let spawn = 0;
    const started = last;
    let frame = 0;
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const elapsed = (now - started) / 1000;
      const remaining = Math.max(0, GAME_SECONDS - elapsed);
      setLeft(Math.ceil(remaining));
      // Faster drops as the 30 seconds go by.
      spawn -= dt;
      if (spawn <= 0) {
        drops.push({ x: 16 + Math.random() * (canvas.width - 32), y: -10, speed: 110 + elapsed * 6 + Math.random() * 60, gold: Math.random() < 0.12 });
        spawn = Math.max(0.22, 0.6 - elapsed * 0.012);
      }
      x += (pointerRef.current * canvas.width - x) * Math.min(1, dt * 14);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const catcherY = canvas.height - 34;
      for (let index = drops.length - 1; index >= 0; index -= 1) {
        const drop = drops[index];
        drop.y += drop.speed * dt;
        if (Math.abs(drop.x - x) < 26 && Math.abs(drop.y - catcherY) < 18) {
          points += drop.gold ? 3 : 1;
          setScore(points);
          drops.splice(index, 1);
          continue;
        }
        if (drop.y > canvas.height + 10) {
          drops.splice(index, 1);
          continue;
        }
        ctx.fillStyle = drop.gold ? "#ffd60a" : "#5ac8fa";
        ctx.beginPath();
        ctx.moveTo(drop.x, drop.y - 9);
        ctx.quadraticCurveTo(drop.x + 7, drop.y + 2, drop.x, drop.y + 6);
        ctx.quadraticCurveTo(drop.x - 7, drop.y + 2, drop.x, drop.y - 9);
        ctx.fill();
      }
      if (mascot.complete) ctx.drawImage(mascot, x - 28, catcherY - 30, 56, 56);
      if (remaining <= 0) {
        setState("over");
        setRecord((best) => {
          const next = Math.max(best, points);
          try {
            window.localStorage.setItem(GAME_RECORD_KEY, String(next));
          } catch {
            // The record lasts this run only.
          }
          return next;
        });
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [state]);

  const start = () => {
    setScore(0);
    setLeft(GAME_SECONDS);
    setState("playing");
  };

  return (
    <PageChrome icon={Gamepad2} iconColor="#35e985" pages={pages} currentPage={currentPage} showPageIcons={showPageIcons} onPageChange={onPageChange} className="game-panel" label={copy.title}>
      <div
        className="game-panel__stage"
        data-window-drag="false"
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          pointerRef.current = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        }}
      >
        <canvas ref={canvasRef} width={520} height={190} />
        <div className="game-panel__hud">
          <span>{copy.score(score)}</span>
          <span>{state === "playing" ? `${left}s` : copy.record(record)}</span>
        </div>
        {state !== "playing" && (
          <div className="game-panel__overlay">
            <strong>{state === "over" ? (score >= record && score > 0 ? copy.newRecord(score) : copy.final(score)) : copy.title}</strong>
            <span>{copy.howTo}</span>
            <button type="button" className="game-panel__start n-pressable" onClick={start}>
              {state === "over" ? copy.again : copy.play}
            </button>
          </div>
        )}
      </div>
    </PageChrome>
  );
}
