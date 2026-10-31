import { invoke, isTauri } from "@tauri-apps/api/core";

export async function listenOnce(language: string): Promise<string> {
  if (!isTauri()) return "";
  return invoke<string>("speech_listen", { language });
}

export function cancelListening() {
  if (isTauri()) void invoke("speech_cancel").catch(() => {});
}

export function speak(text: string, language: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !text.trim()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language;
  const voice = window.speechSynthesis.getVoices().find((item) => item.lang.toLowerCase().startsWith(language.toLowerCase().slice(0, 2)));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
