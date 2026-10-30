import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  advanceFocus,
  parseFocusState,
  pauseFocus,
  remainingOf,
  resetFocus,
  startFocus,
  syncIdleLength,
  phaseLength,
  type FocusDurations,
  type FocusPhase,
  type FocusState,
} from "./pomodoro";

const STORAGE_KEY = "nimbo-focus";

/** Two soft notes, so a finished phase is heard without a jarring beep. */
export function playChime() {
  try {
    const context = new AudioContext();
    [660, 880].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * 0.22;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 1);
    });
    window.setTimeout(() => void context.close(), 1_600);
  } catch {
    // No audio output: the visual notice still shows.
  }
}

export type FocusTimer = {
  state: FocusState;
  remainingMs: number;
  totalMs: number;
  progress: number;
  start: () => void;
  pause: () => void;
  reset: () => void;
  skip: () => void;
};

export function useFocusTimer(
  durations: FocusDurations,
  options: { autoStart: boolean; sound: boolean; onPhaseEnd: (ended: FocusPhase) => void },
): FocusTimer {
  const [state, setState] = useState<FocusState>(() => {
    try {
      return parseFocusState(window.localStorage.getItem(STORAGE_KEY), durations);
    } catch {
      return parseFocusState(null, durations);
    }
  });
  const [now, setNow] = useState(() => Date.now());
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // The timer keeps running for this session.
    }
  }, [state]);

  useEffect(() => {
    setState((current) => syncIdleLength(current, durations));
  }, [durations]);

  useEffect(() => {
    if (state.status !== "running") return;
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [state.status]);

  // A phase that ran out (also while the app was closed) moves on once.
  useEffect(() => {
    if (state.status !== "running" || state.endsAt === null || now < state.endsAt) return;
    const ended = state.phase;
    setState((current) => advanceFocus(current, durations, Date.now(), optionsRef.current.autoStart));
    if (optionsRef.current.sound) playChime();
    optionsRef.current.onPhaseEnd(ended);
  }, [now, state, durations]);

  const start = useCallback(() => setState((current) => startFocus(current, Date.now())), []);
  const pause = useCallback(() => setState((current) => pauseFocus(current, Date.now())), []);
  const reset = useCallback(() => setState(resetFocus(durations)), [durations]);
  const skip = useCallback(
    () => setState((current) => advanceFocus(current, durations, Date.now(), current.status === "running")),
    [durations],
  );

  const remainingMs = remainingOf(state, now);
  const totalMs = phaseLength(state.phase, durations);
  return useMemo(
    () => ({
      state,
      remainingMs,
      totalMs,
      progress: totalMs > 0 ? 1 - remainingMs / totalMs : 0,
      start,
      pause,
      reset,
      skip,
    }),
    [state, remainingMs, totalMs, start, pause, reset, skip],
  );
}

/** "24:59" for the timer. */
export function formatClock(milliseconds: number) {
  const total = Math.ceil(milliseconds / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
