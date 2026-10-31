import assert from "node:assert/strict";
import test from "node:test";
import { agentMood, islandAgentsOf } from "../src/agents/moods.ts";

const now = 10_000_000;
const agent = (id, state, minutesAgo, inProgress = true) => ({
  id,
  name: id,
  goal: null,
  steps: [{ title: "x", status: inProgress ? "in_progress" : "pending" }],
  state,
  message: null,
  updatedAt: now - minutesAgo * 60_000,
});

test("moods follow what the agent is doing", () => {
  const board = { agents: [], approvals: [{ id: "a", agent: "ask", question: "q", status: "pending", createdAt: now }] };
  assert.equal(agentMood(agent("ask", "working", 0), board, now), "waiting");
  assert.equal(agentMood(agent("w", "working", 0), board, now), "working");
  assert.equal(agentMood(agent("t", "working", 0, false), board, now), "thinking");
  assert.equal(agentMood(agent("d", "done", 0), board, now), "done");
  assert.equal(agentMood(agent("e", "error", 0), board, now), "error");
  assert.equal(agentMood(agent("s", "working", 60), board, now), "sleeping");
});

test("the island shows urgent agents first and hides old finished ones", () => {
  const board = {
    agents: [agent("old", "done", 30), agent("busy", "working", 1), agent("broke", "error", 1), agent("ask", "working", 2)],
    approvals: [{ id: "a", agent: "ask", question: "q", status: "pending", createdAt: now }],
  };
  assert.deepEqual(islandAgentsOf(board, now).map((item) => item.id), ["ask", "broke", "busy"]);
});
