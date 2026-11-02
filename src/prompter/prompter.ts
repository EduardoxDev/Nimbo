/** Teleprompter: the script, how fast it scrolls and how long it takes to read. */

export const PROMPTER_KEY = "nimbo-prompter";
export const MIN_WPM = 80;
export const MAX_WPM = 220;
export const DEFAULT_WPM = 140;

export type PrompterState = { script: string; wpm: number; fontSize: number };
export const DEFAULT_PROMPTER: PrompterState = { script: "", wpm: DEFAULT_WPM, fontSize: 26 };

export function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Seconds to read the whole script at this pace. */
export function readingSeconds(text: string, wpm: number) {
  return Math.round((wordCount(text) / Math.max(1, wpm)) * 60);
}

/** Pixels per second so the text crosses the reading line in exactly that time. */
export function scrollSpeed(contentHeight: number, text: string, wpm: number) {
  const seconds = readingSeconds(text, wpm);
  return seconds > 0 ? contentHeight / seconds : 0;
}

export function clampWpm(wpm: number) {
  return Math.min(MAX_WPM, Math.max(MIN_WPM, Math.round(wpm / 5) * 5));
}

export function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function loadPrompter(storage: Pick<Storage, "getItem"> = window.localStorage): PrompterState {
  try {
    const value = JSON.parse(storage.getItem(PROMPTER_KEY) ?? "null");
    if (!value || typeof value !== "object") return DEFAULT_PROMPTER;
    return {
      script: typeof value.script === "string" ? value.script.slice(0, 50_000) : "",
      wpm: clampWpm(Number(value.wpm) || DEFAULT_WPM),
      fontSize: Math.min(44, Math.max(16, Number(value.fontSize) || DEFAULT_PROMPTER.fontSize)),
    };
  } catch {
    return DEFAULT_PROMPTER;
  }
}

/** "teleprompter", "prompter", "roteiro", "提词器" in the launcher. */
export function isPrompterRequest(query: string) {
  return /^(tele\s?prompter|prompter|teleponto|roteiro|ler roteiro|提词器)$/i.test(query.trim());
}
