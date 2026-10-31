import { identityOf, type MascotMood, type MascotShape } from "../mascot/engine";
import type { AgentBoard, AgentEntry } from "./agentsStore";

/** An agent quiet for this long no longer counts as "working" on the island. */
export const AGENT_STALE_MS = 30 * 60_000;

const RECENT_FINISH_MS = 3 * 60_000;
const MAX_ISLAND_AGENTS = 4;

export type IslandAgent = {
  id: string;
  name: string;
  mood: MascotMood;
  shape: MascotShape;
  color: string;
};

export function agentMood(agent: AgentEntry, board: AgentBoard, now: number): MascotMood {
  if ((board.approvals ?? []).some((approval) => approval.status === "pending" && approval.agent === agent.name)) {
    return "waiting";
  }
  if (agent.state === "waiting") return "waiting";
  if (agent.state === "error") return "error";
  if (agent.state === "done") return "done";
  if (now - agent.updatedAt > AGENT_STALE_MS) return "sleeping";
  return agent.steps.some((step) => step.status === "in_progress") ? "working" : "thinking";
}

export function mascotOf(agent: Pick<AgentEntry, "id" | "name">) {
  return identityOf(agent.name || agent.id);
}

const MOOD_PRIORITY: Record<MascotMood, number> = {
  waiting: 0,
  error: 1,
  working: 2,
  thinking: 3,
  done: 4,
  idle: 5,
  greeting: 5,
  annoyed: 5,
  dizzy: 5,
  sleeping: 6,
};

export function islandAgentsOf(board: AgentBoard, now: number): IslandAgent[] {
  return board.agents
    .map((agent) => ({ agent, mood: agentMood(agent, board, now) }))
    .filter(({ agent, mood }) =>
      mood === "waiting" || mood === "working" || mood === "thinking"
        ? true
        : (mood === "done" || mood === "error") && now - agent.updatedAt < RECENT_FINISH_MS,
    )
    .sort((a, b) => MOOD_PRIORITY[a.mood] - MOOD_PRIORITY[b.mood] || b.agent.updatedAt - a.agent.updatedAt)
    .slice(0, MAX_ISLAND_AGENTS)
    .map(({ agent, mood }) => ({ id: agent.id, name: agent.name, mood, ...mascotOf(agent) }));
}

