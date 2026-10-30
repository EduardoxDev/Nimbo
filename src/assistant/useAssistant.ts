import { useCallback, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

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

const MAX_STEPS = 8;
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

export function useAssistant(execute: ToolExecutor, context: () => string) {
  const [entries, setEntries] = useState<ChatEntry[]>(ASSISTANT_DEMO ? DEMO_CHAT : []);
  const [busy, setBusy] = useState(false);
  const messagesRef = useRef<ApiMessage[]>([]);

  const reset = useCallback(() => {
    messagesRef.current = [];
    setEntries([]);
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
        for (let step = 0; step < MAX_STEPS; step += 1) {
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
            actions.push(name);
            try {
              const output = await execute(name, (block.input ?? {}) as Record<string, unknown>);
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
        setBusy(false);
      }
    },
    [busy, context, execute],
  );

  return { entries, busy, send, reset };
}
