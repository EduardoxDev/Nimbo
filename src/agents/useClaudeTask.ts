import { useCallback, useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type Status = { available: boolean; running: boolean; canResume: boolean; homeDir: string };

export function useClaudeTask(folder: string, mode: "acceptEdits" | "plan") {
  const [status, setStatus] = useState<Status>({ available: false, running: false, canResume: false, homeDir: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<Status>("claude_task_status").then(setStatus).catch(() => {});
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void listen("claude-task-finished", () => {
      setStatus((current) => ({ ...current, running: false }));
      void invoke<Status>("claude_task_status")
        .then((next) => setStatus({ ...next, running: false }))
        .catch(() => {});
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const workFolder = folder.trim() || status.homeDir;

  const start = useCallback(
    async (prompt: string) => {
      setError("");
      try {
        await invoke("claude_task_start", { prompt, folder: workFolder, mode, resume: status.canResume });
        setStatus((current) => ({ ...current, running: true }));
        return true;
      } catch (failure) {
        setError(String(failure));
        return false;
      }
    },
    [workFolder, mode, status.canResume],
  );

  const forget = useCallback(() => {
    void invoke("claude_task_forget")
      .then(() => setStatus((current) => ({ ...current, canResume: false })))
      .catch(() => {});
  }, []);

  const stop = useCallback(() => {
    void invoke("claude_task_stop")
      .then(() => setStatus((current) => ({ ...current, running: false })))
      .catch((failure) => setError(String(failure)));
  }, []);

  return { available: status.available, running: status.running, canResume: status.canResume, folder: workFolder, error, start, stop, forget };
}

export type ClaudeTask = ReturnType<typeof useClaudeTask>;
