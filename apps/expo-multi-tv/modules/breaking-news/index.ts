import { requireNativeModule, EventSubscription } from 'expo-modules-core';

export interface BreakingNewsStatus {
  running: boolean;
  lastError: string | null;
}

interface BreakingNewsModule {
  canDrawOverlays(): boolean;
  start(apiUrl: string, token: string): void;
  stop(): void;
  status(): BreakingNewsStatus;
  // Fired when the interrupt stage of a departure countdown wants playback paused.
  addListener(event: 'pause', listener: (payload: { reason: string }) => void): EventSubscription;
  // Fired when that interrupt is dismissed (remote OK, or the phone said "I've left").
  addListener(event: 'resume', listener: () => void): EventSubscription;
}

export default requireNativeModule<BreakingNewsModule>('BreakingNews');
