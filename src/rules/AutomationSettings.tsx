import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Circle, FolderOpen, Play, Plus, Trash2, Undo2, Zap } from "lucide-react";
import { useTranslation } from "../i18n";
import { Row, Section, Toggle } from "../settings/controls";
import { parseRule, parseRules, RULES_KEY, type Rule } from "./rules";

type MacroInfo = { id: string; name: string; steps: number; seconds: number };
type DownloadsReport = { loose: [string, number][]; looseTotal: number; bigOld: { name: string; path: string; sizeMb: number; daysOld: number }[]; canUndo: boolean };

function loadRules() {
  try {
    return parseRules(window.localStorage.getItem(RULES_KEY));
  } catch {
    return [];
  }
}

/** Settings page: trigger rules, recorded actions and the Downloads tidy-up. */
export function AutomationSettings() {
  const t = useTranslation();
  const copy = t.automation;
  const [rules, setRules] = useState<Rule[]>(loadRules);
  const [draft, setDraft] = useState("");
  const [ssid, setSsid] = useState<string | null>(null);
  const [macros, setMacros] = useState<MacroInfo[]>([]);
  const [recording, setRecording] = useState(false);
  const [macroName, setMacroName] = useState("");
  const [report, setReport] = useState<DownloadsReport | null>(null);
  const [message, setMessage] = useState("");
  const parsed = draft.trim() ? parseRule(draft, ssid) : null;

  const saveRules = (next: Rule[]) => {
    setRules(next);
    try {
      window.localStorage.setItem(RULES_KEY, JSON.stringify(next));
    } catch {
      // This window only.
    }
  };

  const refreshMacros = () => {
    if (isTauri()) void invoke<MacroInfo[]>("macro_list").then(setMacros).catch(() => {});
  };
  const refreshReport = () => {
    if (isTauri()) void invoke<DownloadsReport>("downloads_report").then(setReport).catch((error) => setMessage(String(error)));
  };

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === RULES_KEY) setRules(loadRules());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<{ ssid: string | null }>("context_now").then((context) => setSsid(context.ssid)).catch(() => {});
    refreshMacros();
    refreshReport();
  }, []);

  // The recording ends with Esc three times; then it gets the name typed here.
  useEffect(() => {
    if (!recording || !isTauri()) return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    void listen<number>("macro-recorded", () => {
      setRecording(false);
      void invoke<MacroInfo>("macro_save", { name: macroName })
        .then((saved) => {
          setMessage(copy.macroSaved(saved.name, saved.steps));
          setMacroName("");
          refreshMacros();
        })
        .catch((error) => setMessage(String(error)));
    }).then((unlisten) => (cancelled ? unlisten() : (stop = unlisten)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [recording]);

  const startRecording = () => {
    setMessage("");
    void invoke("macro_record_start")
      .then(() => setRecording(true))
      .catch((error) => setMessage(String(error)));
  };

  return (
    <>
      <Section title={t.automations.title}>
        <Row title={t.automations.open} hint={t.automations.openHint}>
          <button type="button" className="prefs-button" onClick={() => void invoke("automations_open").catch((error) => setMessage(String(error)))}>
            <Zap size={14} strokeWidth={2.4} />
            {t.automations.open}
          </button>
        </Row>
      </Section>
      <Section title={copy.rulesTitle}>
        <div className="prefs-auto__new">
          <input
            value={draft}
            placeholder={copy.rulePlaceholder}
            aria-label={copy.rulePlaceholder}
            spellCheck={false}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && parsed) {
                saveRules([...rules, { ...parsed, id: Date.now().toString(36), enabled: true }]);
                setDraft("");
              }
            }}
          />
          <button
            type="button"
            className="prefs-button"
            disabled={!parsed}
            onClick={() => {
              if (!parsed) return;
              saveRules([...rules, { ...parsed, id: Date.now().toString(36), enabled: true }]);
              setDraft("");
            }}
          >
            <Plus size={14} strokeWidth={2.6} /> {copy.addRule}
          </button>
        </div>
        <p className="prefs-auto__hint">{draft.trim() && !parsed ? copy.ruleNotUnderstood : copy.ruleExamples}</p>
        {rules.map((rule) => (
          <Row key={rule.id} title={rule.text}>
            <div className="prefs-auto__row">
              <Toggle label={rule.text} checked={rule.enabled} onChange={(enabled) => saveRules(rules.map((item) => (item.id === rule.id ? { ...item, enabled } : item)))} />
              <button type="button" className="prefs-auto__icon" title={copy.remove} aria-label={copy.remove} onClick={() => saveRules(rules.filter((item) => item.id !== rule.id))}>
                <Trash2 size={14} strokeWidth={2.4} />
              </button>
            </div>
          </Row>
        ))}
      </Section>

      <Section title={copy.macrosTitle}>
        <Row title={copy.recordTitle} hint={recording ? copy.recordingHint : copy.recordHint}>
          <div className="prefs-auto__row">
            <input
              className="prefs-auto__name"
              value={macroName}
              placeholder={copy.macroNamePlaceholder}
              aria-label={copy.macroNamePlaceholder}
              disabled={recording}
              onChange={(event) => setMacroName(event.currentTarget.value)}
            />
            <button type="button" className="prefs-button" disabled={recording || !macroName.trim()} onClick={startRecording}>
              <Circle size={12} strokeWidth={3} fill="currentColor" /> {recording ? copy.recording : copy.record}
            </button>
          </div>
        </Row>
        {macros.map((item) => (
          <Row key={item.id} title={item.name} hint={copy.macroInfo(item.steps, item.seconds)}>
            <div className="prefs-auto__row">
              <button type="button" className="prefs-auto__icon" title={copy.run} aria-label={copy.run} onClick={() => void invoke<string>("macro_run", { id: item.id }).then(setMessage).catch((error) => setMessage(String(error)))}>
                <Play size={14} strokeWidth={2.4} />
              </button>
              <button type="button" className="prefs-auto__icon" title={copy.remove} aria-label={copy.remove} onClick={() => void invoke("macro_delete", { id: item.id }).then(refreshMacros)}>
                <Trash2 size={14} strokeWidth={2.4} />
              </button>
            </div>
          </Row>
        ))}
      </Section>

      <Section title={copy.downloadsTitle}>
        <Row
          title={report ? copy.looseFiles(report.looseTotal) : copy.loading}
          hint={report && report.loose.length > 0 ? report.loose.map(([folder, count]) => `${copy.folders[folder as keyof typeof copy.folders] ?? folder}: ${count}`).join(" · ") : copy.downloadsHint}
        >
          <div className="prefs-auto__row">
            {report?.canUndo && (
              <button
                type="button"
                className="prefs-button prefs-button--quiet"
                onClick={() => void invoke<number>("downloads_undo").then((count) => { setMessage(copy.undone(count)); refreshReport(); }).catch((error) => setMessage(String(error)))}
              >
                <Undo2 size={14} strokeWidth={2.4} /> {copy.undo}
              </button>
            )}
            <button
              type="button"
              className="prefs-button"
              disabled={!report || report.looseTotal === 0}
              onClick={() => void invoke<number>("downloads_organize").then((count) => { setMessage(copy.organized(count)); refreshReport(); }).catch((error) => setMessage(String(error)))}
            >
              {copy.organize}
            </button>
          </div>
        </Row>
        {report?.bigOld.map((file) => (
          <Row key={file.path} title={file.name} hint={copy.bigFile(file.sizeMb, file.daysOld)}>
            <button type="button" className="prefs-auto__icon" title={copy.show} aria-label={copy.show} onClick={() => void invoke("downloads_reveal", { path: file.path })}>
              <FolderOpen size={14} strokeWidth={2.4} />
            </button>
          </Row>
        ))}
      </Section>
      {message && <p className="prefs-auto__message" role="status">{message}</p>}
    </>
  );
}
