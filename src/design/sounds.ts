/** Small, soft interface sounds (off by default), synthesized so nothing needs to be downloaded. */
export type UiSound = "open" | "done" | "notice";

let context: AudioContext | null = null;

function audio() {
  if (!context || context.state === "closed") context = new AudioContext();
  if (context.state === "suspended") void context.resume().catch(() => {});
  return context;
}

const SOUNDS: Record<UiSound, { notes: number[]; gap: number; length: number; volume: number; type: OscillatorType }> = {
  // A quick soft "pop" upwards.
  open: { notes: [520, 780], gap: 0.045, length: 0.14, volume: 0.05, type: "sine" },
  // Two bright notes, like a tick on a checklist.
  done: { notes: [880, 1320], gap: 0.09, length: 0.35, volume: 0.07, type: "triangle" },
  // One gentle bell.
  notice: { notes: [988], gap: 0, length: 0.6, volume: 0.06, type: "sine" },
};

export function playUiSound(sound: UiSound) {
  try {
    const ctx = audio();
    const { notes, gap, length, volume, type } = SOUNDS[sound];
    notes.forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + index * gap;
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + length + 0.05);
    });
  } catch {
    // No audio device: silence is fine.
  }
}
