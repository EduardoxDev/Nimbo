import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Segment } from "../day/activity";
import { recentDays } from "../automations/learn";
import { demoLogs } from "../demo/learnDemo";
import { buildItems, type CopiedText, type MemoryItem, type RecentFile } from "./memory";

type ClipboardSnapshot = { items: { id: string; kind: string; text?: string; copiedAt: number }[] };

const MEMORY_DAYS = 14;

function demoItems(): MemoryItem[] {
  const now = Date.now();
  const files: RecentFile[] = [
    { path: "C:\\Users\\voce\\Downloads\\contrato-marco.pdf", name: "contrato-marco.pdf", folder: false, at: now - 26 * 3_600_000 },
    { path: "C:\\Users\\voce\\Documents\\orcamento-2026.xlsx", name: "orcamento-2026.xlsx", folder: false, at: now - 3 * 3_600_000 },
    { path: "C:\\Users\\voce\\Pictures\\Screenshots\\print-dashboard.png", name: "print-dashboard.png", folder: false, at: now - 50 * 60_000 },
  ];
  const copies: CopiedText[] = [
    { id: "1", text: "https://github.com/EduardoxDev/Nimbo", copiedAt: now - 20 * 60_000 },
    { id: "2", text: "Reunião com o time às 15h, levar o plano da Casa", copiedAt: now - 5 * 3_600_000 },
  ];
  const days = demoLogs().map((log) => ({
    segments: log.segments.map((segment) => ({
      ...segment,
      title:
        segment.app === "chrome.exe"
          ? "Rust ownership explained - DEV Community - Google Chrome"
          : segment.app === "code.exe"
            ? "App.tsx - nimbo - Visual Studio Code"
            : segment.app === "notion.exe"
              ? "Plano da semana - Notion"
              : segment.app === "ms-teams.exe"
                ? "Reunião de planejamento | Microsoft Teams"
                : segment.app.replace(/\.exe$/, ""),
    })),
  }));
  return buildItems(days, files, copies);
}

export async function loadMemory(): Promise<MemoryItem[]> {
  if (!isTauri()) return import.meta.env.DEV ? demoItems() : [];
  const [days, files, clipboard] = await Promise.all([
    Promise.all(recentDays(new Date(), MEMORY_DAYS).map((day) => invoke<Segment[]>("activity_day", { day }).then((segments) => ({ segments })).catch(() => ({ segments: [] as Segment[] })))),
    invoke<RecentFile[]>("memory_recent_files", { days: MEMORY_DAYS }).catch(() => [] as RecentFile[]),
    invoke<ClipboardSnapshot>("get_clipboard_history").catch(() => ({ items: [] }) as ClipboardSnapshot),
  ]);
  const copies = clipboard.items.filter((item) => item.kind === "text" && item.text).map((item) => ({ id: item.id, text: item.text ?? "", copiedAt: item.copiedAt }));
  return buildItems(days, files, copies);
}
