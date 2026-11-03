import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Segment } from "../day/activity";
import { demoLogs } from "../demo/learnDemo";
import { searchApps, type LauncherApp } from "../launcher/launcher";
import { parseRules, RULES_KEY } from "../rules/rules";
import { launchNames, learn, LEARN_KEY, parseLearnState, pending, recentDays, type LearnState, type Suggestion } from "./learn";

export const LEARN_OPEN_KEY = "nimbo-learn-open";

export function activityOff() {
  try {
    return window.localStorage.getItem("nimbo-activity-enabled") === "0";
  } catch {
    return false;
  }
}

export function readLearnState(): LearnState {
  try {
    return parseLearnState(window.localStorage.getItem(LEARN_KEY));
  } catch {
    return {};
  }
}

export function writeLearnState(state: LearnState) {
  try {
    window.localStorage.setItem(LEARN_KEY, JSON.stringify(state));
  } catch {
    return;
  }
}

function resolveApps(suggestions: Suggestion[], apps: LauncherApp[]) {
  const find = (exe: string) => {
    for (const name of launchNames(exe)) {
      const match = searchApps(apps, name)[0];
      if (match) return match.name;
    }
    return null;
  };
  return suggestions.flatMap((suggestion) => {
    if (suggestion.kind !== "morning" && suggestion.kind !== "followup") return [suggestion];
    const exes = suggestion.kind === "morning" ? suggestion.apps : suggestion.apps.slice(1);
    const names = exes.map(find);
    const actions = names.filter((name): name is string => !!name).map((app) => ({ kind: "open" as const, app }));
    return actions.length > 0 ? [{ ...suggestion, actions }] : [];
  });
}

export async function loadSuggestions(copy: { endOfDaySay: string }): Promise<Suggestion[]> {
  if (!isTauri()) return import.meta.env.DEV ? learn(demoLogs(), copy) : [];
  const logs = await Promise.all(
    recentDays(new Date()).map((day) =>
      invoke<Segment[]>("activity_day", { day })
        .then((segments) => ({ day, segments }))
        .catch(() => ({ day, segments: [] as Segment[] })),
    ),
  );
  const found = learn(logs, copy);
  if (found.length === 0) return [];
  const apps = await invoke<LauncherApp[]>("launcher_apps").catch(() => [] as LauncherApp[]);
  return resolveApps(found, apps);
}

export async function pendingSuggestions(copy: { endOfDaySay: string }) {
  const rules = (() => {
    try {
      return parseRules(window.localStorage.getItem(RULES_KEY));
    } catch {
      return [];
    }
  })();
  return pending(await loadSuggestions(copy), rules, readLearnState());
}
