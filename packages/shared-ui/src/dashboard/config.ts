// Location used for the weather forecast.
export const dashboardConfig = {
  location: {
    name: 'Tokyo',
    latitude: 35.6895,
    longitude: 139.6917,
    timezone: 'Asia/Tokyo',
  },
  weatherRefreshMs: 30 * 60 * 1000,
  // Family Hub API (backend/). Set in apps/expo-multi-tv/.env.
  api: {
    url: process.env.EXPO_PUBLIC_API_URL,
    token: process.env.EXPO_PUBLIC_API_TOKEN,
  },
};
