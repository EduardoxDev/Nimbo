/**
 * Tips at the right moment: each one shows once, when the user does the thing
 * it is about, at most one a day, and never again after "no more tips".
 */

export type TipId = "copiedLink" | "focusGuard" | "music" | "phone" | "launcher";

export type TipContext = {
  copiedLink: boolean;
  focusRunning: boolean;
  focusGuardOn: boolean;
  musicPlaying: boolean;
  phoneOn: boolean;
  /** Days since the first time Nimbo ran. */
  daysUsed: number;
};

export const TIPS_SEEN_KEY = "nimbo-tips-seen";
export const TIPS_OFF_KEY = "nimbo-tips-off";
export const TIPS_LAST_KEY = "nimbo-tips-last";
export const FIRST_RUN_KEY = "nimbo-first-run";
const DAY_MS = 24 * 60 * 60 * 1000;

/** In order of priority: the moment the user is in wins over general tips. */
const RULES: { id: TipId; when: (context: TipContext) => boolean }[] = [
  { id: "copiedLink", when: (context) => context.copiedLink },
  { id: "focusGuard", when: (context) => context.focusRunning && !context.focusGuardOn },
  { id: "music", when: (context) => context.musicPlaying },
  { id: "launcher", when: (context) => context.daysUsed >= 1 },
  { id: "phone", when: (context) => context.daysUsed >= 3 && !context.phoneOn },
];

export function nextTip(context: TipContext, state: { seen: TipId[]; lastAt: number; off: boolean; now: number }): TipId | null {
  if (state.off || state.now - state.lastAt < DAY_MS) return null;
  return RULES.find((rule) => !state.seen.includes(rule.id) && rule.when(context))?.id ?? null;
}

export function parseSeen(raw: string | null): TipId[] {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is TipId => RULES.some((rule) => rule.id === id)) : [];
  } catch {
    return [];
  }
}

export function daysSince(firstRun: number, now: number) {
  return Math.max(0, Math.floor((now - firstRun) / DAY_MS));
}
