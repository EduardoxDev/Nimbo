/**
 * Ambient sounds for focus, made on the PC with Web Audio (nothing to download):
 * rain, a busy café, a fireplace, waves and brown noise. Two can play at once.
 */

export type AmbientKind = "rain" | "cafe" | "fire" | "waves" | "brown";
export const AMBIENT_KINDS: AmbientKind[] = ["rain", "cafe", "fire", "waves", "brown"];
export const AMBIENT_KEY = "nimbo-ambient";
export const MAX_AT_ONCE = 2;

type Voice = { gain: GainNode; stop: () => void };

let context: AudioContext | null = null;
const voices = new Map<AmbientKind, Voice>();
const buffers = new Map<string, AudioBuffer>();

function audio() {
  if (!context || context.state === "closed") context = new AudioContext();
  if (context.state === "suspended") void context.resume().catch(() => {});
  return context;
}

/** Four seconds of white, pink or brown noise, looped. */
function noise(ctx: AudioContext, color: "white" | "pink" | "brown") {
  const cached = buffers.get(color);
  if (cached) return cached;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let index = 0; index < data.length; index += 1) {
    const white = Math.random() * 2 - 1;
    if (color === "white") data[index] = white * 0.5;
    else if (color === "brown") {
      last = (last + 0.02 * white) / 1.02;
      data[index] = last * 3.5;
    } else {
      // Paul Kellet's pink noise filter.
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[index] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  }
  buffers.set(color, buffer);
  return buffer;
}

function bed(ctx: AudioContext, out: AudioNode, color: "white" | "pink" | "brown", filters: BiquadFilterNode[], level: number) {
  const source = ctx.createBufferSource();
  source.buffer = noise(ctx, color);
  source.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = level;
  let node: AudioNode = source;
  for (const filter of filters) {
    node.connect(filter);
    node = filter;
  }
  node.connect(gain).connect(out);
  source.start();
  return { source, gain };
}

function filter(ctx: AudioContext, type: BiquadFilterType, frequency: number, q = 0.7) {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  return node;
}

/** Short bursts on a random timer: raindrops, fire crackles, cups in a café. */
function sprinkle(ctx: AudioContext, out: AudioNode, every: [number, number], make: (at: number) => void) {
  let timer = 0;
  let stopped = false;
  const next = () => {
    if (stopped) return;
    make(ctx.currentTime + 0.01);
    timer = window.setTimeout(next, every[0] + Math.random() * (every[1] - every[0]));
  };
  next();
  void out;
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}

function burst(ctx: AudioContext, out: AudioNode, at: number, options: { frequency: number; q: number; length: number; level: number }) {
  const source = ctx.createBufferSource();
  source.buffer = noise(ctx, "white");
  const band = filter(ctx, "bandpass", options.frequency, options.q);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(options.level, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + options.length);
  source.connect(band).connect(gain).connect(out);
  source.start(at, Math.random() * 3);
  source.stop(at + options.length + 0.02);
}

function build(kind: AmbientKind, ctx: AudioContext, out: GainNode): () => void {
  const stops: (() => void)[] = [];
  const keep = (source: AudioBufferSourceNode) => stops.push(() => source.stop());
  if (kind === "rain") {
    keep(bed(ctx, out, "pink", [filter(ctx, "highpass", 500), filter(ctx, "lowpass", 7000)], 0.55).source);
    stops.push(sprinkle(ctx, out, [25, 110], (at) => burst(ctx, out, at, { frequency: 2500 + Math.random() * 4000, q: 2, length: 0.03 + Math.random() * 0.05, level: 0.05 + Math.random() * 0.12 })));
  } else if (kind === "cafe") {
    keep(bed(ctx, out, "brown", [filter(ctx, "lowpass", 900)], 0.35).source);
    // Voices: speech-band noise that swells and fades like a room talking.
    const talk = bed(ctx, out, "pink", [filter(ctx, "bandpass", 700, 0.9)], 0.18);
    keep(talk.source);
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 0.35;
    depth.gain.value = 0.1;
    lfo.connect(depth).connect(talk.gain.gain);
    lfo.start();
    stops.push(() => lfo.stop());
    stops.push(
      sprinkle(ctx, out, [3000, 9000], (at) => {
        const bell = ctx.createOscillator();
        const gain = ctx.createGain();
        bell.frequency.value = 2200 + Math.random() * 1600;
        gain.gain.setValueAtTime(0.04, at);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
        bell.connect(gain).connect(out);
        bell.start(at);
        bell.stop(at + 0.45);
      }),
    );
  } else if (kind === "fire") {
    keep(bed(ctx, out, "brown", [filter(ctx, "lowpass", 600)], 0.6).source);
    stops.push(sprinkle(ctx, out, [60, 450], (at) => burst(ctx, out, at, { frequency: 1500 + Math.random() * 3000, q: 1, length: 0.01 + Math.random() * 0.03, level: 0.15 + Math.random() * 0.3 })));
  } else if (kind === "waves") {
    const sea = bed(ctx, out, "pink", [filter(ctx, "lowpass", 1400)], 0.25);
    keep(sea.source);
    const swell = ctx.createOscillator();
    const depth = ctx.createGain();
    swell.frequency.value = 0.09;
    depth.gain.value = 0.22;
    swell.connect(depth).connect(sea.gain.gain);
    swell.start();
    stops.push(() => swell.stop());
  } else {
    keep(bed(ctx, out, "brown", [filter(ctx, "lowpass", 450)], 0.7).source);
  }
  return () => stops.forEach((stop) => {
    try {
      stop();
    } catch {
      // Already stopped.
    }
  });
}

export function playingAmbient() {
  return [...voices.keys()];
}

export function startAmbient(kind: AmbientKind, volume: number) {
  if (voices.has(kind)) return;
  // Two at most: the oldest one makes room.
  if (voices.size >= MAX_AT_ONCE) stopAmbient(voices.keys().next().value as AmbientKind);
  const ctx = audio();
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 1.5);
  gain.connect(ctx.destination);
  const stop = build(kind, ctx, gain);
  voices.set(kind, { gain, stop });
}

export function stopAmbient(kind: AmbientKind) {
  const voice = voices.get(kind);
  if (!voice || !context) return;
  voices.delete(kind);
  // Fade out instead of cutting.
  voice.gain.gain.cancelScheduledValues(context.currentTime);
  voice.gain.gain.setValueAtTime(voice.gain.gain.value, context.currentTime);
  voice.gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.8);
  window.setTimeout(() => {
    voice.stop();
    voice.gain.disconnect();
  }, 900);
}

export function setAmbientVolume(kind: AmbientKind, volume: number) {
  const voice = voices.get(kind);
  if (voice && context) voice.gain.gain.setTargetAtTime(volume, context.currentTime, 0.1);
}

export function stopAllAmbient() {
  [...voices.keys()].forEach(stopAmbient);
}
