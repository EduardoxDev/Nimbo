import { useCallback, useEffect, useRef, useState } from "react";
import { catalog, loadVolume, saveVolume, type Track } from "./catalog";
import { EQ_BANDS, type MusicSettings } from "./settings";

export type RepeatMode = "off" | "all" | "one";

type Sound = Pick<MusicSettings, "eqGains" | "normalize" | "fade" | "speed">;

type Graph = {
  context: AudioContext;
  filters: BiquadFilterNode[];
  compressor: DynamicsCompressorNode;
  fader: GainNode;
  analyser: AnalyserNode;
  bins: Uint8Array<ArrayBuffer>;
};

/**
 * Plays 30-second previews from a queue through a small Web Audio chain:
 * equalizer → optional compressor → fade → analyser. Preview links expire,
 * so a track that fails (or was saved without one) is fetched again once.
 */
export function usePreviewPlayer({
  sound,
  onStart,
  onMissing,
  onQueueEnd,
}: {
  sound: Sound;
  onStart: (track: Track) => void;
  onMissing: () => void;
  /** Asked when the queue runs out with repeat off; returns what to play next. */
  onQueueEnd: (last: Track, played: Track[]) => Promise<Track[] | null>;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(30);
  const [volume, setVolumeState] = useState(loadVolume);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  /** Pause when the current song ends (the "end of song" sleep timer). */
  const [stopAfterCurrent, setStopAfterCurrent] = useState(false);
  const refreshed = useRef(new Set<number>());
  const startToken = useRef(0);
  const callbacks = useRef({ onStart, onMissing, onQueueEnd });
  callbacks.current = { onStart, onMissing, onQueueEnd };
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const current = index >= 0 ? queue[index] ?? null : null;
  const queueRef = useRef(queue);
  const indexRef = useRef(index);
  queueRef.current = queue;
  indexRef.current = index;

  if (!audioRef.current && typeof Audio !== "undefined") {
    const audio = new Audio();
    audio.preload = "auto";
    // Deezer's preview CDN allows any origin, which lets Web Audio read the samples.
    audio.crossOrigin = "anonymous";
    audioRef.current = audio;
  }

  const graph = useRef<Graph | null>(null);

  /** Built on the first play: browsers only start an AudioContext after a click. */
  const ensureGraph = () => {
    const audio = audioRef.current;
    if (graph.current || !audio || typeof AudioContext === "undefined") {
      void graph.current?.context.resume().catch(() => {});
      return;
    }
    try {
      const context = new AudioContext();
      const filters = EQ_BANDS.map((frequency, band) => {
        const filter = context.createBiquadFilter();
        filter.type = band === 0 ? "lowshelf" : band === EQ_BANDS.length - 1 ? "highshelf" : "peaking";
        filter.frequency.value = frequency;
        filter.Q.value = 1;
        return filter;
      });
      const compressor = context.createDynamicsCompressor();
      const fader = context.createGain();
      const analyser = context.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.78;
      let node: AudioNode = context.createMediaElementSource(audio);
      for (const filter of filters) {
        node.connect(filter);
        node = filter;
      }
      node.connect(compressor);
      compressor.connect(fader);
      fader.connect(analyser);
      analyser.connect(context.destination);
      graph.current = { context, filters, compressor, fader, analyser, bins: new Uint8Array(analyser.frequencyBinCount) };
      applySound(graph.current, soundRef.current);
    } catch (error) {
      console.error("Audio chain unavailable", error);
    }
  };

  const ensureGraphRef = useRef(ensureGraph);
  ensureGraphRef.current = ensureGraph;

  useEffect(() => {
    if (graph.current) applySound(graph.current, sound);
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = sound.speed;
      audio.preservesPitch = true;
    }
  }, [sound]);

  /** Loudness per band (0..1) right now, or null before anything played. */
  const readLevels = useCallback((): { bass: number; bands: number[] } | null => {
    const current = graph.current;
    if (!current) return null;
    current.analyser.getByteFrequencyData(current.bins);
    const bins = current.bins;
    const bass = (bins[1] + bins[2] + bins[3] + bins[4]) / (4 * 255);
    const bands: number[] = [];
    const count = 24;
    // Log-ish spacing so the low end does not take every bar.
    for (let band = 0; band < count; band++) {
      const from = Math.floor(Math.pow(band / count, 1.6) * (bins.length - 1));
      const to = Math.max(from + 1, Math.floor(Math.pow((band + 1) / count, 1.6) * (bins.length - 1)));
      let sum = 0;
      for (let bin = from; bin < to; bin++) sum += bins[bin];
      bands.push(sum / ((to - from) * 255));
    }
    return { bass, bands };
  }, []);

  /** Fade in at the start; the end fades in `timeupdate`. */
  const fadeIn = () => {
    const chain = graph.current;
    if (!chain) return;
    const now = chain.context.currentTime;
    const seconds = soundRef.current.fade;
    chain.fader.gain.cancelScheduledValues(now);
    chain.fader.gain.setValueAtTime(seconds ? 0.0001 : 1, now);
    if (seconds) chain.fader.gain.exponentialRampToValueAtTime(1, now + seconds / 2);
  };

  const start = useCallback(async (list: Track[], at: number) => {
    const audio = audioRef.current;
    const track = list[at];
    if (!audio || !track) return;
    const token = ++startToken.current;
    setQueue(list);
    setIndex(at);
    setTime(0);
    setLoading(true);

    let playable = track;
    if (!playable.preview) {
      try {
        playable = await catalog.track(track.id);
        refreshed.current.add(track.id);
      } catch {
        // Falls through to the "no preview" path.
      }
      if (token !== startToken.current) return;
      if (playable.preview) {
        setQueue((items) => items.map((item, position) => (position === at ? playable : item)));
      }
    }
    if (!playable.preview) {
      setLoading(false);
      setPlaying(false);
      callbacks.current.onMissing();
      return;
    }

    audio.src = playable.preview;
    audio.playbackRate = soundRef.current.speed;
    ensureGraphRef.current();
    fadeIn();
    try {
      await audio.play();
      if (token === startToken.current) callbacks.current.onStart(playable);
    } catch (error) {
      // Autoplay blocks and aborted loads land here; `error` events retry.
      if ((error as DOMException)?.name !== "AbortError") console.error("Preview did not start", error);
    }
  }, []);

  const step = useCallback(
    (direction: 1 | -1, automatic = false) => {
      if (queue.length === 0) return;
      if (automatic && stopAfterCurrent) {
        setStopAfterCurrent(false);
        setPlaying(false);
        return;
      }
      if (automatic && repeat === "one") {
        void start(queue, index);
        return;
      }
      let next = index + direction;
      if (shuffle && queue.length > 1 && direction === 1) {
        do next = Math.floor(Math.random() * queue.length);
        while (next === index);
      }
      if (next >= queue.length) {
        if (repeat === "off") {
          const last = queue[index];
          const played = queue;
          void callbacks.current.onQueueEnd(last, played).then((more) => {
            if (more && more.length > 0) void start(more, 0);
            else if (!automatic) void start(played, 0);
            else setPlaying(false);
          });
          return;
        }
        next = 0;
      }
      if (next < 0) next = queue.length - 1;
      void start(queue, next);
    },
    [index, queue, repeat, shuffle, start, stopAfterCurrent],
  );

  const stepRef = useRef(step);
  stepRef.current = step;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => {
      setTime(audio.currentTime);
      const chain = graph.current;
      const seconds = soundRef.current.fade;
      const left = (audio.duration - audio.currentTime) / audio.playbackRate;
      if (chain && seconds && Number.isFinite(left) && left < seconds / 2 && chain.fader.gain.value > 0.5) {
        const now = chain.context.currentTime;
        chain.fader.gain.cancelScheduledValues(now);
        chain.fader.gain.setValueAtTime(chain.fader.gain.value, now);
        chain.fader.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.2, left));
      }
    };
    const onMeta = () => setLength(Number.isFinite(audio.duration) ? audio.duration : 30);
    const onReady = () => setLoading(false);
    const onWaiting = () => setLoading(true);
    const onEnded = () => stepRef.current(1, true);
    const onError = () => {
      setLoading(false);
      const track = queueRef.current[indexRef.current];
      if (!track) return;
      if (!refreshed.current.has(track.id)) {
        // The link most likely expired: ask for a fresh one and try again.
        refreshed.current.add(track.id);
        const list = queueRef.current.map((item, position) =>
          position === indexRef.current ? { ...item, preview: null } : item,
        );
        void start(list, indexRef.current);
        return;
      }
      callbacks.current.onMissing();
      stepRef.current(1, true);
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("playing", onReady);
    audio.addEventListener("canplay", onReady);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("playing", onReady);
      audio.removeEventListener("canplay", onReady);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
    };
  }, [start]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
    saveVolume(volume);
  }, [volume, muted]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.paused) {
      ensureGraphRef.current();
      void audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [current]);

  const pause = useCallback(() => audioRef.current?.pause(), []);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setTime(seconds);
    // Seeking back from inside the end fade restores full volume.
    const chain = graph.current;
    if (chain && audio.duration - seconds > soundRef.current.fade / 2) {
      chain.fader.gain.cancelScheduledValues(chain.context.currentTime);
      chain.fader.gain.setValueAtTime(1, chain.context.currentTime);
    }
  }, []);

  // Windows media keys and the island's media controls.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    session.metadata = current
      ? new MediaMetadata({
          title: current.title,
          artist: current.artistName,
          album: current.albumTitle,
          artwork: [current.coverXl, current.cover]
            .filter((src): src is string => Boolean(src))
            .map((src) => ({ src, sizes: src === current.coverXl ? "1000x1000" : "250x250", type: "image/jpeg" })),
        })
      : null;
    const handlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
      ["play", () => toggle()],
      ["pause", () => toggle()],
      ["nexttrack", () => stepRef.current(1)],
      ["previoustrack", () => stepRef.current(-1)],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, current ? handler : null);
      } catch {
        // Older WebView2 builds do not know every action.
      }
    }
  }, [current, toggle]);

  return {
    current,
    queue,
    index,
    playing,
    loading,
    time,
    length,
    volume,
    muted,
    shuffle,
    repeat,
    stopAfterCurrent,
    play: start,
    readLevels,
    toggle,
    pause,
    next: () => step(1),
    previous: () => {
      // Like most players: restart the song unless it just began.
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

function applySound(chain: Graph, sound: Sound) {
  const now = chain.context.currentTime;
  chain.filters.forEach((filter, band) => filter.gain.setTargetAtTime(sound.eqGains[band] ?? 0, now, 0.05));
  // "Even volume": a gentle compressor; off means a ratio of 1 (no change).
  chain.compressor.threshold.setTargetAtTime(sound.normalize ? -24 : 0, now, 0.05);
  chain.compressor.knee.setTargetAtTime(sound.normalize ? 24 : 0, now, 0.05);
  chain.compressor.ratio.setTargetAtTime(sound.normalize ? 4 : 1, now, 0.05);
  chain.compressor.attack.setTargetAtTime(0.01, now, 0.05);
  chain.compressor.release.setTargetAtTime(0.25, now, 0.05);
}

export type PreviewPlayer = ReturnType<typeof usePreviewPlayer>;
