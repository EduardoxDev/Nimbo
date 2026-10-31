import { useState } from "react";
import { Bot, Check, Circle, LoaderCircle, X } from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import type { IslandTab } from "../IslandTabs";
import { PageChrome } from "../island/PageChrome";
import { agentMood, answerApproval, currentStepOf, mascotOf, pendingApproval, type AgentBoard } from "./agentsStore";
import { Mascot } from "../mascot/Mascot";
import { identityOf } from "../mascot/engine";

const AGENT_COLOR = "#bf8cff";

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

  const openSettings = () => {
    try {
      window.localStorage.setItem("nimbo-settings-page", "agents");
    } catch {
      // Opens on the last page instead.
    }
    if (isTauri()) void invoke("open_settings_window").catch(() => {});
  };

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
        <div className="agents-approval" role="alertdialog" aria-label={t.agents.asks(approval.agent, approval.question)}>
          <Mascot mood="waiting" {...identityOf(approval.agent)} seed={approval.agent} size={34} />
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
        <div className="agents-panel__body">
          <div className="agents-panel__list" role="tablist" aria-label={t.agents.title}>
            {agents.map((agent) => {
              const identity = mascotOf(agent);
              return (
                <button
                  key={agent.id}
                  className={`agents-chip${agent.id === selected.id ? " agents-chip--active" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={agent.id === selected.id}
                  onClick={() => setSelectedId(agent.id)}
                >
                  <Mascot mood={agentMood(agent, board, now)} shape={identity.shape} color={identity.color} seed={agent.name} size={20} showDot={false} />
                  <span>{agent.name}</span>
                </button>
              );
            })}
          </div>

          <div className="agents-panel__detail">
            <div className="agents-panel__head">
              <Mascot mood={agentMood(selected, board, now)} {...mascotOf(selected)} seed={selected.name} size={40} label={selected.name} />
              <div className="agents-panel__titles">
                <strong>{selected.goal ?? selected.name}</strong>
                <span className={selected.state === "error" ? "agents-panel__error" : undefined}>
                  {selected.state === "done" || selected.state === "error"
                    ? selected.message ?? t.agents.done
                    : currentStepOf(selected)?.title ?? selected.message ?? t.agents.working}
                </span>
              </div>
              <span className="agents-panel__count">
                {selected.steps.filter((step) => step.status === "completed").length}/{selected.steps.length}
              </span>
              <button
                className="agents-panel__dismiss"
                type="button"
                title={t.agents.dismiss}
                aria-label={t.agents.dismiss}
                onClick={() => onClear(selected.id)}
              >
                <X size={14} strokeWidth={2.6} />
              </button>
            </div>
            <ol className="agents-panel__steps">
              {selected.steps.map((step, index) => (
                <li key={`${index}-${step.title}`} className={`agents-step agents-step--${step.status}`}>
                  {step.status === "completed" ? (
                    <Check size={13} strokeWidth={3} aria-hidden="true" />
                  ) : step.status === "in_progress" ? (
                    <LoaderCircle className="agents-step__spinner" size={13} strokeWidth={2.6} aria-hidden="true" />
                  ) : (
                    <Circle size={11} strokeWidth={2.4} aria-hidden="true" />
                  )}
                  <span>{step.title}</span>
                </li>
              ))}
            </ol>
          </div>
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
