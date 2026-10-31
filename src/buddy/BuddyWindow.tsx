import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useTranslation } from "../i18n";
import { Mascot } from "../mascot/Mascot";
import type { MascotMood } from "../mascot/engine";
import { appAccessory, contextAccessory, type MascotAccessory } from "../mascot/accessories";
import { NIMBO_COLOR } from "../mascot/nimboMood";
import { useAgentBoard } from "../agents/agentsStore";
import { islandAgentsOf } from "../agents/moods";
import { BUDDY_SIZE, follow, step, supportsOf, throwVelocity, type Body, type Platform } from "./physics";
import { readBuddyMode, type BuddyMode } from "./mode";
import { INBOX_KEY, parseMessage, readVital, type BuddyFx } from "./channel";
import { auraOf, LEVEL_KEY, PET_KEY, isRub, parsePet, type Pet } from "./pet";
import { FxLayer } from "./Confetti";
import "./Buddy.css";

type Scene = { width: number; height: number; floor: number; platforms: Platform[]; app: string; hasLeft: boolean; hasRight: boolean };
type Behavior = { kind: "idle" | "walk" | "sit"; until: number };
type Bubble = { text: string; page?: string; until: number };

const SCENE_MS = 450;
const SLEEP_AFTER_MS = 25_000;
const SLEEPY_AFTER_MS = 8_000;
const HIDE_AFTER_MS = 120_000;
const DIZZY_IMPACT = 2300;
const CURSOR_OFFSET = { x: 18, y: 22 };
const MINI_SIZE = 26;
const BUBBLE_MS = 6_000;
const DELIVER_BUBBLE_MS = 9_000;
const BUBBLE_WIDTH = 220;
const BUBBLE_LIFT = 62;

function pick<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function readPet(): Pet {
  try {
    return parsePet(window.localStorage.getItem(PET_KEY));
  } catch {
    return parsePet(null);
  }
}

function savePet(pet: Pet) {
  try {
    window.localStorage.setItem(PET_KEY, JSON.stringify(pet));
  } catch {
    // Kept for this run only.
  }
}

function readLevel() {
  try {
    return Number(window.localStorage.getItem(LEVEL_KEY)) || 1;
  } catch {
    return 1;
  }
}

export default function BuddyWindow() {
  const copy = useTranslation().buddy;
  const { board } = useAgentBoard();
  const [mode, setMode] = useState<BuddyMode>(readBuddyMode);
  const [mood, setMood] = useState<MascotMood>("greeting");
  const [accessory, setAccessory] = useState<MascotAccessory | null>(null);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [fx, setFx] = useState<{ kind: BuddyFx; id: string } | null>(null);
  const [level, setLevel] = useState(readLevel);
  const [agentClock, setAgentClock] = useState(() => Date.now());
  const minis = islandAgentsOf(board, agentClock).slice(0, 3);

  const bodyRef = useRef<Body>({ x: window.innerWidth / 2 - BUDDY_SIZE / 2, y: 4, vx: (Math.random() - 0.5) * 500, vy: -650, ground: null });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const miniRefs = useRef<(HTMLDivElement | null)[]>([]);
  const miniPositions = useRef<{ x: number; y: number }[]>([]);
  const shownMoodRef = useRef<MascotMood>("greeting");
  const sceneRef = useRef<Scene | null>(null);
  const cursorRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const behaviorRef = useRef<Behavior>({ kind: "idle", until: 0 });
  const moodRef = useRef<{ mood: MascotMood; until: number }>({ mood: "greeting", until: performance.now() + 1500 });
  const dragRef = useRef<{ dx: number; dy: number; samples: { x: number; y: number; t: number }[]; moved: boolean } | null>(null);
  const leavingRef = useRef(false);
  const attentionRef = useRef(false);
  const deliverRef = useRef<{ text: string; page?: string } | null>(null);
  const bubbleUntilRef = useRef(0);
  const hidingRef = useRef(false);
  const hoppingRef = useRef(false);
  const lastActiveRef = useRef(performance.now());
  const lastCursorMoveRef = useRef(performance.now());
  const squashRef = useRef(0);
  const facingRef = useRef(1);
  const rubRef = useRef<{ samples: { x: number; t: number }[]; cooldown: number }>({ samples: [], cooldown: 0 });
  const hitboxRef = useRef({ key: "", at: 0 });
  const seenMessageRef = useRef("");
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const copyRef = useRef(copy);
  copyRef.current = copy;

  const say = (text: string, page?: string, duration = BUBBLE_MS) => {
    bubbleUntilRef.current = performance.now() + duration;
    setBubble({ text, page, until: Date.now() + duration });
  };
  const sayRef = useRef(say);
  sayRef.current = say;

  useEffect(() => {
    document.documentElement.classList.add("buddy-root");
    const handle = (raw: string | null) => {
      const message = parseMessage(raw, Date.now());
      if (!message || message.id === seenMessageRef.current) return;
      seenMessageRef.current = message.id;
      if (message.kind === "fx") setFx({ kind: message.fx, id: message.id });
      else if (message.kind === "attention") attentionRef.current = message.on;
      else if (message.kind === "deliver") deliverRef.current = { text: message.text, page: message.page };
      else sayRef.current(message.text, message.page);
    };
    try {
      handle(window.localStorage.getItem(INBOX_KEY));
    } catch {
      // Nothing waiting.
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === INBOX_KEY) handle(event.newValue);
      else if (event.key === LEVEL_KEY) setLevel(readLevel());
      else setMode(readBuddyMode());
    };
    window.addEventListener("storage", onStorage);
    const pet = readPet();
    const now = Date.now();
    if (pet.lastSeen > 0 && now - pet.lastSeen > 2 * 24 * 3_600_000) sayRef.current(copyRef.current.missedYou);
    savePet({ ...pet, lastSeen: now });
    const seen = window.setInterval(() => {
      savePet({ ...readPet(), lastSeen: Date.now() });
      setAgentClock(Date.now());
    }, 60_000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(seen);
    };
  }, []);

  useEffect(() => {
    if (!bubble) return;
    const timer = window.setTimeout(() => setBubble(null), Math.max(0, bubble.until - Date.now()));
    return () => window.clearTimeout(timer);
  }, [bubble]);

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
    const keep = (stop: () => void) => (cancelled ? stop() : stops.push(stop));
    void listen<[number, number]>("buddy-cursor", ({ payload }) => {
      const ratio = window.devicePixelRatio || 1;
      const next = { x: payload[0] / ratio, y: payload[1] / ratio, at: performance.now() };
      const previous = cursorRef.current;
      if (!previous || Math.hypot(previous.x - next.x, previous.y - next.y) > 3) lastCursorMoveRef.current = next.at;
      cursorRef.current = next;
    }).then(keep);
    void listen("buddy-leave", () => {
      leavingRef.current = true;
    }).then(keep);
    void getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type !== "drop" || payload.paths.length === 0) return;
        const ratio = window.devicePixelRatio || 1;
        const body = bodyRef.current;
        const x = payload.position.x / ratio;
        const y = payload.position.y / ratio;
        if (x < body.x - 20 || x > body.x + BUDDY_SIZE + 20 || y < body.y - 20 || y > body.y + BUDDY_SIZE + 20) return;
        squashRef.current = 1;
        moodRef.current = { mood: "greeting", until: performance.now() + 2000 };
        void invoke("shelf_add", { paths: payload.paths })
          .then(() => sayRef.current(copyRef.current.ate(payload.paths.length), "shelf"))
          .catch(() => sayRef.current(copyRef.current.cantEat));
      })
      .then(keep);
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
      const calm =
        mode === "free" &&
        !dragRef.current &&
        !leavingRef.current &&
        !attentionRef.current &&
        !deliverRef.current &&
        body0.ground !== null &&
        body0.vx === 0 &&
        squashRef.current === 0 &&
        now < behaviorRef.current.until;
      if (calm && now - last < 100) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(calm ? 0.1 : 0.033, (now - last) / 1000);
      last = now;
      const ratio = window.devicePixelRatio || 1;
      const scene = sceneRef.current;
      const width = window.innerWidth;
      const floor = scene ? scene.floor / ratio : window.innerHeight - 48;
      const supports = supportsOf(
        (scene?.platforms ?? []).map((platform) => ({ left: platform.left / ratio, right: platform.right / ratio, top: platform.top / ratio })),
        floor,
        width,
      );
      let body = body0;
      let facing = facingRef.current;
      const vital = readVital();
      const steer = (target: { x: number; y: number }, speed = 1) => {
        const next = follow(body, target, dt * speed);
        if (Math.abs(next.x - body.x) > 0.3) facing = next.x > body.x ? 1 : -1;
        const moved = Math.hypot(next.x - body.x, next.y - body.y) / Math.max(dt, 0.001);
        body = { x: next.x, y: next.y, vx: 0, vy: 0, ground: null };
        if (moved > 30) lastActiveRef.current = now;
      };

      if (leavingRef.current) {
        steer({ x: width / 2 - BUDDY_SIZE / 2, y: -BUDDY_SIZE }, 0.8);
        if (body.y < -BUDDY_SIZE / 2 && isTauri()) void invoke("buddy_hide");
      } else if (dragRef.current || mode === "off") {
        lastActiveRef.current = now;
      } else if (attentionRef.current) {
        steer({ x: width / 2 + 150, y: 60 - Math.abs(Math.sin(now / 180)) * 14 }, 0.9);
        lastActiveRef.current = now;
        moodRef.current = { mood: "waiting", until: now + 200 };
      } else if (deliverRef.current) {
        const target = { x: width / 2 - BUDDY_SIZE / 2, y: floor - BUDDY_SIZE - 140 };
        steer(target, 0.7);
        lastActiveRef.current = now;
        if (Math.hypot(body.x - target.x, body.y - target.y) < 6) {
          const delivery = deliverRef.current;
          deliverRef.current = null;
          say(delivery.text, delivery.page, DELIVER_BUBBLE_MS);
        }
      } else if (now < bubbleUntilRef.current && body.ground === null && body.vy === 0 && body.vx === 0) {
        lastActiveRef.current = now;
      } else if (mode === "cursor") {
        const cursor = cursorRef.current;
        if (cursor) steer({ x: cursor.x + CURSOR_OFFSET.x, y: cursor.y + CURSOR_OFFSET.y });
      } else {
        const idleCursor = now - lastCursorMoveRef.current > HIDE_AFTER_MS;
        if (idleCursor && !hidingRef.current && body.ground !== null) {
          hidingRef.current = true;
          behaviorRef.current = { kind: "walk", until: now + 60_000 };
          body = { ...body, vx: body.x < width / 2 ? -110 : 110 };
        } else if (!idleCursor && hidingRef.current) {
          hidingRef.current = false;
          body = { ...body, x: Math.min(Math.max(body.x, 0), width - BUDDY_SIZE), vx: 0, vy: -650, ground: null };
          moodRef.current = { mood: "greeting", until: now + 2000 };
          say(copy.found);
        }
        const behavior = behaviorRef.current;
        if (!hidingRef.current && body.ground !== null && now > behavior.until) {
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
        const walkingInto = body.ground !== null && Math.abs(body.vx) > 0 && Math.abs(body.vx) < 200;
        const pushing = body.vx;
        const result = step(body, dt, supports, width);
        if (result.impact > 0) {
          squashRef.current = Math.min(1, result.impact / 2400);
          if (result.impact > DIZZY_IMPACT) moodRef.current = { mood: "dizzy", until: now + 3500 };
          if (!hidingRef.current) behaviorRef.current = { kind: "idle", until: now + 900 };
        }
        if (Math.abs(result.body.x - body.x) > 0.05) {
          facing = result.body.x > body.x ? 1 : -1;
          lastActiveRef.current = now;
        }
        body = result.body;
        const atLeft = body.x <= 0 && pushing < 0;
        const atRight = body.x >= width - BUDDY_SIZE && pushing > 0;
        if (hidingRef.current && (atLeft || atRight) && body.ground !== null) {
          body = { ...body, x: atLeft ? -BUDDY_SIZE * 0.55 : width - BUDDY_SIZE * 0.45, vx: 0 };
          facing = atLeft ? 1 : -1;
        } else if (walkingInto && !hoppingRef.current && scene && ((atLeft && scene.hasLeft) || (atRight && scene.hasRight)) && isTauri()) {
          hoppingRef.current = true;
          const direction = atLeft ? "left" : "right";
          void invoke<boolean>("buddy_move_monitor", { direction })
            .then((moved) => {
              if (moved) bodyRef.current = { ...bodyRef.current, x: direction === "left" ? window.innerWidth - BUDDY_SIZE - 2 : 2, ground: null };
            })
            .catch(() => {})
            .finally(() => window.setTimeout(() => (hoppingRef.current = false), 1500));
        }
      }

      bodyRef.current = body;
      facingRef.current = facing;
      squashRef.current = Math.max(0, squashRef.current - dt * 4);
      const behavior = behaviorRef.current;
      const sleepAfter = vital === "sleepy" ? SLEEPY_AFTER_MS : SLEEP_AFTER_MS;
      const nextMood: MascotMood =
        now < moodRef.current.until
          ? moodRef.current.mood
          : dragRef.current
          ? "dizzy"
          : now < bubbleUntilRef.current
          ? "greeting"
          : now - lastActiveRef.current > sleepAfter
          ? "sleeping"
          : body.ground === null && mode === "free"
          ? "waiting"
          : behavior.kind === "walk" && !hidingRef.current
          ? "greeting"
          : vital === "thirsty"
          ? "waiting"
          : "idle";
      if (nextMood !== shownMoodRef.current) {
        shownMoodRef.current = nextMood;
        setMood(nextMood);
      }
      const squash = squashRef.current;
      if (wrapperRef.current) {
        wrapperRef.current.style.transform = `translate(${body.x}px, ${body.y}px) scale(${facing * (1 + squash * 0.25)}, ${1 - squash * 0.25})`;
      }
      const bubbleLeft = Math.min(Math.max(body.x + BUDDY_SIZE / 2 - BUBBLE_WIDTH / 2, 8), width - BUBBLE_WIDTH - 8);
      const bubbleTop = Math.max(body.y - BUBBLE_LIFT, 4);
      if (bubbleRef.current) bubbleRef.current.style.transform = `translate(${bubbleLeft}px, ${bubbleTop}px)`;
      let leader = { x: body.x + BUDDY_SIZE / 2 - MINI_SIZE / 2, y: body.y + BUDDY_SIZE - MINI_SIZE };
      miniPositions.current = minis.map((_, index) => {
        const previous = miniPositions.current[index] ?? leader;
        const next = follow(previous, { x: leader.x - facing * (MINI_SIZE + 6), y: leader.y }, dt * 0.6);
        const element = miniRefs.current[index];
        if (element) element.style.transform = `translate(${next.x}px, ${next.y + Math.sin(now / 200 + index) * 2}px)`;
        leader = next;
        return next;
      });

      const showing = mode !== "off" && !leavingRef.current && mode !== "cursor";
      const capture = Boolean(dragRef.current);
      const withBubble = now < bubbleUntilRef.current;
      const left = withBubble ? Math.min(body.x, bubbleLeft) : body.x;
      const top = withBubble ? Math.min(body.y, bubbleTop) : body.y;
      const right = withBubble ? Math.max(body.x + BUDDY_SIZE, bubbleLeft + BUBBLE_WIDTH) : body.x + BUDDY_SIZE;
      const box = showing
        ? { x: left * ratio, y: top * ratio, width: (right - left) * ratio, height: (body.y + BUDDY_SIZE - top) * ratio }
        : { x: 0, y: 0, width: 0, height: 0 };
      const key = `${Math.round(box.x / 3)}:${Math.round(box.y / 3)}:${Math.round(box.width)}:${Math.round(box.height)}:${capture}`;
      if (isTauri() && key !== hitboxRef.current.key && now - hitboxRef.current.at > 40) {
        hitboxRef.current = { key, at: now };
        void invoke("buddy_set_hitbox", { ...box, capture });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, minis.length]);

  const openPage = (page?: string) => {
    if (page && isTauri()) void emitTo("main", "buddy-open", { page });
    setBubble(null);
    bubbleUntilRef.current = 0;
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (mode === "cursor") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const body = bodyRef.current;
    hidingRef.current = false;
    dragRef.current = { dx: event.clientX - body.x, dy: event.clientY - body.y, samples: [{ x: event.clientX, y: event.clientY, t: performance.now() }], moved: false };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const now = performance.now();
    const drag = dragRef.current;
    if (!drag) {
      const rub = rubRef.current;
      rub.samples = [...rub.samples.filter((sample) => now - sample.t < 1200), { x: event.clientX, t: now }];
      if (now > rub.cooldown && isRub(rub.samples)) {
        rub.cooldown = now + 4000;
        rub.samples = [];
        const body = bodyRef.current;
        setFx({ kind: "hearts", id: `pet-${now}` });
        moodRef.current = { mood: "greeting", until: now + 2500 };
        const pet = readPet();
        savePet({ ...pet, affection: pet.affection + 1 });
        if (body.ground !== null) bodyRef.current = { ...body, vy: -380, ground: null };
      }
      return;
    }
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
      if (bubble) {
        openPage(bubble.page);
        return;
      }
      bodyRef.current = { ...bodyRef.current, vy: -620, ground: null };
      moodRef.current = { mood: "greeting", until: now + 1600 };
      return;
    }
    const velocity = throwVelocity(drag.samples, now);
    bodyRef.current = { ...bodyRef.current, vx: velocity.vx, vy: velocity.vy, ground: null };
    if (Math.hypot(velocity.vx, velocity.vy) > 2200) moodRef.current = { mood: "dizzy", until: now + 3500 };
  };

  const body = bodyRef.current;
  const origin = mode === "off" || leavingRef.current ? { x: window.innerWidth / 2, y: 30 } : { x: body.x + BUDDY_SIZE / 2, y: body.y };
  const walking = mood === "greeting" && mode === "free" && !bubble;
  return (
    <div className="buddy-stage">
      <FxLayer
        fx={fx}
        origin={origin}
        onDone={() => {
          setFx(null);
          if (modeRef.current === "off" && isTauri()) void invoke("buddy_hide");
        }}
      />
      {mode !== "off" &&
        minis.map((agent, index) => (
          <div
            key={agent.id}
            className="buddy-mini"
            ref={(element) => {
              miniRefs.current[index] = element;
            }}
            style={{ width: MINI_SIZE, height: MINI_SIZE }}
            title={agent.name}
          >
            <Mascot mood={agent.mood} shape={agent.shape} color={agent.color} seed={agent.name} size={MINI_SIZE} showDot={false} fps={8} />
          </div>
        ))}
      {mode !== "off" && bubble && (
        <div ref={bubbleRef} className={`buddy-bubble${bubble.page ? " buddy-bubble--action" : ""}`} onClick={() => openPage(bubble.page)}>
          {bubble.text}
        </div>
      )}
      {mode !== "off" && (
        <div
          className={`buddy${walking ? " buddy--walking" : ""}${mode === "cursor" ? " buddy--cursor" : ""}`}
          ref={wrapperRef}
          style={{ width: BUDDY_SIZE, height: BUDDY_SIZE }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <Mascot mood={mood} shape="cloud" color={NIMBO_COLOR} seed="nimbo" size={BUDDY_SIZE} glow accessory={accessory} aura={auraOf(level)} label="Nimbo" fps={20} />
        </div>
      )}
    </div>
  );
}
