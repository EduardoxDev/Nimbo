export type Pet = { affection: number; lastSeen: number };

export const PET_KEY = "nimbo-pet";
export const LEVEL_KEY = "nimbo-level";

export function parsePet(raw: string | null): Pet {
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<Pet>) : {};
    return { affection: Math.max(0, Number(parsed.affection) || 0), lastSeen: Math.max(0, Number(parsed.lastSeen) || 0) };
  } catch {
    return { affection: 0, lastSeen: 0 };
  }
}

export function isRub(samples: { x: number; t: number }[]) {
  let turns = 0;
  let direction = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const delta = samples[index].x - samples[index - 1].x;
    if (Math.abs(delta) < 2) continue;
    const next = Math.sign(delta);
    if (direction !== 0 && next !== direction) turns += 1;
    direction = next;
  }
  return turns >= 4;
}

export function auraOf(level: number): "sparkle" | "wings" | null {
  return level >= 5 ? "wings" : level >= 3 ? "sparkle" : null;
}
