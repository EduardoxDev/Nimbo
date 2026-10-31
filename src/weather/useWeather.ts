import { useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { setWeather, type Weather, type WeatherPlace } from "./weather";

const REFRESH_MS = 30 * 60 * 1000;

export function useWeather(place: WeatherPlace | null) {
  const latitude = place?.latitude;
  const longitude = place?.longitude;

  useEffect(() => {
    if (latitude === undefined || longitude === undefined) {
      setWeather(null);
      return;
    }
    if (!isTauri()) return;
    let cancelled = false;
    const refresh = () =>
      void invoke<Weather>("weather_current", { latitude, longitude })
        .then((weather) => {
          if (!cancelled) setWeather(weather);
        })
        .catch((error) => console.error("Failed to load the weather", error));
    refresh();
    const interval = window.setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [latitude, longitude]);
}
