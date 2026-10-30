export type FocusPhase = "focus" | "short" | "long";
export type FocusStatus = "idle" | "running" | "paused";

export type FocusDurations = {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  rounds: number;
};

/** Saved as is, so a running timer survives restarts: `endsAt` is a wall-clock time. */
export type FocusState = {
  phase: FocusPhase;
  status: FocusStatus;
  /** Focus rounds finished in the current cycle. */
  completed: number;
  endsAt: number | null;
  /** Time left while idle or paused. */
  remainingMs: number;
};

export function phaseLength(phase: FocusPhase, durations: FocusDurations) {
  const minutes =
    phase === "focus"
      ? durations.focusMinutes
      : phase === "short"
        ? durations.shortBreakMinutes
        : durations.longBreakMinutes;
  return minutes * 60_000;
}

export function initialFocusState(durations: FocusDurations): FocusState {
  return {
    phase: "focus",
    status: "idle",
    completed: 0,
    endsAt: null,
    remainingMs: phaseLength("focus", durations),
  };
}

export function remainingOf(state: FocusState, now: number) {
  return state.status === "running" && state.endsAt !== null
    ? Math.max(0, state.endsAt - now)
    : state.remainingMs;
}

export function startFocus(state: FocusState, now: number): FocusState {
  if (state.status === "running") return state;
  return { ...state, status: "running", endsAt: now + state.remainingMs };
}

export function pauseFocus(state: FocusState, now: number): FocusState {
  if (state.status !== "running") return state;
  return { ...state, status: "paused", endsAt: null, remainingMs: remainingOf(state, now) };
}

export function resetFocus(durations: FocusDurations): FocusState {
  return initialFocusState(durations);
}

/**
 * Moves to the next phase: focus → short break (or a long one after the last
 * round) → focus. A finished long break starts a new cycle.
 */
export function advanceFocus(
  state: FocusState,
  durations: FocusDurations,
  now: number,
  autoStart: boolean,
): FocusState {
  let phase: FocusPhase;
  let completed = state.completed;
  if (state.phase === "focus") {
    completed += 1;
    phase = completed >= durations.rounds ? "long" : "short";
  } else {
    phase = "focus";
    if (state.phase === "long") completed = 0;
  }
  const length = phaseLength(phase, durations);
  return autoStart
    ? { phase, completed, status: "running", endsAt: now + length, remainingMs: length }
    : { phase, completed, status: "idle", endsAt: null, remainingMs: length };
}

/** Re-sizes an idle timer when the durations change in settings. */
export function syncIdleLength(state: FocusState, durations: FocusDurations): FocusState {
  if (state.status !== "idle") return state;
  const length = phaseLength(state.phase, durations);
  return state.remainingMs === length ? state : { ...state, remainingMs: length };
}

export function parseFocusState(raw: string | null, durations: FocusDurations): FocusState {
  try {
    const value = raw ? (JSON.parse(raw) as Partial<FocusState>) : null;
    if (
      value &&
      (value.phase === "focus" || value.phase === "short" || value.phase === "long") &&
      (value.status === "idle" || value.status === "running" || value.status === "paused") &&
      typeof value.remainingMs === "number" &&
      typeof value.completed === "number"
    ) {
      return {
        phase: value.phase,
        status: value.status,
        completed: Math.max(0, Math.floor(value.completed)),
        endsAt: typeof value.endsAt === "number" ? value.endsAt : null,
        remainingMs: Math.max(0, value.remainingMs),
      };
    }
  } catch {
    // A damaged value starts a fresh timer.
  }
  return initialFocusState(durations);
}
