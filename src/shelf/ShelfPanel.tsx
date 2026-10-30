import { useRef, type MouseEvent as ReactMouseEvent } from "react";
import {
  Archive,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  Image,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "../i18n";
import type { IslandTab } from "../IslandTabs";
import { PageChrome } from "../island/PageChrome";
import { formatSize, type ShelfItem } from "./useShelf";

const KIND_ICONS: Record<ShelfItem["kind"], LucideIcon> = {
  folder: Folder,
  image: Image,
  video: FileVideo,
  audio: FileAudio,
  archive: FileArchive,
  document: FileText,
  code: FileCode,
  file: File,
};

/** Pointer travel before a press on an item turns into dragging it out. */
const DRAG_THRESHOLD = 5;

export function ShelfPanel<Page extends string>({
  items,
  isDragOver,
  error,
  onRemove,
  onOpen,
  onReveal,
  onDragOut,
  pages,
  currentPage,
  showPageIcons,
  onPageChange,
}: {
  items: ShelfItem[];
  isDragOver: boolean;
  error: string | null;
  onRemove: (id?: string) => void;
  onOpen: (id: string) => void;
  onReveal: (id: string) => void;
  onDragOut: (paths: string[]) => void;
  pages: IslandTab<Page>[];
  currentPage: Page;
  showPageIcons: boolean;
  onPageChange: (page: Page) => void;
}) {
  const t = useTranslation();
  const copy = t.shelf;
  const pressRef = useRef<{ x: number; y: number; path: string; dragging: boolean } | null>(null);

  const startPress = (event: ReactMouseEvent, item: ShelfItem) => {
    if (event.button !== 0 || !item.exists) return;
    pressRef.current = { x: event.clientX, y: event.clientY, path: item.path, dragging: false };
  };

  const movePress = (event: ReactMouseEvent) => {
    const press = pressRef.current;
    if (!press || press.dragging || (event.buttons & 1) === 0) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) >= DRAG_THRESHOLD) {
      press.dragging = true;
      onDragOut([press.path]);
    }
  };

  return (
    <PageChrome
      icon={Archive}
      iconColor="#ffb340"
      pages={pages}
      currentPage={currentPage}
      showPageIcons={showPageIcons}
      onPageChange={onPageChange}
      className={`shelf-panel${isDragOver ? " shelf-panel--drop" : ""}`}
      label={copy.title}
    >
      {isDragOver || items.length === 0 ? (
        <div className={`shelf-drop${isDragOver ? " shelf-drop--active" : ""}`} role="status">
          <Archive size={26} strokeWidth={2} aria-hidden="true" />
          <strong>{isDragOver ? copy.dropHere : copy.emptyTitle}</strong>
          <span>{isDragOver ? copy.dropHint : copy.emptyHint}</span>
        </div>
      ) : (
        <div className="shelf-panel__body">
          <div className="shelf-panel__head">
            <strong>{copy.count(items.length)}</strong>
            <span>{copy.dragOutHint}</span>
            <button className="shelf-panel__clear" type="button" onClick={() => onRemove()} title={copy.clear} aria-label={copy.clear}>
              <Trash2 size={13} strokeWidth={2.4} />
            </button>
          </div>
          <ul className="shelf-grid" onMouseMove={movePress} onMouseUp={() => (pressRef.current = null)}>
            {items.map((item) => {
              const Icon = KIND_ICONS[item.kind];
              return (
                <li key={item.id} className={`shelf-item${item.exists ? "" : " shelf-item--missing"}`}>
                  <button
                    className="shelf-item__main"
                    type="button"
                    title={item.exists ? `${item.path}\n${copy.openHint}` : copy.missing}
                    onMouseDown={(event) => startPress(event, item)}
                    onDoubleClick={() => item.exists && onOpen(item.id)}
                  >
                    <span className={`shelf-item__preview shelf-item__preview--${item.kind}`}>
                      {item.thumbnail ? <img src={item.thumbnail} alt="" draggable={false} /> : <Icon size={22} strokeWidth={1.9} />}
                    </span>
                    <span className="shelf-item__name">{item.name}</span>
                    <span className="shelf-item__meta">
                      {item.exists ? formatSize(item.size, t.localeTag) || copy.folder : copy.missing}
                    </span>
                  </button>
                  <span className="shelf-item__actions">
                    {item.exists && (
                      <button type="button" title={copy.reveal} aria-label={copy.reveal} onClick={() => onReveal(item.id)}>
                        <FolderOpen size={12} strokeWidth={2.4} />
                      </button>
                    )}
                    <button type="button" title={copy.remove} aria-label={copy.remove} onClick={() => onRemove(item.id)}>
                      <X size={12} strokeWidth={2.6} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {error && <span className="shelf-panel__error">{error}</span>}
        </div>
      )}
    </PageChrome>
  );
}
