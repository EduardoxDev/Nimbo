import type { ExternalService } from "./catalog";

export const SETTINGS_KEY = "nimbo-music-settings";

/** Centre frequencies of the five equalizer bands, in Hz. */
export const EQ_BANDS = [60, 230, 910, 3600, 14000] as const;
export const EQ_LIMIT = 12;

export const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0],
  bass: [7, 4, 0, -1, 1],
  vocal: [-2, -1, 3, 4, 1],
  rock: [4, 2, -2, 2, 4],
  electronic: [5, 2, -1, 2, 5],
  acoustic: [2, 1, 2, 3, 2],
} as const satisfies Record<string, readonly number[]>;

export type EqPreset = keyof typeof EQ_PRESETS | "custom";

/** Nimbo's status colours (src/mascot/nimboMood.ts), music pink first. */
export const ACCENTS = {
  pink: "#ff375f",
  blue: "#5ac8fa",
  green: "#35e985",
  purple: "#bf8cff",
  orange: "#ff9f0a",
  yellow: "#ffd60a",
} as const;

export type Accent = keyof typeof ACCENTS;
export type VisualizerStyle = "bars" | "wave" | "off";

export type MusicSettings = {
  eqPreset: EqPreset;
  eqGains: number[];
  normalize: boolean;
  /** Seconds of fade at the start and end of each preview; 0 is off. */
  fade: 0 | 2 | 4 | 6;
  speed: 0.75 | 1 | 1.25 | 1.5;
  autoplay: boolean;
  hideExplicit: boolean;
  service: ExternalService;
  accent: Accent;
  visualizer: VisualizerStyle;
  nimboDance: boolean;
  coverTint: boolean;
  /** Where songs play from: YouTube (whole, free), Spotify (Premium) or 30-second previews. */
  source: MusicSource;
};

export type MusicSource = "youtube" | "spotify" | "preview";

export const DEFAULT_SETTINGS: MusicSettings = {
  eqPreset: "flat",
  eqGains: [...EQ_PRESETS.flat],
  normalize: false,
  fade: 2,
  speed: 1,
  autoplay: true,
  hideExplicit: false,
  service: "spotify",
  accent: "pink",
  visualizer: "bars",
  nimboDance: true,
  coverTint: true,
  source: "youtube",
};

const pick = <T,>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/** Anything stored by an older or tampered version falls back field by field. */
export function normalizeSettings(raw: unknown): MusicSettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof MusicSettings, unknown>>;
  const gains = Array.isArray(value.eqGains) && value.eqGains.length === EQ_BANDS.length
    ? value.eqGains.map((gain) => (typeof gain === "number" && Number.isFinite(gain) ? Math.max(-EQ_LIMIT, Math.min(EQ_LIMIT, gain)) : 0))
    : [...DEFAULT_SETTINGS.eqGains];
  return {
    eqPreset: pick(value.eqPreset, [...(Object.keys(EQ_PRESETS) as EqPreset[]), "custom"], DEFAULT_SETTINGS.eqPreset),
    eqGains: gains,
    normalize: typeof value.normalize === "boolean" ? value.normalize : DEFAULT_SETTINGS.normalize,
    fade: pick(value.fade, [0, 2, 4, 6] as const, DEFAULT_SETTINGS.fade),
    speed: pick(value.speed, [0.75, 1, 1.25, 1.5] as const, DEFAULT_SETTINGS.speed),
    autoplay: typeof value.autoplay === "boolean" ? value.autoplay : DEFAULT_SETTINGS.autoplay,
    hideExplicit: typeof value.hideExplicit === "boolean" ? value.hideExplicit : DEFAULT_SETTINGS.hideExplicit,
    service: pick(value.service, ["spotify", "spotifyWeb", "youtube", "deezer"] as const, DEFAULT_SETTINGS.service),
    accent: pick(value.accent, Object.keys(ACCENTS) as Accent[], DEFAULT_SETTINGS.accent),
    visualizer: pick(value.visualizer, ["bars", "wave", "off"] as const, DEFAULT_SETTINGS.visualizer),
    nimboDance: typeof value.nimboDance === "boolean" ? value.nimboDance : DEFAULT_SETTINGS.nimboDance,
    coverTint: typeof value.coverTint === "boolean" ? value.coverTint : DEFAULT_SETTINGS.coverTint,
    source: pick(value.source, ["youtube", "spotify", "preview"] as const, DEFAULT_SETTINGS.source),
  };
}

export function loadSettings(): MusicSettings {
  try {
    return normalizeSettings(JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "null"));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: MusicSettings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings still apply for this session.
  }
}

/** "#ff375f" → "255, 55, 95", for rgba() in CSS and on the canvas. */
export function rgbOf(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}
