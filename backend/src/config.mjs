export const config = {
  timezone: process.env.TIMEZONE ?? 'Asia/Tokyo',
  location: {
    name: process.env.LOCATION_NAME ?? 'Tokyo',
    latitude: Number(process.env.LATITUDE ?? 35.6895),
    longitude: Number(process.env.LONGITUDE ?? 139.6917),
  },
  family: (process.env.FAMILY ?? 'Dad,Mom,Ken,Yui').split(','),
  accessToken: process.env.ACCESS_TOKEN,
  // Public base URL of this API, used for the QR code that phones open.
  publicUrl: process.env.PUBLIC_URL,
  // Runs the household on a shifted clock (minutes). For demos and testing only; the TV clocks follow it.
  timeShiftMinutes: Number(process.env.TIME_SHIFT_MINUTES ?? 0) || 0,
};
