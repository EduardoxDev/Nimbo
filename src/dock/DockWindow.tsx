import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { useTranslation } from "../i18n";
import { Mascot } from "../mascot/Mascot";
import { NIMBO_COLOR } from "../mascot/nimboMood";
import { DOCK_BAR_PADDING, dockItems, dockSize, magnification, readDockSettings, togglePin, type DockApp, type DockItem } from "./dock";
import "./Dock.css";

const POLL_MS = 1_500;
const SETTINGS_KEY = "nimbo-settings";

function readSettings() {
  try {
    return readDockSettings(window.localStorage.getItem(SETTINGS_KEY));
  } catch {
    return readDockSettings(null);
  }
}

function savePinned(pinned: string[]) {
  try {
    const settings = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "{}") as Record<string, unknown>;
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, dockPinned: pinned }));
  } catch {
    return;
  }
  if (isTauri()) void emitTo("main", "dock-pinned", pinned).catch(() => {});
}

export default function DockWindow() {
  const copy = useTranslation().dock;
  const [settings, setSettings] = useState(readSettings);
  const [running, setRunning] = useState<DockApp[]>([]);
  const [icons, setIcons] = useState<Record<string, string | null>>({});
  const [pointer, setPointer] = useState<number | null>(null);
  const [menu, setMenu] = useState<DockItem | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const requested = useRef(new Set<string>());
  const items = useMemo(() => dockItems(settings.pinned, running), [settings.pinned, running]);
  const size = dockSize(items.length, settings.iconSize);

  useEffect(() => {
    document.documentElement.classList.add("dock-root");
    const onStorage = (event: StorageEvent) => {
      if (event.key === SETTINGS_KEY) setSettings(readSettings());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const load = () => void invoke<DockApp[]>("dock_apps").then(setRunning).catch(() => {});
    load();
    const interval = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    for (const item of items) {
      if (requested.current.has(item.path)) continue;
      requested.current.add(item.path);
      void invoke<string | null>("dock_icon", { path: item.path })
        .then((icon) => setIcons((current) => ({ ...current, [item.path]: icon ? `data:image/png;base64,${icon}` : null })))
        .catch(() => {});
    }
  }, [items]);

  useEffect(() => {
    if (isTauri()) void invoke("dock_resize", { width: size.width, height: size.height, bar: settings.iconSize + 22 }).catch(() => {});
  }, [size.width, size.height, settings.iconSize]);

  const open = (item: DockItem) => {
    setMenu(null);
    if (!isTauri()) return;
    const target = item.windows.find((window) => !window.minimized) ?? item.windows[0];
    if (target) void invoke("dock_focus", { id: target.id }).catch(() => {});
    else void invoke("open_program", { path: item.path }).catch(() => {});
  };

  const pin = (item: DockItem) => {
    const pinned = togglePin(settings.pinned, item.path);
    setSettings((current) => ({ ...current, pinned }));
    savePinned(pinned);
    setMenu(null);
  };

  const closeAll = (item: DockItem) => {
    setMenu(null);
    for (const window of item.windows) void invoke("dock_close", { id: window.id }).catch(() => {});
  };

  const openIsland = () => {
    if (isTauri()) void emitTo("main", "dock-open-island").catch(() => {});
  };

  return (
    <div className="nimbo-dock" onPointerLeave={() => setPointer(null)} onClick={() => setMenu(null)}>
      {menu && (
        <div className="nimbo-dock__menu" role="menu" onClick={(event) => event.stopPropagation()}>
          <strong>{menu.name}</strong>
          {menu.windows.length === 0 ? null : (
            <button type="button" role="menuitem" onClick={() => open(menu)}>
              {copy.show}
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => void invoke("open_program", { path: menu.path }).catch(() => {}).finally(() => setMenu(null))}>
            {copy.newWindow}
          </button>
          <button type="button" role="menuitem" onClick={() => pin(menu)}>
            {menu.pinned ? copy.unpin : copy.pin}
          </button>
          {menu.windows.length > 0 && (
            <button type="button" role="menuitem" className="nimbo-dock__danger" onClick={() => closeAll(menu)}>
              {menu.windows.length === 1 ? copy.close : copy.closeAll(menu.windows.length)}
            </button>
          )}
        </div>
      )}
      <div
        className="nimbo-dock__bar"
        style={{ height: settings.iconSize + 22, padding: `0 ${DOCK_BAR_PADDING}px` }}
        onPointerMove={(event) => setPointer(event.clientX - event.currentTarget.getBoundingClientRect().left - DOCK_BAR_PADDING)}
      >
        <button
          type="button"
          className="nimbo-dock__item nimbo-dock__item--nimbo"
          style={{ width: size.slot, ["--scale" as string]: magnification(0, pointer, size.slot, settings.magnify) }}
          title={copy.nimbo}
          aria-label={copy.nimbo}
          onClick={openIsland}
        >
          <span className="nimbo-dock__icon" style={{ width: settings.iconSize, height: settings.iconSize }}>
            <Mascot mood="idle" shape="cloud" color={NIMBO_COLOR} seed="nimbo" size={settings.iconSize - 6} showDot={false} fps={6} />
          </span>
        </button>
        <span className="nimbo-dock__divider" aria-hidden="true" />
        {items.map((item, index) => {
          const scale = magnification(index + 1, pointer, size.slot, settings.magnify);
          return (
            <button
              key={item.path}
              type="button"
              className={`nimbo-dock__item${item.active ? " nimbo-dock__item--active" : ""}`}
              style={{ width: size.slot, ["--scale" as string]: scale }}
              aria-label={item.name}
              onPointerEnter={() => setHovered(item.path)}
              onPointerLeave={() => setHovered((current) => (current === item.path ? null : current))}
              onClick={(event) => {
                event.stopPropagation();
                open(item);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setMenu(item);
              }}
            >
              {hovered === item.path && <span className="nimbo-dock__label">{item.windows.length === 1 ? item.windows[0].title || item.name : item.name}</span>}
              <span className="nimbo-dock__icon" style={{ width: settings.iconSize, height: settings.iconSize }}>
                {icons[item.path] ? <img src={icons[item.path] ?? ""} alt="" draggable={false} /> : <span className="nimbo-dock__letter">{item.name.charAt(0)}</span>}
              </span>
              {item.windows.length > 0 && (
                <span className="nimbo-dock__dots" aria-hidden="true">
                  {item.windows.slice(0, 3).map((window) => (
                    <i key={window.id} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
