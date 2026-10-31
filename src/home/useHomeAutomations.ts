import { useEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { callsFor, dueAutomations, loadAutomations, loadRan, minuteKey, saveRan, type HomeAutomation } from "./automations";
import { homeApi } from "./homeStore";

const CHECK_MS = 15_000;

export function useHomeAutomations(onRun: (automation: HomeAutomation, failed: boolean) => void) {
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  useEffect(() => {
    if (!isTauri()) return;
    const check = () => {
      const now = new Date();
      const ran = loadRan();
      const due = dueAutomations(loadAutomations(), now, ran);
      if (due.length === 0) return;
      const key = minuteKey(now);
      for (const automation of due) ran[automation.id] = key;
      saveRan(ran);
      for (const automation of due) {
        void callsFor(automation)
          .reduce((chain, call) => chain.then(() => homeApi.call(call)), Promise.resolve())
          .then(() => onRunRef.current(automation, false))
          .catch((error) => {
            console.error("Home automation failed", error);
            onRunRef.current(automation, true);
          });
      }
    };
    check();
    const interval = window.setInterval(check, CHECK_MS);
    return () => window.clearInterval(interval);
  }, []);
}
