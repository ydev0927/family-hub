// Weather from Open-Meteo (free, no API key). Cached for 30 minutes.
const CACHE_MS = 30 * 60 * 1000;
let cache = null;

export function describeWeather(code) {
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mostly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code >= 95) return 'Thunderstorm';
  return `Code ${code}`;
}

export async function getWeather({ latitude, longitude }, timezone) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const params = [
    `latitude=${latitude}`,
    `longitude=${longitude}`,
    'current=temperature_2m,weather_code',
    'daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    `timezone=${encodeURIComponent(timezone)}`,
    'forecast_days=1',
  ].join('&');
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`Weather request failed: HTTP ${res.status}`);
  const json = await res.json();
  const value = {
    current: describeWeather(json.current.weather_code),
    code: json.current.weather_code,
    temp: Math.round(json.current.temperature_2m),
    high: Math.round(json.daily.temperature_2m_max[0]),
    low: Math.round(json.daily.temperature_2m_min[0]),
    rainChance: json.daily.precipitation_probability_max[0],
  };
  cache = { at: Date.now(), value };
  return value;
}
