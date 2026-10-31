import { useState } from "react";
import { Bot, Check, Circle, LoaderCircle, RotateCcw, X } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import type { IslandTab } from "../IslandTabs";
import { PageChrome } from "../island/PageChrome";
import {
  agentMood,
  answerApproval,
  currentStepOf,
  mascotOf,
  pendingApproval,
  type AgentBoard,
  type AgentEntry,
  type AgentStep,
} from "./agentsStore";
import { Mascot } from "../mascot/Mascot";
import { identityOf } from "../mascot/engine";
import "./Agents.css";

const AGENT_COLOR = "#bf8cff";

function visibleSteps(steps: AgentStep[]) {
  const current = steps.findIndex((step) => step.status !== "completed");
  const focus = current === -1 ? steps.length - 1 : current;
  const start = Math.max(0, Math.min(focus - 1, steps.length - 3));
  return steps.slice(start, start + 3).map((step, offset) => ({ step, isCurrent: start + offset === focus }));
}

export function AgentsPanel<Page extends string>({
  board,
  onClear,
  pages,
  currentPage,
  showPageIcons,
  onPageChange,
}: {
  board: AgentBoard;
  onClear: (agentId?: string) => void;
  pages: IslandTab<Page>[];
  currentPage: Page;
  showPageIcons: boolean;
  onPageChange: (page: Page) => void;
}) {
  const t = useTranslation();
  const agents = [...board.agents].sort((a, b) => b.updatedAt - a.updatedAt);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = agents.find((agent) => agent.id === selectedId) ?? agents[0] ?? null;
  const now = Date.now();
  const approval = pendingApproval(board);
  const selectedMood = selected ? agentMood(selected, board, now) : "idle";
  const isError = selectedMood === "error";

  const openSettings = () => {
    try {
      window.localStorage.setItem("nimbo-settings-page", "agents");
    } catch {
      // Opens on the last page instead.
    }
    if (isTauri()) void invoke("open_settings_window").catch(() => {});
  };

  const statusLine = (agent: AgentEntry) =>
    agent.state === "done" || agent.state === "error"
      ? agent.message ?? t.agents.done
      : currentStepOf(agent)?.title ?? agent.message ?? t.agents.working;

  return (
    <PageChrome
      icon={Bot}
      iconColor={AGENT_COLOR}
      pages={pages}
      currentPage={currentPage}
      showPageIcons={showPageIcons}
      onPageChange={onPageChange}
      className="agents-panel"
      label={t.agents.title}
    >
      {approval && (
        <div className="agents-approval g-card" role="alertdialog" aria-label={t.agents.asks(approval.agent, approval.question)}>
          <Mascot mood="waiting" {...identityOf(approval.agent)} seed={approval.agent} size={38} glow />
          <span className="agents-approval__text">
            <strong>{approval.agent}</strong>
            {approval.question}
          </span>
          <button className="agents-approval__button agents-approval__button--primary" type="button" onClick={() => void answerApproval(approval.id, true)}>
            {t.agents.approve}
          </button>
          <button className="agents-approval__button" type="button" onClick={() => void answerApproval(approval.id, false)}>
            {t.agents.deny}
          </button>
        </div>
      )}
      {selected ? (
        <div className={`agents-g${isError ? " agents-g--error" : ""}`}>
          <div className={`agents-g__focus g-card${isError ? " agents-g__focus--error" : ""}`}>
            <Mascot mood={selectedMood} {...mascotOf(selected)} seed={selected.name} size={64} glow label={selected.name} />
            {isError ? (
              <div className="agents-g__error">
                <strong>{t.agents.failedTitle(selected.name)}</strong>
                <span>{selected.message ?? selected.goal ?? ""}</span>
              </div>
            ) : selected.steps.length > 0 ? (
              <ol className="agents-g__steps" aria-label={selected.goal ?? selected.name}>
                {visibleSteps(selected.steps).map(({ step, isCurrent }, index) => (
                  <li
                    key={`${index}-${step.title}`}
                    className={`agents-g__step${isCurrent ? " agents-g__step--current" : ""}${step.status === "completed" ? " agents-g__step--done" : ""}`}
                  >
                    {step.status === "completed" ? (
                      <Check size={12} strokeWidth={3} aria-hidden="true" />
                    ) : step.status === "in_progress" ? (
                      <LoaderCircle className="agents-step__spinner" size={12} strokeWidth={2.6} aria-hidden="true" />
                    ) : (
                      <Circle size={10} strokeWidth={2.4} aria-hidden="true" />
                    )}
                    <span>{step.title}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="agents-g__error agents-g__error--calm">
                <strong>{selected.goal ?? selected.name}</strong>
                <span>{statusLine(selected)}</span>
              </div>
            )}
            <button
              className={isError ? "agents-g__retry" : "agents-g__dismiss"}
              type="button"
              title={t.agents.dismiss}
              aria-label={t.agents.dismiss}
              onClick={() => onClear(selected.id)}
            >
              {isError ? <RotateCcw size={14} strokeWidth={2.4} /> : <X size={12} strokeWidth={2.6} />}
            </button>
          </div>
          {!isError && (
            <div className="agents-g__others g-card" role="tablist" aria-label={t.agents.title}>
              {agents.slice(0, 4).map((agent) => {
                const identity = mascotOf(agent);
                return (
                  <button
                    key={agent.id}
                    className={`g-pill agents-g__pill${agent.id === selected.id ? " agents-g__pill--active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={agent.id === selected.id}
                    title={`${agent.name}: ${statusLine(agent)}`}
                    onClick={() => setSelectedId(agent.id)}
                  >
                    <Mascot mood={agentMood(agent, board, now)} shape={identity.shape} color={identity.color} seed={agent.name} size={18} showDot={false} glow />
                    <span>{statusLine(agent)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="home-empty" role="status">
          <strong>{t.agents.emptyTitle}</strong>
          <span className="home-empty__hint">{t.agents.emptyHint}</span>
          <button className="home-empty__button" type="button" onClick={openSettings}>
            {t.agents.connect}
          </button>
        </div>
      )}
    </PageChrome>
  );
}
