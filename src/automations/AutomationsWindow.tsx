import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowRight, ArrowUp, Check, ClockCounterClockwise, Copy, Lightbulb, Lightning, LockSimple, MagicWand, MagnifyingGlass, PencilSimple, Play, Plus, Stack, Trash, X } from "@phosphor-icons/react";
import { useTranslation } from "../i18n";
import { actionsOf, parseRule, parseRules, parseRunLog, RULES_KEY, RULES_LOG_KEY, type Action, type Rule, type RuleRun, type Trigger } from "../rules/rules";
import { ACTION_KINDS, actionReady, defaultAction, defaultTrigger, RECIPES, ruleFromParts, TRIGGER_KINDS, triggerReady, type Recipe } from "./catalog";
import { Mascot } from "../mascot/Mascot";
import { ACTION_GLYPHS, TRIGGER_GLYPHS, type Glyph } from "./kindIcons";
import { appName, pending, titleOf, type LearnState, type Suggestion } from "./learn";
import { activityOff, LEARN_OPEN_KEY, loadSuggestions, readLearnState, writeLearnState } from "./learnClient";
import "./Automations.css";

type Section = "ideas" | "mine" | "recipes" | "history";
type Filter = "all" | "on" | "off";
type Draft = { id: string | null; name: string; trigger: Trigger; actions: Action[]; suggestion?: string };

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
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [learnState, setLearnState] = useState<LearnState>(readLearnState);
  const toastTimer = useRef(0);
  const win = isTauri() ? getCurrentWindow() : null;
  const learnCopy = t.learn;

  useEffect(() => {
    let cancelled = false;
    void loadSuggestions(learnCopy)
      .then((found) => !cancelled && setSuggestions(found))
      .catch(() => !cancelled && setSuggestions([]));
    return () => {
      cancelled = true;
    };
  }, [learnCopy]);

  useEffect(() => {
    const openIdeas = () => {
      try {
        if (window.localStorage.getItem(LEARN_OPEN_KEY) !== "1") return;
        window.localStorage.removeItem(LEARN_OPEN_KEY);
      } catch {
        return;
      }
      setSection("ideas");
    };
    openIdeas();
    const onStorage = (event: StorageEvent) => {
      if (event.key === LEARN_OPEN_KEY) openIdeas();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

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
    if (draft.suggestion) markIdea(draft.suggestion, "accepted");
    notify(draft.id ? copy.saved : copy.added);
    setDraft(null);
    setSection("mine");
  };

  const markIdea = (id: string, value: "accepted" | "dismissed") => {
    const next = { ...learnState, [id]: value };
    setLearnState(next);
    writeLearnState(next);
  };

  const ideaTitle = (idea: Suggestion) => titleOf(idea, learnCopy.titles);

  const ideaReason = (idea: Suggestion) => {
    const names = learnCopy.list(idea.apps.map(appName));
    switch (idea.kind) {
      case "morning":
        return learnCopy.reasons.morning(names, idea.hits, idea.total);
      case "followup":
        return learnCopy.reasons.followup(appName(idea.apps[0]), appName(idea.apps[1]), idea.hits, idea.total);
      case "endOfDay": {
        const [hours, minutes] = idea.trigger.kind === "time" ? idea.trigger.time.split(":").map(Number) : [18, 0];
        const total = hours * 60 + minutes + 10;
        return learnCopy.reasons.endOfDay(`${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`, idea.hits, idea.total);
      }
      case "night":
        return learnCopy.reasons.night(idea.hits, idea.total);
      case "meeting":
        return learnCopy.reasons.meeting(names, idea.hits);
    }
  };

  const acceptIdea = (idea: Suggestion) => {
    save([{ ...ruleFromParts(idea.trigger, idea.actions, sentenceOf(idea.trigger, idea.actions), ideaTitle(idea)), id: newId(), enabled: true }, ...rules]);
    markIdea(idea.id, "accepted");
    notify(copy.added);
  };

  const dismissIdea = (idea: Suggestion) => {
    markIdea(idea.id, "dismissed");
    notify(learnCopy.dismissed);
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

  const ideas = suggestions ? pending(suggestions, rules, learnState) : [];
  const nav: { id: Section; icon: typeof Lightning; label: string; count?: number; fresh?: boolean }[] = [
    { id: "ideas", icon: Lightbulb, label: learnCopy.section, count: ideas.length, fresh: ideas.length > 0 },
    { id: "mine", icon: Lightning, label: copy.mine, count: rules.length },
    { id: "recipes", icon: Stack, label: copy.recipes, count: RECIPES.length },
    { id: "history", icon: ClockCounterClockwise, label: copy.history, count: log.length },
  ];

  const openNew = (trigger: Trigger = defaultTrigger("focusStart"), actions: Action[] = []) => {
    setPicking(actions.length === 0);
    setDraft({ id: null, name: "", trigger, actions });
  };

  return (
    <div className="na">
      <header className="na-top" data-tauri-drag-region>
        <button type="button" className="na-top__close" aria-label={copy.close} title={copy.close} onClick={() => void win?.close()}>
          <X size={15} />
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
                <item.icon size={15} />
              </span>
              <span className="na-nav__label">{item.label}</span>
              {!!item.count && <span className={`na-nav__count${item.fresh ? " is-fresh" : ""}`}>{item.count}</span>}
            </button>
          ))}
        </nav>
        <button type="button" className="na-side__new" onClick={() => openNew()}>
          <Plus size={15} />
          <span>{copy.newOne}</span>
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
        {section === "ideas" && (
          <div className="na-page" key="ideas">
            <div className="na-hero">
              <div>
                <h1>{learnCopy.section}</h1>
                <p>{learnCopy.hint}</p>
              </div>
            </div>
            {activityOff() ? (
              <div className="na-empty">
                <Logo size={76} mood="sleeping" />
                <strong>{learnCopy.off}</strong>
                <span>{learnCopy.offHint}</span>
              </div>
            ) : suggestions !== null && ideas.length === 0 ? (
              <div className="na-empty">
                <Logo size={76} mood="sleeping" />
                <strong>{learnCopy.empty}</strong>
                <span>{learnCopy.emptyHint}</span>
              </div>
            ) : (
              <ul className="na-ideas">
                {ideas.map((idea) => {
                  const sure = idea.hits / Math.max(1, idea.total);
                  const level = sure >= 0.85 ? 3 : sure >= 0.65 ? 2 : 1;
                  return (
                    <li key={idea.id} className="na-idea">
                      <div className="na-idea__head">
                        <GlyphTile glyph={TRIGGER_GLYPHS[idea.trigger.kind]} size={40} />
                        <div className="na-idea__text">
                          <strong>{ideaTitle(idea)}</strong>
                          <p>{ideaReason(idea)}</p>
                        </div>
                        <span className="na-idea__sure" title={`${learnCopy.sure}: ${Math.round(sure * 100)}%`}>
                          {[1, 2, 3].map((dot) => (
                            <i key={dot} className={dot <= level ? "is-on" : ""} />
                          ))}
                        </span>
                      </div>
                      <div className="na-idea__flow">
                        <span className="na-idea__step">
                          <GlyphTile glyph={TRIGGER_GLYPHS[idea.trigger.kind]} size={22} />
                          {describeTrigger(idea.trigger)}
                        </span>
                        <ArrowRight size={14} className="na-idea__arrow" />
                        {idea.actions.map((action, index) => (
                          <span key={index} className="na-idea__step">
                            <GlyphTile glyph={ACTION_GLYPHS[action.kind]} size={22} />
                            {describeAction(action)}
                          </span>
                        ))}
                      </div>
                      <div className="na-idea__actions">
                        <button type="button" className="na-btn na-btn--primary" onClick={() => acceptIdea(idea)}>
                          <Check size={15} weight="bold" />
                          {learnCopy.activate}
                        </button>
                        <button
                          type="button"
                          className="na-btn"
                          onClick={() => {
                            setPicking(false);
                            setDraft({ id: null, name: ideaTitle(idea), trigger: idea.trigger, actions: idea.actions, suggestion: idea.id });
                          }}
                        >
                          {learnCopy.adjust}
                        </button>
                        <button type="button" className="na-link" onClick={() => dismissIdea(idea)}>
                          {learnCopy.later}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="na-privacy">
              <LockSimple size={13} />
              {learnCopy.privacy}
            </p>
          </div>
        )}

        {section === "mine" && (
          <div className="na-page" key="mine">
            <div className="na-hero">
              <div>
                <h1>{copy.mine}</h1>
                <p>{copy.mineHint}</p>
              </div>
              <button type="button" className="na-btn na-btn--primary" onClick={() => openNew()}>
                <Plus size={15} />
                {copy.newOne}
              </button>
            </div>

            {ideas.length > 0 && (
              <button type="button" className="na-banner" onClick={() => setSection("ideas")}>
                <Lightbulb size={18} weight="duotone" />
                <span>{learnCopy.banner(ideas.length)}</span>
                <em>
                  {learnCopy.see}
                  <ArrowRight size={13} />
                </em>
              </button>
            )}

            <form
              className="na-magic"
              onSubmit={(event) => {
                event.preventDefault();
                addSentence();
              }}
            >
              <MagicWand size={16} className="na-magic__icon" />
              <input value={sentence} placeholder={copy.sentencePlaceholder} aria-label={copy.sentencePlaceholder} onChange={(event) => setSentence(event.currentTarget.value)} />
              <button type="submit" className="na-magic__go" disabled={!sentence.trim()} aria-label={copy.sentenceAdd} title={copy.sentenceAdd}>
                <ArrowUp size={15} />
              </button>
            </form>

            {rules.length > 0 && (
              <div className="na-toolbar">
                <div className="na-seg">
                  {(["all", "on", "off"] as Filter[]).map((item) => (
                    <button key={item} type="button" aria-pressed={filter === item} className={filter === item ? "is-on" : ""} onClick={() => setFilter(item)}>
                      {item === "all" ? copy.filterAll : item === "on" ? copy.filterOn : copy.filterOff}
                    </button>
                  ))}
                </div>
                <label className="na-search">
                  <MagnifyingGlass size={14} />
                  <input value={query} placeholder={copy.search} aria-label={copy.search} onChange={(event) => setQuery(event.currentTarget.value)} />
                </label>
              </div>
            )}

            {rules.length === 0 ? (
              <div className="na-empty">
                <Logo size={80} mood="sleeping" />
                <strong>{copy.empty}</strong>
                <span>{copy.emptyHint}</span>
                <div className="na-empty__actions">
                  <button type="button" className="na-btn na-btn--primary" onClick={() => openNew()}>
                    <Plus size={15} />
                    {copy.newOne}
                  </button>
                  <button type="button" className="na-btn" onClick={() => setSection("recipes")}>
                    {copy.seeRecipes}
                  </button>
                </div>
              </div>
            ) : visible.length === 0 ? (
              <div className="na-empty na-empty--small">
                <span>{copy.noMatch}</span>
              </div>
            ) : (
              <ul className="na-list">
                {visible.map((rule) => {
                  const run = lastRun.get(rule.id);
                  const actions = actionsOf(rule);
                  const title = rule.name || describeTrigger(rule.trigger);
                  const then = actions.map(describeAction).join(", ");
                  return (
                    <li key={rule.id} className={`na-row${rule.enabled ? "" : " is-off"}`}>
                      <GlyphTile glyph={TRIGGER_GLYPHS[rule.trigger.kind]} size={38} />
                      <div className="na-row__text">
                        <strong>{title}</strong>
                        <span className="na-row__then">
                          <span className="na-row__minis" aria-hidden="true">
                            {actions.map((action, index) => (
                              <GlyphTile key={index} glyph={ACTION_GLYPHS[action.kind]} size={18} />
                            ))}
                          </span>
                          <span className="na-row__sentence">{rule.name ? `${describeTrigger(rule.trigger)} → ${then}` : then}</span>
                        </span>
                      </div>
                      <span className={`na-row__last${run && !run.ok ? " is-bad" : ""}`}>{run ? `${run.ok ? copy.ran : copy.failed} ${relative(run.at)}` : copy.never}</span>
                      <div className="na-row__tools">
                        <button type="button" className="na-tool" title={copy.test} aria-label={copy.test} onClick={() => test(rule)}>
                          <Play size={14} />
                        </button>
                        <button
                          type="button"
                          className="na-tool"
                          title={copy.edit}
                          aria-label={copy.edit}
                          onClick={() => {
                            setPicking(false);
                            setDraft({ id: rule.id, name: rule.name ?? "", trigger: rule.trigger, actions });
                          }}
                        >
                          <PencilSimple size={14} />
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
                          <Copy size={14} />
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
                          <Trash size={14} />
                        </button>
                      </div>
                      <label className="na-switch" title={copy.enabled}>
                        <input type="checkbox" checked={rule.enabled} aria-label={copy.enabled} onChange={() => save(rules.map((item) => (item.id === rule.id ? { ...item, enabled: !item.enabled } : item)))} />
                        <span />
                      </label>
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
            <ul className="na-gallery">
              {RECIPES.map((recipe) => {
                const local = localRecipe(recipe);
                const glyph = TRIGGER_GLYPHS[recipe.trigger.kind];
                const added = rules.some((rule) => sameFlow(rule, recipe.trigger, recipe.actions));
                return (
                  <li key={recipe.id} className="na-shortcut">
                    <button type="button" className="na-shortcut__open" aria-label={`${copy.customize}: ${copy.recipeTitles[recipe.id]}`} onClick={() => openNew(local.trigger, local.actions)} />
                    <div className="na-shortcut__top">
                      <GlyphTile glyph={glyph} size={40} />
                      <span className="na-shortcut__minis">
                        {local.actions.map((action, index) => {
                          const Icon = ACTION_GLYPHS[action.kind].icon;
                          return <Icon key={index} size={15} weight="duotone" />;
                        })}
                      </span>
                      {added ? (
                        <span className="na-shortcut__add is-added" title={copy.alreadyAdded} aria-label={copy.alreadyAdded}>
                          <Check size={15} weight="bold" />
                        </span>
                      ) : (
                        <button type="button" className="na-shortcut__add" title={copy.use} aria-label={`${copy.use}: ${copy.recipeTitles[recipe.id]}`} onClick={() => addRecipe(recipe)}>
                          <Plus size={16} weight="bold" />
                        </button>
                      )}
                    </div>
                    <div className="na-shortcut__text">
                      <strong>{copy.recipeTitles[recipe.id]}</strong>
                      <span>
                        {describeTrigger(local.trigger)} → {local.actions.map(describeAction).join(", ")}
                      </span>
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
                <Logo size={76} mood="sleeping" />
                <strong>{copy.historyEmpty}</strong>
                <span>{copy.historyEmptyHint}</span>
              </div>
            ) : (
              groups.map((group) => (
                <section key={group.label} className="na-day-group">
                  <h2>{group.label}</h2>
                  <ul className="na-list">
                    {group.runs.map((run) => {
                      const rule = ruleOf(run.ruleId);
                      return (
                        <li key={run.id} className="na-row na-row--run">
                          {rule ? <GlyphTile glyph={TRIGGER_GLYPHS[rule.trigger.kind]} size={30} /> : <span className="na-glyph na-glyph--empty" />}
                          <div className="na-row__text">
                            <strong>{run.name}</strong>
                            {run.error && <span className="na-row__error">{run.error}</span>}
                          </div>
                          <span className={`na-status${run.ok ? "" : " is-bad"}`}>{run.ok ? copy.ran : copy.failed}</span>
                          <span className="na-row__time">{clock(run.at)}</span>
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
              <h2>{draft.id ? copy.edit : copy.newOne}</h2>
              <button type="button" className="na-tool" aria-label={copy.cancel} onClick={() => setDraft(null)}>
                <X size={15} />
              </button>
            </div>

            <div className="na-drawer__body">
              <section className="na-step">
                <h3>{copy.pickTrigger}</h3>
                <div className="na-tiles">
                  {TRIGGER_KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={`na-tile${draft.trigger.kind === kind ? " is-on" : ""}`}
                      aria-pressed={draft.trigger.kind === kind}
                      onClick={() => setDraft({ ...draft, trigger: draft.trigger.kind === kind ? draft.trigger : defaultTrigger(kind) })}
                    >
                      <GlyphTile glyph={TRIGGER_GLYPHS[kind]} size={30} />
                      <span>{copy.triggers[kind]}</span>
                    </button>
                  ))}
                </div>
                <TriggerFields trigger={draft.trigger} onChange={(trigger) => setDraft({ ...draft, trigger })} />
              </section>

              <section className="na-step">
                <h3>{copy.pickActions}</h3>
                {draft.actions.length > 0 && (
                  <ol className="na-list na-steps">
                    {draft.actions.map((action, index) => (
                      <li key={index} className="na-action">
                        <GlyphTile glyph={ACTION_GLYPHS[action.kind]} size={30} />
                        <div className="na-action__body">
                          <strong>{copy.actions[action.kind]}</strong>
                          <ActionFields action={action} onChange={(next) => setDraft({ ...draft, actions: draft.actions.map((item, position) => (position === index ? next : item)) })} />
                        </div>
                        <button type="button" className="na-tool na-tool--danger" aria-label={copy.remove} onClick={() => setDraft({ ...draft, actions: draft.actions.filter((_, position) => position !== index) })}>
                          <Trash size={14} />
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
                {draft.actions.length < 5 &&
                  (picking ? (
                    <div className="na-picker">
                      {ACTION_KINDS.map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          className="na-picker__item"
                          onClick={() => {
                            setDraft({ ...draft, actions: [...draft.actions, defaultAction(kind)] });
                            setPicking(false);
                          }}
                        >
                          <GlyphTile glyph={ACTION_GLYPHS[kind]} size={26} />
                          {copy.actions[kind]}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <button type="button" className="na-add" onClick={() => setPicking(true)}>
                      <Plus size={15} />
                      {copy.addAction}
                    </button>
                  ))}
              </section>

              <section className="na-step">
                <h3>{copy.finish}</h3>
                <input className="na-input" value={draft.name} placeholder={copy.namePlaceholder} aria-label={copy.name} onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })} />
                <p className="na-preview">{draft.actions.length > 0 ? sentenceOf(draft.trigger, draft.actions) : `${copy.when} ${describeTrigger(draft.trigger)} → …`}</p>
              </section>
            </div>

            <div className="na-drawer__foot">
              <button type="button" className="na-btn" onClick={() => setDraft(null)}>
                {copy.cancel}
              </button>
              <button type="button" className="na-btn na-btn--primary" disabled={!draftReady} onClick={commitDraft}>
                {copy.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div key={toast.id} className={`na-toast${toast.bad ? " is-bad" : ""}`} role="status">
          <Logo size={20} mood={toast.bad ? "error" : "done"} />
          {toast.text}
        </div>
      )}
    </div>
  );
}

function GlyphTile({ glyph, size }: { glyph: Glyph; size: number }) {
  const Icon = glyph.icon;
  return (
    <span className="na-glyph" style={{ width: size, height: size }} aria-hidden="true">
      <Icon size={Math.round(size * 0.56)} weight="duotone" />
    </span>
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
