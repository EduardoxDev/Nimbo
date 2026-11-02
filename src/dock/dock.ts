export type DockWindowInfo = { id: number; title: string; minimized: boolean };
export type DockApp = { path: string; name: string; windows: DockWindowInfo[]; active: boolean };
export type DockItem = { path: string; name: string; pinned: boolean; windows: DockWindowInfo[]; active: boolean };
export type DockSettings = { pinned: string[]; iconSize: number; magnify: boolean };

export const DOCK_HEADROOM = 58;
export const DOCK_BAR_PADDING = 12;
export const DOCK_GAP = 8;
export const NIMBO_SLOT = 1;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function readDockSettings(raw: string | null): DockSettings {
  try {
    const parsed = raw ? (JSON.parse(raw) as { dockPinned?: unknown; dockIconSize?: unknown; dockMagnify?: unknown }) : {};
    const pinned = Array.isArray(parsed.dockPinned) ? parsed.dockPinned.filter((item): item is string => typeof item === "string").slice(0, 30) : [];
    const size = Number(parsed.dockIconSize);
    return {
      pinned,
      iconSize: Number.isFinite(size) ? Math.min(72, Math.max(36, size)) : 48,
      magnify: parsed.dockMagnify !== false,
    };
  } catch {
    return { pinned: [], iconSize: 48, magnify: true };
  }
}

export function nameOf(path: string) {
  const file = path.split(/[\\/]/).pop() ?? path;
  const stem = file.replace(/\.exe$/i, "");
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

export function dockItems(pinned: string[], running: DockApp[]): DockItem[] {
  const items: DockItem[] = pinned.map((path) => {
    const app = running.find((candidate) => same(candidate.path, path));
    return { path, name: app?.name ?? nameOf(path), pinned: true, windows: app?.windows ?? [], active: app?.active ?? false };
  });
  for (const app of running) {
    if (!pinned.some((path) => same(path, app.path))) items.push({ path: app.path, name: app.name, pinned: false, windows: app.windows, active: app.active });
  }
  return items;
}

export function togglePin(pinned: string[], path: string) {
  return pinned.some((item) => same(item, path)) ? pinned.filter((item) => !same(item, path)) : [...pinned, path];
}

export function magnification(index: number, pointer: number | null, slot: number, enabled: boolean) {
  if (!enabled || pointer === null) return 1;
  const distance = Math.abs(index * slot + slot / 2 - pointer) / slot;
  if (distance >= 2.6) return 1;
  return 1 + 0.6 * Math.cos((distance / 2.6) * (Math.PI / 2)) ** 2;
}

export function dockSize(count: number, iconSize: number) {
  const slot = iconSize + DOCK_GAP;
  return { width: (count + NIMBO_SLOT) * slot + DOCK_BAR_PADDING * 2 + 16, height: iconSize + 22 + DOCK_HEADROOM, slot };
}
