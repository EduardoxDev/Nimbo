/** "Find my PC": a bright rising arpeggio, three times, loud enough to hear across the room. */
export function playFindMeChime() {
  try {
    const context = new AudioContext();
    for (let round = 0; round < 3; round += 1) {
      [784, 988, 1175, 1568].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime + round * 0.9 + index * 0.12;
        oscillator.type = "triangle";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.32, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.55);
      });
    }
    window.setTimeout(() => void context.close(), 3_500);
  } catch {
    // No audio output: the visual notice still shows.
  }
}
