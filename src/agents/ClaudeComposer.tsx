import { useState } from "react";
import { ArrowUp, Folder, RotateCcw, Square } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import type { ClaudeTask } from "./useClaudeTask";

function folderName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function ClaudeComposer({ claude }: { claude: ClaudeTask }) {
  const copy = useTranslation().agents;
  const [prompt, setPrompt] = useState("");

  const openSettings = () => {
    try {
      window.localStorage.setItem("nimbo-settings-page", "agents");
    } catch {
      // Opens on the last page instead.
    }
    if (isTauri()) void invoke("open_settings_window").catch(() => {});
  };

  if (!claude.available) {
    return <p className="claude-composer__hint">{copy.noClaude}</p>;
  }

  return (
    <form
      className="claude-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (claude.running || !prompt.trim()) return;
        void claude.start(prompt).then((started) => {
          if (started) setPrompt("");
        });
      }}
    >
      <button className="claude-composer__folder" type="button" title={claude.folder} onClick={openSettings}>
        <Folder size={12} strokeWidth={2.4} aria-hidden="true" />
        <span>{folderName(claude.folder)}</span>
      </button>
      <input
        value={prompt}
        maxLength={4000}
        placeholder={claude.running ? copy.working : claude.canResume ? copy.continuePlaceholder : copy.askPlaceholder}
        aria-label={copy.askPlaceholder}
        disabled={claude.running}
        spellCheck={false}
        onChange={(event) => setPrompt(event.currentTarget.value)}
      />
      {claude.canResume && !claude.running && (
        <button className="claude-composer__folder" type="button" title={copy.newChat} onClick={claude.forget}>
          <RotateCcw size={11} strokeWidth={2.4} aria-hidden="true" />
          <span>{copy.newChatShort}</span>
        </button>
      )}
      {claude.running ? (
        <button className="claude-composer__send claude-composer__send--stop" type="button" title={copy.stop} aria-label={copy.stop} onClick={claude.stop}>
          <Square size={11} strokeWidth={3} fill="currentColor" />
        </button>
      ) : (
        <button className="claude-composer__send" type="submit" title={copy.send} aria-label={copy.send} disabled={!prompt.trim()}>
          <ArrowUp size={14} strokeWidth={2.8} />
        </button>
      )}
      {claude.error && (
        <span className="claude-composer__error" role="alert">
          {claude.error}
        </span>
      )}
    </form>
  );
}
