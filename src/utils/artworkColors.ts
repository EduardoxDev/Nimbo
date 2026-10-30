export type Rgb = [number, number, number];

export type ArtworkPalette = {
  /** Most vivid tone of the cover, used for glows and the progress bar. */
  accent: Rgb;
  /** Darker companion tone, used for the ambient background. */
  shade: Rgb;
};

export const DEFAULT_ARTWORK_PALETTE: ArtworkPalette = {
  accent: [132, 160, 255],
  shade: [38, 44, 74],
};

function saturationOf([r, g, b]: Rgb) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function lightnessOf([r, g, b]: Rgb) {
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
}

/** Keeps a tone readable on a dark glass surface. */
function liftAccent(color: Rgb): Rgb {
  const lightness = lightnessOf(color);
  if (lightness >= 0.55) return color;
  const lift = (0.55 - lightness) * 255;
  return color.map((channel) => Math.min(255, Math.round(channel + lift))) as Rgb;
}

function darken(color: Rgb, factor: number): Rgb {
  return color.map((channel) => Math.round(channel * factor)) as Rgb;
}

/**
 * Picks an accent and a shade from pixels: tones are bucketed coarsely and the
 * bucket that is both common and saturated wins, so a small vivid spot beats a
 * large grey area without letting single noisy pixels decide.
 */
export function paletteFromPixels(pixels: ArrayLike<number>): ArtworkPalette {
  const buckets = new Map<number, { sum: Rgb; count: number }>();
  let total: Rgb = [0, 0, 0];
  let totalCount = 0;

  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue;
    const color: Rgb = [pixels[index], pixels[index + 1], pixels[index + 2]];
    total = [total[0] + color[0], total[1] + color[1], total[2] + color[2]];
    totalCount += 1;

    const key = ((color[0] >> 5) << 6) | ((color[1] >> 5) << 3) | (color[2] >> 5);
    const bucket = buckets.get(key) ?? { sum: [0, 0, 0] as Rgb, count: 0 };
    bucket.sum = [bucket.sum[0] + color[0], bucket.sum[1] + color[1], bucket.sum[2] + color[2]];
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  if (totalCount === 0) return DEFAULT_ARTWORK_PALETTE;

  let best: Rgb | null = null;
  let bestScore = 0;
  for (const { sum, count } of buckets.values()) {
    const color = sum.map((channel) => channel / count) as Rgb;
    const lightness = lightnessOf(color);
    if (lightness < 0.12 || lightness > 0.94) continue;
    const score = (count / totalCount) ** 0.6 * (0.15 + saturationOf(color));
    if (score > bestScore) {
      bestScore = score;
      best = color;
    }
  }

  const average = total.map((channel) => channel / totalCount) as Rgb;
  const accent = liftAccent((best ?? average).map(Math.round) as Rgb);
  const shade = darken(best ? mix(best, average, 0.5) : average, 0.42);
  return { accent, shade };
}

function mix(a: Rgb, b: Rgb, weight: number): Rgb {
  return a.map((channel, index) => channel * (1 - weight) + b[index] * weight) as Rgb;
}

/** Reads a cover image (data URL) in the browser and returns its palette. */
export function extractArtworkPalette(source: string): Promise<ArtworkPalette> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const size = 32;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        resolve(DEFAULT_ARTWORK_PALETTE);
        return;
      }
      context.drawImage(image, 0, 0, size, size);
      resolve(paletteFromPixels(context.getImageData(0, 0, size, size).data));
    };
    image.onerror = () => resolve(DEFAULT_ARTWORK_PALETTE);
    image.src = source;
  });
}
