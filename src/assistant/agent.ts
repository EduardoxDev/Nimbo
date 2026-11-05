export type PlanStatus = "pending" | "doing" | "done" | "failed";
export type PlanStep = { text: string; status: PlanStatus };
export type ApprovalRequest = { id: string; tool: string; input: Record<string, unknown> };

const STATUSES: PlanStatus[] = ["pending", "doing", "done", "failed"];
export const AGENT_MAX_STEPS = 24;

export function parsePlan(input: Record<string, unknown>): PlanStep[] {
  const steps = Array.isArray(input.steps) ? input.steps : [];
  return steps
    .map((step) => {
      const value = (step ?? {}) as Record<string, unknown>;
      const text = String(value.text ?? "").trim().slice(0, 140);
      const status = STATUSES.includes(value.status as PlanStatus) ? (value.status as PlanStatus) : "pending";
      return { text, status };
    })
    .filter((step) => step.text)
    .slice(0, 12);
}

export function needsApproval(name: string, input: Record<string, unknown>) {
  switch (name) {
    case "move_files":
    case "run_in_terminal":
      return true;
    case "free_space":
      return input.confirm === true;
    case "shutdown_timer":
      return Number(input.minutes) > 0;
    default:
      return false;
  }
}

export function folderName(path: unknown) {
  const text = String(path ?? "").replace(/[\\/]+$/, "");
  return text.split(/[\\/]/).pop() || text;
}

/**
 * The full detail under an approval: the one-line summary is cut with "…", and what gets
 * approved must be visible whole (every file name and the real destination, the whole command).
 */
export function approvalDetail(tool: string, input: Record<string, unknown>) {
  if (tool === "move_files") {
    const files = Array.isArray(input.files) ? input.files.map(folderName) : [];
    const shown = files.slice(0, 6).join(", ");
    const more = files.length > 6 ? ` +${files.length - 6}` : "";
    return `${shown}${more} → ${String(input.to ?? "")}`;
  }
  if (tool === "run_in_terminal") return `${String(input.command ?? "")}\n${String(input.folder ?? "")}`;
  return null;
}

export function planProgress(plan: PlanStep[]) {
  const done = plan.filter((step) => step.status === "done").length;
  return { done, total: plan.length };
}

export function safeUrl(raw: unknown) {
  const text = String(raw ?? "").trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^https?:\/\//i.test(text) && !/^localhost:\d+/i.test(text)) return null;
  const url = /^https?:\/\//i.test(text) ? text : /^localhost(:\d+)?(\/|$)/i.test(text) ? `http://${text}` : `https://${text}`;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}
