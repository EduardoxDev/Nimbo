import { useCallback, useEffect, useRef, useState } from "react";
import type { Track } from "./catalog";
import { matchQueue, spotify, trackFromSpotify, type SpotifyState } from "./spotify";
import type { RepeatMode } from "./usePreviewPlayer";

const POLL_MS = 1000;

/**
 * Same surface as `usePreviewPlayer`, but the music is the whole song playing
 * in the user's Spotify app; this hook sends commands and mirrors its state.
 */
export function useSpotifyPlayer({
  enabled,
  onStart,
  onError,
}: {
  enabled: boolean;
  onStart: (track: Track) => void;
  onError: (error: unknown) => void;
}) {
  const [queue, setQueue] = useState<Track[]>([]);
  const [remote, setRemote] = useState<SpotifyState | null>(null);
  const [polledAt, setPolledAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [stopAfterCurrent, setStopAfterCurrent] = useState(false);
  const [optimistic, setOptimistic] = useState<{ playing?: boolean; volume?: number; at: number } | null>(null);
  const callbacks = useRef({ onStart, onError });
  callbacks.current = { onStart, onError };
  const lastItem = useRef<string | null>(null);
  const mutedFrom = useRef<number | null>(null);
  const volumeTimer = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const state = await spotify.state();
      setRemote(state);
      setPolledAt(Date.now());
    } catch {
      // A missed poll is fine; the next one catches up.
    }
  }, []);

  // Poll while the window is visible; tick the clock between polls.
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [enabled, refresh]);

  // Optimistic values win for a moment so the buttons feel instant.
  const fresh = optimistic && Date.now() - optimistic.at < 1800 ? optimistic : null;
  const playing = fresh?.playing ?? remote?.isPlaying ?? false;
  const index = remote?.item ? matchQueue(queue, remote.item) : -1;
  const current: Track | null = remote?.item ? (index >= 0 ? queue[index] : trackFromSpotify(remote.item, remote.durationMs)) : null;
  const length = (remote?.durationMs ?? 0) / 1000 || 30;
  const time = Math.min(length, ((remote?.progressMs ?? 0) + (playing ? now - polledAt : 0)) / 1000);
  const volume = (fresh?.volume ?? remote?.volume ?? 80) / 100;

  // A new song started: log it as recent; honour "pause after this song".
  useEffect(() => {
    const id = remote?.item?.id ?? null;
    if (!id || id === lastItem.current) return;
    const previous = lastItem.current;
    lastItem.current = id;
    if (current) callbacks.current.onStart(current);
    if (previous && stopAfterCurrent) {
      setStopAfterCurrent(false);
      void spotify.control("pause").then(refresh);
    }
    // `current` follows `remote`; the id is the change that matters.
  }, [remote?.item?.id]);

  const run = useCallback(
    async (action: Parameters<typeof spotify.control>[0], value?: number) => {
      try {
        await spotify.control(action, value);
      } catch (error) {
        callbacks.current.onError(error);
      }
      window.setTimeout(() => void refresh(), 350);
    },
    [refresh],
  );

  const play = useCallback(
    async (list: Track[], at: number) => {
      setQueue(list.slice(at, at + 25));
      setLoading(true);
      setOptimistic({ playing: true, at: Date.now() });
      try {
        await spotify.play(list, at);
      } catch (error) {
        setOptimistic(null);
        callbacks.current.onError(error);
      } finally {
        setLoading(false);
        window.setTimeout(() => void refresh(), 600);
      }
    },
    [refresh],
  );

  const toggle = useCallback(() => {
    if (!remote?.item) return;
    setOptimistic({ playing: !playing, at: Date.now() });
    void run(playing ? "pause" : "play");
  }, [playing, remote?.item, run]);

  const repeat: RepeatMode = remote?.repeat === "track" ? "one" : remote?.repeat === "context" ? "all" : "off";

  return {
    source: "spotify" as const,
    current,
    queue,
    index,
    playing,
    loading,
    time,
    length,
    volume,
    muted: (remote?.volume ?? 1) === 0 && mutedFrom.current !== null,
    shuffle: remote?.shuffle ?? false,
    repeat,
    stopAfterCurrent,
    play,
    /** The sound plays outside Nimbo, so there is nothing to analyse; the dance keeps a steady beat. */
    readLevels: useCallback((): { bass: number; bands: number[] } | null => null, []),
    toggle,
    pause: useCallback(() => void run("pause"), [run]),
    moveInQueue: (_from: number, _to: number) => {},
    removeFromQueue: (_position: number) => {},
    enqueue: (track: Track, _next = false) => {
      setQueue((items) => [...items, track]);
      void spotify.queue(track).catch((error) => callbacks.current.onError(error));
    },
    clearUpcoming: () => {},
    jump: (position: number) => void play(queue, position),
    next: () => void run("next"),
    previous: () => {
      if (time > 3) void run("seek", 0);
      else void run("previous");
    },
    seek: (seconds: number) => {
      setRemote((state) => (state ? { ...state, progressMs: seconds * 1000 } : state));
      setPolledAt(Date.now());
      void run("seek", Math.round(seconds * 1000));
    },
    setVolume: (value: number) => {
      mutedFrom.current = null;
      setOptimistic({ volume: Math.round(value * 100), at: Date.now() });
      window.clearTimeout(volumeTimer.current);
      volumeTimer.current = window.setTimeout(() => void run("volume", Math.round(value * 100)), 180);
    },
    toggleMute: () => {
      if (mutedFrom.current !== null) {
        const back = mutedFrom.current;
        mutedFrom.current = null;
        setOptimistic({ volume: back, at: Date.now() });
        void run("volume", back);
      } else {
        mutedFrom.current = remote?.volume ?? 80;
        setOptimistic({ volume: 0, at: Date.now() });
        void run("volume", 0);
      }
    },
    toggleShuffle: () => void run("shuffle", remote?.shuffle ? 0 : 1),
    cycleRepeat: () => void run("repeat", repeat === "off" ? 1 : repeat === "all" ? 2 : 0),
    setStopAfterCurrent,
    /** Spotify's own device, shown in the player. */
    device: remote?.device ?? null,
  };
}

export type SpotifyPlayer = ReturnType<typeof useSpotifyPlayer>;
