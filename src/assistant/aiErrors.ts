import type { Translations } from "../i18n";

const CODES = ["AI_KEY", "AI_LIMIT", "AI_SLOW", "AI_NOT_READY", "OLLAMA_OFF", "OLLAMA_NO_MODEL"] as const;

/** Turns the error codes `ai.rs` returns into a sentence in the user's language. */
export function aiErrorText(t: Translations, error: unknown): string {
  const text = String(error).replace(/^Error:\s*/, "");
  const code = CODES.find((item) => text === item || text.startsWith(`${item}`));
  return code ? t.assistant.errors[code] : text;
}
