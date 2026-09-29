import { dashboardConfig } from './config';

export interface DailyForecast {
  date: string;
  code: number;
  max: number;
  min: number;
  rainChance: number;
}

export interface Weather {
  currentTemp: number;
  currentCode: number;
  daily: DailyForecast[];
}

// WMO weather interpretation codes used by Open-Meteo.
// https://open-meteo.com/en/docs
export function describeWeather(code: number): { label: string; icon: string } {
  if (code === 0) return { label: 'Clear', icon: '☀️' };
  if (code === 1) return { label: 'Mostly clear', icon: '🌤️' };
  if (code === 2) return { label: 'Partly cloudy', icon: '⛅' };
  if (code === 3) return { label: 'Cloudy', icon: '☁️' };
  if (code === 45 || code === 48) return { label: 'Fog', icon: '🌫️' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: '🌦️' };
  if (code >= 61 && code <= 67) return { label: 'Rain', icon: '🌧️' };
  if (code >= 71 && code <= 77) return { label: 'Snow', icon: '❄️' };
  if (code >= 80 && code <= 82) return { label: 'Showers', icon: '🌦️' };
  if (code === 85 || code === 86) return { label: 'Snow showers', icon: '🌨️' };
  if (code >= 95) return { label: 'Thunderstorm', icon: '⛈️' };
  return { label: `Code ${code}`, icon: '❔' };
}

export async function fetchWeather(
  location: { latitude: number; longitude: number; timezone?: string } = dashboardConfig.location,
): Promise<Weather> {
  const { latitude, longitude } = location;
  const timezone = location.timezone ?? dashboardConfig.location.timezone;
  const params = [
    `latitude=${latitude}`,
    `longitude=${longitude}`,
    'current=temperature_2m,weather_code',
    'daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    `timezone=${encodeURIComponent(timezone)}`,
    'forecast_days=3',
  ].join('&');
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) {
    throw new Error(`Weather request failed: HTTP ${res.status}`);
  }
  const json = await res.json();
  return {
    currentTemp: json.current.temperature_2m,
    currentCode: json.current.weather_code,
    daily: json.daily.time.map((date: string, i: number) => ({
      date,
      code: json.daily.weather_code[i],
      max: json.daily.temperature_2m_max[i],
      min: json.daily.temperature_2m_min[i],
      rainChance: json.daily.precipitation_probability_max[i],
    })),
  };
}
