export type Platform = { left: number; right: number; top: number };
export type Body = { x: number; y: number; vx: number; vy: number; ground: number | null };
export type StepResult = { body: Body; impact: number };

export const BUDDY_SIZE = 56;
const GRAVITY = 2400;
const AIR_DRAG = 0.35;
const WALL_BOUNCE = 0.55;
const RIDE_TOLERANCE = 24;
const LAND_TOLERANCE = 2;

function covers(platform: Platform, center: number) {
  return center >= platform.left && center <= platform.right;
}

export function supportsOf(platforms: Platform[], floor: number, width: number): Platform[] {
  return [...platforms, { left: 0, right: width, top: floor }];
}

export function step(body: Body, dt: number, supports: Platform[], width: number): StepResult {
  const next: Body = { ...body };
  const center = () => next.x + BUDDY_SIZE / 2;
  let impact = 0;

  if (next.ground !== null) {
    next.x += next.vx * dt;
    const ground = next.ground;
    const under = supports
      .filter((platform) => covers(platform, center()) && Math.abs(platform.top - ground) <= RIDE_TOLERANCE)
      .sort((a, b) => Math.abs(a.top - ground) - Math.abs(b.top - ground))[0];
    if (under) {
      next.ground = under.top;
      next.y = under.top - BUDDY_SIZE;
      next.vy = 0;
    } else {
      next.ground = null;
    }
  } else {
    next.vy += GRAVITY * dt;
    next.vx *= 1 - AIR_DRAG * dt;
    const bottom = next.y + BUDDY_SIZE;
    const nextY = next.y + next.vy * dt;
    next.x += next.vx * dt;
    const landing =
      next.vy >= 0
        ? supports
            .filter((platform) => covers(platform, center()) && bottom <= platform.top + LAND_TOLERANCE && nextY + BUDDY_SIZE >= platform.top)
            .sort((a, b) => a.top - b.top)[0]
        : undefined;
    if (landing) {
      impact = next.vy;
      next.y = landing.top - BUDDY_SIZE;
      next.vy = 0;
      next.ground = landing.top;
    } else {
      next.y = nextY;
      if (next.y < 0) {
        next.y = 0;
        next.vy = Math.abs(next.vy) * 0.3;
      }
    }
  }

  if (next.x < 0) {
    next.x = 0;
    next.vx = Math.abs(next.vx) * (next.ground === null ? WALL_BOUNCE : 1);
  } else if (next.x > width - BUDDY_SIZE) {
    next.x = width - BUDDY_SIZE;
    next.vx = -Math.abs(next.vx) * (next.ground === null ? WALL_BOUNCE : 1);
  }
  return { body: next, impact };
}

export function throwVelocity(samples: { x: number; y: number; t: number }[], now: number) {
  const recent = samples.filter((sample) => now - sample.t <= 90);
  if (recent.length < 2) return { vx: 0, vy: 0 };
  const first = recent[0];
  const last = recent[recent.length - 1];
  const seconds = Math.max(0.016, (last.t - first.t) / 1000);
  const clamp = (value: number) => Math.max(-3200, Math.min(3200, value));
  return { vx: clamp((last.x - first.x) / seconds), vy: clamp((last.y - first.y) / seconds) };
}

export function follow(current: { x: number; y: number }, target: { x: number; y: number }, dt: number) {
  const ease = Math.min(1, dt * 7);
  return { x: current.x + (target.x - current.x) * ease, y: current.y + (target.y - current.y) * ease };
}
