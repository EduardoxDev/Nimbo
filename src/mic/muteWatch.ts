/**
 * "You're on mute!" without nagging: one warning when a call starts with the
 * microphone off, and one when you talk while it is off (at most every 30 s).
 * Muting on purpose in the middle of a call says nothing.
 */

export type MicReading = { muted: boolean; volume: number; peak: number };
export type MuteWatch = { callId: string | null; warnedStart: boolean; loudSamples: number; lastSpeakingAt: number };
export type MuteAlert = "startedMuted" | "speakingMuted" | null;

export const IDLE_MUTE_WATCH: MuteWatch = { callId: null, warnedStart: false, loudSamples: 0, lastSpeakingAt: 0 };

/** The first seconds of a call, when a muted microphone is almost always a mistake. */
const START_WINDOW_MS = 15_000;
const SPEAKING_PEAK = 0.06;
const SPEAKING_EVERY_MS = 30_000;

export function isOff(reading: MicReading) {
  return reading.muted || reading.volume < 0.03;
}

export function watchMute(
  watch: MuteWatch,
  input: { callId: string | null; callStart: number; reading: MicReading | null; now: number },
): { watch: MuteWatch; alert: MuteAlert } {
  if (!input.callId || !input.reading) return { watch: IDLE_MUTE_WATCH, alert: null };
  let next: MuteWatch = input.callId === watch.callId ? watch : { ...IDLE_MUTE_WATCH, callId: input.callId };
  if (!isOff(input.reading)) return { watch: { ...next, loudSamples: 0 }, alert: null };

  if (!next.warnedStart && input.now - input.callStart < START_WINDOW_MS) {
    return { watch: { ...next, warnedStart: true }, alert: "startedMuted" };
  }
  next = { ...next, warnedStart: true };
  const loudSamples = input.reading.peak > SPEAKING_PEAK ? next.loudSamples + 1 : 0;
  if (loudSamples >= 2 && input.now - next.lastSpeakingAt > SPEAKING_EVERY_MS) {
    return { watch: { ...next, loudSamples: 0, lastSpeakingAt: input.now }, alert: "speakingMuted" };
  }
  return { watch: { ...next, loudSamples }, alert: null };
}
