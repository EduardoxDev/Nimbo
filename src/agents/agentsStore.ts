import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AGENT_STALE_MS } from "./moods";

export { AGENT_STALE_MS, agentMood, islandAgentsOf, mascotOf, type IslandAgent } from "./moods";

/** Mirrors the structs in src-tauri/src/agents.rs. */
export type AgentStep = {
  title: string;
  status: "pending" | "in_progress" | "completed";
};

export type AgentEntry = {
  id: string;
  name: string;
  goal: string | null;
  steps: AgentStep[];
  state: "working" | "done" | "error";
  message: string | null;
  updatedAt: number;
};

export type AgentApproval = {
  id: string;
  agent: string;
  question: string;
  status: "pending" | "approved" | "denied";
  createdAt: number;
};

export type AgentBoard = { agents: AgentEntry[]; approvals?: AgentApproval[] };

export function pendingApproval(board: AgentBoard): AgentApproval | null {
  return (board.approvals ?? []).find((approval) => approval.status === "pending") ?? null;
}

export function answerApproval(id: string, approved: boolean) {
  if (!isTauri()) return Promise.resolve();
  return invoke("agents_answer_approval", { id, approved }).then(() => undefined);
}

export type AgentNotice = { agent: string; text: string; level: "info" | "success" | "warning" };

export type AgentServerInfo = {
  enabled: boolean;
  running: boolean;
  url: string;
  token: string;
  error: string | null;
};


export const AGENTS_DEMO =
  import.meta.env.DEV &&
  !isTauri() &&
  new URLSearchParams(window.location.search).get("demo") === "agents";

const DEMO_BOARD: AgentBoard = {
  approvals: [
    { id: "demo", agent: "Claude Code", question: "Posso apagar a pasta build/ e rodar a migração do banco?", status: "pending", createdAt: Date.now() },
  ],
  agents: [
    {
      id: "claudecode",
      name: "Claude Code",
      goal: "Corrigir o login da VaultPay",
      steps: [
        { title: "Ler o fluxo de autenticação", status: "completed" },
        { title: "Reproduzir o erro com um teste", status: "completed" },
        { title: "Corrigir a validação do token", status: "in_progress" },
        { title: "Rodar a bateria de testes", status: "pending" },
        { title: "Abrir o PR", status: "pending" },
      ],
      state: "working",
      message: null,
      updatedAt: Date.now() - 60_000,
    },
    {
      id: "cursor",
      name: "Cursor",
      goal: "Atualizar as dependências",
      steps: [{ title: "Rodar a instalação", status: "in_progress" }],
      state: "error",
      message: "Não consegui baixar um pacote",
      updatedAt: Date.now() - 30_000,
    },
    {
      id: "codex",
      name: "Codex",
      goal: "Traduzir a landing para inglês",
      steps: [
        { title: "Extrair os textos", status: "completed" },
        { title: "Traduzir", status: "completed" },
      ],
      state: "done",
      message: "Landing traduzida, 42 textos",
      updatedAt: Date.now() - 12 * 60_000,
    },
  ],
};

export function progressOf(agent: AgentEntry) {
  if (agent.steps.length === 0) return agent.state === "done" ? 1 : 0;
  return agent.steps.filter((step) => step.status === "completed").length / agent.steps.length;
}

export function currentStepOf(agent: AgentEntry) {
  return (
    agent.steps.find((step) => step.status === "in_progress") ??
    agent.steps.find((step) => step.status === "pending") ??
    null
  );
}

/** The agent to feature on the closed island: the most recent one still working. */
export function activeAgentOf(board: AgentBoard, now: number) {
  return (
    board.agents
      .filter((agent) => agent.state === "working" && now - agent.updatedAt < AGENT_STALE_MS)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
  );
}

export function useAgentBoard() {
  const [board, setBoard] = useState<AgentBoard>(AGENTS_DEMO ? DEMO_BOARD : { agents: [] });

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    invoke<AgentBoard>("agents_board").then(setBoard).catch(() => {});
    void listen<AgentBoard>("agents-board", (event) => setBoard(event.payload)).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const clear = (agentId?: string) => {
    if (AGENTS_DEMO) {
      setBoard((current) => ({ agents: agentId ? current.agents.filter((agent) => agent.id !== agentId) : [] }));
      return;
    }
    void invoke<AgentBoard>("agents_clear", { agentId: agentId ?? null }).then(setBoard).catch(() => {});
  };

  return { board, clear };
}

/** Wires agent notices and "add a task for the user" requests into the app. */
export function useAgentEvents(onNotice: (notice: AgentNotice) => void, onAddTodo: (title: string, agent: string) => void) {
  useEffect(() => {
    if (!isTauri()) return;
    const stops: (() => void)[] = [];
    let cancelled = false;
    void listen<AgentNotice>("agents-notice", (event) => onNotice(event.payload)).then((stop) =>
      cancelled ? stop() : stops.push(stop),
    );
    void listen<{ title: string; agent: string }>("agents-add-todo", (event) =>
      onAddTodo(event.payload.title, event.payload.agent),
    ).then((stop) => (cancelled ? stop() : stops.push(stop)));
    return () => {
      cancelled = true;
      stops.forEach((stop) => stop());
    };
    // The handlers are stable callbacks from the app.
  }, [onNotice, onAddTodo]);
}
