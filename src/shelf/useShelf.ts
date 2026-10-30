import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { startDrag } from "@crabnebula/tauri-plugin-drag";

/** Mirrors `ShelfItem` in src-tauri/src/shelf.rs. */
export type ShelfItem = {
  id: string;
  path: string;
  name: string;
  kind: "folder" | "image" | "video" | "audio" | "archive" | "document" | "code" | "file";
  size: number | null;
  exists: boolean;
  addedAt: number;
  thumbnail: string | null;
};

export const SHELF_DEMO =
  import.meta.env.DEV &&
  !isTauri() &&
  new URLSearchParams(window.location.search).get("demo") === "shelf";

const DEMO_ITEMS: ShelfItem[] = [
  { id: "1", path: "C:\\Users\\Eu\\Desktop\\contrato-vaultpay.pdf", name: "contrato-vaultpay.pdf", kind: "document", size: 482_113, exists: true, addedAt: Date.now(), thumbnail: null },
  { id: "2", path: "C:\\Users\\Eu\\Pictures\\print-nimbo.png", name: "print-nimbo.png", kind: "image", size: 1_204_331, exists: true, addedAt: Date.now(), thumbnail: null },
  { id: "3", path: "C:\\Users\\Eu\\Downloads\\nimbo-assets", name: "nimbo-assets", kind: "folder", size: null, exists: true, addedAt: Date.now(), thumbnail: null },
  { id: "4", path: "C:\\Users\\Eu\\Music\\jatuh-suka.mp3", name: "jatuh-suka.mp3", kind: "audio", size: 3_912_000, exists: true, addedAt: Date.now(), thumbnail: null },
  { id: "5", path: "C:\\Users\\Eu\\Desktop\\antigo.zip", name: "antigo.zip", kind: "archive", size: 88_000, exists: false, addedAt: Date.now(), thumbnail: null },
];

export function formatSize(bytes: number | null, localeTag: string) {
  if (bytes === null) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(localeTag, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`;
}

/**
 * Shelf contents plus file drops on the island window. `onDragEnter` lets the
 * app open the shelf while files hover over the island.
 */
export function useShelf(handlers: { onDragEnter: () => void; onAdded: (count: number) => void }) {
  const [items, setItems] = useState<ShelfItem[]>(SHELF_DEMO ? DEMO_ITEMS : []);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const iconRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    try {
      setItems(await invoke<ShelfItem[]>("shelf_list"));
    } catch (reason) {
      setError(String(reason));
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!isTauri()) return;
    invoke<string>("shelf_drag_icon").then((path) => (iconRef.current = path)).catch(() => {});
    let stop: (() => void) | undefined;
    let cancelled = false;
    void getCurrentWebview()
      .onDragDropEvent(async (event) => {
        const payload = event.payload;
        if (payload.type === "enter") {
          setIsDragOver(true);
          handlersRef.current.onDragEnter();
        } else if (payload.type === "leave") {
          setIsDragOver(false);
        } else if (payload.type === "drop") {
          setIsDragOver(false);
          if (!payload.paths.length) return;
          try {
            const next = await invoke<ShelfItem[]>("shelf_add", { paths: payload.paths });
            setItems(next);
            setError(null);
            handlersRef.current.onAdded(payload.paths.length);
          } catch (reason) {
            setError(String(reason));
          }
        }
      })
      .then((unlisten) => (cancelled ? unlisten() : (stop = unlisten)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [refresh]);

  const remove = useCallback(async (id?: string) => {
    if (SHELF_DEMO) {
      setItems((current) => (id ? current.filter((item) => item.id !== id) : []));
      return;
    }
    await invoke("shelf_remove", { id: id ?? null }).catch((reason) => setError(String(reason)));
    await refresh();
  }, [refresh]);

  const open = useCallback((id: string) => {
    if (isTauri()) void invoke("shelf_open", { id }).catch((reason) => setError(String(reason)));
  }, []);

  const reveal = useCallback((id: string) => {
    if (isTauri()) void invoke("shelf_reveal", { id }).catch((reason) => setError(String(reason)));
  }, []);

  /** Hands the files to the OS drag-and-drop, as if dragged from Explorer. */
  const dragOut = useCallback((paths: string[]) => {
    if (!isTauri() || !iconRef.current || paths.length === 0) return;
    void startDrag({ item: paths, icon: iconRef.current }).catch((reason) => setError(String(reason)));
  }, []);

  return { items, isDragOver, error, remove, open, reveal, dragOut };
}
