import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Rocket, Search } from "lucide-react";
import { useTranslation } from "../i18n";
import type { IslandTab } from "../IslandTabs";
import { PageChrome } from "../island/PageChrome";
import { LAUNCHER_DEMO_APPS } from "../demo/launcherDemo";
import { searchApps, type LauncherApp } from "./launcher";

export function LauncherPanel<Page extends string>({
  pages,
  currentPage,
  showPageIcons,
  onPageChange,
  onDone,
}: {
  pages: IslandTab<Page>[];
  currentPage: Page;
  showPageIcons: boolean;
  onPageChange: (page: Page) => void;
  onDone: () => void;
}) {
  const copy = useTranslation().launcher;
  const inputRef = useRef<HTMLInputElement>(null);
  const [apps, setApps] = useState<LauncherApp[]>(LAUNCHER_DEMO_APPS);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");
  const results = searchApps(apps, query);

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
                open(results[selected]);
              } else if (event.key === "Escape") {
                setQuery("");
                onDone();
              }
            }}
          />
        </label>
        {!query.trim() ? (
          <span className="launcher-panel__hint">{copy.hint}</span>
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
