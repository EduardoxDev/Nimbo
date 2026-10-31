import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { AlarmClock, Clapperboard, Rocket, Search, X } from "lucide-react";
import { useTranslation } from "../i18n";
import type { IslandTab } from "../IslandTabs";
import { PageChrome } from "../island/PageChrome";
import { LAUNCHER_DEMO_APPS } from "../demo/launcherDemo";
import { isClipRequest, searchApps, type LauncherApp } from "./launcher";
import { parseReminder } from "../reminders/reminders";
import type { Reminders } from "../reminders/useReminders";

function whenOf(at: number) {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString() ? time : `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

export function LauncherPanel<Page extends string>({
  pages,
  currentPage,
  showPageIcons,
  onPageChange,
  reminders,
  onDone,
}: {
  pages: IslandTab<Page>[];
  currentPage: Page;
  showPageIcons: boolean;
  onPageChange: (page: Page) => void;
  reminders: Reminders;
  onDone: () => void;
}) {
  const copy = useTranslation().launcher;
  const inputRef = useRef<HTMLInputElement>(null);
  const [apps, setApps] = useState<LauncherApp[]>(LAUNCHER_DEMO_APPS);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");
  const reminder = parseReminder(query, Date.now());
  const clip = !reminder && isClipRequest(query);
  const results = reminder || clip ? [] : searchApps(apps, query);

  const saveClip = () => {
    if (!isTauri()) return;
    setError("");
    void invoke("record_last_clip")
      .then(() => {
        setQuery("");
        onDone();
      })
      .catch((failure) => setError(String(failure)));
  };

  const saveReminder = () => {
    if (!reminder) return;
    reminders.add(reminder.text, reminder.at);
    setQuery("");
    onDone();
  };

  useEffect(() => {
    inputRef.current?.focus();
    if (!isTauri()) return;
    let attempts = 0;
    let timer = 0;
    const load = () =>
      void invoke<LauncherApp[]>("launcher_apps").then((list) => {
        setApps(list);
        attempts += 1;
        if (list.length === 0 && attempts < 8) timer = window.setTimeout(load, 800);
      });
    load();
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => setSelected(0), [query]);

  const open = (app: LauncherApp | undefined) => {
    if (!app || !isTauri()) return;
    setError("");
    void invoke("launcher_open", { id: app.id })
      .then(() => {
        setQuery("");
        onDone();
      })
      .catch((failure) => setError(String(failure)));
  };

  return (
    <PageChrome
      icon={Rocket}
      iconColor="#64d2ff"
      pages={pages}
      currentPage={currentPage}
      showPageIcons={showPageIcons}
      onPageChange={onPageChange}
      className="launcher-panel"
      label={copy.title}
    >
      <div className="launcher-panel__body">
        <label className="launcher-search">
          <Search size={16} strokeWidth={2.4} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            placeholder={apps.length ? copy.placeholder : copy.loading}
            aria-label={copy.placeholder}
            aria-controls="launcher-results"
            aria-activedescendant={results[selected] ? `launcher-${selected}` : undefined}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((index) => Math.min(results.length - 1, index + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((index) => Math.max(0, index - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (reminder) saveReminder();
                else if (clip) saveClip();
                else open(results[selected]);
              } else if (event.key === "Escape") {
                setQuery("");
                onDone();
              }
            }}
          />
        </label>
        {reminder ? (
          <ul className="launcher-results" role="listbox" aria-label={copy.title}>
            <li role="option" aria-selected="true">
              <button className="launcher-result launcher-result--selected" type="button" tabIndex={-1} onClick={saveReminder}>
                <span className="launcher-result__avatar launcher-result__avatar--reminder" aria-hidden="true">
                  <AlarmClock size={14} strokeWidth={2.4} />
                </span>
                <span className="launcher-result__name">{copy.reminderRow(reminder.text, whenOf(reminder.at))}</span>
                <kbd>Enter</kbd>
              </button>
            </li>
          </ul>
        ) : clip ? (
          <ul className="launcher-results" role="listbox" aria-label={copy.title}>
            <li role="option" aria-selected="true">
              <button className="launcher-result launcher-result--selected" type="button" tabIndex={-1} onClick={saveClip}>
                <span className="launcher-result__avatar launcher-result__avatar--reminder" aria-hidden="true">
                  <Clapperboard size={14} strokeWidth={2.4} />
                </span>
                <span className="launcher-result__name">{copy.clipRow}</span>
                <kbd>Enter</kbd>
              </button>
            </li>
          </ul>
        ) : !query.trim() ? (
          <>
            <span className="launcher-panel__hint">{copy.hint}</span>
            {reminders.reminders.length > 0 && (
              <ul className="launcher-reminders" aria-label={copy.upcoming}>
                {reminders.reminders.slice(0, 3).map((item) => (
                  <li key={item.id}>
                    <AlarmClock size={12} strokeWidth={2.4} aria-hidden="true" />
                    <span className="launcher-reminders__text">{item.text}</span>
                    <span className="launcher-reminders__when">{whenOf(item.at)}</span>
                    <button type="button" title={copy.removeReminder} aria-label={copy.removeReminder} onClick={() => reminders.remove(item.id)}>
                      <X size={11} strokeWidth={2.6} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : results.length === 0 ? (
          <span className="launcher-panel__hint">{copy.noResults}</span>
        ) : (
          <ul className="launcher-results" id="launcher-results" role="listbox" aria-label={copy.title}>
            {results.map((app, index) => (
              <li key={app.id} id={`launcher-${index}`} role="option" aria-selected={index === selected}>
                <button
                  className={`launcher-result${index === selected ? " launcher-result--selected" : ""}`}
                  type="button"
                  tabIndex={-1}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => open(app)}
                >
                  <span className="launcher-result__avatar" aria-hidden="true">
                    {app.name.trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="launcher-result__name">{app.name}</span>
                  {index === selected && <kbd>Enter</kbd>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <span className="launcher-panel__error" role="alert">
            {error}
          </span>
        )}
      </div>
    </PageChrome>
  );
}
