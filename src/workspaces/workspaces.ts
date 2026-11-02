/**
 * "Where did I leave off?": a project is the apps that were open and the
 * files and folders used recently, saved by name and reopened in one click.
 */

export type WorkspaceItem = { name: string; path: string };
export type Workspace = { id: string; name: string; savedAt: number; apps: WorkspaceItem[]; files: WorkspaceItem[] };

export const WORKSPACES_KEY = "nimbo-workspaces";
const MAX_WORKSPACES = 20;

function items(value: unknown): WorkspaceItem[] {
  return Array.isArray(value)
    ? value.filter((item): item is WorkspaceItem => !!item && typeof item.name === "string" && typeof item.path === "string").slice(0, 12)
    : [];
}

export function parseWorkspaces(raw: string | null): Workspace[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === "string" && typeof item.name === "string" && Number.isFinite(item.savedAt))
      .map((item) => ({ id: item.id, name: item.name.slice(0, 60), savedAt: item.savedAt, apps: items(item.apps), files: items(item.files) }))
      .slice(0, MAX_WORKSPACES);
  } catch {
    return [];
  }
}

function key(name: string) {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Saving again under the same name replaces the old one; the newest comes first. */
export function saveWorkspace(list: Workspace[], workspace: Workspace): Workspace[] {
  return [workspace, ...list.filter((item) => key(item.name) !== key(workspace.name))].slice(0, MAX_WORKSPACES);
}

export function findWorkspace(list: Workspace[], name: string): Workspace | null {
  const wanted = key(name);
  return list.find((item) => key(item.name) === wanted) ?? list.find((item) => key(item.name).includes(wanted)) ?? null;
}

const SAVE = [/^(?:salv(?:ar|a|e)|guard(?:ar|a|e))\s+(?:o\s+)?projeto\s+(.+)$/i, /^save\s+(?:the\s+)?(?:project|workspace)\s+(.+)$/i, /^保存项目\s*(.+)$/];
const OPEN = [
  /^(?:abr(?:ir|e)|reabr(?:ir|e)|volt(?:ar|a)\s+(?:a|ao|pro|para\s+o))\s+(?:o\s+)?projeto\s+(.+)$/i,
  /^(?:open|reopen|back\s+to)\s+(?:the\s+)?(?:project|workspace)\s+(.+)$/i,
  /^(?:打开|恢复)项目\s*(.+)$/,
];
const LAST = /^(?:onde\s+(?:eu\s+)?parei\??|where\s+did\s+i\s+(?:leave\s+off|stop)\??|我做到哪了[？?]?)$/i;

export type WorkspaceRequest = { kind: "save"; name: string } | { kind: "open"; name: string } | { kind: "last" };

/** "salvar projeto Nimbo", "abrir projeto Nimbo", "onde eu parei?". */
export function workspaceRequestOf(query: string): WorkspaceRequest | null {
  const text = query.trim();
  if (LAST.test(text)) return { kind: "last" };
  for (const pattern of SAVE) {
    const name = pattern.exec(text)?.[1]?.replace(/[.!]+$/, "").trim();
    if (name) return { kind: "save", name };
  }
  for (const pattern of OPEN) {
    const name = pattern.exec(text)?.[1]?.replace(/[.!]+$/, "").trim();
    if (name) return { kind: "open", name };
  }
  return null;
}
