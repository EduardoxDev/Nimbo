import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { firedRules, isHeadphones, parseRules, RULES_KEY, type Rule, type RuleContext } from "./rules";

const POLL_MS = 10_000;

function load() {
  try {
    return parseRules(window.localStorage.getItem(RULES_KEY));
  } catch {
    return [];
  }
}

/**
 * Keeps the trigger rules (shared with the Settings window through
 * localStorage) and runs each one's action when its trigger turns true.
 */
export function useRules(battery: { level: number; charging: boolean } | null, run: (rule: Rule) => Promise<void>) {
  const [rules, setRules] = useState<Rule[]>(load);
  const previousRef = useRef<RuleContext | null>(null);
  const runRef = useRef(run);
  runRef.current = run;
  const batteryRef = useRef(battery);
  batteryRef.current = battery;
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  // The Settings window edits the same list.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === RULES_KEY) setRules(load());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const save = useCallback((next: Rule[]) => {
    setRules(next);
    try {
      window.localStorage.setItem(RULES_KEY, JSON.stringify(next));
    } catch {
      // This run only.
    }
  }, []);

  const add = useCallback((rule: Omit<Rule, "id" | "enabled">) => {
    save([...rulesRef.current, { ...rule, id: `${Date.now().toString(36)}`, enabled: true }]);
  }, [save]);

  const active = rules.some((rule) => rule.enabled);
  useEffect(() => {
    if (!active || !isTauri()) {
      previousRef.current = null;
      return;
    }
    const watchApps = rulesRef.current.some((rule) => rule.trigger.kind === "app");
    const sample = async () => {
      const context = await invoke<{ ssid: string | null; audioOutput: string | null }>("context_now").catch(() => ({ ssid: null, audioOutput: null }));
      const front = watchApps ? await invoke<{ app: string; title: string } | null>("foreground_window").catch(() => null) : null;
      const now = new Date();
      const current: RuleContext = {
        headphones: isHeadphones(context.audioOutput),
        battery: batteryRef.current?.level ?? null,
        charging: batteryRef.current?.charging ?? false,
        ssid: context.ssid,
        app: front ? `${front.app} ${front.title}` : "",
        time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
      };
      const fired = firedRules(rulesRef.current, previousRef.current, current);
      previousRef.current = current;
      for (const rule of fired) await runRef.current(rule).catch((error) => console.error("Rule failed", rule.text, error));
    };
    void sample();
    const interval = window.setInterval(() => void sample(), POLL_MS);
    return () => window.clearInterval(interval);
  }, [active]);

  return { rules, save, add };
}
