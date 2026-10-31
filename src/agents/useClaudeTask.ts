import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type FileChange = { path: string; added: number; removed: number; created: boolean };

type Status = { available: boolean; running: boolean; canResume: boolean; homeDir: string };

export function useClaudeTask(folder: string, mode: "acceptEdits" | "plan") {
  const [status, setStatus] = useState<Status>({ available: false, running: false, canResume: false, homeDir: "" });
  const [error, setError] = useState("");
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [queued, setQueued] = useState<string[]>([]);
  const queueRef = useRef<string[]>([]);
  const startRef = useRef<(prompt: string, resume?: boolean) => Promise<boolean>>(async () => false);

  const setQueue = useCallback((next: string[]) => {
    queueRef.current = next;
    setQueued(next);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<Status>("claude_task_status").then(setStatus).catch(() => {});
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void listen<{ changes?: FileChange[]; failed?: boolean }>("claude-task-finished", ({ payload }) => {
      setChanges(payload?.changes ?? []);
      setStatus((current) => ({ ...current, running: false }));
      void invoke<Status>("claude_task_status")
        .then((next) => {
          setStatus({ ...next, running: false });
          const [upcoming, ...rest] = queueRef.current;
          if (upcoming === undefined) return;
          if (payload?.failed) {
            queueRef.current = [];
            setQueued([]);
            return;
          }
          queueRef.current = rest;
          setQueued(rest);
          void startRef.current(upcoming, next.canResume);
        })
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
    async (prompt: string, resume?: boolean) => {
      setError("");
      setChanges([]);
      try {
        await invoke("claude_task_start", { prompt, folder: workFolder, mode, resume: resume ?? status.canResume });
        setStatus((current) => ({ ...current, running: true }));
        return true;
      } catch (failure) {
        setError(String(failure));
        return false;
      }
    },
    [workFolder, mode, status.canResume],
  );
  startRef.current = start;

  const enqueue = useCallback((prompt: string) => setQueue([...queueRef.current, prompt]), [setQueue]);
  const clearQueue = useCallback(() => setQueue([]), [setQueue]);

  const forget = useCallback(() => {
    void invoke("claude_task_forget")
      .then(() => setStatus((current) => ({ ...current, canResume: false })))
      .catch(() => {});
  }, []);

  const undo = useCallback(async () => {
    try {
      await invoke<number>("claude_task_undo");
      setChanges([]);
    } catch (failure) {
      setError(String(failure));
    }
  }, []);

  const stop = useCallback(() => {
    setQueue([]);
    void invoke("claude_task_stop")
      .then(() => setStatus((current) => ({ ...current, running: false })))
      .catch((failure) => setError(String(failure)));
  }, [setQueue]);

  return { available: status.available, running: status.running, canResume: status.canResume, folder: workFolder, error, changes, queued, start, enqueue, clearQueue, stop, forget, undo };
}

export type ClaudeTask = ReturnType<typeof useClaudeTask>;
