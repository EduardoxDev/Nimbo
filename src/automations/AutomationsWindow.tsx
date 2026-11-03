import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowRight, Check, Copy, History, Pencil, Play, Plus, Search, Sparkles, Trash2, Wand2, X, Zap } from "lucide-react";
import { useTranslation } from "../i18n";
import { actionsOf, parseRule, parseRules, parseRunLog, RULES_KEY, RULES_LOG_KEY, type Action, type Rule, type RuleRun, type Trigger } from "../rules/rules";
import { ACTION_KINDS, actionReady, defaultAction, defaultTrigger, RECIPES, ruleFromParts, TRIGGER_KINDS, triggerReady, type Recipe } from "./catalog";
import { Mascot } from "../mascot/Mascot";
import { ACTION_ICONS, TRIGGER_ICONS } from "./kindIcons";
import "./Automations.css";

type Section = "mine" | "recipes" | "history";
type Filter = "all" | "on" | "off";
type Draft = { id: string | null; name: string; trigger: Trigger; actions: Action[] };

const DAY_MS = 86_400_000;

function readRules() {
  try {
    return parseRules(window.localStorage.getItem(RULES_KEY));
  } catch {
    return [];
  }
}

function readLog() {
  try {
    return parseRunLog(window.localStorage.getItem(RULES_LOG_KEY));
  } catch {
    return [];
  }
}

function writeRules(rules: Rule[]) {
  try {
    window.localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  } catch {
    return;
  }
}

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function startOfDay(at: number) {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function sameFlow(rule: Rule, trigger: Trigger, actions: Action[]) {
  return rule.trigger.kind === trigger.kind && JSON.stringify(actionsOf(rule).map((action) => action.kind)) === JSON.stringify(actions.map((action) => action.kind));
}

const LOGO_COLOR = "#ff9f0a";

function Logo({ size, mood = "idle" }: { size: number; mood?: "idle" | "working" | "sleeping" | "done" | "error" }) {
  return <Mascot mood={mood} shape="round" color={LOGO_COLOR} seed="automacoes" size={size} showDot={false} fps={10} />;
}

export default function AutomationsWindow() {
  const t = useTranslation();
  const copy = t.automations;
  const [section, setSection] = useState<Section>("mine");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [rules, setRules] = useState<Rule[]>(readRules);
  const [log, setLog] = useState<RuleRun[]>(readLog);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sentence, setSentence] = useState("");
  const [toast, setToast] = useState<{ id: number; text: string; bad?: boolean } | null>(null);
  const [picking, setPicking] = useState(false);
  const toastTimer = useRef(0);
  const win = isTauri() ? getCurrentWindow() : null;

  useEffect(() => {
    document.documentElement.classList.add("automations-root");
    const onStorage = (event: StorageEvent) => {
      if (event.key === RULES_KEY) setRules(readRules());
      if (event.key === RULES_LOG_KEY) setLog(readLog());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (picking) setPicking(false);
      else if (draft) setDraft(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, picking]);

  const notify = (text: string, bad = false) => {
    window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, bad });
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  };

  const save = (next: Rule[]) => {
    setRules(next);
    writeRules(next);
  };

  const days = (list?: number[]) =>
    !list || list.length === 0 || list.length === 7 ? copy.everyDay : list.length === 5 && [1, 2, 3, 4, 5].every((day) => list.includes(day)) ? copy.weekdaysLabel : list.map((day) => copy.weekdays[day]).join(", ");

  const triggerDetail = (trigger: Trigger) => {
    switch (trigger.kind) {
      case "time":
        return `${trigger.time} · ${days(trigger.days)}`;
      case "battery":
        return `≤ ${trigger.below}%`;
      case "wifi":
        return trigger.ssid;
      case "app":
        return trigger.app;
      case "idle":
        return `${trigger.minutes} min`;
      default:
        return "";
    }
  };

  const actionDetail = (action: Action) => {
    switch (action.kind) {
      case "music":
        return action.query;
      case "volume":
        return `${action.level}%`;
      case "open":
        return action.app;
      case "url":
        return action.url;
      case "notify":
      case "say":
        return `“${action.text}”`;
      case "claude":
        return `“${action.prompt}”`;
      case "macro":
        return action.name;
      case "dark":
        return action.on ? copy.fields.on : copy.fields.off;
      case "ac":
        return action.on ? `${action.temperature ?? ""}°` : copy.fields.off;
      case "routine":
        return action.routine === "start" ? copy.fields.routineStart : copy.fields.routineEnd;
      default:
        return "";
    }
  };

  const describeTrigger = (trigger: Trigger) => [copy.triggers[trigger.kind], triggerDetail(trigger)].filter(Boolean).join(" · ");
  const describeAction = (action: Action) => [copy.actions[action.kind], actionDetail(action)].filter(Boolean).join(" · ");
  const sentenceOf = (trigger: Trigger, actions: Action[]) => `${copy.when} ${describeTrigger(trigger)} → ${actions.map(describeAction).join(" + ")}`;

  const localRecipe = (recipe: Recipe): Recipe => {
    const line = copy.recipeLines[recipe.id];
    if (!line) return recipe;
    return { ...recipe, actions: recipe.actions.map((action) => (action.kind === "say" || action.kind === "notify" ? { ...action, text: line } : action)) };
  };

  const commitDraft = () => {
    if (!draft) return;
    const parts = ruleFromParts(draft.trigger, draft.actions, sentenceOf(draft.trigger, draft.actions), draft.name.trim() || undefined);
    const next = draft.id ? rules.map((rule) => (rule.id === draft.id ? { ...rule, ...parts } : rule)) : [{ ...parts, id: newId(), enabled: true }, ...rules];
    save(next);
    notify(draft.id ? copy.saved : copy.added);
    setDraft(null);
    setSection("mine");
  };

  const addSentence = () => {
    const parsed = parseRule(sentence, null);
    if (!parsed) {
      notify(copy.sentenceBad, true);
      return;
    }
    save([{ ...parsed, id: newId(), enabled: true }, ...rules]);
    setSentence("");
    notify(copy.added);
  };

  const addRecipe = (recipe: Recipe) => {
    const local = localRecipe(recipe);
    save([{ ...ruleFromParts(local.trigger, local.actions, sentenceOf(local.trigger, local.actions), copy.recipeTitles[recipe.id]), id: newId(), enabled: true }, ...rules]);
    notify(copy.added);
  };

  const test = (rule: Rule) => {
    if (isTauri()) void emitTo("main", "rules-test", rule.id).catch(() => {});
    notify(copy.testing(rule.name || copy.triggers[rule.trigger.kind]));
  };

  const lastRun = useMemo(() => {
    const map = new Map<string, RuleRun>();
    for (const run of log) if (!map.has(run.ruleId)) map.set(run.ruleId, run);
    return map;
  }, [log]);

  const today = startOfDay(Date.now());
  const ranToday = log.filter((run) => run.at >= today).length;
  const activeCount = rules.filter((rule) => rule.enabled).length;
  const failedToday = log.filter((run) => run.at >= today && !run.ok).length;

  const visible = rules.filter((rule) => {
    if (filter === "on" && !rule.enabled) return false;
    if (filter === "off" && rule.enabled) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [rule.name ?? "", describeTrigger(rule.trigger), ...actionsOf(rule).map(describeAction)].join(" ").toLowerCase().includes(needle);
  });

  const groups = useMemo(() => {
    const result: { label: string; runs: RuleRun[] }[] = [];
    for (const run of log) {
      const day = startOfDay(run.at);
      const label = day === today ? copy.today : day === today - DAY_MS ? copy.yesterday : new Date(day).toLocaleDateString(t.localeTag, { weekday: "long", day: "numeric", month: "short" });
      const last = result[result.length - 1];
      if (last && last.label === label) last.runs.push(run);
      else result.push({ label, runs: [run] });
    }
    return result;
  }, [log, today, copy, t.localeTag]);

  const ruleOf = (id: string) => rules.find((rule) => rule.id === id);
  const draftReady = draft !== null && triggerReady(draft.trigger) && draft.actions.length > 0 && draft.actions.every(actionReady);
  const clock = (at: number) => new Date(at).toLocaleTimeString(t.localeTag, { hour: "2-digit", minute: "2-digit" });
  const relative = (at: number) => (startOfDay(at) === today ? `${copy.today.toLowerCase()} ${clock(at)}` : new Date(at).toLocaleString(t.localeTag, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }));

  const nav: { id: Section; icon: typeof Zap; count?: number }[] = [
    { id: "mine", icon: Zap, count: rules.length },
    { id: "recipes", icon: Sparkles, count: RECIPES.length },
    { id: "history", icon: History, count: log.length },
  ];

  const openNew = (trigger: Trigger = defaultTrigger("focusStart"), actions: Action[] = []) => {
    setPicking(actions.length === 0);
    setDraft({ id: null, name: "", trigger, actions });
  };

  return (
    <div className="na">
      <header className="na-top" data-tauri-drag-region>
        <button type="button" className="na-top__close" aria-label={copy.close} title={copy.close} onClick={() => void win?.close()}>
          <X size={15} strokeWidth={2} />
        </button>
      </header>

      <aside className="na-side">
        <div className="na-brand" data-tauri-drag-region>
          <span className="na-brand__logo">
            <Logo size={34} mood={activeCount > 0 ? "idle" : "sleeping"} />
          </span>
          <span className="na-brand__text" data-tauri-drag-region>
            <strong>
              Nimbo <em>{copy.titleShort}</em>
            </strong>
            <small>{copy.subtitle}</small>
          </span>
        </div>
        <nav className="na-nav">
          {nav.map((item) => (
            <button key={item.id} type="button" className={`na-nav__item${section === item.id ? " is-on" : ""}`} onClick={() => setSection(item.id)}>
              <span className="na-nav__icon">
                <item.icon size={15} strokeWidth={2} />
              </span>
              <span className="na-nav__label">{copy[item.id]}</span>
              {!!item.count && <span className="na-nav__count">{item.count}</span>}
            </button>
          ))}
        </nav>
        <button type="button" className="na-side__new" onClick={() => openNew()}>
          <Plus size={15} strokeWidth={2} />
          {copy.newOne}
        </button>
        <div className="na-pulse">
          <span className={`na-pulse__dot${activeCount > 0 ? " is-live" : ""}`} />
          <div>
            <strong>{activeCount > 0 ? copy.watching(activeCount) : copy.sleeping}</strong>
            <small>{copy.ranToday(ranToday)}</small>
          </div>
        </div>
      </aside>

      <main className="na-main">
        {section === "mine" && (
          <div className="na-page" key="mine">
            <div className="na-hero">
              <div>
                <h1>{copy.mine}</h1>
                <p>{copy.mineHint}</p>
              </div>
            </div>

            <div className="na-stats">
              <div className="na-stat">
                <span>{copy.statActive}</span>
                <strong>{activeCount}</strong>
                <small>{copy.ofTotal(rules.length)}</small>
              </div>
              <div className="na-stat">
                <span>{copy.statToday}</span>
                <strong>{ranToday}</strong>
                <small>{failedToday > 0 ? copy.failedCount(failedToday) : copy.allGood}</small>
              </div>
              <div className="na-stat">
                <span>{copy.statLast}</span>
                <strong>{log[0] ? clock(log[0].at) : "—"}</strong>
                <small>{log[0] ? log[0].name : copy.noneYet}</small>
              </div>
            </div>

            <form
              className="na-magic"
              onSubmit={(event) => {
                event.preventDefault();
                addSentence();
              }}
            >
              <span className="na-magic__icon">
                <Wand2 size={15} strokeWidth={2} />
              </span>
              <input value={sentence} placeholder={copy.sentencePlaceholder} aria-label={copy.sentencePlaceholder} onChange={(event) => setSentence(event.currentTarget.value)} />
              <button type="submit" className="na-btn na-btn--soft" disabled={!sentence.trim()}>
                {copy.sentenceAdd}
                <ArrowRight size={14} strokeWidth={2} />
              </button>
            </form>

            {rules.length > 0 && (
              <div className="na-toolbar">
                <div className="na-seg" role="tablist">
                  {(["all", "on", "off"] as Filter[]).map((item) => (
                    <button key={item} type="button" role="tab" aria-selected={filter === item} className={filter === item ? "is-on" : ""} onClick={() => setFilter(item)}>
                      {item === "all" ? copy.filterAll : item === "on" ? copy.filterOn : copy.filterOff}
                    </button>
                  ))}
                </div>
                <label className="na-search">
                  <Search size={14} strokeWidth={2} />
                  <input value={query} placeholder={copy.search} aria-label={copy.search} onChange={(event) => setQuery(event.currentTarget.value)} />
                </label>
              </div>
            )}

            {rules.length === 0 ? (
              <div className="na-empty">
                <Logo size={84} mood="sleeping" />
                <strong>{copy.empty}</strong>
                <span>{copy.emptyHint}</span>
                <div className="na-empty__actions">
                  <button type="button" className="na-btn na-btn--primary" onClick={() => openNew()}>
                    <Plus size={15} strokeWidth={2} />
                    {copy.newOne}
                  </button>
                  <button type="button" className="na-btn" onClick={() => setSection("recipes")}>
                    <Sparkles size={14} strokeWidth={2} />
                    {copy.seeRecipes}
                  </button>
                </div>
              </div>
            ) : visible.length === 0 ? (
              <div className="na-empty na-empty--small">
                <Search size={22} strokeWidth={2} />
                <span>{copy.noMatch}</span>
              </div>
            ) : (
              <ul className="na-rules">
                {visible.map((rule) => {
                  const run = lastRun.get(rule.id);
                  const TriggerIcon = TRIGGER_ICONS[rule.trigger.kind];
                  const detail = triggerDetail(rule.trigger);
                  return (
                    <li key={rule.id} className={`na-rule${rule.enabled ? "" : " is-off"}`}>
                      <div className="na-rule__flow">
                        <div className="na-when">
                          <span className="na-when__icon">
                            <TriggerIcon size={17} strokeWidth={2} />
                          </span>
                          <span className="na-when__text">
                            <small>{copy.when}</small>
                            <strong>{copy.triggers[rule.trigger.kind]}</strong>
                            {detail && <em>{detail}</em>}
                          </span>
                        </div>
                        <span className="na-rule__link" aria-hidden="true">
                          <ArrowRight size={14} strokeWidth={2} />
                        </span>
                        <div className="na-then">
                          {actionsOf(rule).map((action, index) => {
                            const Icon = ACTION_ICONS[action.kind];
                            const extra = actionDetail(action);
                            return (
                              <span key={index} className="na-pill" title={describeAction(action)}>
                                <Icon size={13} strokeWidth={2} />
                                <b>{copy.actions[action.kind]}</b>
                                {extra && <i>{extra}</i>}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                      <div className="na-rule__foot">
                        <span className="na-rule__meta">
                          {rule.name && <b>{rule.name}</b>}
                          {run ? (
                            <span className={run.ok ? "is-ok" : "is-bad"}>
                              {run.ok ? <Check size={12} strokeWidth={2.4} /> : <X size={12} strokeWidth={2.4} />}
                              {run.ok ? copy.ran : copy.failed} {relative(run.at)}
                            </span>
                          ) : (
                            <span>{copy.never}</span>
                          )}
                        </span>
                        <div className="na-rule__tools">
                          <button type="button" className="na-tool" title={copy.test} aria-label={copy.test} onClick={() => test(rule)}>
                            <Play size={13} strokeWidth={2} />
                          </button>
                          <button
                            type="button"
                            className="na-tool"
                            title={copy.edit}
                            aria-label={copy.edit}
                            onClick={() => {
                              setPicking(false);
                              setDraft({ id: rule.id, name: rule.name ?? "", trigger: rule.trigger, actions: actionsOf(rule) });
                            }}
                          >
                            <Pencil size={13} strokeWidth={2} />
                          </button>
                          <button
                            type="button"
                            className="na-tool"
                            title={copy.duplicate}
                            aria-label={copy.duplicate}
                            onClick={() => {
                              save([{ ...rule, id: newId(), enabled: false }, ...rules]);
                              notify(copy.duplicated);
                            }}
                          >
                            <Copy size={13} strokeWidth={2} />
                          </button>
                          <button
                            type="button"
                            className="na-tool na-tool--danger"
                            title={copy.remove}
                            aria-label={copy.remove}
                            onClick={() => {
                              save(rules.filter((item) => item.id !== rule.id));
                              notify(copy.removed);
                            }}
                          >
                            <Trash2 size={13} strokeWidth={2} />
                          </button>
                        </div>
                        <label className="na-switch" title={copy.enabled}>
                          <input type="checkbox" checked={rule.enabled} aria-label={copy.enabled} onChange={() => save(rules.map((item) => (item.id === rule.id ? { ...item, enabled: !item.enabled } : item)))} />
                          <span />
                        </label>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {section === "recipes" && (
          <div className="na-page" key="recipes">
            <div className="na-hero">
              <div>
                <h1>{copy.recipes}</h1>
                <p>{copy.recipesHint}</p>
              </div>
            </div>
            <ul className="na-recipes">
              {RECIPES.map((recipe) => {
                const local = localRecipe(recipe);
                const TriggerIcon = TRIGGER_ICONS[recipe.trigger.kind];
                const added = rules.some((rule) => sameFlow(rule, recipe.trigger, recipe.actions));
                return (
                  <li key={recipe.id} className="na-recipe">
                    <div className="na-recipe__icons">
                      <span className="na-recipe__trigger">
                        <TriggerIcon size={18} strokeWidth={2} />
                      </span>
                      <ArrowRight size={13} strokeWidth={2} className="na-recipe__arrow" />
                      {local.actions.map((action, index) => {
                        const Icon = ACTION_ICONS[action.kind];
                        return (
                          <span key={index} className="na-recipe__action">
                            <Icon size={14} strokeWidth={2} />
                          </span>
                        );
                      })}
                    </div>
                    <strong>{copy.recipeTitles[recipe.id]}</strong>
                    <p>
                      <span>{describeTrigger(local.trigger)}</span> → {local.actions.map(describeAction).join(" + ")}
                    </p>
                    <div className="na-recipe__foot">
                      {added ? (
                        <span className="na-recipe__added">
                          <Check size={13} strokeWidth={2.4} />
                          {copy.alreadyAdded}
                        </span>
                      ) : (
                        <button type="button" className="na-btn na-btn--soft" onClick={() => addRecipe(recipe)}>
                          <Plus size={14} strokeWidth={2} />
                          {copy.use}
                        </button>
                      )}
                      <button type="button" className="na-link" onClick={() => openNew(local.trigger, local.actions)}>
                        {copy.customize}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {section === "history" && (
          <div className="na-page" key="history">
            <div className="na-hero">
              <div>
                <h1>{copy.history}</h1>
                <p>{copy.historyHint}</p>
              </div>
            </div>
            {log.length === 0 ? (
              <div className="na-empty">
                <Logo size={80} mood="sleeping" />
                <strong>{copy.historyEmpty}</strong>
                <span>{copy.historyEmptyHint}</span>
              </div>
            ) : (
              groups.map((group) => (
                <section key={group.label} className="na-day-group">
                  <h2>{group.label}</h2>
                  <ul className="na-runs">
                    {group.runs.map((run) => {
                      const rule = ruleOf(run.ruleId);
                      const Icon = rule ? TRIGGER_ICONS[rule.trigger.kind] : Zap;
                      return (
                        <li key={run.id} className="na-run">
                          <span className="na-run__icon">
                            <Icon size={14} strokeWidth={2} />
                          </span>
                          <span className="na-run__name">{run.name}</span>
                          <span className={`na-badge ${run.ok ? "is-ok" : "is-bad"}`}>{run.ok ? copy.ran : copy.failed}</span>
                          <span className="na-run__time">{clock(run.at)}</span>
                          {run.error && <span className="na-run__error">{run.error}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
          </div>
        )}
      </main>

      {draft && (
        <div className="na-drawer" role="dialog" aria-modal="true" aria-label={draft.id ? copy.edit : copy.newOne}>
          <button type="button" className="na-drawer__scrim" aria-label={copy.cancel} tabIndex={-1} onClick={() => setDraft(null)} />
          <div className="na-drawer__panel">
            <div className="na-drawer__head">
              <Logo size={28} mood="working" />
              <h2>{draft.id ? copy.edit : copy.newOne}</h2>
              <button type="button" className="na-tool" aria-label={copy.cancel} onClick={() => setDraft(null)}>
                <X size={15} strokeWidth={2} />
              </button>
            </div>

            <div className="na-drawer__body">
              <section className="na-step">
                <h3>
                  <span>1</span>
                  {copy.pickTrigger}
                </h3>
                <div className="na-tiles">
                  {TRIGGER_KINDS.map((kind) => {
                    const Icon = TRIGGER_ICONS[kind];
                    return (
                      <button
                        key={kind}
                        type="button"
                        className={`na-tile${draft.trigger.kind === kind ? " is-on" : ""}`}
                       
                        aria-pressed={draft.trigger.kind === kind}
                        onClick={() => setDraft({ ...draft, trigger: draft.trigger.kind === kind ? draft.trigger : defaultTrigger(kind) })}
                      >
                        <span className="na-tile__icon">
                          <Icon size={17} strokeWidth={2} />
                        </span>
                        {copy.triggers[kind]}
                      </button>
                    );
                  })}
                </div>
                <TriggerFields trigger={draft.trigger} onChange={(trigger) => setDraft({ ...draft, trigger })} />
              </section>

              <section className="na-step">
                <h3>
                  <span>2</span>
                  {copy.pickActions}
                </h3>
                {draft.actions.length > 0 && (
                  <ol className="na-steps">
                    {draft.actions.map((action, index) => {
                      const Icon = ACTION_ICONS[action.kind];
                      return (
                        <li key={index} className="na-action">
                          <span className="na-action__icon">
                            <Icon size={15} strokeWidth={2} />
                          </span>
                          <div className="na-action__body">
                            <strong>{copy.actions[action.kind]}</strong>
                            <ActionFields action={action} onChange={(next) => setDraft({ ...draft, actions: draft.actions.map((item, position) => (position === index ? next : item)) })} />
                          </div>
                          <button type="button" className="na-tool na-tool--danger" aria-label={copy.remove} onClick={() => setDraft({ ...draft, actions: draft.actions.filter((_, position) => position !== index) })}>
                            <Trash2 size={13} strokeWidth={2} />
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
                {draft.actions.length < 5 &&
                  (picking ? (
                    <div className="na-picker">
                      {ACTION_KINDS.map((kind) => {
                        const Icon = ACTION_ICONS[kind];
                        return (
                          <button
                            key={kind}
                            type="button"
                            className="na-picker__item"
                           
                            onClick={() => {
                              setDraft({ ...draft, actions: [...draft.actions, defaultAction(kind)] });
                              setPicking(false);
                            }}
                          >
                            <span>
                              <Icon size={15} strokeWidth={2} />
                            </span>
                            {copy.actions[kind]}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <button type="button" className="na-add" onClick={() => setPicking(true)}>
                      <Plus size={15} strokeWidth={2} />
                      {copy.addAction}
                    </button>
                  ))}
              </section>

              <section className="na-step">
                <h3>
                  <span>3</span>
                  {copy.finish}
                </h3>
                <input className="na-input" value={draft.name} placeholder={copy.namePlaceholder} aria-label={copy.name} onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })} />
                <div className="na-preview">
                  <span className="na-preview__label">{copy.preview}</span>
                  <p>{draft.actions.length > 0 ? sentenceOf(draft.trigger, draft.actions) : `${copy.when} ${describeTrigger(draft.trigger)} → …`}</p>
                </div>
              </section>
            </div>

            <div className="na-drawer__foot">
              <button type="button" className="na-btn" onClick={() => setDraft(null)}>
                {copy.cancel}
              </button>
              <button type="button" className="na-btn na-btn--primary" disabled={!draftReady} onClick={commitDraft}>
                <Check size={15} strokeWidth={2.4} />
                {copy.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div key={toast.id} className={`na-toast${toast.bad ? " is-bad" : ""}`} role="status">
          <Logo size={22} mood={toast.bad ? "error" : "done"} />
          {toast.text}
        </div>
      )}
    </div>
  );
}

function TriggerFields({ trigger, onChange }: { trigger: Trigger; onChange: (trigger: Trigger) => void }) {
  const copy = useTranslation().automations;
  switch (trigger.kind) {
    case "time":
      return (
        <div className="na-fields">
          <input className="na-input na-input--short" type="time" value={trigger.time} aria-label={copy.fields.time} onChange={(event) => onChange({ ...trigger, time: event.currentTarget.value })} />
          <div className="na-days" role="group" aria-label={copy.fields.days}>
            {copy.weekdays.map((label, day) => {
              const on = !trigger.days || trigger.days.length === 0 || trigger.days.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  className={`na-day${on ? " is-on" : ""}`}
                  aria-pressed={on}
                  onClick={() => {
                    const current = trigger.days && trigger.days.length > 0 ? trigger.days : [0, 1, 2, 3, 4, 5, 6];
                    const next = current.includes(day) ? current.filter((item) => item !== day) : [...current, day].sort();
                    if (next.length === 0) return;
                    onChange({ ...trigger, days: next.length === 7 ? [] : next });
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      );
    case "battery":
      return (
        <div className="na-fields">
          <span>{copy.fields.below}</span>
          <input type="range" min={5} max={95} step={5} value={trigger.below} aria-label={copy.fields.below} onChange={(event) => onChange({ ...trigger, below: Number(event.currentTarget.value) })} />
          <span className="na-value">{trigger.below}%</span>
        </div>
      );
    case "wifi":
      return (
        <div className="na-fields">
          <input className="na-input" value={trigger.ssid} placeholder={copy.fields.ssid} aria-label={copy.fields.ssid} onChange={(event) => onChange({ ...trigger, ssid: event.currentTarget.value })} />
        </div>
      );
    case "app":
      return (
        <div className="na-fields">
          <input className="na-input" value={trigger.app} placeholder={copy.fields.app} aria-label={copy.fields.app} onChange={(event) => onChange({ ...trigger, app: event.currentTarget.value })} />
        </div>
      );
    case "idle":
      return (
        <div className="na-fields">
          <input type="range" min={1} max={120} value={trigger.minutes} aria-label={copy.fields.minutes} onChange={(event) => onChange({ ...trigger, minutes: Number(event.currentTarget.value) })} />
          <span className="na-value">{trigger.minutes} min</span>
        </div>
      );
    default:
      return null;
  }
}

function ActionFields({ action, onChange }: { action: Action; onChange: (action: Action) => void }) {
  const copy = useTranslation().automations;
  switch (action.kind) {
    case "music":
      return <input className="na-input" value={action.query} placeholder={copy.fields.query} aria-label={copy.fields.query} onChange={(event) => onChange({ ...action, query: event.currentTarget.value })} />;
    case "volume":
      return (
        <div className="na-fields">
          <input type="range" min={0} max={100} value={action.level} aria-label={copy.fields.level} onChange={(event) => onChange({ ...action, level: Number(event.currentTarget.value) })} />
          <span className="na-value">{action.level}%</span>
        </div>
      );
    case "open":
      return <input className="na-input" value={action.app} placeholder={copy.fields.app} aria-label={copy.fields.app} onChange={(event) => onChange({ ...action, app: event.currentTarget.value })} />;
    case "url":
      return <input className="na-input" value={action.url} placeholder={copy.fields.url} aria-label={copy.fields.url} onChange={(event) => onChange({ ...action, url: event.currentTarget.value })} />;
    case "notify":
    case "say":
      return <input className="na-input" value={action.text} placeholder={copy.fields.text} aria-label={copy.fields.text} onChange={(event) => onChange({ ...action, text: event.currentTarget.value })} />;
    case "claude":
      return <input className="na-input" value={action.prompt} placeholder={copy.fields.prompt} aria-label={copy.fields.prompt} onChange={(event) => onChange({ ...action, prompt: event.currentTarget.value })} />;
    case "macro":
      return <input className="na-input" value={action.name} placeholder={copy.fields.macro} aria-label={copy.fields.macro} onChange={(event) => onChange({ ...action, name: event.currentTarget.value })} />;
    case "dark":
      return <OnOff on={action.on} onChange={(on) => onChange({ ...action, on })} />;
    case "ac":
      return (
        <div className="na-fields">
          <OnOff on={action.on} onChange={(on) => onChange({ ...action, on })} />
          {action.on && (
            <>
              <input type="range" min={16} max={30} value={action.temperature ?? 23} aria-label={copy.fields.temperature} onChange={(event) => onChange({ ...action, temperature: Number(event.currentTarget.value) })} />
              <span className="na-value">{action.temperature ?? 23}°</span>
            </>
          )}
        </div>
      );
    case "routine":
      return (
        <div className="na-seg na-seg--small">
          {(["start", "end"] as const).map((routine) => (
            <button key={routine} type="button" className={action.routine === routine ? "is-on" : ""} onClick={() => onChange({ ...action, routine })}>
              {routine === "start" ? copy.fields.routineStart : copy.fields.routineEnd}
            </button>
          ))}
        </div>
      );
    default:
      return null;
  }
}

function OnOff({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const copy = useTranslation().automations;
  return (
    <div className="na-seg na-seg--small">
      <button type="button" className={on ? "is-on" : ""} onClick={() => onChange(true)}>
        {copy.fields.on}
      </button>
      <button type="button" className={on ? "" : "is-on"} onClick={() => onChange(false)}>
        {copy.fields.off}
      </button>
    </div>
  );
}
