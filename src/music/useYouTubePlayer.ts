import { useCallback, useEffect, useRef, useState } from "react";
import { loadVolume, saveVolume, type Track } from "./catalog";
import type { RepeatMode } from "./usePreviewPlayer";
import { loadYouTubeApi, youtube, YT_STATE, type YouTubeCandidate, type YTPlayer } from "./youtube";

/** Owner disabled embedding (101/150) or the video is gone (100): try the next match. */
const SKIP_TO_NEXT_VIDEO = [100, 101, 150];

/**
 * Same surface as `usePreviewPlayer`, but whole songs from YouTube's official
 * embedded player. `stage` is the element the (visible) video lives in.
 */
export function useYouTubePlayer({
  enabled,
  onStart,
  onMissing,
  onError,
}: {
  enabled: boolean;
  onStart: (track: Track) => void;
  onMissing: () => void;
  onError: (error: unknown) => void;
}) {
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  const [volume, setVolumeState] = useState(loadVolume);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [stopAfterCurrent, setStopAfterCurrent] = useState(false);
  /** The YouTube video playing now, for the credits and the "open on YouTube" link. */
  const [videoId, setVideoId] = useState<string | null>(null);
  /** Every version found for the current song, best first. */
  const [versions, setVersions] = useState<YouTubeCandidate[]>([]);
  const callbacks = useRef({ onStart, onMissing, onError });
  callbacks.current = { onStart, onMissing, onError };
  const queueRef = useRef(queue);
  const indexRef = useRef(index);
  queueRef.current = queue;
  indexRef.current = index;
  /** The videos found for the current song and which one is loaded. */
  const videos = useRef<{ ids: string[]; at: number; started: boolean }>({ ids: [], at: 0, started: false });
  const versionsRef = useRef<YouTubeCandidate[]>([]);
  const token = useRef(0);
  const stepRef = useRef<(direction: 1 | -1, automatic?: boolean) => void>(() => {});
  const pendingRef = useRef<string | null>(null);

  const current = index >= 0 ? queue[index] ?? null : null;

  // Create the player once there is a stage to put it on.
  useEffect(() => {
    if (!enabled || !stage) return;
    let cancelled = false;
    const slot = document.createElement("div");
    stage.appendChild(slot);
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        playerRef.current = new YT.Player(slot, {
          width: "100%",
          height: "100%",
          playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, origin: window.location.origin },
          events: {
            onReady: () => {
              setReady(true);
              const pending = pendingRef.current;
              pendingRef.current = null;
              if (pending) playerRef.current?.loadVideoById(pending);
            },
            onStateChange: ({ data }) => {
              if (data === YT_STATE.playing) {
                setPlaying(true);
                setLoading(false);
                if (!videos.current.started) {
                  videos.current.started = true;
                  const track = queueRef.current[indexRef.current];
                  if (track) callbacks.current.onStart(track);
                }
              } else if (data === YT_STATE.paused) {
                setPlaying(false);
              } else if (data === YT_STATE.buffering) {
                setLoading(true);
              } else if (data === YT_STATE.ended) {
                setPlaying(false);
                stepRef.current(1, true);
              }
            },
            onError: ({ data }) => {
              const next = videos.current.at + 1;
              if (SKIP_TO_NEXT_VIDEO.includes(data) && next < videos.current.ids.length) {
                videos.current.at = next;
                setVideoId(videos.current.ids[next]);
                playerRef.current?.loadVideoById(videos.current.ids[next]);
                return;
              }
              setLoading(false);
              callbacks.current.onMissing();
              stepRef.current(1, true);
            },
          },
        });
      })
      .catch((error) => callbacks.current.onError(error));
    // The player lives and dies with its stage, so a remount (or a hot reload) builds a fresh one.
    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
      slot.remove();
      setReady(false);
      setPlaying(false);
    };
  }, [enabled, stage]);

  // Leaving YouTube mode stops the video.
  useEffect(() => {
    if (!enabled) playerRef.current?.pauseVideo();
  }, [enabled]);

  // The clock and volume follow the player.
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player || !ready) return;
      setTime(player.getCurrentTime() || 0);
      const duration = player.getDuration();
      if (duration) setLength(duration);
    }, 250);
    return () => window.clearInterval(timer);
  }, [enabled, ready]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !ready) return;
    player.setVolume(Math.round(volume * 100));
    if (muted) player.mute();
    else player.unMute();
    saveVolume(volume);
  }, [volume, muted, ready]);

  const start = useCallback(async (list: Track[], at: number) => {
    const track = list[at];
    if (!track) return;
    const mine = ++token.current;
    setQueue(list);
    setIndex(at);
    setTime(0);
    setLength(track.duration || 0);
    setLoading(true);
    let found: YouTubeCandidate[] = [];
    try {
      found = await youtube.videosFor(track);
    } catch (error) {
      if (mine !== token.current) return;
      setLoading(false);
      setPlaying(false);
      callbacks.current.onError(error);
      return;
    }
    if (mine !== token.current) return;
    const ids = found.map((candidate) => candidate.id);
    versionsRef.current = found;
    setVersions(found);
    if (ids.length === 0) {
      setLoading(false);
      callbacks.current.onMissing();
      stepRef.current(1, true);
      return;
    }
    videos.current = { ids, at: 0, started: false };
    setVideoId(ids[0]);
    if (playerRef.current && ready) playerRef.current.loadVideoById(ids[0]);
    else pendingRef.current = ids[0];
  }, [ready]);

  const step = useCallback(
    (direction: 1 | -1, automatic = false) => {
      const list = queueRef.current;
      const at = indexRef.current;
      if (list.length === 0) return;
      if (automatic && stopAfterCurrent) {
        setStopAfterCurrent(false);
        return;
      }
      if (automatic && repeat === "one") {
        playerRef.current?.seekTo(0, true);
        playerRef.current?.playVideo();
        return;
      }
      let next = at + direction;
      if (shuffle && list.length > 1 && direction === 1) {
        do next = Math.floor(Math.random() * list.length);
        while (next === at);
      }
      if (next >= list.length) {
        if (repeat === "off" && automatic) return;
        next = 0;
      }
      if (next < 0) next = list.length - 1;
      void start(list, next);
    },
    [repeat, shuffle, start, stopAfterCurrent],
  );
  stepRef.current = step;

  const toggle = useCallback(() => {
    const player = playerRef.current;
    if (!player || !current) return;
    if (playing) player.pauseVideo();
    else player.playVideo();
  }, [current, playing]);

  const seek = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds, true);
    setTime(seconds);
  }, []);

  return {
    source: "youtube" as const,
    device: null as string | null,
    /** Callback ref for the element that shows the video. */
    stageRef: setStage,
    videoId,
    versions,
    /** Plays another version of the current song and remembers the choice. */
    chooseVersion: (id: string) => {
      const track = queueRef.current[indexRef.current];
      const at = videos.current.ids.indexOf(id);
      if (!track || at < 0) return;
      videos.current.at = at;
      setVideoId(id);
      setLoading(true);
      youtube.prefer(track.id, versionsRef.current, id);
      playerRef.current?.loadVideoById(id);
    },
    current,
    queue,
    index,
    playing,
    loading,
    time,
    length: length || 30,
    volume,
    muted,
    shuffle,
    repeat,
    stopAfterCurrent,
    play: start,
    /** The sound plays inside YouTube's frame, out of reach; the dance keeps a steady beat. */
    readLevels: useCallback((): { bass: number; bands: number[] } | null => null, []),
    toggle,
    pause: useCallback(() => playerRef.current?.pauseVideo(), []),
    moveInQueue: (from: number, to: number) => {
      const list = [...queueRef.current];
      if (from === to || !list[from] || to < 0 || to >= list.length) return;
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item);
      const at = indexRef.current;
      setQueue(list);
      setIndex(from === at ? to : from < at && to >= at ? at - 1 : from > at && to <= at ? at + 1 : at);
    },
    removeFromQueue: (position: number) => {
      const at = indexRef.current;
      if (position === at) return;
      setQueue((list) => list.filter((_, item) => item !== position));
      if (position < at) setIndex(at - 1);
    },
    enqueue: (track: Track, next = false) => {
      const list = queueRef.current;
      if (list.length === 0 || indexRef.current < 0) {
        void start([track], 0);
        return;
      }
      const at = next ? indexRef.current + 1 : list.length;
      setQueue([...list.slice(0, at), track, ...list.slice(at)]);
    },
    clearUpcoming: () => setQueue((list) => list.slice(0, indexRef.current + 1)),
    jump: (position: number) => void start(queueRef.current, position),
    next: () => step(1),
    previous: () => {
      if (time > 3) seek(0);
      else step(-1);
    },
    seek,
    setVolume: (value: number) => {
      setVolumeState(value);
      setMuted(false);
    },
    toggleMute: () => setMuted((value) => !value),
    toggleShuffle: () => setShuffle((value) => !value),
    cycleRepeat: () => setRepeat((mode) => (mode === "off" ? "all" : mode === "all" ? "one" : "off")),
    setStopAfterCurrent,
  };
}

export type YouTubePlayer = ReturnType<typeof useYouTubePlayer>;
