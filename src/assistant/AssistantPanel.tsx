import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, RotateCcw, Sparkles } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import type { IslandTab } from "../IslandTabs";
import { PageChrome } from "../island/PageChrome";
import { ASSISTANT_DEMO, type ChatEntry } from "./useAssistant";

const ASSISTANT_COLOR = "#ffb86b";

export function AssistantPanel<Page extends string>({
  entries,
  busy,
  onSend,
  onReset,
  pages,
  currentPage,
  showPageIcons,
  onPageChange,
}: {
  entries: ChatEntry[];
  busy: boolean;
  onSend: (text: string) => void;
  onReset: () => void;
  pages: IslandTab<Page>[];
  currentPage: Page;
  showPageIcons: boolean;
  onPageChange: (page: Page) => void;
}) {
  const t = useTranslation();
  const copy = t.assistant;
  const [draft, setDraft] = useState("");
  const [hasKey, setHasKey] = useState<boolean | null>(ASSISTANT_DEMO ? true : null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    invoke<boolean>("assistant_has_key").then(setHasKey).catch(() => setHasKey(false));
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [entries, busy]);

  useEffect(() => {
    if (hasKey) inputRef.current?.focus();
  }, [hasKey]);

  const submit = (event?: FormEvent, text = draft) => {
    event?.preventDefault();
    if (!text.trim() || busy) return;
    onSend(text);
    setDraft("");
  };

  const openSettings = () => {
    try {
      window.localStorage.setItem("nimbo-settings-page", "agents");
    } catch {
      // Opens on the last page instead.
    }
    if (isTauri()) void invoke("open_settings_window").catch(() => {});
  };

  const actionLabel = (name: string) => copy.actions[name as keyof typeof copy.actions] ?? name;
  const suggestions = [copy.suggestion1, copy.suggestion2, copy.suggestion3, copy.suggestion4];

  return (
    <PageChrome
      icon={Sparkles}
      iconColor={ASSISTANT_COLOR}
      pages={pages}
      currentPage={currentPage}
      showPageIcons={showPageIcons}
      onPageChange={onPageChange}
      className="assistant-panel"
      label={copy.title}
    >
      {hasKey === false ? (
        <div className="home-empty" role="status">
          <strong>{copy.noKey}</strong>
          <span className="home-empty__hint">{copy.noKeyHint}</span>
          <button className="home-empty__button" type="button" onClick={openSettings}>
            {copy.addKey}
          </button>
        </div>
      ) : (
        <>
          <div className="assistant-panel__list" ref={listRef} aria-live="polite">
            {entries.length === 0 ? (
              <div className="assistant-panel__empty">
                <strong>{copy.emptyTitle}</strong>
                <div className="assistant-panel__suggestions">
                  {suggestions.map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => submit(undefined, suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              entries.map((entry) => (
                <div key={entry.id} className={`assistant-bubble assistant-bubble--${entry.role}`}>
                  <span>{entry.text}</span>
                  {entry.actions && entry.actions.length > 0 && (
                    <em>{entry.actions.map(actionLabel).join(" · ")}</em>
                  )}
                </div>
              ))
            )}
            {busy && (
              <div className="assistant-bubble assistant-bubble--assistant assistant-bubble--typing" aria-label={copy.thinking}>
                <i />
                <i />
                <i />
              </div>
            )}
          </div>

          <form className="assistant-panel__input" onSubmit={submit}>
            {entries.length > 0 && (
              <button
                className="assistant-panel__reset"
                type="button"
                title={copy.newChat}
                aria-label={copy.newChat}
                onClick={onReset}
                disabled={busy}
              >
                <RotateCcw size={14} strokeWidth={2.4} />
              </button>
            )}
            <input
              ref={inputRef}
              value={draft}
              placeholder={copy.placeholder}
              aria-label={copy.placeholder}
              maxLength={2000}
              onChange={(event) => setDraft(event.currentTarget.value)}
            />
            <button className="assistant-panel__send" type="submit" disabled={!draft.trim() || busy} aria-label={copy.send}>
              <ArrowUp size={16} strokeWidth={2.8} />
            </button>
          </form>
        </>
      )}
    </PageChrome>
  );
}
