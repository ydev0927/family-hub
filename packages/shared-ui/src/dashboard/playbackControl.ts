// Lets the breaking-news service pause the app's own video player, and resume it afterwards.
type Listener = () => void;
const pauseListeners = new Set<Listener>();
const resumeListeners = new Set<Listener>();

function subscribe(set: Set<Listener>, listener: Listener) {
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

export const playbackControl = {
  pause() {
    pauseListeners.forEach((l) => l());
  },
  resume() {
    resumeListeners.forEach((l) => l());
  },
  onPause(listener: Listener) {
    return subscribe(pauseListeners, listener);
  },
  onResume(listener: Listener) {
    return subscribe(resumeListeners, listener);
  },
};
