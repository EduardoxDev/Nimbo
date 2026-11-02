import { useEffect, useState, type FormEvent } from "react";
import { Check, Cpu, Download, ExternalLink, Lock, Sparkles, Zap } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "../i18n";
import { Section } from "../settings/controls";
import { aiErrorText } from "./aiErrors";

type ProviderId = "ollama" | "gemini" | "groq" | "claude";

/** What `ai_status` in `src-tauri/src/ai.rs` returns. */
type AiStatus = {
  provider: ProviderId;
  ready: boolean;
  claude: boolean;
  gemini: boolean;
  groq: boolean;
  ollamaRunning: boolean;
  ollamaModels: string[];
  ollamaSuggested: string;
};

const PROVIDERS: { id: ProviderId; icon: typeof Cpu; color: string; keyUrl?: string; keyHost?: string }[] = [
  { id: "ollama", icon: Cpu, color: "#f5f5f7" },
  { id: "gemini", icon: Sparkles, color: "#4f8cff", keyUrl: "https://aistudio.google.com/apikey", keyHost: "aistudio.google.com" },
  { id: "groq", icon: Zap, color: "#f55036", keyUrl: "https://console.groq.com/keys", keyHost: "console.groq.com" },
  { id: "claude", icon: Sparkles, color: "#d97757", keyUrl: "https://platform.claude.com/settings/keys", keyHost: "platform.claude.com" },
];
const OLLAMA_DOWNLOAD = "https://ollama.com/download";

const open = (url: string) => void openUrl(url).catch(() => window.open(url));

/** Settings > AI agents > Island assistant: which AI answers, with three free choices. */
export function AssistantSettings() {
  const t = useTranslation();
  const copy = t.prefs.assistant;
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState(false);

  const refresh = () => {
    if (!isTauri()) return;
    invoke<AiStatus>("ai_status").then(setStatus).catch((reason) => setError(aiErrorText(t, reason)));
  };
  useEffect(refresh, []);

  // Ollama may be opened after this page: look again every few seconds while it is chosen and not ready.
  useEffect(() => {
    if (status?.provider !== "ollama" || status.ready) return;
    const timer = window.setInterval(refresh, 4000);
    return () => window.clearInterval(timer);
  }, [status?.provider, status?.ready]);

  const choose = async (provider: ProviderId) => {
    setError(null);
    setKey("");
    try {
      setStatus(await invoke<AiStatus>("ai_set_provider", { provider }));
    } catch (reason) {
      setError(aiErrorText(t, reason));
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!status) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await invoke<AiStatus>("ai_save_key", { provider: status.provider, key }));
      setKey("");
    } catch (reason) {
      setError(aiErrorText(t, reason));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!status) return;
    try {
      setStatus(await invoke<AiStatus>("ai_delete_key", { provider: status.provider }));
    } catch (reason) {
      setError(aiErrorText(t, reason));
    }
  };

  const pull = async () => {
    setPulling(true);
    setError(null);
    try {
      setStatus(await invoke<AiStatus>("ai_ollama_pull"));
    } catch (reason) {
      setError(aiErrorText(t, reason));
    } finally {
      setPulling(false);
    }
  };

  const hasKey = (id: ProviderId) => (id === "ollama" ? Boolean(status?.ollamaRunning && status.ollamaModels.length) : Boolean(status?.[id]));
  const chosen = PROVIDERS.find((provider) => provider.id === status?.provider);
  const ollamaModel = status?.ollamaModels.find((model) => !model.includes("embed")) ?? null;

  return (
    <Section title={copy.section}>
      <p className="prefs-card__hint">{copy.hint}</p>
      <p className="prefs-ai__title">{copy.providerTitle}</p>
      <div className="prefs-ai" role="radiogroup" aria-label={copy.providerTitle}>
        {PROVIDERS.map(({ id, icon: Icon, color }) => {
          const on = status?.provider === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`prefs-ai__option${on ? " prefs-ai__option--on" : ""}`}
              onClick={() => void choose(id)}
            >
              <span className="prefs-ai__icon" style={{ color }} aria-hidden="true">
                <Icon size={17} strokeWidth={2.2} />
              </span>
              <span className="prefs-ai__text">
                <strong>
                  {copy.providers[id].name}
                  <em className={id === "claude" ? "prefs-ai__badge--paid" : undefined}>{copy.providers[id].badge}</em>
                </strong>
                <small>{copy.providers[id].hint}</small>
              </span>
              {hasKey(id) && <Check className="prefs-ai__ok" size={15} strokeWidth={3} aria-label={copy.ready} />}
            </button>
          );
        })}
      </div>

      {status && chosen && (
        <div className="prefs-ai__setup">
          <span className={`prefs-ai__state${status.ready ? " prefs-ai__state--ready" : ""}`}>
            {status.ready ? copy.ready : copy.notReady}
          </span>

          {chosen.id === "ollama" ? (
            !status.ollamaRunning ? (
              <>
                <p>{copy.ollamaOff}</p>
                <button className="prefs-button" type="button" onClick={() => open(OLLAMA_DOWNLOAD)}>
                  <ExternalLink size={13} strokeWidth={2.4} aria-hidden="true" /> {copy.ollamaInstall}
                </button>
              </>
            ) : !ollamaModel ? (
              <>
                <p>{copy.ollamaNoModel}</p>
                <button className="prefs-button" type="button" disabled={pulling} onClick={() => void pull()}>
                  <Download size={13} strokeWidth={2.4} aria-hidden="true" /> {pulling ? copy.ollamaPulling : copy.ollamaPull(status.ollamaSuggested)}
                </button>
              </>
            ) : (
              <p>{copy.ollamaUsing(ollamaModel)}</p>
            )
          ) : hasKey(chosen.id) ? (
            <div className="prefs-ai__row">
              <p>{chosen.id === "claude" ? copy.model : copy.saved}</p>
              <button className="prefs-button prefs-button--quiet" type="button" onClick={() => void remove()}>
                {copy.remove}
              </button>
            </div>
          ) : (
            <form className="prefs-form" onSubmit={(event) => void save(event)}>
              <label className="prefs-field">
                <span>{chosen.id === "claude" ? copy.key : copy.keyFor(copy.providers[chosen.id].name)}</span>
                <input
                  type="password"
                  value={key}
                  placeholder={chosen.id === "claude" ? copy.keyPlaceholder : "…"}
                  autoComplete="off"
                  spellCheck={false}
                  required
                  onChange={(event) => setKey(event.currentTarget.value)}
                />
                {chosen.keyUrl && (
                  <small>
                    {chosen.id === "claude" ? copy.getKey : copy.getKeyAt}{" "}
                    <button className="prefs-inline-link" type="button" onClick={() => open(chosen.keyUrl ?? "")}>
                      {chosen.keyHost}
                      <ExternalLink size={11} strokeWidth={2.4} aria-hidden="true" />
                    </button>
                  </small>
                )}
              </label>
              <div className="prefs-form__actions">
                <button className="prefs-button" type="submit" disabled={!key.trim() || busy}>
                  {copy.save}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {error && (
        <p className="prefs-error" role="alert">
          {error}
        </p>
      )}
      <p className="prefs-card__hint prefs-card__hint--bottom prefs-card__hint--icon">
        <Lock size={12} strokeWidth={2.2} aria-hidden="true" />
        {copy.privacy}
      </p>
    </Section>
  );
}
