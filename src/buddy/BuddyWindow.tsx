import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Mascot } from "../mascot/Mascot";
import type { MascotMood } from "../mascot/engine";
import { appAccessory, contextAccessory, type MascotAccessory } from "../mascot/accessories";
import { NIMBO_COLOR } from "../mascot/nimboMood";
import { BUDDY_SIZE, follow, step, supportsOf, throwVelocity, type Body, type Platform } from "./physics";
import { readBuddyMode, type BuddyMode } from "./mode";
import "./Buddy.css";

type Scene = { width: number; height: number; floor: number; platforms: Platform[]; app: string };
type Behavior = { kind: "idle" | "walk" | "sit"; until: number };

const SCENE_MS = 450;
const SLEEP_AFTER_MS = 25_000;
const DIZZY_IMPACT = 2300;
const CURSOR_OFFSET = { x: 18, y: 22 };

function pick<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

export default function BuddyWindow() {
  const [mode, setMode] = useState<BuddyMode>(readBuddyMode);
  const [mood, setMood] = useState<MascotMood>("greeting");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const shownMoodRef = useRef<MascotMood>("greeting");
  const [accessory, setAccessory] = useState<MascotAccessory | null>(null);
  const bodyRef = useRef<Body>({ x: window.innerWidth / 2 - BUDDY_SIZE / 2, y: 4, vx: (Math.random() - 0.5) * 500, vy: -650, ground: null });
  const sceneRef = useRef<Scene | null>(null);
  const cursorRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const behaviorRef = useRef<Behavior>({ kind: "idle", until: 0 });
  const moodRef = useRef<{ mood: MascotMood; until: number }>({ mood: "greeting", until: performance.now() + 1500 });
  const dragRef = useRef<{ dx: number; dy: number; samples: { x: number; y: number; t: number }[]; moved: boolean } | null>(null);
  const leavingRef = useRef(false);
  const lastActiveRef = useRef(performance.now());
  const squashRef = useRef(0);
  const facingRef = useRef(1);
  const hitboxRef = useRef({ x: -1, y: -1, capture: false, at: 0 });

  useEffect(() => {
    document.documentElement.classList.add("buddy-root");
    const onStorage = () => setMode(readBuddyMode());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const load = () =>
      void invoke<Scene>("buddy_scene")
        .then((scene) => {
          if (cancelled) return;
          sceneRef.current = scene;
          setAccessory(appAccessory(scene.app) ?? contextAccessory(new Date().getHours(), null));
        })
        .catch(() => {});
    load();
    const interval = window.setInterval(load, SCENE_MS);
    const stops: (() => void)[] = [];
    void listen<[number, number]>("buddy-cursor", ({ payload }) => {
      const ratio = window.devicePixelRatio || 1;
      cursorRef.current = { x: payload[0] / ratio, y: payload[1] / ratio, at: performance.now() };
    }).then((stop) => (cancelled ? stop() : stops.push(stop)));
    void listen("buddy-leave", () => {
      leavingRef.current = true;
    }).then((stop) => (cancelled ? stop() : stops.push(stop)));
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      stops.forEach((stop) => stop());
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const body0 = bodyRef.current;
      const resting =
        mode === "free" && !dragRef.current && !leavingRef.current && body0.ground !== null && body0.vx === 0 && squashRef.current === 0 && now < behaviorRef.current.until;
      if (resting && now - last < 100) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(resting ? 0.1 : 0.033, (now - last) / 1000);
      last = now;
      const ratio = window.devicePixelRatio || 1;
      const scene = sceneRef.current;
      const width = window.innerWidth;
      const supports = scene
        ? supportsOf(
            scene.platforms.map((platform) => ({ left: platform.left / ratio, right: platform.right / ratio, top: platform.top / ratio })),
            scene.floor / ratio,
            width,
          )
        : supportsOf([], window.innerHeight - 48, width);
      let body = bodyRef.current;
      let facing = facingRef.current;

      if (leavingRef.current) {
        const target = { x: width / 2 - BUDDY_SIZE / 2, y: -BUDDY_SIZE };
        const next = follow(body, target, dt * 0.8);
        body = { ...body, ...next, vx: 0, vy: 0, ground: null };
        moodRef.current = { mood: "greeting", until: now + 1000 };
        if (body.y < -BUDDY_SIZE / 2 && isTauri()) void invoke("buddy_hide");
      } else if (dragRef.current) {
        lastActiveRef.current = now;
      } else if (mode === "cursor") {
        const cursor = cursorRef.current;
        if (cursor) {
          const target = { x: cursor.x + CURSOR_OFFSET.x, y: cursor.y + CURSOR_OFFSET.y };
          const next = follow(body, target, dt);
          const speed = Math.hypot(next.x - body.x, next.y - body.y) / Math.max(dt, 0.001);
          if (Math.abs(next.x - body.x) > 0.4) facing = next.x > body.x ? 1 : -1;
          if (speed > 30) lastActiveRef.current = now;
          body = { x: next.x, y: next.y, vx: 0, vy: 0, ground: null };
        }
      } else {
        const behavior = behaviorRef.current;
        if (body.ground !== null && now > behavior.until) {
          const kind = pick<Behavior["kind"]>(["idle", "walk", "walk", "sit"]);
          behaviorRef.current = { kind, until: now + 2500 + Math.random() * 4000 };
          if (kind === "walk") {
            const direction = Math.random() < 0.5 ? -1 : 1;
            body = { ...body, vx: direction * (55 + Math.random() * 45) };
            if (Math.random() < 0.18) body = { ...body, vy: -720 - Math.random() * 260, ground: null };
          } else {
            body = { ...body, vx: 0 };
          }
        }
        const result = step(body, dt, supports, width);
        if (result.impact > 0) {
          squashRef.current = Math.min(1, result.impact / 2400);
          if (result.impact > DIZZY_IMPACT) moodRef.current = { mood: "dizzy", until: now + 3500 };
          behaviorRef.current = { kind: "idle", until: now + 900 };
        }
        if (Math.abs(result.body.x - body.x) > 0.05) {
          facing = result.body.x > body.x ? 1 : -1;
          lastActiveRef.current = now;
        }
        body = result.body;
      }

      bodyRef.current = body;
      facingRef.current = facing;
      squashRef.current = Math.max(0, squashRef.current - dt * 4);
      const behavior = behaviorRef.current;
      const nextMood: MascotMood =
        now < moodRef.current.until
          ? moodRef.current.mood
          : dragRef.current
          ? "dizzy"
          : now - lastActiveRef.current > SLEEP_AFTER_MS
          ? "sleeping"
          : body.ground === null && mode !== "cursor"
          ? "waiting"
          : behavior.kind === "walk"
          ? "greeting"
          : "idle";
      if (nextMood !== shownMoodRef.current) {
        shownMoodRef.current = nextMood;
        setMood(nextMood);
      }
      const squash = squashRef.current;
      if (wrapperRef.current) {
        wrapperRef.current.style.transform = `translate(${body.x}px, ${body.y}px) scale(${facing * (1 + squash * 0.25)}, ${1 - squash * 0.25})`;
      }

      const capture = Boolean(dragRef.current);
      const hitbox = hitboxRef.current;
      if (isTauri() && (Math.abs(hitbox.x - body.x) > 2 || Math.abs(hitbox.y - body.y) > 2 || hitbox.capture !== capture) && now - hitbox.at > 40) {
        hitboxRef.current = { x: body.x, y: body.y, capture, at: now };
        void invoke("buddy_set_hitbox", {
          x: body.x * ratio,
          y: body.y * ratio,
          width: mode === "cursor" ? 0 : BUDDY_SIZE * ratio,
          height: mode === "cursor" ? 0 : BUDDY_SIZE * ratio,
          capture,
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  const onPointerDown = (event: React.PointerEvent) => {
    if (mode === "cursor") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const body = bodyRef.current;
    dragRef.current = { dx: event.clientX - body.x, dy: event.clientY - body.y, samples: [{ x: event.clientX, y: event.clientY, t: performance.now() }], moved: false };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const now = performance.now();
    drag.samples = [...drag.samples.filter((sample) => now - sample.t < 150), { x: event.clientX, y: event.clientY, t: now }];
    if (Math.hypot(event.clientX - drag.samples[0].x, event.clientY - drag.samples[0].y) > 4) drag.moved = true;
    bodyRef.current = { x: event.clientX - drag.dx, y: event.clientY - drag.dy, vx: 0, vy: 0, ground: null };
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const now = performance.now();
    if (!drag.moved) {
      bodyRef.current = { ...bodyRef.current, vy: -620, ground: null };
      moodRef.current = { mood: "greeting", until: now + 1600 };
      return;
    }
    const velocity = throwVelocity(drag.samples, now);
    bodyRef.current = { ...bodyRef.current, vx: velocity.vx, vy: velocity.vy, ground: null };
    if (Math.hypot(velocity.vx, velocity.vy) > 2200) moodRef.current = { mood: "dizzy", until: now + 3500 };
  };

  const walking = mood === "greeting" && mode !== "cursor";
  return (
    <div className="buddy-stage">
      <div
        className={`buddy${walking ? " buddy--walking" : ""}${mode === "cursor" ? " buddy--cursor" : ""}`}
        ref={wrapperRef}
        style={{ width: BUDDY_SIZE, height: BUDDY_SIZE }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <Mascot mood={mood} shape="cloud" color={NIMBO_COLOR} seed="nimbo" size={BUDDY_SIZE} glow accessory={accessory} label="Nimbo" />
      </div>
    </div>
  );
}
