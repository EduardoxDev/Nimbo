import { useCallback, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { AGENT_MAX_STEPS, needsApproval, parsePlan, type ApprovalRequest, type PlanStep } from "./agent";

/** API message shape, kept exactly as Claude returns it (thinking blocks included). */
type ContentBlock = { type: string; [key: string]: unknown };
type ApiMessage = { role: "user" | "assistant"; content: ContentBlock[] };

type StepResult = { stopReason: string; content: ContentBlock[] };

export type ChatEntry = {
  id: string;
  role: "user" | "assistant" | "notice";
  text: string;
  /** Tools the assistant used to produce this answer, for a small "did X" line. */
  actions?: string[];
};

/** Runs one local tool and returns text for Claude, or throws to report an error. */
export type ToolExecutor = (name: string, input: Record<string, unknown>) => Promise<string>;

/** Long histories start fresh instead of being trimmed (editing past turns breaks thinking replay). */
const MAX_MESSAGES = 60;

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const ASSISTANT_DEMO =
  import.meta.env.DEV &&
  !isTauri() &&
  new URLSearchParams(window.location.search).get("demo") === "assistant";

const DEMO_CHAT: ChatEntry[] = [
  { id: "1", role: "user", text: "liga o ar em 22 e começa um foco" },
  { id: "2", role: "assistant", text: "Pronto: ar ligado no frio a 22° e foco de 25 minutos rodando. Bom trabalho!", actions: ["air_conditioner", "focus_timer"] },
  { id: "3", role: "user", text: "o que ainda tenho pra hoje?" },
  { id: "4", role: "assistant", text: "Faltam duas: revisar o contrato da VaultPay e comprar o Broadlink RM4 Mini.", actions: ["get_status"] },
];

const DEMO_AGENT = ASSISTANT_DEMO && new URLSearchParams(window.location.search).has("agent");
const DEMO_PLAN: PlanStep[] = [
  { text: "Achar a pasta do projeto Nimbo", status: "done" },
  { text: "Abrir no VS Code", status: "done" },
  { text: "Subir o servidor (pnpm dev)", status: "doing" },
  { text: "Abrir localhost:1420 no navegador", status: "pending" },
  { text: "Tocar a playlist de foco", status: "pending" },
];

export function useAssistant(execute: ToolExecutor, context: () => string) {
  const [entries, setEntries] = useState<ChatEntry[]>(DEMO_AGENT ? [{ id: "a1", role: "user", text: "Prepara meu projeto Nimbo pra programar" }] : ASSISTANT_DEMO ? DEMO_CHAT : []);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<PlanStep[] | null>(DEMO_AGENT ? DEMO_PLAN : null);
  const [approval, setApproval] = useState<ApprovalRequest | null>(DEMO_AGENT ? { id: "demo", tool: "run_in_terminal", input: { command: "pnpm dev", folder: "C:/Users/voce/nimbo" } } : null);
  const approvalRef = useRef<((approved: boolean) => void) | null>(null);
  const messagesRef = useRef<ApiMessage[]>([]);

  const answer = useCallback((approved: boolean) => {
    const resolve = approvalRef.current;
    approvalRef.current = null;
    setApproval(null);
    resolve?.(approved);
  }, []);

  const ask = (tool: string, input: Record<string, unknown>) =>
    new Promise<boolean>((resolve) => {
      approvalRef.current = resolve;
      setApproval({ id: newId(), tool, input });
    });

  const reset = useCallback(() => {
    messagesRef.current = [];
    setEntries([]);
    setPlan(null);
  }, []);

  const send = useCallback(
    async (text: string, labels: { refused: string; longConversation: string }) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      if (messagesRef.current.length > MAX_MESSAGES) {
        messagesRef.current = [];
        setEntries([{ id: newId(), role: "notice", text: labels.longConversation }]);
      }
      setEntries((current) => [...current, { id: newId(), role: "user", text: trimmed }]);
      setBusy(true);
      setPlan(null);

      const messages = messagesRef.current;
      messages.push({
        role: "user",
        content: [
          { type: "text", text: trimmed },
          // Volatile context goes in the newest turn so the cached prefix stays intact.
          { type: "text", text: context() },
        ],
      });

      const actions: string[] = [];
      const lengthBefore = messages.length - 1;
      try {
        for (let step = 0; step < AGENT_MAX_STEPS; step += 1) {
          const result = await invoke<StepResult>("assistant_step", { messages });
          messages.push({ role: "assistant", content: result.content });

          if (result.stopReason === "refusal") {
            setEntries((current) => [...current, { id: newId(), role: "assistant", text: labels.refused }]);
            return;
          }

          const toolUses = result.content.filter((block) => block.type === "tool_use");
          if (result.stopReason !== "tool_use" || toolUses.length === 0) {
            const answer = result.content
              .filter((block) => block.type === "text")
              .map((block) => String(block.text ?? ""))
              .join("\n")
              .trim();
            if (answer) {
              setEntries((current) => [...current, { id: newId(), role: "assistant", text: answer, actions: [...new Set(actions)] }]);
            }
            return;
          }

          // Every tool result for this turn goes back in one user message.
          const results: ContentBlock[] = [];
          for (const block of toolUses) {
            const name = String(block.name);
            const input = (block.input ?? {}) as Record<string, unknown>;
            if (name === "set_plan") {
              setPlan(parsePlan(input));
              results.push({ type: "tool_result", tool_use_id: block.id, content: "The plan is on screen." });
              continue;
            }
            actions.push(name);
            try {
              if (needsApproval(name, input) && !(await ask(name, input))) {
                results.push({ type: "tool_result", tool_use_id: block.id, content: "The user declined this step. Do not retry it.", is_error: true });
                continue;
              }
              const output = await execute(name, input);
              results.push({ type: "tool_result", tool_use_id: block.id, content: output });
            } catch (error) {
              results.push({ type: "tool_result", tool_use_id: block.id, content: String(error), is_error: true });
            }
          }
          messages.push({ role: "user", content: results });
        }
      } catch (error) {
        // Failing on the first request: drop only the unanswered message. Failing later:
        // start over, since cutting answered turns out of the history is not allowed.
        if (messages.length === lengthBefore + 1) {
          messages.pop();
        } else {
          messagesRef.current = [];
        }
        setEntries((current) => [...current, { id: newId(), role: "notice", text: String(error) }]);
      } finally {
        approvalRef.current = null;
        setApproval(null);
        setBusy(false);
      }
    },
    [busy, context, execute],
  );

  /**
   * A request answered on the PC without Claude (like "toca Anitta"). It is
   * shown in the chat but kept out of the API history.
   */
  const handleLocally = useCallback(async (text: string, answer: () => Promise<{ text: string; action: string }>) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setEntries((current) => [...current, { id: newId(), role: "user", text: trimmed }]);
    setBusy(true);
    try {
      const result = await answer();
      setEntries((current) => [...current, { id: newId(), role: "assistant", text: result.text, actions: [result.action] }]);
    } catch (error) {
      setEntries((current) => [...current, { id: newId(), role: "notice", text: String(error) }]);
    } finally {
      setBusy(false);
    }
  }, []);

  return { entries, busy, send, reset, handleLocally, plan, approval, answer };
}
