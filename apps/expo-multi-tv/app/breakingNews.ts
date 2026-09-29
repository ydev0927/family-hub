// Starts the breaking-news overlay service and reports its state to the dashboard.
import { Platform } from 'react-native';
import { dashboardConfig, registerOverlayStatus, playbackControl } from '@multi-tv/shared-ui';

const PACKAGE = 'com.familyhub.tv';

export function startBreakingNews() {
  if (Platform.OS !== 'android') return;
  const BreakingNews = require('../modules/breaking-news').default;
  const { url, token } = dashboardConfig.api;

  const startIfPossible = () => {
    if (url && token && BreakingNews.canDrawOverlays() && !BreakingNews.status().running) {
      BreakingNews.start(url, token);
    }
  };

  // The dashboard polls this; it also (re)starts the service once the overlay permission is granted,
  // so the adb command in the warning takes effect without restarting the app.
  registerOverlayStatus(() => {
    if (!url || !token) return { ok: false, message: 'API is not configured' };
    if (!BreakingNews.canDrawOverlays()) {
      return { ok: false, message: `overlay permission missing. Run: adb shell appops set ${PACKAGE} SYSTEM_ALERT_WINDOW allow` };
    }
    startIfPossible();
    const { running, lastError } = BreakingNews.status();
    if (lastError) return { ok: false, message: lastError };
    if (!running) return { ok: false, message: 'service is starting' };
    return { ok: true };
  });

  BreakingNews.addListener('pause', () => playbackControl.pause());
  BreakingNews.addListener('resume', () => playbackControl.resume());
  startIfPossible();
}
