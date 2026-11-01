import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Headphones,
  Heart,
  History,
  House,
  Loader2,
  AudioLines,
  Check,
  Copy,
  Disc,
  Ellipsis,
  GripVertical,
  Gauge,
  ListEnd,
  ListMusic,
  ListPlus,
  ListStart,
  MicVocal,
  Pencil,
  Plus,
  Minus,
  MoonStar,
  Music2,
  Palette,
  Radio,
  Repeat,
  Repeat1,
  Search,
  ShieldAlert,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  User,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useTranslation, type Translations } from "../i18n";
import { Mascot } from "../mascot/Mascot";
import { NIMBO_COLOR } from "../mascot/nimboMood";
import type { MascotMood } from "../mascot/engine";
import {
  LIKES_KEY,
  RECENT_KEY,
  catalog,
  dominantColor,
  formatDuration,
  loadMotion,
  loadTracks,
  saveMotion,
  saveTracks,
  toggleLike,
  withRecent,
  yearOf,
  type Album,
  type Artist,
  type ExternalService,
  type LyricsAnswer,
  type MotionPreference,
  type Track,
} from "./catalog";
import { usePreviewPlayer, type PreviewPlayer } from "./usePreviewPlayer";
import { PauseGlyph, PlayGlyph, ServiceMark, SkipGlyph } from "./icons";
import {
  addToPlaylist,
  createPlaylist,
  loadPlaylists,
  mosaicOf,
  moveInPlaylist,
  PENDING_KEY,
  PLAYLISTS_KEY,
  removeFromPlaylist,
  savePlaylists,
  takePending,
  type Playlist,
} from "./library";
import { parseLrc } from "../utils/lyrics";
import {
  ACCENTS,
  EQ_BANDS,
  EQ_LIMIT,
  EQ_PRESETS,
  loadSettings,
  rgbOf,
  saveSettings,
  type Accent,
  type EqPreset,
  type MusicSettings,
} from "./settings";
import "./MusicWindow.css";

type View =
  | { kind: "home" }
  | { kind: "search" }
  | { kind: "artist"; id: number }
  | { kind: "album"; id: number }
  | { kind: "likes" }
  | { kind: "recent" }
  | { kind: "settings" }
  | { kind: "playlist"; id: string };

type Music = {
  t: Translations["musicApp"];
  locale: string;
  player: PreviewPlayer;
  /** Latest spectrum, refreshed every frame while music plays. */
  bandsRef: { current: number[] };
  isLiked: (track: Track) => boolean;
  like: (track: Track) => void;
  open: (view: View) => void;
  setTint: (image: string | null) => void;
  /** False when animations are off, here or in Windows. */
  animate: boolean;
  settings: MusicSettings;
  updateSettings: (patch: Partial<MusicSettings>) => void;
  motion: MotionPreference;
  setMotionPreference: (value: MotionPreference) => void;
  sleep: SleepState;
  setSleep: (minutes: number | "end" | null) => void;
  likes: Track[];
  recent: Track[];
  clearLibrary: (which: "likes" | "recent") => void;
  /** Hides explicit songs when the setting asks for it. */
  shownTracks: (tracks: Track[]) => Track[];
  playlists: Playlist[];
  editPlaylists: (change: (playlists: Playlist[]) => Playlist[]) => void;
  notify: (text: string) => void;
  panel: Panel;
  setPanel: (panel: Panel) => void;
  /** Page name shown in the top bar once the page header scrolls away. */
  setHeading: (name: string | null) => void;
};

type Panel = "lyrics" | "queue" | null;

type SleepState = { kind: "off" } | { kind: "end" } | { kind: "at"; endsAt: number; minutes: number };

const MusicContext = createContext<Music | null>(null);

function useMusic(): Music {
  const value = useContext(MusicContext);
  if (!value) throw new Error("useMusic outside MusicWindow");
  return value;
}

type Async<T> = { status: "loading" } | { status: "error" } | { status: "ready"; data: T };

function useAsync<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<Async<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    load().then(
      (data) => !cancelled && setState({ status: "ready", data }),
      (error) => {
        console.error("Nimbo Music failed to load", key, error);
        if (!cancelled) setState({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
    // `key` names everything `load` depends on.
  }, [key, attempt]);
  return { state, retry: () => setAttempt((value) => value + 1) };
}

function sameView(a: View, b: View) {
  return a.kind === b.kind && ("id" in a ? a.id : 0) === ("id" in b ? b.id : 0);
}

const viewKey = (view: View) => `${view.kind}${"id" in view ? view.id : ""}`;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function useSystemReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia(REDUCED_MOTION).matches);
  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION);
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Stagger index for entrance animations, capped so long lists do not lag. */
const stagger = (index: number) => ({ "--i": Math.min(index, 14) }) as CSSProperties;

// ---------- Window ----------

export default function MusicWindow() {
  const tAll = useTranslation();
  const t = tAll.musicApp;
  const locale = tAll.localeTag;
  // Browser-style history: back and forward move `at`; opening a page drops what was ahead.
  const [nav, setNav] = useState<{ stack: View[]; at: number }>({ stack: [{ kind: "home" }], at: 0 });
  const view = nav.stack[nav.at];
  const [heading, setHeading] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [likes, setLikes] = useState<Track[]>(() => loadTracks(LIKES_KEY));
  const [recent, setRecent] = useState<Track[]>(() => loadTracks(RECENT_KEY));
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);
  const [tintImage, setTintImage] = useState<string | null>(null);
  const [tint, setTintColor] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const bandsRef = useRef<number[]>([]);
  const [scrolled, setScrolled] = useState(false);
  const [motion, setMotion] = useState<MotionPreference>(loadMotion);
  const systemReduced = useSystemReducedMotion();
  const animate = motion === "on" || (motion === "system" && !systemReduced);
  const setMotionPreference = (value: MotionPreference) => {
    setMotion(value);
    saveMotion(value);
  };
  const [settings, setSettings] = useState<MusicSettings>(loadSettings);
  const updateSettings = useCallback((patch: Partial<MusicSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);
  const [sleep, setSleepState] = useState<SleepState>({ kind: "off" });
  const [playlists, setPlaylists] = useState<Playlist[]>(loadPlaylists);
  const [panel, setPanel] = useState<Panel>(null);
  const editPlaylists = useCallback((change: (playlists: Playlist[]) => Playlist[]) => {
    setPlaylists((current) => {
      const next = change(current);
      savePlaylists(next);
      return next;
    });
  }, []);
  const notify = useCallback((text: string) => setToast({ text, id: Date.now() }), []);
  const sound = useMemo(
    () => ({ eqGains: settings.eqGains, normalize: settings.normalize, fade: settings.fade, speed: settings.speed }),
    [settings.eqGains, settings.normalize, settings.fade, settings.speed],
  );
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const shownTracks = useCallback(
    (tracks: Track[]) => (settings.hideExplicit ? tracks.filter((track) => !track.explicit) : tracks),
    [settings.hideExplicit],
  );

  const player = usePreviewPlayer({
    sound,
    onStart: (track) =>
      setRecent((items) => {
        const next = withRecent(items, track);
        saveTracks(RECENT_KEY, next);
        return next;
      }),
    onMissing: () => setToast({ text: t.noPreview, id: Date.now() }),
    // Nimbo Radio: the same artist's hits, then a similar artist's.
    onQueueEnd: async (last, played) => {
      const current = settingsRef.current;
      if (!current.autoplay || !last) return null;
      const seen = new Set(played.map((track) => track.id));
      const fresh = (tracks: Track[]) =>
        tracks.filter((track) => !seen.has(track.id) && !(current.hideExplicit && track.explicit));
      try {
        const page = await catalog.artist(last.artistId, locale);
        let next = fresh(page.top);
        let artist = page.artist.name;
        const similar = page.related[Math.floor(Math.random() * Math.min(4, page.related.length))];
        if (next.length < 4 && similar) {
          const other = await catalog.artist(similar.id, locale);
          next = [...next, ...fresh(other.top)];
          artist = other.artist.name;
        }
        if (next.length === 0) return null;
        setToast({ text: t.radioStarted(artist), id: Date.now() });
        return next.sort(() => Math.random() - 0.5).slice(0, 20);
      } catch {
        return null;
      }
    },
  });

  const setSleep = (minutes: number | "end" | null) => {
    player.setStopAfterCurrent(minutes === "end");
    setSleepState(
      minutes === null ? { kind: "off" } : minutes === "end" ? { kind: "end" } : { kind: "at", minutes, endsAt: Date.now() + minutes * 60_000 },
    );
  };

  useEffect(() => {
    if (sleep.kind !== "at") return;
    const timer = window.setTimeout(() => {
      player.pause();
      setSleepState({ kind: "off" });
      setToast({ text: t.sleepDone, id: Date.now() });
    }, Math.max(0, sleep.endsAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [sleep, player.pause, t]);

  // Requests from the island and the voice assistant (see library.ts).
  const playRef = useRef(player.play);
  playRef.current = player.play;
  useEffect(() => {
    const consume = () => {
      const pending = takePending();
      if (pending) void playRef.current(pending.tracks, pending.index);
    };
    consume();
    const onStorage = (event: StorageEvent) => {
      if (event.key === PENDING_KEY && event.newValue) consume();
      if (event.key === PLAYLISTS_KEY) setPlaylists(loadPlaylists());
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", consume);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", consume);
    };
  }, []);

  // "End of song" finished on its own.
  useEffect(() => {
    if (sleep.kind === "end" && !player.stopAfterCurrent) setSleepState({ kind: "off" });
  }, [sleep.kind, player.stopAfterCurrent]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    if (!tintImage) {
      setTintColor(null);
      return;
    }
    void dominantColor(tintImage).then((color) => !cancelled && setTintColor(color));
    return () => {
      cancelled = true;
    };
  }, [tintImage]);

  // One loop feeds every beat-driven animation through CSS variables, so the
  // dance never re-renders React.
  const { playing, readLevels } = player;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (!playing || !animate) {
      root.style.setProperty("--beat", "0");
      bandsRef.current = [];
      return;
    }
    let frame = 0;
    let smooth = 0;
    const loop = (now: number) => {
      const levels = readLevels();
      // Without an analyser, fall back to a gentle 118 bpm pulse.
      const raw = levels ? Math.max(0, (levels.bass - 0.35) / 0.65) : Math.pow(Math.max(0, Math.sin((now / 1000) * Math.PI * (118 / 60))), 6);
      smooth = raw > smooth ? smooth + (raw - smooth) * 0.6 : smooth + (raw - smooth) * 0.12;
      root.style.setProperty("--beat", smooth.toFixed(3));
      bandsRef.current = levels?.bands ?? [];
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      root.style.setProperty("--beat", "0");
    };
  }, [playing, readLevels, animate]);

  const open = useCallback((next: View) => {
    setNav(({ stack, at }) => {
      if (sameView(stack[at], next)) return { stack, at };
      const kept = [...stack.slice(0, at + 1), next].slice(-40);
      return { stack: kept, at: kept.length - 1 };
    });
  }, []);

  const back = useCallback(() => setNav(({ stack, at }) => ({ stack, at: Math.max(0, at - 1) })), []);
  const forward = useCallback(() => setNav(({ stack, at }) => ({ stack, at: Math.min(stack.length - 1, at + 1) })), []);

  // A deleted playlist leaves the history too; if it was on screen, go home.
  useEffect(() => {
    const gone = (item: View) => item.kind === "playlist" && !playlists.some((playlist) => playlist.id === item.id);
    if (!nav.stack.some(gone)) return;
    setNav(({ stack, at }) => {
      const current = stack[at];
      const kept = stack.filter((item) => !gone(item));
      if (gone(current)) {
        const list: View[] = [...kept, { kind: "home" }];
        return { stack: list, at: list.length - 1 };
      }
      return { stack: kept, at: Math.max(0, kept.indexOf(current)) };
    });
  }, [nav.stack, playlists]);

  useEffect(() => {
    setHeading(null);
    setScrolled(false);
  }, [view]);

  // Every page change starts at the top.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [view]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 320);
    return () => window.clearTimeout(timer);
  }, [query]);

  const changeQuery = (value: string) => {
    setQuery(value);
    if (value.trim() && view.kind !== "search") open({ kind: "search" });
  };

  const like = useCallback((track: Track) => {
    setLikes((items) => {
      const next = toggleLike(items, track);
      saveTracks(LIKES_KEY, next);
      return next;
    });
  }, []);
  const likedIds = useMemo(() => new Set(likes.map((track) => track.id)), [likes]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input:not([type='range']), textarea, select, [contenteditable='true']");
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (event.key === " " && !typing && !target?.closest("button, a, input")) {
        event.preventDefault();
        player.toggle();
      } else if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        back();
      } else if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        forward();
      }
    };
    // The mouse's side buttons go back and forward too.
    const onMouse = (event: MouseEvent) => {
      if (event.button === 3) back();
      if (event.button === 4) forward();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
    };
  }, [back, forward, player]);

  const clearLibrary = (which: "likes" | "recent") => {
    if (which === "likes") {
      setLikes([]);
      saveTracks(LIKES_KEY, []);
    } else {
      setRecent([]);
      saveTracks(RECENT_KEY, []);
    }
  };

  const accent = ACCENTS[settings.accent];

  const music: Music = {
    t,
    locale,
    player,
    bandsRef,
    isLiked: (track) => likedIds.has(track.id),
    like,
    open,
    setTint: setTintImage,
    animate,
    settings,
    updateSettings,
    motion,
    setMotionPreference,
    sleep,
    setSleep,
    likes,
    recent,
    clearLibrary,
    shownTracks,
    playlists,
    editPlaylists,
    notify,
    panel,
    setPanel,
    setHeading,
  };

  return (
    <MusicContext.Provider value={music}>
      <div
        ref={rootRef}
        className={`mm${player.playing ? " mm--playing" : ""}${animate ? "" : " mm--still"}${settings.nimboDance ? "" : " mm--no-dance"}`}
        style={
          {
            "--mm-tint": (settings.coverTint && tint) || "rgb(60, 60, 70)",
            "--mm-accent": accent,
            "--mm-accent-rgb": rgbOf(accent),
          } as CSSProperties
        }
      >
        <Sidebar view={view} likes={likes.length} recent={recent.length} onOpen={open} onSearch={() => searchRef.current?.focus()} />
        <div className={`mm-body${panel ? " mm-body--panel" : ""}`}>
          <header className={`mm-top${scrolled ? " mm-top--scrolled" : ""}`} data-tauri-drag-region>
            <div className="mm-top__left" data-tauri-drag-region>
              <button className="mm-nav-btn" type="button" title={`${t.back} (Alt+←)`} aria-label={t.back} disabled={nav.at === 0} onClick={back}>
                <ChevronLeft size={19} strokeWidth={2.4} />
              </button>
              <button
                className="mm-nav-btn"
                type="button"
                title={`${t.forward} (Alt+→)`}
                aria-label={t.forward}
                disabled={nav.at >= nav.stack.length - 1}
                onClick={forward}
              >
                <ChevronRight size={19} strokeWidth={2.4} />
              </button>
              <span className={`mm-top__heading${scrolled && heading ? " mm-top__heading--on" : ""}`} data-tauri-drag-region aria-hidden="true">
                {heading}
              </span>
            </div>
            <label className="mm-search">
              <Search size={16} strokeWidth={2.4} aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder={t.searchPlaceholder}
                aria-label={t.search}
                spellCheck={false}
                onChange={(event) => changeQuery(event.currentTarget.value)}
                onFocus={() => view.kind !== "search" && query.trim() && open({ kind: "search" })}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    if (query) setQuery("");
                    else event.currentTarget.blur();
                  }
                }}
              />
              {query ? (
                <button type="button" className="mm-search__clear" title={t.clearSearch} aria-label={t.clearSearch} onClick={() => setQuery("")}>
                  <X size={14} strokeWidth={2.6} />
                </button>
              ) : (
                <kbd className="mm-search__key" aria-hidden="true">
                  Ctrl K
                </kbd>
              )}
            </label>
            <div className="mm-top__right" data-tauri-drag-region>
              <button
                type="button"
                className={`mm-nav-btn${view.kind === "settings" ? " mm-nav-btn--on" : ""}`}
                title={t.settings}
                aria-label={t.settings}
                onClick={() => open({ kind: "settings" })}
              >
                <SlidersHorizontal size={16} strokeWidth={2.4} />
              </button>
              <span className="mm-top__divider" aria-hidden="true" />
              <WindowControls />
            </div>
          </header>

          <main className="mm-main" ref={mainRef} onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 140)}>
            <div className="mm-glow" aria-hidden="true" />
            <div className="mm-page" key={`${nav.at}-${viewKey(view)}`}>
              {view.kind === "home" && <HomeView />}
              {view.kind === "search" && <SearchView query={debounced} />}
              {view.kind === "artist" && <ArtistView id={view.id} />}
              {view.kind === "album" && <AlbumView id={view.id} />}
              {view.kind === "likes" && <LibraryView kind="likes" tracks={likes} />}
              {view.kind === "recent" && <LibraryView kind="recent" tracks={recent} />}
              {view.kind === "settings" && <SettingsView />}
              {view.kind === "playlist" && <PlaylistView id={view.id} />}
            </div>
          </main>
        </div>
        {panel && <NowPanel />}
        <PlayerBar />
        {toast && (
          <div className="mm-toast" role="status" key={toast.id}>
            <Mascot mood="annoyed" shape="cloud" color={NIMBO_COLOR} seed="nimbo" size={22} showDot={false} forceMotion={animate} />
            <span>{toast.text}</span>
          </div>
        )}
      </div>
    </MusicContext.Provider>
  );
}

/** Round window buttons in a capsule, like the island; close turns red on hover. */
function WindowControls() {
  const { t } = useMusic();
  const win = isTauri() ? getCurrentWindow() : null;
  return (
    <div className="mm-window" data-tauri-drag-region>
      <button type="button" title={t.minimize} aria-label={t.minimize} onClick={() => void win?.minimize()}>
        <Minus size={13} strokeWidth={2.6} />
      </button>
      <button type="button" title={t.maximize} aria-label={t.maximize} onClick={() => void win?.toggleMaximize()}>
        <Square size={10} strokeWidth={2.6} />
      </button>
      <button type="button" className="mm-window__close" title={t.close} aria-label={t.close} onClick={() => void win?.close()}>
        <X size={14} strokeWidth={2.6} />
      </button>
    </div>
  );
}

/** Nimbo with headphones. Bobs with the bass through `--beat`. */
function Nimbo({ size, mood, interactive }: { size: number; mood?: MascotMood; interactive?: boolean }) {
  const { player, t, animate } = useMusic();
  const shown: MascotMood = mood ?? (player.loading && player.current ? "thinking" : player.playing ? "done" : "idle");
  return (
    <span className="mm-nimbo" style={{ width: size, height: size }}>
      <Mascot
        mood={shown}
        shape="cloud"
        color={NIMBO_COLOR}
        seed="nimbo"
        size={size}
        accessory="headphones"
        showDot={false}
        glow={player.playing}
        interactive={interactive}
        forceMotion={animate}
        label={player.playing ? t.nimboPlaying : t.nimboIdle}
      />
    </span>
  );
}

function Sidebar({
  view,
  likes,
  recent,
  onOpen,
  onSearch,
}: {
  view: View;
  likes: number;
  recent: number;
  onOpen: (view: View) => void;
  onSearch: () => void;
}) {
  const { t, playlists, editPlaylists } = useMusic();
  const items: { id: View["kind"]; label: string; icon: typeof House; count?: number; run: () => void }[] = [
    { id: "home", label: t.home, icon: House, run: () => onOpen({ kind: "home" }) },
    {
      id: "search",
      label: t.search,
      icon: Search,
      run: () => {
        onOpen({ kind: "search" });
        onSearch();
      },
    },
  ];
  const library: typeof items = [
    { id: "likes", label: t.likes, icon: Heart, count: likes, run: () => onOpen({ kind: "likes" }) },
    { id: "recent", label: t.recentShort, icon: History, count: recent, run: () => onOpen({ kind: "recent" }) },
  ];
  const more: typeof items = [{ id: "settings", label: t.settings, icon: SlidersHorizontal, run: () => onOpen({ kind: "settings" }) }];
  const renderItem = ({ id, label, icon: Icon, count, run }: (typeof items)[number]) => {
    const active = view.kind === id;
    return (
      <button
        key={id}
        type="button"
        className={`mm-nav__item mm-nav__item--${id}${active ? " mm-nav__item--active" : ""}`}
        aria-current={active ? "page" : undefined}
        title={label}
        onClick={run}
      >
        <span className="mm-nav__icon">
          <Icon size={15} strokeWidth={2.3} fill={id === "likes" && active ? "currentColor" : "none"} />
        </span>
        <span className="mm-nav__label">{label}</span>
        {count ? <span className="mm-nav__count">{count}</span> : null}
      </button>
    );
  };
  return (
    <aside className="mm-side" data-tauri-drag-region>
      <div className="mm-brand" data-tauri-drag-region>
        <Nimbo size={42} interactive />
        <span className="mm-brand__name" data-tauri-drag-region>
          <strong>
            Nimbo <em>Music</em>
          </strong>
        </span>
      </div>
      <nav className="mm-nav" aria-label={t.title}>
        {items.map(renderItem)}
        <p className="mm-nav__heading">{t.library}</p>
        {library.map(renderItem)}
        <p className="mm-nav__heading mm-nav__heading--row">
          {t.playlists}
          <button
            type="button"
            className="mm-nav__add"
            title={t.newPlaylist}
            aria-label={t.newPlaylist}
            onClick={() => {
              const next = createPlaylist(playlists, t.playlistDefault(playlists.length + 1));
              editPlaylists(() => next);
              onOpen({ kind: "playlist", id: next[0].id });
            }}
          >
            <Plus size={14} strokeWidth={2.6} />
          </button>
        </p>
        <div className="mm-nav__playlists">
          {playlists.map((playlist, index) => {
            const active = view.kind === "playlist" && view.id === playlist.id;
            return (
              <button
                key={playlist.id}
                type="button"
                className={`mm-nav__item mm-nav__item--playlist${active ? " mm-nav__item--active" : ""}`}
                aria-current={active ? "page" : undefined}
                title={playlist.name}
                style={stagger(index)}
                onClick={() => onOpen({ kind: "playlist", id: playlist.id })}
              >
                <Mosaic tracks={playlist.tracks} size="nav" />
                <span className="mm-nav__label">{playlist.name}</span>
                {playlist.tracks.length ? <span className="mm-nav__count">{playlist.tracks.length}</span> : null}
              </button>
            );
          })}
        </div>
        <span className="mm-nav__gap" />
        {more.map(renderItem)}
      </nav>
      <footer className="mm-side__foot" title={t.previewNote}>
        <Headphones size={13} strokeWidth={2.4} aria-hidden="true" />
        <span>{t.footNote}</span>
      </footer>
    </aside>
  );
}

// ---------- Building blocks ----------

function Cover({ src, round, size = "md" }: { src: string | null; round?: boolean; size?: "sm" | "md" | "lg" | "xl" }) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  return (
    <span className={`mm-cover mm-cover--${size}${round ? " mm-cover--round" : ""} mm-cover--${state}`} aria-hidden="true">
      {src && state !== "failed" && (
        <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onLoad={() => setState("ready")} onError={() => setState("failed")} />
      )}
      {(!src || state === "failed") && <Music2 size={size === "sm" ? 14 : 26} strokeWidth={1.6} />}
    </span>
  );
}

/** A record that slides out from behind a cover and spins while it plays. */
function Vinyl({ src, spinning }: { src: string | null; spinning: boolean }) {
  return (
    <span className={`mm-vinyl${spinning ? " mm-vinyl--spin" : ""}`} aria-hidden="true">
      <span className="mm-vinyl__disc">
        <span className="mm-vinyl__label" style={src ? { backgroundImage: `url("${src}")` } : undefined} />
      </span>
    </span>
  );
}

function Equalizer() {
  return (
    <span className="mm-eq" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

function NimboState({ mood, text, action }: { mood: MascotMood; text: string; action?: ReactNode }) {
  const { animate } = useMusic();
  return (
    <div className="mm-state" role="status">
      <span className="mm-state__nimbo">
        <Mascot mood={mood} shape="cloud" color={NIMBO_COLOR} seed="nimbo" size={84} accessory="headphones" showDot={false} glow forceMotion={animate} />
      </span>
      <p>{text}</p>
      {action}
    </div>
  );
}

function Loading() {
  const { t } = useMusic();
  return (
    <div className="mm-skeleton" aria-busy="true">
      <NimboState mood="thinking" text={t.loading} />
      <div className="mm-skeleton__row">
        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} style={stagger(index)} />
        ))}
      </div>
    </div>
  );
}

function Failed({ onRetry }: { onRetry: () => void }) {
  const { t } = useMusic();
  return (
    <NimboState
      mood="error"
      text={t.loadError}
      action={
        <button type="button" className="mm-pill" onClick={onRetry}>
          {t.retry}
        </button>
      }
    />
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mm-section">
      <header className="mm-section__head">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

/** A titled row of cards that "Show all" turns into a full grid. */
function Shelf({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useMusic();
  const [all, setAll] = useState(false);
  return (
    <Section
      title={title}
      action={
        <button type="button" className="mm-link-btn" onClick={() => setAll((value) => !value)}>
          {all ? t.showLess : t.showAll}
        </button>
      }
    >
      {all ? (
        <div className="mm-grid-cards" key="grid">
          {children}
        </div>
      ) : (
        <Rail key="rail">{children}</Rail>
      )}
    </Section>
  );
}

function Rail({ children }: { children: ReactNode }) {
  const { t, animate } = useMusic();
  const ref = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const measure = () => {
    const element = ref.current;
    if (!element) return;
    setEdges({
      start: element.scrollLeft < 8,
      end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 8,
    });
  };
  useEffect(measure, [children]);
  const scroll = (direction: 1 | -1) => {
    const element = ref.current;
    if (element) element.scrollBy({ left: direction * element.clientWidth * 0.85, behavior: animate ? "smooth" : "auto" });
  };
  return (
    <div className={`mm-rail-wrap${edges.start ? " mm-rail-wrap--start" : ""}${edges.end ? " mm-rail-wrap--end" : ""}`}>
      <button type="button" className="mm-rail__arrow mm-rail__arrow--left" aria-label={t.scrollLeft} onClick={() => scroll(-1)}>
        <ChevronLeft size={18} />
      </button>
      <div className="mm-rail" ref={ref} onScroll={measure}>
        {children}
      </div>
      <button type="button" className="mm-rail__arrow mm-rail__arrow--right" aria-label={t.scrollRight} onClick={() => scroll(1)}>
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

function AlbumCard({ album, subtitle, index = 0 }: { album: Album; subtitle?: string; index?: number }) {
  const { open, t } = useMusic();
  const year = yearOf(album.releaseDate);
  return (
    <button type="button" className="mm-card" style={stagger(index)} onClick={() => open({ kind: "album", id: album.id })}>
      <span className="mm-card__art">
        <Cover src={album.cover} size="lg" />
        <span className="mm-card__play" aria-hidden="true">
          <PlayGlyph size={19} />
        </span>
      </span>
      <strong>{album.title}</strong>
      <small>{subtitle ?? ([year, album.artistName ?? t.recordType(album.recordType)].filter(Boolean).join(" · "))}</small>
    </button>
  );
}

function ArtistCard({ artist, index = 0 }: { artist: Artist; index?: number }) {
  const { open, t } = useMusic();
  return (
    <button type="button" className="mm-card mm-card--artist" style={stagger(index)} onClick={() => open({ kind: "artist", id: artist.id })}>
      <span className="mm-card__art">
        <Cover src={artist.picture} size="lg" round />
      </span>
      <strong>{artist.name}</strong>
      <small>{t.artist}</small>
    </button>
  );
}

function LikeButton({ track, size = 16 }: { track: Track; size?: number }) {
  const { isLiked, like, t } = useMusic();
  const liked = isLiked(track);
  const [burst, setBurst] = useState(0);
  return (
    <button
      type="button"
      className={`mm-like${liked ? " mm-like--on" : ""}`}
      title={liked ? t.unlike : t.like}
      aria-label={liked ? t.unlike : t.like}
      aria-pressed={liked}
      onClick={(event) => {
        event.stopPropagation();
        if (!liked) setBurst((value) => value + 1);
        like(track);
      }}
    >
      <Heart size={size} fill={liked ? "currentColor" : "none"} strokeWidth={2} />
      {burst > 0 && liked && (
        <span className="mm-like__burst" key={burst} aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            <i key={index} style={{ "--a": `${index * 45}deg` } as CSSProperties} />
          ))}
        </span>
      )}
    </button>
  );
}

function TrackList({
  tracks,
  numbered = true,
  showAlbum = true,
  showCover = true,
  limit,
  onRemove,
  onMove,
}: {
  tracks: Track[];
  numbered?: boolean;
  showAlbum?: boolean;
  showCover?: boolean;
  limit?: number;
  /** Shows "remove from this playlist" in the row menu. */
  onRemove?: (track: Track, index: number) => void;
  /** Lets rows be dragged to a new position. */
  onMove?: (from: number, to: number) => void;
}) {
  const { player, open, t, shownTracks } = useMusic();
  const [expanded, setExpanded] = useState(false);
  tracks = shownTracks(tracks);
  const visible = limit && !expanded ? tracks.slice(0, limit) : tracks;
  const drag = useDragOrder(onMove);
  return (
    <>
      <ol className={`mm-tracks${showAlbum ? "" : " mm-tracks--no-album"}${numbered ? "" : " mm-tracks--plain"}`}>
        {visible.map((track, index) => {
          const isCurrent = player.current?.id === track.id;
          const isPlaying = isCurrent && player.playing;
          return (
            <li key={`${track.id}-${index}`} style={stagger(index)} {...drag.item(index)}>
              <div
                className={`mm-track${isCurrent ? " mm-track--current" : ""}`}
                role="button"
                tabIndex={0}
                aria-label={`${t.play}: ${track.title}, ${track.artistName}`}
                onDoubleClick={() => void player.play(tracks, index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void player.play(tracks, index);
                }}
              >
                {numbered && (
                  <span className="mm-track__index">
                    {isPlaying ? <Equalizer /> : <span className="mm-track__number">{index + 1}</span>}
                  </span>
                )}
                <span className="mm-track__main">
                  {showCover ? (
                    <span className="mm-track__art">
                      <Cover src={track.cover} size="sm" />
                      <TrackPlay track={track} tracks={tracks} index={index} />
                    </span>
                  ) : (
                    !numbered && <TrackPlay track={track} tracks={tracks} index={index} />
                  )}
                  <span className="mm-track__text">
                    <strong>{track.title}</strong>
                    <span>
                      {track.explicit && (
                        <abbr className="mm-explicit" title={t.explicit}>
                          E
                        </abbr>
                      )}
                      <button
                        type="button"
                        className="mm-link"
                        onClick={(event) => {
                          event.stopPropagation();
                          open({ kind: "artist", id: track.artistId });
                        }}
                      >
                        {track.artistName}
                      </button>
                    </span>
                  </span>
                </span>
                {showAlbum && (
                  <span className="mm-track__album">
                    <button
                      type="button"
                      className="mm-link"
                      onClick={(event) => {
                        event.stopPropagation();
                        open({ kind: "album", id: track.albumId });
                      }}
                    >
                      {track.albumTitle}
                    </button>
                  </span>
                )}
                <LikeButton track={track} />
                <span className="mm-track__time">{formatDuration(track.duration)}</span>
                <TrackMenu track={track} onRemove={onRemove ? () => onRemove(track, index) : undefined} />
              </div>
            </li>
          );
        })}
      </ol>
      {limit && tracks.length > limit && (
        <button type="button" className="mm-more" onClick={() => setExpanded((value) => !value)}>
          {expanded ? t.showLess : t.showMore}
        </button>
      )}
    </>
  );
}

function TrackPlay({ track, tracks, index }: { track: Track; tracks: Track[]; index: number }) {
  const { player, t } = useMusic();
  const isCurrent = player.current?.id === track.id;
  const isPlaying = isCurrent && player.playing;
  return (
    <button
      type="button"
      className={`mm-track__play${isPlaying ? " mm-track__play--on" : ""}`}
      title={isPlaying ? t.pause : t.play}
      aria-label={isPlaying ? t.pause : `${t.play}: ${track.title}`}
      onClick={(event) => {
        event.stopPropagation();
        if (isCurrent) player.toggle();
        else void player.play(tracks, index);
      }}
    >
      {isPlaying ? <PauseGlyph size={15} /> : <PlayGlyph size={15} />}
    </button>
  );
}

function PlayButton({ tracks: all, label }: { tracks: Track[]; label?: string }) {
  const { player, t, shownTracks } = useMusic();
  const tracks = shownTracks(all);
  const active = player.current !== null && tracks.some((track) => track.id === player.current?.id);
  const isPlaying = active && player.playing;
  return (
    <button
      type="button"
      className={`mm-play-big${isPlaying ? " mm-play-big--on" : ""}`}
      disabled={tracks.length === 0}
      title={isPlaying ? t.pause : label ?? t.playAll}
      aria-label={isPlaying ? t.pause : label ?? t.playAll}
      onClick={() => (active ? player.toggle() : void player.play(tracks, 0))}
    >
      {isPlaying ? <PauseGlyph size={24} /> : <PlayGlyph size={24} />}
    </button>
  );
}

function useCompact(locale: string) {
  return useMemo(() => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }), [locale]);
}

// ---------- Views ----------

function Greeting() {
  const { t } = useMusic();
  const [waving, setWaving] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setWaving(false), 2600);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <header className="mm-hello">
      <Nimbo size={68} mood={waving ? "greeting" : undefined} interactive />
      <div className="mm-hello__bubble">
        <h1>{t.greeting(new Date().getHours())}</h1>
        <p>{t.greetingLine}</p>
      </div>
    </header>
  );
}

function HomeView() {
  const { t, locale, setTint, open, player } = useMusic();
  const [genre, setGenre] = useState(0);
  const genres = useAsync(() => catalog.genres(locale), `genres:${locale}`);
  const chart = useAsync(() => catalog.chart(genre, locale), `chart:${genre}:${locale}`);
  const top = chart.state.status === "ready" ? chart.state.data.tracks[0] ?? null : null;

  useEffect(() => {
    setTint(top?.cover ?? null);
  }, [top, setTint]);

  return (
    <div className="mm-view">
      <Greeting />

      <div className="mm-chips" role="tablist" aria-label={t.genres}>
        {[{ id: 0, name: t.allGenres }, ...(genres.state.status === "ready" ? genres.state.data : [])].map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={genre === item.id}
            className={`mm-chip${genre === item.id ? " mm-chip--on" : ""}`}
            style={stagger(index)}
            onClick={() => setGenre(item.id)}
          >
            {item.name}
          </button>
        ))}
      </div>

      {chart.state.status === "loading" && <Loading />}
      {chart.state.status === "error" && <Failed onRetry={chart.retry} />}
      {chart.state.status === "ready" && (
        <>
          {top && (
            <section className="mm-hero">
              <img className="mm-backdrop" src={top.coverXl ?? top.cover ?? ""} alt="" aria-hidden="true" />
              <span className="mm-hero__art">
                <Vinyl src={top.cover} spinning={player.current?.id === top.id && player.playing} />
                <Cover src={top.coverXl ?? top.cover} size="xl" />
              </span>
              <div className="mm-hero__text">
                <span className="mm-eyebrow">
                  <span className="mm-eyebrow__dot" aria-hidden="true" />
                  {t.topNow}
                </span>
                <h2>{top.title}</h2>
                <p>
                  <button type="button" className="mm-link mm-link--strong" onClick={() => open({ kind: "artist", id: top.artistId })}>
                    {top.artistName}
                  </button>
                  <span aria-hidden="true"> · </span>
                  <button type="button" className="mm-link" onClick={() => open({ kind: "album", id: top.albumId })}>
                    {top.albumTitle}
                  </button>
                </p>
                <div className="mm-actions">
                  <PlayButton tracks={chart.state.data.tracks} />
                  <ListenFullMenu track={top} />
                  <LikeButton track={top} size={20} />
                </div>
              </div>
            </section>
          )}

          <Section title={t.hotTracks}>
            <div className="mm-grid-tracks">
              <TrackList tracks={chart.state.data.tracks} showAlbum={false} limit={12} />
            </div>
          </Section>

          {chart.state.data.albums.length > 0 && (
            <Shelf title={t.hotAlbums}>
              {chart.state.data.albums.map((album, index) => (
                <AlbumCard key={album.id} album={album} index={index} />
              ))}
            </Shelf>
          )}

          {chart.state.data.artists.length > 0 && (
            <Shelf title={t.hotArtists}>
              {chart.state.data.artists.map((artist, index) => (
                <ArtistCard key={artist.id} artist={artist} index={index} />
              ))}
            </Shelf>
          )}
        </>
      )}
    </div>
  );
}

function SearchView({ query }: { query: string }) {
  const { t, locale, open, setTint } = useMusic();
  const results = useAsync(
    () => (query ? catalog.search(query, locale) : Promise.resolve({ tracks: [], albums: [], artists: [] })),
    `search:${query}:${locale}`,
  );
  const compact = useCompact(locale);
  const data = results.state.status === "ready" ? results.state.data : null;
  const best = data?.artists[0] ?? null;

  useEffect(() => {
    setTint(best?.picture ?? data?.tracks[0]?.cover ?? null);
  }, [best, data, setTint]);

  if (!query) {
    return (
      <div className="mm-view">
        <NimboState mood="idle" text={t.searchHint} />
      </div>
    );
  }
  if (results.state.status === "loading") return <div className="mm-view"><Loading /></div>;
  if (results.state.status === "error") return <div className="mm-view"><Failed onRetry={results.retry} /></div>;
  if (!data || (data.tracks.length === 0 && data.artists.length === 0 && data.albums.length === 0)) {
    return (
      <div className="mm-view">
        <NimboState mood="annoyed" text={t.noResults(query)} />
      </div>
    );
  }

  return (
    <div className="mm-view">
      <div className="mm-search-top">
        {best && (
          <Section title={t.topResult}>
            <button type="button" className="mm-best" onClick={() => open({ kind: "artist", id: best.id })}>
              <img className="mm-backdrop" src={best.picture ?? ""} alt="" aria-hidden="true" />
              <Cover src={best.picture} size="lg" round />
              <strong>{best.name}</strong>
              <span className="mm-best__meta">
                <span className="mm-badge">{t.artist}</span>
                {best.fans ? <small>{t.fans(compact.format(best.fans))}</small> : null}
              </span>
              <span className="mm-card__play" aria-hidden="true">
                <PlayGlyph size={22} />
              </span>
            </button>
          </Section>
        )}
        {data.tracks.length > 0 && (
          <Section title={t.songs}>
            <TrackList tracks={data.tracks} numbered={false} showAlbum={false} limit={5} />
          </Section>
        )}
      </div>

      {data.artists.length > 0 && (
        <Shelf title={t.artists}>
          {data.artists.map((artist, index) => (
            <ArtistCard key={artist.id} artist={artist} index={index} />
          ))}
        </Shelf>
      )}

      {data.albums.length > 0 && (
        <Shelf title={t.albums}>
          {data.albums.map((album, index) => (
            <AlbumCard key={album.id} album={album} index={index} />
          ))}
        </Shelf>
      )}

      {data.tracks.length > 5 && (
        <Section title={t.songs}>
          <TrackList tracks={data.tracks} />
        </Section>
      )}
    </div>
  );
}

function ArtistView({ id }: { id: number }) {
  const { t, locale, setTint } = useMusic();
  const page = useAsync(() => catalog.artist(id, locale), `artist:${id}:${locale}`);
  const compact = useCompact(locale);
  const [filter, setFilter] = useState<string>("all");
  const data = page.state.status === "ready" ? page.state.data : null;

  const { setHeading } = useMusic();
  useEffect(() => {
    setTint(data?.artist.picture ?? null);
    setHeading(data?.artist.name ?? null);
  }, [data, setTint, setHeading]);

  const types = useMemo(() => {
    const present = new Set((data?.albums ?? []).map((album) => album.recordType ?? "album"));
    return ["album", "single", "ep", "compile"].filter((type) => present.has(type));
  }, [data]);
  const albums = (data?.albums ?? []).filter((album) => filter === "all" || (album.recordType ?? "album") === filter);

  if (page.state.status === "loading") return <div className="mm-view"><Loading /></div>;
  if (!data) return <div className="mm-view"><Failed onRetry={page.retry} /></div>;

  return (
    <div className="mm-view mm-view--flush">
      <header className="mm-banner">
        <img className="mm-backdrop" src={data.artist.pictureXl ?? data.artist.picture ?? ""} alt="" aria-hidden="true" />
        <span className="mm-banner__art">
          <Cover src={data.artist.pictureXl ?? data.artist.picture} size="xl" round />
        </span>
        <div className="mm-banner__text">
          <span className="mm-eyebrow">{t.artist}</span>
          <h1>{data.artist.name}</h1>
          <p>
            {[
              data.artist.fans ? t.fans(compact.format(data.artist.fans)) : null,
              data.artist.albumCount ? `${data.artist.albumCount} ${t.albums.toLowerCase()}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </header>

      <div className="mm-view__pad">
        <div className="mm-actions mm-actions--bar">
          <PlayButton tracks={data.top} />
          {data.top[0] && <ListenFullMenu track={data.top[0]} />}
        </div>

        {data.top.length > 0 && (
          <Section title={t.popular}>
            <TrackList tracks={data.top} limit={5} />
          </Section>
        )}

        {data.albums.length > 0 && (
          <Section
            title={t.discography}
            action={
              types.length > 1 && (
                <div className="mm-chips mm-chips--small">
                  {["all", ...types].map((type) => (
                    <button key={type} type="button" className={`mm-chip${filter === type ? " mm-chip--on" : ""}`} onClick={() => setFilter(type)}>
                      {type === "all" ? t.filterAll : t.recordType(type)}
                    </button>
                  ))}
                </div>
              )
            }
          >
            <div className="mm-grid-cards" key={filter}>
              {albums.map((album, index) => (
                <AlbumCard
                  key={album.id}
                  album={album}
                  index={index}
                  subtitle={[yearOf(album.releaseDate), t.recordType(album.recordType)].filter(Boolean).join(" · ")}
                />
              ))}
            </div>
          </Section>
        )}

        {data.related.length > 0 && (
          <Shelf title={t.related}>
            {data.related.map((artist, index) => (
              <ArtistCard key={artist.id} artist={artist} index={index} />
            ))}
          </Shelf>
        )}
      </div>
    </div>
  );
}

function AlbumView({ id }: { id: number }) {
  const { t, locale, open, setTint, player } = useMusic();
  const page = useAsync(() => catalog.album(id, locale), `album:${id}:${locale}`);
  const data = page.state.status === "ready" ? page.state.data : null;

  const { setHeading } = useMusic();
  useEffect(() => {
    setTint(data?.album.cover ?? null);
    setHeading(data?.album.title ?? null);
  }, [data, setTint, setHeading]);

  if (page.state.status === "loading") return <div className="mm-view"><Loading /></div>;
  if (!data) return <div className="mm-view"><Failed onRetry={page.retry} /></div>;

  const total = data.tracks.reduce((sum, track) => sum + track.duration, 0);
  const spinning = player.playing && player.current?.albumId === data.album.id;
  return (
    <div className="mm-view mm-view--flush">
      <header className="mm-banner">
        <img className="mm-backdrop" src={data.album.coverXl ?? data.album.cover ?? ""} alt="" aria-hidden="true" />
        <span className="mm-banner__art mm-hero__art">
          <Vinyl src={data.album.cover} spinning={spinning} />
          <Cover src={data.album.coverXl ?? data.album.cover} size="xl" />
        </span>
        <div className="mm-banner__text">
          <span className="mm-eyebrow">{t.recordType(data.album.recordType)}</span>
          <h1>{data.album.title}</h1>
          <p>
            {data.album.artistId ? (
              <button type="button" className="mm-link mm-link--strong" onClick={() => open({ kind: "artist", id: data.album.artistId ?? 0 })}>
                {data.album.artistName}
              </button>
            ) : (
              data.album.artistName
            )}
            {[yearOf(data.album.releaseDate), t.trackCount(data.tracks.length), formatDuration(total)]
              .filter(Boolean)
              .map((part) => ` · ${part}`)
              .join("")}
          </p>
        </div>
      </header>
      <div className="mm-view__pad">
        <div className="mm-actions mm-actions--bar">
          <PlayButton tracks={data.tracks} />
          {data.tracks[0] && <ListenFullMenu track={data.tracks[0]} />}
        </div>
        <TrackList tracks={data.tracks} showAlbum={false} showCover={false} />
      </div>
    </div>
  );
}

function LibraryView({ kind, tracks }: { kind: "likes" | "recent"; tracks: Track[] }) {
  const { t, setTint } = useMusic();
  useEffect(() => {
    setTint(tracks[0]?.cover ?? null);
  }, [tracks, setTint]);
  const Icon = kind === "likes" ? Heart : Clock3;
  const { setHeading } = useMusic();
  useEffect(() => setHeading(kind === "likes" ? t.likes : t.recent), [kind, setHeading, t]);
  return (
    <div className="mm-view mm-view--flush">
      <header className={`mm-banner mm-banner--${kind}`}>
        <span className="mm-banner__art">
          <span className="mm-library-art" aria-hidden="true">
            <Icon size={64} strokeWidth={1.6} fill={kind === "likes" ? "currentColor" : "none"} />
          </span>
        </span>
        <div className="mm-banner__text">
          <span className="mm-eyebrow">{t.library}</span>
          <h1>{kind === "likes" ? t.likes : t.recent}</h1>
          <p>{t.trackCount(tracks.length)}</p>
        </div>
      </header>
      <div className="mm-view__pad">
        {tracks.length === 0 ? (
          <NimboState mood={kind === "likes" ? "waiting" : "sleeping"} text={kind === "likes" ? t.emptyLikes : t.emptyRecent} />
        ) : (
          <>
            <div className="mm-actions mm-actions--bar">
              <PlayButton tracks={tracks} />
            </div>
            <TrackList tracks={tracks} />
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Player ----------

function ListenFullMenu({ track, compact }: { track: Track; compact?: boolean }) {
  const { t, settings } = useMusic();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  const services: { id: ExternalService; label: string }[] = [
    { id: "spotify", label: t.openSpotify },
    { id: "spotifyWeb", label: t.openSpotifyWeb },
    { id: "youtube", label: t.openYoutube },
    { id: "deezer", label: t.openDeezer },
  ];

  return (
    <div className={`mm-full${compact ? " mm-full--compact" : ""}`} ref={ref}>
      <button
        type="button"
        className={compact ? "mm-icon" : "mm-pill mm-pill--ghost"}
        title={t.listenFull}
        aria-label={compact ? t.listenFull : undefined}
        aria-haspopup={compact ? undefined : "menu"}
        aria-expanded={compact ? undefined : open}
        onClick={() => {
          // The player's button goes straight to the chosen service.
          if (compact) void catalog.openExternal(settings.service, track).catch((error) => console.error("Could not open the service", error));
          else setOpen((value) => !value);
        }}
      >
        {compact ? <ServiceMark service={settings.service} size={18} /> : <ExternalLink size={15} />}
        {!compact && <span>{t.listenFull}</span>}
      </button>
      {open && (
        <div className="mm-menu" role="menu">
          {services.map((service, index) => (
            <button
              key={service.id}
              type="button"
              role="menuitem"
              className={`mm-menu__item mm-menu__item--${service.id}`}
              style={stagger(index)}
              onClick={() => {
                setOpen(false);
                void catalog.openExternal(service.id, track).catch((error) => console.error("Could not open the service", error));
              }}
            >
              <ServiceMark service={service.id} size={18} />
              {service.label}
              {service.id === settings.service && <Check size={14} className="mm-menu__check" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Live spectrum behind the player, drawn straight to a canvas. */
function Visualizer() {
  const { bandsRef, player, animate, settings } = useMusic();
  const style = settings.visualizer;
  const color = rgbOf(ACCENTS[settings.accent]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    let frame = 0;
    let heights: number[] = [];
    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
      if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const bands = player.playing ? bandsRef.current : [];
      const count = 48;
      if (heights.length !== count) heights = new Array(count).fill(0);
      const gap = 3;
      const bar = (width - gap * (count - 1)) / count;
      let moving = false;
      const points: [number, number][] = [];
      for (let index = 0; index < count; index++) {
        // Mirror the spectrum so bass sits in the middle, under the controls.
        const source = bands.length ? bands[Math.floor(Math.abs(index - count / 2 + 0.5) / (count / 2) * bands.length)] ?? 0 : 0;
        const target = Math.pow(source, 1.4) * height;
        heights[index] += (target - heights[index]) * (target > heights[index] ? 0.5 : 0.1);
        if (heights[index] > 0.5) moving = true;
        const h = Math.max(0, heights[index]);
        if (style === "wave") {
          points.push([index * (bar + gap) + bar / 2, height - h]);
          continue;
        }
        const gradient = context.createLinearGradient(0, height - h, 0, height);
        gradient.addColorStop(0, `rgba(${color}, 0.5)`);
        gradient.addColorStop(1, `rgba(${color}, 0)`);
        context.fillStyle = gradient;
        context.beginPath();
        context.roundRect(index * (bar + gap), height - h, bar, h, [3, 3, 0, 0]);
        context.fill();
      }
      if (style === "wave" && points.length > 1) {
        const fill = context.createLinearGradient(0, 0, 0, height);
        fill.addColorStop(0, `rgba(${color}, 0.35)`);
        fill.addColorStop(1, `rgba(${color}, 0)`);
        context.beginPath();
        context.moveTo(0, height);
        context.lineTo(points[0][0], points[0][1]);
        for (let point = 1; point < points.length; point++) {
          const [x0, y0] = points[point - 1];
          const [x1, y1] = points[point];
          context.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
        }
        context.lineTo(width, height);
        context.closePath();
        context.fillStyle = fill;
        context.fill();
        context.strokeStyle = `rgba(${color}, 0.8)`;
        context.lineWidth = 1.5;
        context.stroke();
      }
      if (player.playing || moving) frame = requestAnimationFrame(draw);
    };
    if (animate && style !== "off") frame = requestAnimationFrame(draw);
    else context.clearRect(0, 0, canvas.width, canvas.height);
    return () => cancelAnimationFrame(frame);
  }, [bandsRef, player.playing, animate, style, color]);

  return <canvas className="mm-visualizer" ref={canvasRef} aria-hidden="true" />;
}

function PlayerBar() {
  const { t, player, open, panel, setPanel } = useMusic();
  const track = player.current;
  const progress = player.length > 0 ? (player.time / player.length) * 100 : 0;
  const volumeLevel = player.muted ? 0 : player.volume;
  const VolumeIcon = volumeLevel === 0 ? VolumeX : volumeLevel < 0.5 ? Volume1 : Volume2;
  const RepeatIcon = player.repeat === "one" ? Repeat1 : Repeat;

  return (
    <footer className={`mm-player${track ? "" : " mm-player--idle"}${player.playing ? " mm-player--on" : ""}`} aria-label={t.title}>
      <div className="mm-player__island">
        <span className="mm-player__line" style={{ "--progress": `${progress}%` } as CSSProperties} aria-hidden="true" />
        <Visualizer />
        <div className="mm-player__now">
          {track ? (
            <>
              <button type="button" className="mm-player__art" key={track.id} onClick={() => open({ kind: "album", id: track.albumId })} aria-label={track.albumTitle}>
                <Cover src={track.cover} size="md" />
              </button>
              <span className="mm-player__text" key={`text-${track.id}`}>
                <strong title={track.title}>{track.title}</strong>
                <button type="button" className="mm-link" onClick={() => open({ kind: "artist", id: track.artistId })}>
                  {track.artistName}
                </button>
              </span>
              <LikeButton track={track} />
            </>
          ) : (
            <>
              <Nimbo size={40} />
              <span className="mm-player__text mm-player__text--idle">
                <strong>{t.nothingPlaying}</strong>
                <span>{t.nothingPlayingHint}</span>
              </span>
            </>
          )}
        </div>

        <div className="mm-player__center">
          <div className="mm-player__buttons">
            <button
              type="button"
              className={`mm-icon${player.shuffle ? " mm-icon--on" : ""}`}
              title={t.shuffle}
              aria-label={t.shuffle}
              aria-pressed={player.shuffle}
              onClick={player.toggleShuffle}
            >
              <Shuffle size={16} />
            </button>
            <button type="button" className="mm-icon" title={t.previous} aria-label={t.previous} disabled={!track} onClick={player.previous}>
              <SkipGlyph size={19} back />
            </button>
            <button
              type="button"
              className="mm-player__main"
              title={player.playing ? t.pause : t.play}
              aria-label={player.playing ? t.pause : t.play}
              disabled={!track}
              onClick={player.toggle}
            >
              {player.loading && track ? (
                <Loader2 size={19} className="mm-spin" />
              ) : player.playing ? (
                <PauseGlyph size={20} />
              ) : (
                <PlayGlyph size={20} />
              )}
            </button>
            <button type="button" className="mm-icon" title={t.next} aria-label={t.next} disabled={!track} onClick={player.next}>
              <SkipGlyph size={19} />
            </button>
            <button
              type="button"
              className={`mm-icon${player.repeat !== "off" ? " mm-icon--on" : ""}`}
              title={player.repeat === "one" ? t.repeatOne : t.repeat}
              aria-label={player.repeat === "one" ? t.repeatOne : t.repeat}
              aria-pressed={player.repeat !== "off"}
              onClick={player.cycleRepeat}
            >
              <RepeatIcon size={16} />
            </button>
          </div>
          <div className="mm-progress">
            <span className="mm-progress__time">{formatDuration(player.time)}</span>
            <input
              type="range"
              className="mm-range"
              min={0}
              max={Math.max(1, player.length)}
              step={0.1}
              value={player.time}
              disabled={!track}
              aria-label={t.seek}
              style={{ "--progress": `${progress}%` } as CSSProperties}
              onChange={(event) => player.seek(Number(event.currentTarget.value))}
            />
            <span className="mm-progress__time">{formatDuration(player.length)}</span>
          </div>
        </div>

        <div className="mm-player__side">
          <SleepChip />
          <button
            type="button"
            className={`mm-icon${panel === "lyrics" ? " mm-icon--on" : ""}`}
            title={t.lyrics}
            aria-label={t.lyrics}
            aria-pressed={panel === "lyrics"}
            disabled={!track}
            onClick={() => setPanel(panel === "lyrics" ? null : "lyrics")}
          >
            <MicVocal size={17} />
          </button>
          <button
            type="button"
            className={`mm-icon${panel === "queue" ? " mm-icon--on" : ""}`}
            title={t.queue}
            aria-label={t.queue}
            aria-pressed={panel === "queue"}
            onClick={() => setPanel(panel === "queue" ? null : "queue")}
          >
            <ListMusic size={17} />
            {player.queue.length - player.index - 1 > 0 && (
              <span className="mm-icon__count">{Math.min(99, player.queue.length - player.index - 1)}</span>
            )}
          </button>
          {track && <ListenFullMenu track={track} compact />}
          <button type="button" className="mm-icon" title={player.muted ? t.unmute : t.mute} aria-label={player.muted ? t.unmute : t.mute} onClick={player.toggleMute}>
            <VolumeIcon size={17} />
          </button>
          <input
            type="range"
            className="mm-range mm-range--volume"
            min={0}
            max={1}
            step={0.01}
            value={volumeLevel}
            aria-label={t.volume}
            style={{ "--progress": `${volumeLevel * 100}%` } as CSSProperties}
            onChange={(event) => player.setVolume(Number(event.currentTarget.value))}
          />
          {track && <Nimbo size={38} interactive />}
        </div>
      </div>
    </footer>
  );
}

// ---------- Settings ----------

function useCountdown(endsAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [endsAt]);
  return endsAt === null ? null : Math.max(0, endsAt - now);
}

function formatLeft(ms: number) {
  return formatDuration(Math.ceil(ms / 1000));
}

/** Moon chip in the player while a sleep timer runs; click cancels it. */
function SleepChip() {
  const { sleep, setSleep, t } = useMusic();
  const left = useCountdown(sleep.kind === "at" ? sleep.endsAt : null);
  if (sleep.kind === "off") return null;
  const text = sleep.kind === "end" ? t.sleepEnd : t.sleepLeft(formatLeft(left ?? 0));
  return (
    <button type="button" className="mm-sleep-chip" title={`${t.sleep}: ${text}`} aria-label={`${t.sleep}: ${text}`} onClick={() => setSleep(null)}>
      <MoonStar size={13} />
      <span>{sleep.kind === "end" ? t.sleepEnd : formatLeft(left ?? 0)}</span>
    </button>
  );
}

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`mm-switch${checked ? " mm-switch--on" : ""}`} onClick={() => onChange(!checked)}>
      <span className="mm-switch__knob" />
    </button>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  label,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  label: string;
  onChange: (value: T) => void;
}) {
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  return (
    <div className="mm-seg" role="radiogroup" aria-label={label} style={{ "--count": options.length, "--index": index } as CSSProperties}>
      <span className="mm-seg__thumb" aria-hidden="true" />
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={`mm-seg__item${option.value === value ? " mm-seg__item--on" : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SettingRow({
  icon: Icon,
  tone,
  title,
  hint,
  children,
  wide,
}: {
  icon: typeof Heart;
  tone: string;
  title: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`mm-setting${wide ? " mm-setting--wide" : ""}`}>
      <span className="mm-setting__icon" style={{ "--tone": tone } as CSSProperties} aria-hidden="true">
        <Icon size={16} strokeWidth={2.2} />
      </span>
      <span className="mm-setting__text">
        <strong>{title}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <span className="mm-setting__control">{children}</span>
    </div>
  );
}

function Equalizer5() {
  const { settings, updateSettings, t } = useMusic();
  const presets = [...(Object.keys(EQ_PRESETS) as EqPreset[]), "custom" as EqPreset];
  const setBand = (band: number, gain: number) => {
    const gains = settings.eqGains.map((value, position) => (position === band ? gain : value));
    updateSettings({ eqGains: gains, eqPreset: "custom" });
  };
  // A smooth curve through the five bands, drawn behind the sliders.
  const curve = settings.eqGains
    .map((gain, band) => {
      const x = 10 + band * 20;
      const y = 50 - (gain / EQ_LIMIT) * 40;
      return `${band === 0 ? "M" : "L"}${x} ${y}`;
    })
    .join(" ");
  return (
    <div className="mm-eqbox">
      <div className="mm-chips mm-chips--small mm-eqbox__presets">
        {presets
          .filter((preset) => preset !== "custom" || settings.eqPreset === "custom")
          .map((preset) => (
            <button
              key={preset}
              type="button"
              className={`mm-chip${settings.eqPreset === preset ? " mm-chip--on" : ""}`}
              onClick={() => preset !== "custom" && updateSettings({ eqPreset: preset, eqGains: [...EQ_PRESETS[preset]] })}
            >
              {t.eqPreset(preset)}
            </button>
          ))}
      </div>
      <div className="mm-eqbox__bands">
        <svg className="mm-eqbox__curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="50" x2="100" y2="50" />
          <path d={curve} />
        </svg>
        {EQ_BANDS.map((frequency, band) => (
          <label key={frequency} className="mm-eqbox__band">
            <span className="mm-eqbox__gain">
              {settings.eqGains[band] > 0 ? "+" : ""}
              {settings.eqGains[band]} dB
            </span>
            <input
              type="range"
              className="mm-vrange"
              min={-EQ_LIMIT}
              max={EQ_LIMIT}
              step={1}
              value={settings.eqGains[band]}
              aria-label={`${t.equalizer} ${frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`}`}
              onChange={(event) => setBand(band, Number(event.currentTarget.value))}
            />
            <span className="mm-eqbox__hz">{frequency >= 1000 ? `${frequency / 1000}k` : frequency}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function SettingsView() {
  const { t, locale, settings, updateSettings, motion, setMotionPreference, sleep, setSleep, likes, recent, clearLibrary, setTint } = useMusic();
  const [confirming, setConfirming] = useState<"likes" | "recent" | null>(null);
  const [copied, setCopied] = useState(false);
  const left = useCountdown(sleep.kind === "at" ? sleep.endsAt : null);

  useEffect(() => setTint(null), [setTint]);
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(null), 3000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  const exportLikes = async () => {
    const text = likes.map((track, index) => `${index + 1}. ${track.title} - ${track.artistName}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Could not copy the list", error);
    }
  };

  const danger = (which: "likes" | "recent") => {
    if (confirming === which) {
      clearLibrary(which);
      setConfirming(null);
    } else {
      setConfirming(which);
    }
  };

  const sleepValue: string = sleep.kind === "off" ? "off" : sleep.kind === "end" ? "end" : String(sleep.minutes);

  return (
    <div className="mm-view mm-settings">
      <header className="mm-settings__head">
        <Nimbo size={64} mood="greeting" />
        <div>
          <h1>{t.settings}</h1>
          <p>{t.settingsIntro}</p>
        </div>
      </header>

      <section className="mm-group" style={stagger(0)}>
        <h2>{t.sectionSound}</h2>
        <SettingRow icon={AudioLines} tone="#ff375f" title={t.equalizer} hint={t.equalizerHint} wide>
          <Equalizer5 />
        </SettingRow>
        <SettingRow icon={Volume2} tone="#5ac8fa" title={t.normalize} hint={t.normalizeHint}>
          <Toggle checked={settings.normalize} label={t.normalize} onChange={(normalize) => updateSettings({ normalize })} />
        </SettingRow>
        <SettingRow icon={Sparkles} tone="#bf8cff" title={t.fade} hint={t.fadeHint}>
          <Segmented
            label={t.fade}
            value={settings.fade}
            options={[0, 2, 4, 6].map((value) => ({ value: value as MusicSettings["fade"], label: value ? t.seconds(value) : t.off }))}
            onChange={(fade) => updateSettings({ fade })}
          />
        </SettingRow>
        <SettingRow icon={Gauge} tone="#ff9f0a" title={t.speed} hint={t.speedHint}>
          <Segmented
            label={t.speed}
            value={settings.speed}
            options={[0.75, 1, 1.25, 1.5].map((value) => ({ value: value as MusicSettings["speed"], label: `${new Intl.NumberFormat(locale).format(value)}×` }))}
            onChange={(speed) => updateSettings({ speed })}
          />
        </SettingRow>
      </section>

      <section className="mm-group" style={stagger(1)}>
        <h2>{t.sectionPlayback}</h2>
        <SettingRow icon={Radio} tone="#35e985" title={t.autoplay} hint={t.autoplayHint}>
          <Toggle checked={settings.autoplay} label={t.autoplay} onChange={(autoplay) => updateSettings({ autoplay })} />
        </SettingRow>
        <SettingRow icon={MoonStar} tone="#bf8cff" title={t.sleep} hint={left !== null ? t.sleepLeft(formatLeft(left)) : t.sleepHint} wide>
          <Segmented
            label={t.sleep}
            value={sleepValue}
            options={[
              { value: "off", label: t.off },
              { value: "15", label: t.minutes(15) },
              { value: "30", label: t.minutes(30) },
              { value: "60", label: t.minutes(60) },
              { value: "end", label: t.sleepEnd },
            ]}
            onChange={(value) => setSleep(value === "off" ? null : value === "end" ? "end" : Number(value))}
          />
        </SettingRow>
        <SettingRow icon={ShieldAlert} tone="#ff453a" title={t.hideExplicit} hint={t.hideExplicitHint}>
          <Toggle checked={settings.hideExplicit} label={t.hideExplicit} onChange={(hideExplicit) => updateSettings({ hideExplicit })} />
        </SettingRow>
        <SettingRow icon={ExternalLink} tone="#1ed760" title={t.service} hint={t.serviceHint} wide>
          <div className="mm-services" role="radiogroup" aria-label={t.service}>
            {(["spotify", "spotifyWeb", "youtube", "deezer"] as const).map((service) => (
              <button
                key={service}
                type="button"
                role="radio"
                aria-checked={settings.service === service}
                className={`mm-service${settings.service === service ? " mm-service--on" : ""}`}
                onClick={() => updateSettings({ service })}
              >
                <ServiceMark service={service} size={22} />
                <span>
                  {service === "spotify" ? t.openSpotify : service === "spotifyWeb" ? t.openSpotifyWeb : service === "youtube" ? t.openYoutube : t.openDeezer}
                </span>
                {settings.service === service && <Check size={14} className="mm-service__check" />}
              </button>
            ))}
          </div>
        </SettingRow>
      </section>

      <section className="mm-group" style={stagger(2)}>
        <h2>{t.sectionLook}</h2>
        <SettingRow icon={Palette} tone={ACCENTS[settings.accent]} title={t.accent}>
          <div className="mm-swatches" role="radiogroup" aria-label={t.accent}>
            {(Object.keys(ACCENTS) as Accent[]).map((accent) => (
              <button
                key={accent}
                type="button"
                role="radio"
                aria-checked={settings.accent === accent}
                title={t.accentName(accent)}
                aria-label={t.accentName(accent)}
                className={`mm-swatch${settings.accent === accent ? " mm-swatch--on" : ""}`}
                style={{ "--swatch": ACCENTS[accent] } as CSSProperties}
                onClick={() => updateSettings({ accent })}
              >
                {settings.accent === accent && <Check size={13} strokeWidth={3} />}
              </button>
            ))}
          </div>
        </SettingRow>
        <SettingRow icon={AudioLines} tone="#5ac8fa" title={t.visualizer}>
          <Segmented
            label={t.visualizer}
            value={settings.visualizer}
            options={(["bars", "wave", "off"] as const).map((value) => ({ value, label: t.visualizerStyle(value) }))}
            onChange={(visualizer) => updateSettings({ visualizer })}
          />
        </SettingRow>
        <SettingRow icon={Music2} tone="#f2f2f5" title={t.nimboDance} hint={t.nimboDanceHint}>
          <Toggle checked={settings.nimboDance} label={t.nimboDance} onChange={(nimboDance) => updateSettings({ nimboDance })} />
        </SettingRow>
        <SettingRow icon={Palette} tone="#ffd60a" title={t.coverTint} hint={t.coverTintHint}>
          <Toggle checked={settings.coverTint} label={t.coverTint} onChange={(coverTint) => updateSettings({ coverTint })} />
        </SettingRow>
        <SettingRow icon={Sparkles} tone="#ff9f0a" title={t.animations} hint={t.motionHint}>
          <Segmented
            label={t.animations}
            value={motion}
            options={(["system", "on", "off"] as const).map((value) => ({ value, label: t.motionOption(value) }))}
            onChange={setMotionPreference}
          />
        </SettingRow>
      </section>

      <section className="mm-group" style={stagger(3)}>
        <h2>{t.sectionLibrary}</h2>
        <SettingRow icon={Heart} tone="#ff375f" title={t.library} hint={t.librarySummary(likes.length, recent.length)} wide>
          <div className="mm-library-actions">
            <button type="button" className="mm-pill mm-pill--ghost" disabled={likes.length === 0} onClick={() => void exportLikes()}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? t.exported : t.exportLikes}
            </button>
            <button type="button" className={`mm-pill mm-pill--ghost mm-pill--danger${confirming === "recent" ? " mm-pill--confirm" : ""}`} disabled={recent.length === 0} onClick={() => danger("recent")}>
              <History size={15} />
              {confirming === "recent" ? t.confirm : t.clearRecent}
            </button>
            <button type="button" className={`mm-pill mm-pill--ghost mm-pill--danger${confirming === "likes" ? " mm-pill--confirm" : ""}`} disabled={likes.length === 0} onClick={() => danger("likes")}>
              <Trash2 size={15} />
              {confirming === "likes" ? t.confirm : t.clearLikes}
            </button>
          </div>
        </SettingRow>
        <SettingRow icon={SlidersHorizontal} tone="#8e8e93" title={t.shortcuts} hint={t.shortcutsHint}>
          <span />
        </SettingRow>
      </section>
    </div>
  );
}

// ---------- Drag to reorder ----------

/** HTML drag and drop for lists; the music window turns off Tauri's file-drop handler so these events arrive. */
function useDragOrder(onMove?: (from: number, to: number) => void) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  return {
    item: (index: number) =>
      onMove
        ? {
            draggable: true,
            "data-dragging": dragging === index || undefined,
            "data-over": over === index && dragging !== index ? (dragging !== null && dragging < index ? "after" : "before") : undefined,
            onDragStart: (event: React.DragEvent) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", String(index));
              setDragging(index);
            },
            onDragOver: (event: React.DragEvent) => {
              if (dragging === null) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (over !== index) setOver(index);
            },
            onDrop: (event: React.DragEvent) => {
              event.preventDefault();
              if (dragging !== null && dragging !== index) onMove(dragging, index);
              setDragging(null);
              setOver(null);
            },
            onDragEnd: () => {
              setDragging(null);
              setOver(null);
            },
          }
        : {},
  };
}

// ---------- Playlist covers ----------

function Mosaic({ tracks, size }: { tracks: Track[]; size: "nav" | "xl" }) {
  const covers = mosaicOf(tracks);
  return (
    <span className={`mm-mosaic mm-mosaic--${size} mm-mosaic--${covers.length >= 4 ? 4 : covers.length ? 1 : 0}`} aria-hidden="true">
      {covers.length >= 4
        ? covers.map((src) => <img key={src} src={src} alt="" draggable={false} />)
        : covers.length
          ? <img src={covers[0]} alt="" draggable={false} />
          : <ListMusic size={size === "nav" ? 14 : 64} strokeWidth={1.8} />}
    </span>
  );
}

// ---------- Row menu ----------

function TrackMenu({ track, onRemove }: { track: Track; onRemove?: () => void }) {
  const { t, player, open, playlists, editPlaylists, notify } = useMusic();
  const [place, setPlace] = useState<CSSProperties | null>(null);
  const [choosing, setChoosing] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!place) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event.type === "pointerdown" && (menuRef.current?.contains(event.target as Node) || buttonRef.current?.contains(event.target as Node))) return;
      setPlace(null);
      setChoosing(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("resize", close);
    document.querySelector(".mm-main")?.addEventListener("scroll", close, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("resize", close);
      document.querySelector(".mm-main")?.removeEventListener("scroll", close);
    };
  }, [place]);

  const toggle = () => {
    if (place) {
      setPlace(null);
      setChoosing(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Fixed position so the list's scroll box never clips it; opens upwards near the player.
    const upwards = window.innerHeight - rect.bottom < 330;
    setPlace({
      right: Math.max(8, window.innerWidth - rect.right),
      ...(upwards ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
    });
  };

  const run = (action: () => void) => () => {
    action();
    setPlace(null);
    setChoosing(false);
  };

  const addTo = (id: string, name: string) =>
    run(() => {
      editPlaylists((current) => addToPlaylist(current, id, track));
      notify(t.addedToPlaylist(name));
    });

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`mm-more-btn${place ? " mm-more-btn--open" : ""}`}
        title={t.more}
        aria-label={`${t.more}: ${track.title}`}
        aria-haspopup="menu"
        aria-expanded={Boolean(place)}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
      >
        <Ellipsis size={17} />
      </button>
      {place && (
        <div className="mm-menu mm-menu--track" role="menu" ref={menuRef} style={place} onClick={(event) => event.stopPropagation()}>
          {!choosing ? (
            <>
              <button type="button" role="menuitem" className="mm-menu__item" style={stagger(0)} onClick={run(() => { player.enqueue(track, true); notify(t.addedToQueue(track.title)); })}>
                <ListStart size={16} /> {t.playNext}
              </button>
              <button type="button" role="menuitem" className="mm-menu__item" style={stagger(1)} onClick={run(() => { player.enqueue(track); notify(t.addedToQueue(track.title)); })}>
                <ListEnd size={16} /> {t.addToQueue}
              </button>
              <button type="button" role="menuitem" className="mm-menu__item" style={stagger(2)} onClick={() => setChoosing(true)}>
                <ListPlus size={16} /> {t.addToPlaylist}
                <ChevronRight size={15} className="mm-menu__check" />
              </button>
              <span className="mm-menu__line" />
              <button type="button" role="menuitem" className="mm-menu__item" style={stagger(3)} onClick={run(() => open({ kind: "artist", id: track.artistId }))}>
                <User size={16} /> {t.goToArtist}
              </button>
              <button type="button" role="menuitem" className="mm-menu__item" style={stagger(4)} onClick={run(() => open({ kind: "album", id: track.albumId }))}>
                <Disc size={16} /> {t.goToAlbum}
              </button>
              {onRemove && (
                <>
                  <span className="mm-menu__line" />
                  <button type="button" role="menuitem" className="mm-menu__item mm-menu__item--danger" style={stagger(5)} onClick={run(onRemove)}>
                    <Trash2 size={16} /> {t.removeFromPlaylist}
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <button type="button" className="mm-menu__item mm-menu__back" onClick={() => setChoosing(false)}>
                <ChevronLeft size={16} /> {t.addToPlaylist}
              </button>
              <span className="mm-menu__line" />
              <button
                type="button"
                role="menuitem"
                className="mm-menu__item"
                style={stagger(0)}
                onClick={run(() => {
                  const name = t.playlistDefault(playlists.length + 1);
                  editPlaylists((current) => createPlaylist(current, name, track));
                  notify(t.addedToPlaylist(name));
                })}
              >
                <span className="mm-menu__new" aria-hidden="true">
                  <Plus size={14} strokeWidth={2.6} />
                </span>
                {t.newPlaylist}
              </button>
              <div className="mm-menu__scroll">
                {playlists.map((playlist, index) => (
                  <button key={playlist.id} type="button" role="menuitem" className="mm-menu__item" style={stagger(index + 1)} onClick={addTo(playlist.id, playlist.name)}>
                    <Mosaic tracks={playlist.tracks} size="nav" />
                    <span className="mm-menu__label">{playlist.name}</span>
                    {playlist.tracks.some((item) => item.id === track.id) && <Check size={14} className="mm-menu__check" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

// ---------- Lyrics and queue panel ----------

type LyricsView = { status: "loading" } | { status: "missing" } | { status: "ready"; lines: string[]; instrumental: boolean };

function linesOf(answer: LyricsAnswer | null): LyricsView {
  if (!answer) return { status: "missing" };
  if (answer.instrumental) return { status: "ready", lines: [], instrumental: true };
  const lines = answer.plain
    ? answer.plain.split(/\r?\n/).map((line) => line.trim())
    : answer.synced
      ? parseLrc(answer.synced).map((line) => line.text)
      : [];
  return lines.some(Boolean) ? { status: "ready", lines, instrumental: false } : { status: "missing" };
}

function LyricsPane() {
  const { player, t } = useMusic();
  const track = player.current;
  const [view, setView] = useState<LyricsView>({ status: "loading" });

  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    setView({ status: "loading" });
    catalog
      .lyrics(track)
      .then((answer) => !cancelled && setView(linesOf(answer)))
      .catch(() => !cancelled && setView({ status: "missing" }));
    return () => {
      cancelled = true;
    };
    // The id names the song; the rest of the object changes when its preview refreshes.
  }, [track?.id]);

  if (!track) return null;
  return (
    <div className="mm-lyrics">
      <header className="mm-lyrics__track">
        <Cover src={track.cover} size="md" />
        <span>
          <strong>{track.title}</strong>
          <small>{track.artistName}</small>
        </span>
      </header>
      {view.status === "loading" ? (
        <NimboState mood="thinking" text={t.lyricsLoading} />
      ) : view.status === "missing" ? (
        <NimboState mood="annoyed" text={t.lyricsMissing} />
      ) : view.instrumental ? (
        <NimboState mood="done" text={t.lyricsInstrumental} />
      ) : (
        <>
          <ol className="mm-lyrics__lines" key={track.id}>
            {view.lines.map((line, index) =>
              line ? (
                <li key={index} style={stagger(index)}>
                  {line}
                </li>
              ) : (
                <li key={index} className="mm-lyrics__gap" aria-hidden="true" />
              ),
            )}
          </ol>
          <p className="mm-lyrics__note">
            {t.lyricsNote} · {t.lyricsCredit}
          </p>
        </>
      )}
    </div>
  );
}

function QueuePane() {
  const { player, t } = useMusic();
  const upcoming = player.queue.slice(player.index + 1);
  const offset = player.index + 1;
  const drag = useDragOrder((from, to) => player.moveInQueue(from + offset, to + offset));
  return (
    <div className="mm-queue">
      {player.current && (
        <>
          <h3>{t.nowPlaying}</h3>
          <div className="mm-queue__row mm-queue__row--now">
            <Cover src={player.current.cover} size="sm" />
            <span className="mm-queue__text">
              <strong>{player.current.title}</strong>
              <small>{player.current.artistName}</small>
            </span>
            {player.playing && <Equalizer />}
          </div>
        </>
      )}
      <h3>
        {t.upNext}
        {upcoming.length > 0 && (
          <button type="button" className="mm-queue__clear" onClick={player.clearUpcoming}>
            {t.clearQueue}
          </button>
        )}
      </h3>
      {upcoming.length === 0 ? (
        <p className="mm-queue__empty">{t.queueEmpty}</p>
      ) : (
        <ol className="mm-queue__list">
          {upcoming.map((track, index) => (
            <li key={`${track.id}-${index + offset}`} style={stagger(index)} {...drag.item(index)}>
              <div className="mm-queue__row">
                <span className="mm-queue__grip" title={t.dragToReorder} aria-hidden="true">
                  <GripVertical size={14} />
                </span>
                <button type="button" className="mm-queue__jump" onClick={() => player.jump(index + offset)} aria-label={`${t.play}: ${track.title}`}>
                  <Cover src={track.cover} size="sm" />
                  <span className="mm-queue__text">
                    <strong>{track.title}</strong>
                    <small>{track.artistName}</small>
                  </span>
                </button>
                <button type="button" className="mm-icon mm-queue__remove" title={t.removeFromQueue} aria-label={`${t.removeFromQueue}: ${track.title}`} onClick={() => player.removeFromQueue(index + offset)}>
                  <X size={15} />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function NowPanel() {
  const { panel, setPanel, t } = useMusic();
  if (!panel) return null;
  return (
    <aside className="mm-now" aria-label={panel === "lyrics" ? t.lyrics : t.queue}>
      <header className="mm-now__head">
        <Segmented
          label={t.nowPlaying}
          value={panel}
          options={[
            { value: "lyrics", label: t.lyrics },
            { value: "queue", label: t.queue },
          ]}
          onChange={(value) => setPanel(value)}
        />
        <button type="button" className="mm-icon" title={t.closePanel} aria-label={t.closePanel} onClick={() => setPanel(null)}>
          <X size={16} />
        </button>
      </header>
      <div className="mm-now__body" key={panel}>
        {panel === "lyrics" ? <LyricsPane /> : <QueuePane />}
      </div>
    </aside>
  );
}

// ---------- Playlist page ----------

function PlaylistView({ id }: { id: string }) {
  const { t, playlists, editPlaylists, setTint } = useMusic();
  const playlist = playlists.find((item) => item.id === id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);

  const { setHeading } = useMusic();
  useEffect(() => {
    setTint(playlist?.tracks[0]?.cover ?? null);
    setHeading(playlist?.name ?? null);
  }, [playlist?.tracks, playlist?.name, setTint, setHeading]);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  if (!playlist) return null;
  const total = playlist.tracks.reduce((sum, track) => sum + track.duration, 0);
  const saveName = () => {
    const name = draft.trim();
    if (name) editPlaylists((current) => current.map((item) => (item.id === id ? { ...item, name: name.slice(0, 80) } : item)));
    setEditing(false);
  };

  return (
    <div className="mm-view mm-view--flush">
      <header className="mm-banner mm-banner--playlist">
        {playlist.tracks[0]?.coverXl && <img className="mm-backdrop" src={playlist.tracks[0].coverXl} alt="" aria-hidden="true" />}
        <span className="mm-banner__art">
          <Mosaic tracks={playlist.tracks} size="xl" />
        </span>
        <div className="mm-banner__text">
          <span className="mm-eyebrow">{t.playlist}</span>
          {editing ? (
            <input
              className="mm-rename"
              value={draft}
              autoFocus
              maxLength={80}
              aria-label={t.playlistName}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onBlur={saveName}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveName();
                if (event.key === "Escape") setEditing(false);
              }}
            />
          ) : (
            <h1>
              <button
                type="button"
                className="mm-rename-btn"
                title={t.rename}
                onClick={() => {
                  setDraft(playlist.name);
                  setEditing(true);
                }}
              >
                {playlist.name}
                <Pencil size={20} aria-hidden="true" />
              </button>
            </h1>
          )}
          <p>{[t.trackCount(playlist.tracks.length), total ? formatDuration(total) : null].filter(Boolean).join(" · ")}</p>
        </div>
      </header>
      <div className="mm-view__pad">
        <div className="mm-actions mm-actions--bar">
          <PlayButton tracks={playlist.tracks} />
          <button
            type="button"
            className={`mm-pill mm-pill--ghost mm-pill--danger${confirming ? " mm-pill--confirm" : ""}`}
            onClick={() => (confirming ? editPlaylists((current) => current.filter((item) => item.id !== id)) : setConfirming(true))}
          >
            <Trash2 size={15} />
            {confirming ? t.confirm : t.deletePlaylist}
          </button>
        </div>
        {playlist.tracks.length === 0 ? (
          <NimboState mood="waiting" text={t.emptyPlaylist} />
        ) : (
          <TrackList
            tracks={playlist.tracks}
            onRemove={(track) => editPlaylists((current) => removeFromPlaylist(current, id, track.id))}
            onMove={(from, to) => editPlaylists((current) => moveInPlaylist(current, id, from, to))}
          />
        )}
      </div>
    </div>
  );
}
