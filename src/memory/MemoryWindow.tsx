import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AppWindow, ArrowSquareOut, ClipboardText, Copy, File, FileDoc, FileImage, FilePdf, FileVideo, FileXls, Folder, Globe, Link, LockSimple, MagnifyingGlass, X, type Icon } from "@phosphor-icons/react";
import { useTranslation } from "../i18n";
import { Mascot } from "../mascot/Mascot";
import { searchApps, type LauncherApp } from "../launcher/launcher";
import { groupByDay, parseQuery, search, type MemoryItem } from "./memory";
import { loadMemory } from "./memoryClient";
import "../automations/Automations.css";
import "./Memory.css";

const BROWSERS = /^(chrome|msedge|firefox|brave|opera|vivaldi|arc)\.exe$/;
const LOGO_COLOR = "#5ac8fa";

function iconOf(item: MemoryItem): Icon {
  if (item.kind === "copy") return item.url ? Link : ClipboardText;
  if (item.kind === "window") return BROWSERS.test(item.app ?? "") ? Globe : AppWindow;
  if (item.folder) return Folder;
  const extension = item.title.toLowerCase().split(".").pop() ?? "";
  if (extension === "pdf") return FilePdf;
  if (["xlsx", "xls", "csv"].includes(extension)) return FileXls;
  if (["docx", "doc", "txt", "md"].includes(extension)) return FileDoc;
  if (["png", "jpg", "jpeg", "webp", "gif", "heic"].includes(extension)) return FileImage;
  if (["mp4", "mov", "mkv", "webm"].includes(extension)) return FileVideo;
  return File;
}

export default function MemoryWindow() {
  const t = useTranslation();
  const copy = t.memory;
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<{ id: number; text: string; bad?: boolean } | null>(null);
  const toastTimer = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const win = isTauri() ? getCurrentWindow() : null;

  useEffect(() => {
    document.documentElement.classList.add("automations-root");
    let cancelled = false;
    void loadMemory()
      .then((found) => !cancelled && setItems(found))
      .catch(() => !cancelled && setItems([]));
    inputRef.current?.focus();
    return () => {
      cancelled = true;
    };
  }, []);

  const notify = (text: string, bad = false) => {
    window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, bad });
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };

  const results = useMemo(() => (items ? search(items, parseQuery(query, new Date()), 80) : []), [items, query]);
  const groups = useMemo(() => groupByDay(results), [results]);

  const today = new Date();
  const dayLabel = (day: number) => {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    if (day === start) return copy.today;
    if (day === start - 86_400_000) return copy.yesterday;
    return new Date(day).toLocaleDateString(t.localeTag, { weekday: "long", day: "numeric", month: "short" });
  };
  const clock = (at: number) => new Date(at).toLocaleTimeString(t.localeTag, { hour: "2-digit", minute: "2-digit" });

  const open = async (item: MemoryItem) => {
    try {
      if (item.kind === "file" && item.path) {
        if (isTauri()) await invoke("memory_open_file", { path: item.path });
        return;
      }
      if (item.url) {
        await openUrl(item.url);
        return;
      }
      if (item.kind === "copy") {
        await navigator.clipboard.writeText(item.title);
        notify(copy.copied);
        return;
      }
      if (BROWSERS.test(item.app ?? "")) {
        await openUrl(`https://www.google.com/search?q=${encodeURIComponent(item.title)}`);
        return;
      }
      if (isTauri()) {
        const apps = await invoke<LauncherApp[]>("launcher_apps");
        const app = searchApps(apps, item.subtitle)[0];
        if (!app) throw new Error(item.subtitle);
        await invoke("launcher_open", { id: app.id });
      }
    } catch {
      notify(copy.openFailed, true);
    }
  };

  const actionOf = (item: MemoryItem): { label: string; icon: Icon } => {
    if (item.kind === "copy" && !item.url) return { label: copy.copy, icon: Copy };
    if (item.kind === "window" && BROWSERS.test(item.app ?? "")) return { label: copy.searchWeb, icon: MagnifyingGlass };
    return { label: copy.open, icon: ArrowSquareOut };
  };

  const chips: { label: string; value: string }[] = [
    { label: copy.chips.today, value: copy.chipQueries.today },
    { label: copy.chips.yesterday, value: copy.chipQueries.yesterday },
    { label: copy.chips.links, value: copy.chipQueries.links },
    { label: copy.chips.files, value: copy.chipQueries.files },
    { label: copy.chips.copies, value: copy.chipQueries.copies },
  ];

  return (
    <div className="na na--solo">
      <header className="na-top" data-tauri-drag-region>
        <button type="button" className="na-top__close" aria-label={copy.close} title={copy.close} onClick={() => void win?.close()}>
          <X size={15} />
        </button>
      </header>
      <main className="na-main">
        <div className="na-page nm-page">
          <div className="nm-brand" data-tauri-drag-region>
            <Mascot mood="idle" shape="drop" color={LOGO_COLOR} seed="memoria" size={34} showDot={false} fps={10} />
            <strong>
              Nimbo <em>{copy.titleShort}</em>
            </strong>
          </div>
          <h1 className="nm-title">{copy.headline}</h1>
          <label className="nm-search">
            <MagnifyingGlass size={20} />
            <input ref={inputRef} value={query} placeholder={copy.placeholder} aria-label={copy.placeholder} onChange={(event) => setQuery(event.currentTarget.value)} />
            {query && (
              <button type="button" className="na-tool" aria-label={copy.clear} onClick={() => setQuery("")}>
                <X size={14} />
              </button>
            )}
          </label>
          <div className="nm-chips">
            {chips.map((chip) => (
              <button key={chip.label} type="button" className={query === chip.value ? "is-on" : ""} onClick={() => setQuery(query === chip.value ? "" : chip.value)}>
                {chip.label}
              </button>
            ))}
          </div>

          {items === null ? (
            <p className="nm-status">{copy.loading}</p>
          ) : items.length === 0 ? (
            <div className="na-empty">
              <Mascot mood="sleeping" shape="drop" color={LOGO_COLOR} seed="memoria" size={76} showDot={false} fps={8} />
              <strong>{copy.nothingYet}</strong>
              <span>{copy.nothingYetHint}</span>
            </div>
          ) : results.length === 0 ? (
            <div className="na-empty na-empty--small">
              <strong>{copy.empty}</strong>
              <span>{copy.emptyHint}</span>
            </div>
          ) : (
            <>
              <p className="nm-status">{copy.count(results.length)}</p>
              {groups.map((group) => (
                <section key={group.day} className="na-day-group">
                  <h2>{dayLabel(group.day)}</h2>
                  <ul className="na-list">
                    {group.items.map((item) => {
                      const ItemIcon = iconOf(item);
                      const action = actionOf(item);
                      const minutes = item.kind === "window" ? Math.round((item.end - item.at) / 60_000) : 0;
                      return (
                        <li key={item.id} className="na-row nm-row">
                          <span className="nm-time">{clock(item.at)}</span>
                          <span className="na-glyph" style={{ width: 34, height: 34 }} aria-hidden="true">
                            <ItemIcon size={18} weight="duotone" />
                          </span>
                          <div className="na-row__text">
                            <strong title={item.title}>{item.title}</strong>
                            <span className="na-row__then">
                              <span className="na-row__sentence">
                                {[copy.kinds[item.kind], item.subtitle, minutes > 0 ? copy.minutes(minutes) : ""].filter(Boolean).join(" · ")}
                              </span>
                            </span>
                          </div>
                          <button type="button" className="na-btn nm-open" onClick={() => void open(item)}>
                            <action.icon size={14} />
                            {action.label}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </>
          )}
          <p className="na-privacy">
            <LockSimple size={13} />
            {copy.privacy}
          </p>
        </div>
      </main>
      {toast && (
        <div key={toast.id} className={`na-toast nm-toast${toast.bad ? " is-bad" : ""}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}
