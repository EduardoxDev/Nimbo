import { useState } from "react";
import { ArrowUp, Camera, FileDiff, Folder, ListPlus, RotateCcw, Square, Undo2, X } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import type { ClaudeTask } from "./useClaudeTask";
import { MicButton } from "../voice/MicButton";

function folderName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function ClaudeComposer({ claude }: { claude: ClaudeTask }) {
  const copy = useTranslation().agents;
  const [prompt, setPrompt] = useState("");
  const [showChanges, setShowChanges] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const added = claude.changes.reduce((sum, change) => sum + change.added, 0);
  const removed = claude.changes.reduce((sum, change) => sum + change.removed, 0);

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
        if (!prompt.trim()) return;
        if (claude.running) {
          claude.enqueue(prompt.trim());
          setPrompt("");
          return;
        }
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
        placeholder={claude.running ? copy.queuePlaceholder : claude.canResume ? copy.continuePlaceholder : copy.askPlaceholder}
        aria-label={copy.askPlaceholder}
        spellCheck={false}
        onChange={(event) => setPrompt(event.currentTarget.value)}
      />
      {claude.attachment && (
        <button className="claude-composer__folder claude-composer__shot" type="button" title={copy.screenRemove} onClick={() => claude.attach(null)}>
          <Camera size={11} strokeWidth={2.4} aria-hidden="true" />
          <span>{copy.screenAttached}</span>
          <X size={10} strokeWidth={2.6} aria-hidden="true" />
        </button>
      )}
      {claude.queued.length > 0 && (
        <button className="claude-composer__folder" type="button" title={[copy.queueClear, ...claude.queued].join(" · ")} onClick={claude.clearQueue}>
          <ListPlus size={11} strokeWidth={2.4} aria-hidden="true" />
          <span>{copy.queuedShort(claude.queued.length)}</span>
        </button>
      )}
      {claude.changes.length > 0 && !claude.running && (
        <button
          className="claude-composer__folder claude-composer__changes"
          type="button"
          aria-expanded={showChanges}
          title={copy.changesTitle(claude.changes.length, added, removed)}
          onClick={() => {
            setShowChanges((open) => !open);
            setConfirmUndo(false);
          }}
        >
          <FileDiff size={11} strokeWidth={2.4} aria-hidden="true" />
          <span>{copy.changesShort(claude.changes.length)}</span>
        </button>
      )}
      {showChanges && claude.changes.length > 0 && (
        <div className="claude-changes g-card" role="dialog" aria-label={copy.changesTitle(claude.changes.length, added, removed)}>
          <ul>
            {claude.changes.map((change) => (
              <li key={change.path}>
                <span className="claude-changes__path" title={change.path}>{change.path}</span>
                {change.created && <span className="claude-changes__new">{copy.newFile}</span>}
                <span className="claude-changes__added">+{change.added}</span>
                <span className="claude-changes__removed">−{change.removed}</span>
              </li>
            ))}
          </ul>
          <button
            className={`claude-changes__undo${confirmUndo ? " claude-changes__undo--confirm" : ""}`}
            type="button"
            onClick={() => {
              if (!confirmUndo) {
                setConfirmUndo(true);
                return;
              }
              void claude.undo().then(() => {
                setShowChanges(false);
                setConfirmUndo(false);
              });
            }}
          >
            <Undo2 size={12} strokeWidth={2.4} aria-hidden="true" />
            {confirmUndo ? copy.undoConfirm : copy.undoAll}
          </button>
        </div>
      )}
      {claude.canResume && !claude.running && (
        <button className="claude-composer__folder" type="button" title={copy.newChat} onClick={claude.forget}>
          <RotateCcw size={11} strokeWidth={2.4} aria-hidden="true" />
          <span>{copy.newChatShort}</span>
        </button>
      )}
      <MicButton
        onText={(text) => {
          setVoiceError("");
          if (claude.running) claude.enqueue(text);
          else void claude.start(text);
        }}
        onError={setVoiceError}
      />
      {claude.running && prompt.trim() ? (
        <button className="claude-composer__send" type="submit" title={copy.queueAdd} aria-label={copy.queueAdd}>
          <ListPlus size={13} strokeWidth={2.6} />
        </button>
      ) : claude.running ? (
        <button className="claude-composer__send claude-composer__send--stop" type="button" title={copy.stop} aria-label={copy.stop} onClick={claude.stop}>
          <Square size={11} strokeWidth={3} fill="currentColor" />
        </button>
      ) : (
        <button className="claude-composer__send" type="submit" title={copy.send} aria-label={copy.send} disabled={!prompt.trim()}>
          <ArrowUp size={14} strokeWidth={2.8} />
        </button>
      )}
      {(claude.error || voiceError) && (
        <span className="claude-composer__error" role="alert">
          {claude.error || voiceError}
        </span>
      )}
    </form>
  );
}
