import { useEffect, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { History, Play, Plus, Sparkles, Trash2, Wand2, X, Zap } from "lucide-react";
import { useTranslation } from "../i18n";
import { actionsOf, parseRule, parseRules, parseRunLog, RULES_KEY, RULES_LOG_KEY, type Action, type Rule, type RuleRun, type Trigger } from "../rules/rules";
import { ACTION_KINDS, actionReady, defaultAction, defaultTrigger, RECIPES, ruleFromParts, TRIGGER_COLORS, TRIGGER_KINDS, triggerReady } from "./catalog";
import "./Automations.css";

type Section = "mine" | "recipes" | "history";
type Draft = { id: string | null; name: string; trigger: Trigger; actions: Action[] };

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

export default function AutomationsWindow() {
  const t = useTranslation();
  const copy = t.automations;
  const [section, setSection] = useState<Section>("mine");
  const [rules, setRules] = useState<Rule[]>(readRules);
  const [log, setLog] = useState<RuleRun[]>(readLog);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sentence, setSentence] = useState("");
  const [notice, setNotice] = useState("");
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

  const save = (next: Rule[]) => {
    setRules(next);
    writeRules(next);
  };

  const days = (list?: number[]) =>
    !list || list.length === 0 || list.length === 7 ? copy.everyDay : list.length === 5 && [1, 2, 3, 4, 5].every((day) => list.includes(day)) ? copy.weekdaysLabel : list.map((day) => copy.weekdays[day]).join(", ");

  const describeTrigger = (trigger: Trigger) => {
    const label = copy.triggers[trigger.kind];
    switch (trigger.kind) {
      case "time":
        return `${label} · ${trigger.time} · ${days(trigger.days)}`;
      case "battery":
        return `${label} · ≤ ${trigger.below}%`;
      case "wifi":
        return `${label} · ${trigger.ssid}`;
      case "app":
        return `${label} · ${trigger.app}`;
      case "idle":
        return `${label} · ${trigger.minutes} min`;
      default:
        return label;
    }
  };

  const describeAction = (action: Action) => {
    const label = copy.actions[action.kind];
    switch (action.kind) {
      case "music":
        return action.query ? `${label} · ${action.query}` : label;
      case "volume":
        return `${label} · ${action.level}%`;
      case "open":
        return `${label} · ${action.app}`;
      case "url":
        return `${label} · ${action.url}`;
      case "notify":
      case "say":
        return `${label} · “${action.text}”`;
      case "claude":
        return `${label} · “${action.prompt}”`;
      case "macro":
        return `${label} · ${action.name}`;
      case "dark":
        return `${label} · ${action.on ? copy.fields.on : copy.fields.off}`;
      case "ac":
        return `${label} · ${action.on ? `${action.temperature ?? ""}°` : copy.fields.off}`;
      case "routine":
        return `${label} · ${action.routine === "start" ? copy.fields.routineStart : copy.fields.routineEnd}`;
      default:
        return label;
    }
  };

  const sentenceOf = (trigger: Trigger, actions: Action[]) => `${copy.when} ${describeTrigger(trigger)} → ${actions.map(describeAction).join(" + ")}`;

  const commitDraft = () => {
    if (!draft) return;
    const parts = ruleFromParts(draft.trigger, draft.actions, sentenceOf(draft.trigger, draft.actions), draft.name.trim() || undefined);
    const next = draft.id ? rules.map((rule) => (rule.id === draft.id ? { ...rule, ...parts } : rule)) : [...rules, { ...parts, id: Date.now().toString(36), enabled: true }];
    save(next);
    setDraft(null);
    setSection("mine");
  };

  const addSentence = () => {
    const parsed = parseRule(sentence, null);
    if (!parsed) {
      setNotice(copy.sentenceBad);
      return;
    }
    save([...rules, { ...parsed, id: Date.now().toString(36), enabled: true }]);
    setSentence("");
    setNotice(copy.added);
  };

  const test = (rule: Rule) => {
    if (isTauri()) void emitTo("main", "rules-test", rule.id).catch(() => {});
    setNotice(copy.testing(rule.name || describeTrigger(rule.trigger)));
  };

  const lastRun = useMemo(() => {
    const map = new Map<string, RuleRun>();
    for (const run of log) if (!map.has(run.ruleId)) map.set(run.ruleId, run);
    return map;
  }, [log]);

  const draftReady = draft !== null && triggerReady(draft.trigger) && draft.actions.length > 0 && draft.actions.every(actionReady);
  const time = (at: number) => new Date(at).toLocaleString(t.localeTag, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="na">
      <header className="na-top" data-tauri-drag-region>
        <span className="na-top__brand" data-tauri-drag-region>
          <Zap size={15} strokeWidth={2.6} />
          {copy.title}
        </span>
        <button type="button" className="na-top__close" aria-label={copy.close} title={copy.close} onClick={() => void win?.close()}>
          <X size={14} strokeWidth={2.6} />
        </button>
      </header>
      <aside className="na-side">
        {(["mine", "recipes", "history"] as Section[]).map((item) => {
          const Icon = item === "mine" ? Zap : item === "recipes" ? Sparkles : History;
          return (
            <button key={item} type="button" className={`na-side__item${section === item ? " na-side__item--on" : ""}`} onClick={() => setSection(item)}>
              <Icon size={15} strokeWidth={2.3} />
              <span>{copy[item]}</span>
              {item === "mine" && rules.length > 0 && <em>{rules.length}</em>}
            </button>
          );
        })}
      </aside>
      <main className="na-main">
        {notice && (
          <div className="na-notice" role="status" onAnimationEnd={() => setNotice("")}>
            {notice}
          </div>
        )}
        {section === "mine" && (
          <>
            <div className="na-head">
              <h1>{copy.mine}</h1>
              <button type="button" className="na-button na-button--primary" onClick={() => setDraft({ id: null, name: "", trigger: defaultTrigger("focusStart"), actions: [defaultAction("say")] })}>
                <Plus size={14} strokeWidth={2.8} />
                {copy.newOne}
              </button>
            </div>
            <form
              className="na-sentence"
              onSubmit={(event) => {
                event.preventDefault();
                addSentence();
              }}
            >
              <Wand2 size={15} strokeWidth={2.3} />
              <input value={sentence} placeholder={copy.sentencePlaceholder} aria-label={copy.sentencePlaceholder} onChange={(event) => setSentence(event.currentTarget.value)} />
              <button type="submit" className="na-button" disabled={!sentence.trim()}>
                {copy.sentenceAdd}
              </button>
            </form>
            {rules.length === 0 ? (
              <div className="na-empty">
                <Zap size={28} strokeWidth={2} />
                <strong>{copy.empty}</strong>
                <span>{copy.emptyHint}</span>
              </div>
            ) : (
              <ul className="na-list">
                {rules.map((rule) => {
                  const run = lastRun.get(rule.id);
                  return (
                    <li key={rule.id} className={`na-card${rule.enabled ? "" : " na-card--off"}`}>
                      <div className="na-card__flow">
                        <span className="na-chip na-chip--when" style={{ ["--chip" as string]: TRIGGER_COLORS[rule.trigger.kind] ?? "#8e8e93" }}>
                          <b>{copy.when}</b>
                          {describeTrigger(rule.trigger)}
                        </span>
                        <span className="na-card__arrow">→</span>
                        {actionsOf(rule).map((action, index) => (
                          <span key={index} className="na-chip">
                            {describeAction(action)}
                          </span>
                        ))}
                      </div>
                      <div className="na-card__foot">
                        <span className="na-card__meta">{rule.name ? `${rule.name} · ` : ""}{run ? `${run.ok ? copy.ran : copy.failed} ${time(run.at)}` : copy.never}</span>
                        <label className="na-switch" title={copy.enabled}>
                          <input type="checkbox" checked={rule.enabled} onChange={() => save(rules.map((item) => (item.id === rule.id ? { ...item, enabled: !item.enabled } : item)))} />
                          <span />
                        </label>
                        <button type="button" className="na-icon" title={copy.test} aria-label={copy.test} onClick={() => test(rule)}>
                          <Play size={13} strokeWidth={2.6} />
                        </button>
                        <button type="button" className="na-icon" title={copy.edit} aria-label={copy.edit} onClick={() => setDraft({ id: rule.id, name: rule.name ?? "", trigger: rule.trigger, actions: actionsOf(rule) })}>
                          <Wand2 size={13} strokeWidth={2.4} />
                        </button>
                        <button type="button" className="na-icon na-icon--danger" title={copy.remove} aria-label={copy.remove} onClick={() => save(rules.filter((item) => item.id !== rule.id))}>
                          <Trash2 size={13} strokeWidth={2.4} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
        {section === "recipes" && (
          <>
            <div className="na-head">
              <h1>{copy.recipes}</h1>
            </div>
            <ul className="na-grid">
              {RECIPES.map((recipe) => (
                <li key={recipe.id} className="na-recipe" style={{ ["--chip" as string]: TRIGGER_COLORS[recipe.trigger.kind] }}>
                  <span className="na-recipe__when">{describeTrigger(recipe.trigger)}</span>
                  <span className="na-recipe__then">{recipe.actions.map(describeAction).join(" + ")}</span>
                  <button
                    type="button"
                    className="na-button"
                    onClick={() => {
                      save([...rules, { ...ruleFromParts(recipe.trigger, recipe.actions, sentenceOf(recipe.trigger, recipe.actions)), id: Date.now().toString(36), enabled: true }]);
                      setNotice(copy.added);
                    }}
                  >
                    <Plus size={13} strokeWidth={2.8} />
                    {copy.use}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {section === "history" && (
          <>
            <div className="na-head">
              <h1>{copy.history}</h1>
            </div>
            {log.length === 0 ? (
              <div className="na-empty">
                <History size={28} strokeWidth={2} />
                <strong>{copy.historyEmpty}</strong>
              </div>
            ) : (
              <ul className="na-history">
                {log.map((run) => (
                  <li key={run.id}>
                    <i className={run.ok ? "na-dot na-dot--ok" : "na-dot na-dot--bad"} />
                    <span className="na-history__name">{run.name}</span>
                    <span className="na-history__time">{time(run.at)}</span>
                    {run.error && <span className="na-history__error">{run.error}</span>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
      {draft && (
        <div className="na-sheet" role="dialog" aria-label={copy.newOne}>
          <div className="na-sheet__panel">
            <div className="na-head">
              <h1>{draft.id ? copy.edit : copy.newOne}</h1>
              <button type="button" className="na-icon" aria-label={copy.cancel} onClick={() => setDraft(null)}>
                <X size={14} strokeWidth={2.6} />
              </button>
            </div>
            <label className="na-label">{copy.when}</label>
            <div className="na-tiles">
              {TRIGGER_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`na-tile${draft.trigger.kind === kind ? " na-tile--on" : ""}`}
                  style={{ ["--chip" as string]: TRIGGER_COLORS[kind] }}
                  onClick={() => setDraft({ ...draft, trigger: draft.trigger.kind === kind ? draft.trigger : defaultTrigger(kind) })}
                >
                  {copy.triggers[kind]}
                </button>
              ))}
            </div>
            <TriggerFields trigger={draft.trigger} onChange={(trigger) => setDraft({ ...draft, trigger })} />
            <label className="na-label">{copy.then}</label>
            {draft.actions.map((action, index) => (
              <div key={index} className="na-action">
                <select
                  value={action.kind}
                  aria-label={copy.then}
                  onChange={(event) => setDraft({ ...draft, actions: draft.actions.map((item, position) => (position === index ? defaultAction(event.currentTarget.value as Action["kind"]) : item)) })}
                >
                  {ACTION_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {copy.actions[kind]}
                    </option>
                  ))}
                </select>
                <ActionFields action={action} onChange={(next) => setDraft({ ...draft, actions: draft.actions.map((item, position) => (position === index ? next : item)) })} />
                {draft.actions.length > 1 && (
                  <button type="button" className="na-icon na-icon--danger" aria-label={copy.remove} onClick={() => setDraft({ ...draft, actions: draft.actions.filter((_, position) => position !== index) })}>
                    <Trash2 size={13} strokeWidth={2.4} />
                  </button>
                )}
              </div>
            ))}
            {draft.actions.length < 5 && (
              <button type="button" className="na-button na-button--ghost" onClick={() => setDraft({ ...draft, actions: [...draft.actions, defaultAction("notify")] })}>
                <Plus size={13} strokeWidth={2.8} />
                {copy.addAction}
              </button>
            )}
            <label className="na-label">{copy.name}</label>
            <input className="na-input" value={draft.name} placeholder={copy.namePlaceholder} onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })} />
            <p className="na-preview">{sentenceOf(draft.trigger, draft.actions)}</p>
            <div className="na-sheet__actions">
              <button type="button" className="na-button na-button--ghost" onClick={() => setDraft(null)}>
                {copy.cancel}
              </button>
              <button type="button" className="na-button na-button--primary" disabled={!draftReady} onClick={commitDraft}>
                {copy.save}
              </button>
            </div>
          </div>
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
                  className={`na-day${on ? " na-day--on" : ""}`}
                  aria-pressed={on}
                  onClick={() => {
                    const current = trigger.days && trigger.days.length > 0 ? trigger.days : [0, 1, 2, 3, 4, 5, 6];
                    const next = current.includes(day) ? current.filter((item) => item !== day) : [...current, day].sort();
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
          <input className="na-input na-input--short" type="number" min={5} max={95} value={trigger.below} onChange={(event) => onChange({ ...trigger, below: Number(event.currentTarget.value) || 20 })} />
          <span>%</span>
        </div>
      );
    case "wifi":
      return <input className="na-input" value={trigger.ssid} placeholder={copy.fields.ssid} onChange={(event) => onChange({ ...trigger, ssid: event.currentTarget.value })} />;
    case "app":
      return <input className="na-input" value={trigger.app} placeholder={copy.fields.app} onChange={(event) => onChange({ ...trigger, app: event.currentTarget.value })} />;
    case "idle":
      return (
        <div className="na-fields">
          <input className="na-input na-input--short" type="number" min={1} max={240} value={trigger.minutes} onChange={(event) => onChange({ ...trigger, minutes: Number(event.currentTarget.value) || 10 })} />
          <span>{copy.fields.minutes}</span>
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
      return <input className="na-input" value={action.query} placeholder={copy.fields.query} onChange={(event) => onChange({ ...action, query: event.currentTarget.value })} />;
    case "volume":
      return (
        <div className="na-fields">
          <input type="range" min={0} max={100} value={action.level} aria-label={copy.fields.level} onChange={(event) => onChange({ ...action, level: Number(event.currentTarget.value) })} />
          <span className="na-value">{action.level}%</span>
        </div>
      );
    case "open":
      return <input className="na-input" value={action.app} placeholder={copy.fields.app} onChange={(event) => onChange({ ...action, app: event.currentTarget.value })} />;
    case "url":
      return <input className="na-input" value={action.url} placeholder={copy.fields.url} onChange={(event) => onChange({ ...action, url: event.currentTarget.value })} />;
    case "notify":
    case "say":
      return <input className="na-input" value={action.text} placeholder={copy.fields.text} onChange={(event) => onChange({ ...action, text: event.currentTarget.value })} />;
    case "claude":
      return <input className="na-input" value={action.prompt} placeholder={copy.fields.prompt} onChange={(event) => onChange({ ...action, prompt: event.currentTarget.value })} />;
    case "macro":
      return <input className="na-input" value={action.name} placeholder={copy.fields.macro} onChange={(event) => onChange({ ...action, name: event.currentTarget.value })} />;
    case "dark":
      return (
        <select value={action.on ? "on" : "off"} onChange={(event) => onChange({ ...action, on: event.currentTarget.value === "on" })}>
          <option value="on">{copy.fields.on}</option>
          <option value="off">{copy.fields.off}</option>
        </select>
      );
    case "ac":
      return (
        <div className="na-fields">
          <select value={action.on ? "on" : "off"} onChange={(event) => onChange({ ...action, on: event.currentTarget.value === "on" })}>
            <option value="on">{copy.fields.on}</option>
            <option value="off">{copy.fields.off}</option>
          </select>
          {action.on && (
            <input className="na-input na-input--short" type="number" min={16} max={30} value={action.temperature ?? 23} aria-label={copy.fields.temperature} onChange={(event) => onChange({ ...action, temperature: Number(event.currentTarget.value) || 23 })} />
          )}
        </div>
      );
    case "routine":
      return (
        <select value={action.routine} onChange={(event) => onChange({ ...action, routine: event.currentTarget.value === "end" ? "end" : "start" })}>
          <option value="start">{copy.fields.routineStart}</option>
          <option value="end">{copy.fields.routineEnd}</option>
        </select>
      );
    default:
      return null;
  }
}
