export type MascotMood = "idle" | "greeting" | "thinking" | "working" | "waiting" | "done" | "error" | "sleeping" | "annoyed" | "dizzy";
export type MascotShape = "cloud" | "pebble" | "round" | "blob" | "drop";
export type EyeStyle = "open" | "happy" | "closed" | "spiral";

export type MascotFrame = {
  body: string;
  offsetY: number;
  rotation: number;
  scale: number;
  eyes: { cx: number; cy: number; rx: number; ry: number; style: EyeStyle }[];
  hands: { cx: number; cy: number; r: number }[];
  dot: string | null;
};

type Wave = { k: number; amplitude: number; phase: number };

const SHAPES: Record<MascotShape, { stretchX: number; stretchY: number; waves: Wave[] }> = {
  cloud: { stretchX: 1.12, stretchY: 0.9, waves: [{ k: 6, amplitude: 0.06, phase: Math.PI / 2 }, { k: 1, amplitude: 0.07, phase: Math.PI / 2 }] },
  pebble: { stretchX: 1.14, stretchY: 0.88, waves: [{ k: 3, amplitude: 0.03, phase: 0.8 }] },
  round: { stretchX: 1, stretchY: 1, waves: [{ k: 4, amplitude: 0.012, phase: 0 }] },
  blob: { stretchX: 1.04, stretchY: 0.98, waves: [{ k: 3, amplitude: 0.06, phase: 2.1 }, { k: 5, amplitude: 0.02, phase: 0.4 }] },
  drop: { stretchX: 0.96, stretchY: 1.04, waves: [{ k: 1, amplitude: 0.08, phase: -Math.PI / 2 }, { k: 2, amplitude: 0.03, phase: 0 }] },
};

export const MASCOT_SHAPES = Object.keys(SHAPES) as MascotShape[];
export const MASCOT_COLORS = ["#5ac8fa", "#ff9f0a", "#ff6961", "#bf8cff", "#35e985", "#ffd60a"];

const MOOD_DOTS: Record<MascotMood, string | null> = {
  idle: null,
  greeting: null,
  annoyed: null,
  dizzy: "#ff6fb5",
  thinking: "#bf8cff",
  working: "#0a84ff",
  waiting: "#ff9f0a",
  done: "#35e985",
  error: "#ff453a",
  sleeping: null,
};

const POINTS = 48;
const RADIUS = 34;
const CENTER = 50;

export function hashSeed(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function identityOf(seed: string): { shape: MascotShape; color: string } {
  const value = hashSeed(seed);
  return { shape: MASCOT_SHAPES[value % MASCOT_SHAPES.length], color: MASCOT_COLORS[hashSeed(`${seed}#color`) % MASCOT_COLORS.length] };
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

export function bodyPath(shape: MascotShape, t: number, wobble: number) {
  const { stretchX, stretchY, waves } = SHAPES[shape];
  const points: [number, number][] = [];
  for (let index = 0; index < POINTS; index += 1) {
    const angle = (index / POINTS) * Math.PI * 2;
    let radius = 1;
    for (const wave of waves) radius += wave.amplitude * Math.cos(wave.k * angle + wave.phase);
    radius += wobble * 0.025 * Math.sin(3 * angle + t * 2.2);
    points.push([CENTER + Math.cos(angle) * RADIUS * radius * stretchX, CENTER + Math.sin(angle) * RADIUS * radius * stretchY]);
  }
  let path = `M${round(points[0][0])} ${round(points[0][1])}`;
  for (let index = 0; index < POINTS; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % POINTS];
    const midX = (current[0] + next[0]) / 2;
    const midY = (current[1] + next[1]) / 2;
    path += ` Q${round(current[0])} ${round(current[1])} ${round(midX)} ${round(midY)}`;
  }
  return `${path} Z`;
}

export function blinkAmount(t: number, seed: number) {
  const period = 3.2 + (seed % 7) * 0.35;
  const phase = (t + (seed % 13) * 0.21) % period;
  const duration = 0.16;
  if (phase > duration) return 0;
  return Math.sin((phase / duration) * Math.PI);
}

function drift(t: number, seed: number) {
  const a = seed % 17;
  return {
    x: Math.sin(t * 0.37 + a) * 0.5 + Math.sin(t * 0.13 + a * 2) * 0.3,
    y: Math.sin(t * 0.29 + a * 3) * 0.3,
  };
}

export function mascotFrame(options: {
  shape: MascotShape;
  mood: MascotMood;
  t: number;
  seed?: number;
  gaze?: { x: number; y: number } | null;
}): MascotFrame {
  const { shape, mood, t } = options;
  const seed = options.seed ?? 0;
  const wandering = drift(t, seed);
  let look = options.gaze ?? wandering;
  let offsetY = Math.sin(t * 1.6) * 0.8;
  let rotation = 0;
  let scale = 1 + Math.sin(t * 1.6) * 0.012;
  let style: EyeStyle = "open";
  let eyeHeight = 1;
  let wobble = 0.4;

  if (mood === "thinking") {
    look = { x: 0.6 + Math.sin(t * 0.8) * 0.15, y: -0.8 };
    rotation = Math.sin(t * 1.2) * 4;
  } else if (mood === "working") {
    offsetY = -Math.abs(Math.sin(t * 4.2)) * 3.2;
    look = { x: Math.sin(t * 1.1) * 0.5, y: 0.25 };
    wobble = 1;
  } else if (mood === "waiting") {
    look = { x: 0, y: 0.1 };
    eyeHeight = 1.15;
    scale = 1 + Math.sin(t * 3) * 0.02;
  } else if (mood === "done") {
    style = "happy";
    offsetY = -Math.abs(Math.sin(t * 2.4)) * 1.6;
  } else if (mood === "error") {
    style = "closed";
    offsetY = 1.5;
    rotation = -6;
    wobble = 0.1;
  } else if (mood === "greeting") {
    look = { x: 0, y: -0.25 };
    offsetY = -Math.abs(Math.sin(t * 2)) * 1.4;
  } else if (mood === "annoyed") {
    look = { x: 0, y: 0.15 };
    eyeHeight = 0.42;
    wobble = 0.1;
  } else if (mood === "dizzy") {
    style = "spiral";
    rotation = Math.sin(t * 7) * 12;
    offsetY = Math.sin(t * 5) * 1.5;
    wobble = 1.2;
  } else if (mood === "sleeping") {
    style = "closed";
    offsetY = Math.sin(t * 0.9) * 1.2;
    scale = 1 + Math.sin(t * 0.9) * 0.025;
    wobble = 0.1;
  }

  const blink = style === "open" ? blinkAmount(t, seed) : 0;
  const lookX = Math.max(-1, Math.min(1, look.x));
  const lookY = Math.max(-1, Math.min(1, look.y));
  const eyeY = 46 + lookY * 5;
  const spread = 12;
  const eyes = [-1, 1].map((side) => ({
    cx: round(CENTER + side * spread + lookX * 7),
    cy: round(eyeY + side * lookX * 0.8),
    rx: 4.6,
    ry: round(8.6 * eyeHeight * (1 - blink * 0.92)),
    style,
  }));

  const hands =
    mood === "greeting"
      ? [-1, 1].map((side) => ({
          cx: round(CENTER + side * 46),
          cy: round(58 - (side === 1 ? Math.abs(Math.sin(t * 6)) * 10 : Math.abs(Math.sin(t * 2)) * 3)),
          r: 7.5,
        }))
      : [];

  return { body: bodyPath(shape, t, wobble), offsetY: round(offsetY), rotation: round(rotation), scale: round(scale * 1000) / 1000, eyes, hands, dot: MOOD_DOTS[mood] };
}
