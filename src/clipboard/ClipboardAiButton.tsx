import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Languages, ListPlus, LoaderCircle, Sparkles, TextQuote } from "lucide-react";
import { useLocale, useTranslation } from "../i18n";

type Action = "summarize" | "translate" | "todo";

const STATUS_MS = 4_000;

export function ClipboardAiButton({ text, onAddTodo }: { text: string; onAddTodo: (title: string) => void }) {
  const copy = useTranslation().clipboard;
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [status, setStatus] = useState<{ text: string; failed: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef(0);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const show = (next: { text: string; failed: boolean }) => {
    setStatus(next);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setStatus(null), STATUS_MS);
  };

  const run = (action: Action) => {
    setOpen(false);
    if (action === "todo") {
      onAddTodo(text.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 200) ?? "");
      show({ text: copy.aiTodoDone, failed: false });
      return;
    }
    if (!isTauri()) return;
    setBusy(action);
    void invoke<string>("clipboard_ai_action", { action, text, language: locale })
      .then(() => show({ text: action === "summarize" ? copy.aiSummaryDone : copy.aiTranslationDone, failed: false }))
      .catch((failure) => show({ text: String(failure), failed: true }))
      .finally(() => setBusy(null));
  };

  return (
    <div className="clipboard-ai" ref={rootRef}>
      <button
        className="clipboard-ai__button"
        type="button"
        title={busy ? copy.aiWorking : copy.aiMenu}
        aria-label={copy.aiMenu}
        aria-expanded={open}
        disabled={busy !== null}
        onClick={() => setOpen((current) => !current)}
      >
        {busy ? <LoaderCircle className="clipboard-ai__spin" size={14} strokeWidth={2.3} /> : <Sparkles size={14} strokeWidth={2.3} />}
      </button>
      {open && (
        <div className="clipboard-ai__menu g-card" role="menu">
          <button type="button" role="menuitem" onClick={() => run("summarize")}>
            <TextQuote size={12} strokeWidth={2.4} aria-hidden="true" />
            {copy.aiSummarize}
          </button>
          <button type="button" role="menuitem" onClick={() => run("translate")}>
            <Languages size={12} strokeWidth={2.4} aria-hidden="true" />
            {copy.aiTranslate}
          </button>
          <button type="button" role="menuitem" onClick={() => run("todo")}>
            <ListPlus size={12} strokeWidth={2.4} aria-hidden="true" />
            {copy.aiTodo}
          </button>
        </div>
      )}
      {status && (
        <span className={`clipboard-ai__status${status.failed ? " clipboard-ai__status--failed" : ""}`} role="status">
          {status.text}
        </span>
      )}
    </div>
  );
}
