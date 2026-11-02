import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { AlarmClock, AppWindow, CalendarRange, Circle, Clapperboard, ClipboardList, File as FileIcon, FileText, BookmarkPlus, ScrollText, FolderDown, FolderOpen, FolderTree, ListChecks, Moon, Play, Rocket, Search, Smartphone, Sunrise, X, Zap, type LucideIcon } from "lucide-react";
import { readLaterRequestOf, shortLink } from "../readLater/readLater";
import { isPrompterRequest } from "../prompter/prompter";
import { useTranslation } from "../i18n";
import type { IslandTab } from "../IslandTabs";
import { PageChrome } from "../island/PageChrome";
import { LAUNCHER_DEMO_APPS } from "../demo/launcherDemo";
import { dayRequestOf, isClipRequest, searchApps, type LauncherApp } from "./launcher";
import { matchesAll, parseFileQuery } from "./universal";
import { parseRule, type Rule } from "../rules/rules";
import { parseAppReminder, parseReminder } from "../reminders/reminders";
import { routineOf, type RoutineKind } from "../routines/routines";
import {
  findWorkspace,
  parseWorkspaces,
  saveWorkspace,
  workspaceRequestOf,
  WORKSPACES_KEY,
  type Workspace,
  type WorkspaceItem,
} from "../workspaces/workspaces";

function loadWorkspaces() {
  try {
    return parseWorkspaces(window.localStorage.getItem(WORKSPACES_KEY));
  } catch {
    return [];
  }
}
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
  onRoutine,
  onNotice,
  onSummarize,
  clips,
  todos,
  onCopyClip,
  onOpenTodos,
  onAddRule,
  onRecord,
  onSendToPhone,
  onReadLater,
  onOpenPrompter,
  onDone,
}: {
  pages: IslandTab<Page>[];
  currentPage: Page;
  showPageIcons: boolean;
  onPageChange: (page: Page) => void;
  reminders: Reminders;
  onRoutine: (kind: RoutineKind) => void;
  /** A short message on the island once the launcher has closed. */
  onNotice: (text: string) => void;
  /** Sums up a link or a file on the assistant page. */
  onSummarize: (source: string) => void;
  /** Copied texts, newest first, for the universal search. */
  clips: { id: string; text: string }[];
  todos: string[];
  onCopyClip: (id: string) => void;
  onOpenTodos: () => void;
  onAddRule: (rule: Omit<Rule, "id" | "enabled">) => void;
  /** Starts recording an action that will be saved under this name. */
  onRecord: (name: string) => void;
  onSendToPhone: (text: string) => void;
  /** Keeps a link to read in a free moment. */
  onReadLater: (url: string) => void;
  onOpenPrompter: () => void;
  onDone: () => void;
}) {
  const t = useTranslation();
  const copy = t.launcher;
  const inputRef = useRef<HTMLInputElement>(null);
  const [apps, setApps] = useState<LauncherApp[]>(LAUNCHER_DEMO_APPS);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");
  const [workspaces, setWorkspaces] = useState<Workspace[]>(loadWorkspaces);
  const [ssid, setSsid] = useState<string | null>(null);
  const [macros, setMacros] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!isTauri()) return;
    void invoke<{ ssid: string | null }>("context_now").then((context) => setSsid(context.ssid)).catch(() => {});
    void invoke<{ id: string; name: string }[]>("macro_list").then(setMacros).catch(() => {});
  }, []);
  const trimmed = query.trim();
  const toPhone = /^(?:manda|mandar|envia|enviar|send)\s+(?:pro|para o|pra|ao|to(?: my| the)?)\s+(?:celular|telefone|phone)(?:\s*:?\s+(.+))?$|^发到手机\s*(.*)$/i.exec(trimmed);
  const tidyDownloads = /^(arrumar|arruma|organizar|organiza|limpar|limpa)\s+(os\s+|a\s+pasta\s+)?downloads$|^(tidy|organi[sz]e|clean)( up)?( my)? downloads$|^整理下载$/i.test(trimmed);
  const recordName = /^(?:gravar|grava|grave|ensinar|ensina)\s+(?:uma\s+|a\s+)?a[cç][aã]o\s+(.+)$|^(?:record|teach)\s+(?:an?\s+)?action\s+(.+)$/i.exec(trimmed);
  const macroWanted = /^(?:faz|fazer|roda|rodar|rode|executa|run|do)\s+(?:o\s+|a\s+|the\s+)?(.+)$/i.exec(trimmed)?.[1]?.toLowerCase() ?? null;
  const macroToRun = macroWanted ? (macros.find((item) => item.name.toLowerCase() === macroWanted) ?? macros.find((item) => item.name.toLowerCase().includes(macroWanted)) ?? null) : null;
  const newRule = /^(quando|sempre que|assim que|when|whenever|todo dia|todos os dias|every day|daily)\s/i.test(trimmed) ? parseRule(trimmed, ssid) : null;
  const summarySource = /^(?:resum(?:ir|e|a|o)|summari[sz]e|总结)\s+(.+)$/i.exec(query.trim())?.[1]?.trim() ?? null;
  const readLater = summarySource || toPhone ? null : readLaterRequestOf(trimmed);
  const prompter = isPrompterRequest(trimmed);
  const dayTab = summarySource ? null : dayRequestOf(query);
  const routine = dayTab ? null : routineOf(query);
  const project = routine || dayTab ? null : workspaceRequestOf(query);
  const forApp = routine || project ? null : parseAppReminder(query);
  const reminder = routine || project || forApp ? null : parseReminder(query, Date.now());
  const clip = !summarySource && !dayTab && !routine && !project && !forApp && !reminder && isClipRequest(query);
  const results = summarySource || dayTab || routine || project || forApp || reminder || clip ? [] : searchApps(apps, query);
  const projectToOpen = project?.kind === "open" ? findWorkspace(workspaces, project.name) : project?.kind === "last" ? (workspaces[0] ?? null) : null;
  // A typed command wins over app names, so "bom dia" never opens an app called "Bom".
  const command = toPhone
    ? { icon: Smartphone, text: toPhone[1] || toPhone[2] ? copy.phoneRow(toPhone[1] ?? toPhone[2]) : copy.phoneClipRow, run: () => sendToPhone(toPhone[1] ?? toPhone[2] ?? null) }
    : tidyDownloads
    ? { icon: FolderTree, text: copy.tidyRow, run: () => tidyNow() }
    : recordName
      ? { icon: Circle, text: copy.recordRow(recordName[1] ?? recordName[2]), run: () => recordNow((recordName[1] ?? recordName[2]).trim()) }
      : macroToRun
        ? { icon: Play, text: copy.macroRow(macroToRun.name), run: () => runMacro(macroToRun.id) }
        : prompter
    ? {
        icon: ScrollText,
        text: copy.prompterRow,
        run: () => {
          setQuery("");
          onOpenPrompter();
        },
      }
        : readLater
    ? { icon: BookmarkPlus, text: copy.readLaterRow(shortLink(readLater)), run: () => readLaterNow(readLater) }
        : summarySource
    ? { icon: FileText, text: copy.summarizeRow(summarySource), run: () => summarizeNow(summarySource) }
    : dayTab
    ? { icon: CalendarRange, text: copy.dayRow(t.day.tabs[dayTab]), run: () => openDay(dayTab) }
    : routine
    ? { icon: routine === "start" ? Sunrise : Moon, text: copy.routineRow(t.routines.names[routine]), run: () => runRoutine(routine) }
    : project?.kind === "save"
      ? { icon: FolderDown, text: copy.saveProjectRow(project.name), run: () => saveProject(project.name) }
      : project
        ? projectToOpen
          ? { icon: FolderOpen, text: copy.openProjectRow(projectToOpen.name, projectToOpen.apps.length + projectToOpen.files.length), run: () => openProject(projectToOpen) }
          : { icon: FolderOpen, text: project.kind === "open" ? copy.noProject(project.name) : copy.noProjects, run: () => {} }
        : forApp
          ? { icon: AppWindow, text: copy.appReminderRow(forApp.text, forApp.app), run: () => saveForApp() }
          : newRule
            ? { icon: Zap, text: copy.ruleRow(newRule.text), run: () => saveRule() }
            : null;

  // Universal search: files (by meaning: type, month, words), copied things and tasks.
  const [files, setFiles] = useState<{ name: string; path: string; folder: string }[]>([]);
  const searching = command || reminder || clip ? "" : query.trim();
  useEffect(() => {
    setFiles([]);
    const fileQuery = searching.length >= 3 ? parseFileQuery(searching) : null;
    if (!fileQuery || !isTauri()) return;
    const timer = window.setTimeout(() => {
      void invoke<{ name: string; path: string; folder: string }[]>("search_files", fileQuery).then(setFiles).catch(() => {});
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searching]);
  const extras: { key: string; icon: LucideIcon; label: string; tag: string; run: () => void }[] =
    searching.length < 3
      ? []
      : [
          ...files.map((file) => ({ key: `f-${file.path}`, icon: FileIcon, label: file.name, tag: file.folder, run: () => openFile(file.path) })),
          ...clips
            .filter((clip) => matchesAll(clip.text, searching))
            .slice(0, 3)
            .map((clip) => ({ key: `c-${clip.id}`, icon: ClipboardList, label: clip.text.replace(/\s+/g, " ").slice(0, 80), tag: copy.tagCopied, run: () => copyClip(clip.id) })),
          ...todos
            .filter((todo) => matchesAll(todo, searching))
            .slice(0, 3)
            .map((todo) => ({ key: `t-${todo}`, icon: ListChecks, label: todo, tag: copy.tagTask, run: () => onOpenTodos() })),
        ];
  useEffect(() => {
    try {
      window.localStorage.setItem(WORKSPACES_KEY, JSON.stringify(workspaces));
    } catch {
      // Kept for this run only.
    }
  }, [workspaces]);

  const saveProject = (name: string) => {
    if (!isTauri()) return;
    setError("");
    void invoke<{ apps: WorkspaceItem[]; files: WorkspaceItem[] }>("workspace_snapshot", { hours: 6 })
      .then(({ apps: openApps, files }) => {
        const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        setWorkspaces((current) => saveWorkspace(current, { id, name, savedAt: Date.now(), apps: openApps, files }));
        setQuery("");
        onNotice(copy.projectSaved(name, openApps.length, files.length));
        onDone();
      })
      .catch((failure) => setError(String(failure)));
  };

  const openProject = (workspace: Workspace) => {
    if (!isTauri()) return;
    setError("");
    void invoke<number>("workspace_open", { apps: workspace.apps.map((item) => item.path), files: workspace.files.map((item) => item.path) })
      .then((count) => {
        setQuery("");
        onNotice(copy.projectOpened(workspace.name, count));
        onDone();
      })
      .catch((failure) => setError(String(failure)));
  };

  const readLaterNow = (url: string) => {
    setQuery("");
    onReadLater(url);
    onDone();
  };

  const summarizeNow = (source: string) => {
    setQuery("");
    onSummarize(source);
  };

  const openFile = (path: string) => {
    setQuery("");
    if (isTauri()) void invoke("search_open", { path }).catch((failure) => setError(String(failure)));
    onDone();
  };

  const copyClip = (id: string) => {
    setQuery("");
    onCopyClip(id);
    onDone();
  };

  const sendToPhone = (text: string | null) => {
    setQuery("");
    if (text) onSendToPhone(text);
    else if (isTauri()) void invoke<string | null>("read_translation_clipboard").then((clip) => clip && onSendToPhone(clip));
    onDone();
  };

  const tidyNow = () => {
    setQuery("");
    if (isTauri()) {
      void invoke<number>("downloads_organize")
        .then((count) => onNotice(t.automation.organized(count)))
        .catch((failure) => onNotice(String(failure)));
    }
    onDone();
  };

  const recordNow = (name: string) => {
    setQuery("");
    onRecord(name);
    onNotice(t.automation.recordingStarted(name));
    onDone();
  };

  const runMacro = (id: string) => {
    setQuery("");
    onDone();
    if (isTauri()) void invoke<string>("macro_run", { id }).catch((failure) => onNotice(String(failure)));
  };

  const saveRule = () => {
    if (!newRule) return;
    onAddRule(newRule);
    setQuery("");
    onNotice(t.automation.ruleAdded(newRule.text));
    onDone();
  };

  const openDay = (tab: string) => {
    setQuery("");
    if (isTauri()) void invoke("open_day_window", { tab }).catch((failure) => setError(String(failure)));
    onDone();
  };

  const runRoutine = (kind: RoutineKind) => {
    setQuery("");
    onRoutine(kind);
    onDone();
  };

  const saveForApp = () => {
    if (!forApp) return;
    reminders.addForApp(forApp.text, forApp.app);
    setQuery("");
    onDone();
  };

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
                setSelected((index) => Math.min(results.length + extras.length - 1, index + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((index) => Math.max(0, index - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (command) command.run();
                else if (reminder) saveReminder();
                else if (clip) saveClip();
                else if (selected < results.length) open(results[selected]);
                else extras[selected - results.length]?.run();
              } else if (event.key === "Escape") {
                setQuery("");
                onDone();
              }
            }}
          />
        </label>
        {command ? (
          <ul className="launcher-results" role="listbox" aria-label={copy.title}>
            <li role="option" aria-selected="true">
              <button className="launcher-result launcher-result--selected" type="button" tabIndex={-1} onClick={command.run}>
                <span className="launcher-result__avatar launcher-result__avatar--reminder" aria-hidden="true">
                  <command.icon size={14} strokeWidth={2.4} />
                </span>
                <span className="launcher-result__name">{command.text}</span>
                <kbd>Enter</kbd>
              </button>
            </li>
          </ul>
        ) : reminder ? (
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
            {workspaces.length > 0 && (
              <ul className="launcher-reminders" aria-label={copy.projects}>
                {workspaces.slice(0, 3).map((item) => (
                  <li key={item.id}>
                    <FolderOpen size={12} strokeWidth={2.4} aria-hidden="true" />
                    <button type="button" className="launcher-reminders__open" title={copy.openProject} onClick={() => openProject(item)}>
                      {item.name}
                    </button>
                    <span className="launcher-reminders__when">{whenOf(item.savedAt)}</span>
                    <button
                      type="button"
                      title={copy.removeProject}
                      aria-label={copy.removeProject}
                      onClick={() => setWorkspaces((current) => current.filter((other) => other.id !== item.id))}
                    >
                      <X size={11} strokeWidth={2.6} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {reminders.forApps.length > 0 && (
              <ul className="launcher-reminders" aria-label={copy.upcoming}>
                {reminders.forApps.slice(0, 3).map((item) => (
                  <li key={item.id}>
                    <AppWindow size={12} strokeWidth={2.4} aria-hidden="true" />
                    <span className="launcher-reminders__text">{item.text}</span>
                    <span className="launcher-reminders__when">{copy.whenOpen(item.app)}</span>
                    <button type="button" title={copy.removeReminder} aria-label={copy.removeReminder} onClick={() => reminders.removeForApp(item.id)}>
                      <X size={11} strokeWidth={2.6} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
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
        ) : results.length === 0 && extras.length === 0 ? (
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
            {extras.map((item, offset) => {
              const index = results.length + offset;
              return (
                <li key={item.key} id={`launcher-${index}`} role="option" aria-selected={index === selected}>
                  <button
                    className={`launcher-result${index === selected ? " launcher-result--selected" : ""}`}
                    type="button"
                    tabIndex={-1}
                    onMouseEnter={() => setSelected(index)}
                    onClick={item.run}
                  >
                    <span className="launcher-result__avatar launcher-result__avatar--extra" aria-hidden="true">
                      <item.icon size={13} strokeWidth={2.4} />
                    </span>
                    <span className="launcher-result__name">{item.label}</span>
                    <span className="launcher-result__tag">{item.tag}</span>
                    {index === selected && <kbd>Enter</kbd>}
                  </button>
                </li>
              );
            })}
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
