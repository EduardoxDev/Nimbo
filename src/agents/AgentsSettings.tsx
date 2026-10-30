import { useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, Lock, RefreshCcw } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import { Row, Section, Toggle } from "../settings/controls";
import { AGENTS_DEMO, type AgentServerInfo } from "./agentsStore";

const DEMO_INFO: AgentServerInfo = {
  enabled: true,
  running: true,
  url: "http://127.0.0.1:47615/mcp",
  token: "3f9c2a7e81d04b6c9e5f1a2b3c4d5e6f708192a3b4c5d6e7",
  error: null,
};

function CopyBlock({ label, text, copyLabel, copiedLabel }: { label: string; text: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked; the text stays selectable.
    }
  };
  return (
    <div className="agents-copy">
      <div className="agents-copy__head">
        <span>{label}</span>
        <button className="prefs-button prefs-button--quiet" type="button" onClick={() => void copy()}>
          {copied ? <Check size={13} strokeWidth={2.8} /> : <Copy size={13} strokeWidth={2.4} />}
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
      <pre>{text}</pre>
    </div>
  );
}

/** Settings > AI agents: the local MCP server and ready-to-paste connection snippets. */
export function AgentsSettings() {
  const t = useTranslation();
  const copy = t.prefs.agents;
  const [info, setInfo] = useState<AgentServerInfo | null>(AGENTS_DEMO ? DEMO_INFO : null);
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    invoke<AgentServerInfo>("agents_server_info").then(setInfo).catch((reason) => setError(String(reason)));
  }, []);

  const call = (command: string, args?: Record<string, unknown>) => {
    if (!isTauri()) return;
    invoke<AgentServerInfo>(command, args)
      .then((next) => {
        setInfo(next);
        setError(null);
      })
      .catch((reason) => setError(String(reason)));
  };

  if (!info) return null;
  const masked = showToken ? info.token : `${info.token.slice(0, 6)}${"•".repeat(18)}`;
  const claudeCommand = `claude mcp add --transport http nimbo ${info.url} --header "Authorization: Bearer ${info.token}"`;
  const jsonConfig = JSON.stringify(
    { mcpServers: { nimbo: { type: "http", url: info.url, headers: { Authorization: `Bearer ${info.token}` } } } },
    null,
    2,
  );

  return (
    <>
      <Section title={copy.section}>
        <p className="prefs-card__hint">{copy.hint}</p>
        <Row title={copy.enabled} hint={info.running ? copy.running : info.error ?? copy.stopped}>
          <Toggle label={copy.enabled} checked={info.enabled} onChange={(enabled) => call("agents_set_enabled", { enabled })} />
        </Row>
        <Row title={copy.address} hint={info.url} />
        <Row title={copy.token} hint={masked}>
          <div className="agents-token-actions">
            <button
              className="prefs-button prefs-button--quiet"
              type="button"
              aria-label={showToken ? copy.hide : copy.show}
              onClick={() => setShowToken((value) => !value)}
            >
              {showToken ? <EyeOff size={14} strokeWidth={2.3} /> : <Eye size={14} strokeWidth={2.3} />}
            </button>
            <button className="prefs-button prefs-button--quiet" type="button" onClick={() => call("agents_regenerate_token")}>
              <RefreshCcw size={13} strokeWidth={2.4} />
              {copy.regenerate}
            </button>
          </div>
        </Row>
        {error && (
          <p className="prefs-error" role="alert">
            {error}
          </p>
        )}
      </Section>

      <Section title={copy.connectSection}>
        <CopyBlock label={copy.claudeCode} text={claudeCommand} copyLabel={copy.copy} copiedLabel={copy.copied} />
        <CopyBlock label={copy.others} text={jsonConfig} copyLabel={copy.copy} copiedLabel={copy.copied} />
        <p className="prefs-card__hint prefs-card__hint--bottom">{copy.tip}</p>
      </Section>

      <p className="prefs-note">
        <Lock size={13} strokeWidth={2.2} aria-hidden="true" />
        {copy.privacy}
      </p>
    </>
  );
}
