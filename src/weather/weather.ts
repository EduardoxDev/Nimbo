export type WeatherPlace = { name: string; region: string; latitude: number; longitude: number };
export type Weather = { temperature: number; code: number; isDay: boolean; max: number | null; min: number | null };
export type WeatherKind = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";

const CACHE_KEY = "nimbo-weather-cache";
const listeners = new Set<() => void>();
let snapshot: Weather | null = readCache();

function readCache(): Weather | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as { weather?: Weather } | null;
    return parsed?.weather ?? null;
  } catch {
    return null;
  }
}

export function weatherKind(code: number): WeatherKind {
  if (code <= 1) return "clear";
  if (code === 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "cloudy";
}

export function setWeather(weather: Weather | null) {
  snapshot = weather;
  try {
    if (weather) localStorage.setItem(CACHE_KEY, JSON.stringify({ weather, fetchedAt: Date.now() }));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    return;
  } finally {
    listeners.forEach((listener) => listener());
  }
}

export function subscribeWeather(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getWeather() {
  return snapshot;
}
