import { useEffect, useState } from 'react';

/** Whether the decorative background layers should run. */
export type EffectsPreference = 'auto' | 'on' | 'off';

const STORAGE_KEY = 'outpost.visualEffects';
/** Below this the page feels laggy rather than merely imperfect. */
const MIN_ACCEPTABLE_FPS = 30;
/** Long enough to ride out first-paint jank, short enough that nobody watches it struggle. */
const PROBE_MS = 1200;

export function readPreference(): EffectsPreference {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'on' || saved === 'off' || saved === 'auto' ? saved : 'auto';
}

export function writePreference(value: EffectsPreference): void {
  localStorage.setItem(STORAGE_KEY, value);
  window.dispatchEvent(new CustomEvent('outpost:effects-changed'));
}

/** Counts real animation frames over a short window and reports the average rate. */
function probeFrameRate(): Promise<number> {
  return new Promise((resolve) => {
    let frames = 0;
    const started = performance.now();
    const tick = () => {
      frames++;
      const elapsed = performance.now() - started;
      if (elapsed >= PROBE_MS) {
        resolve((frames / elapsed) * 1000);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export function useVisualEffects(): boolean {
  const [preference, setPreference] = useState<EffectsPreference>(readPreference);
  // Assume capable until measured, so a fast machine never flashes the plain background.
  const [capable, setCapable] = useState(true);

  useEffect(() => {
    const onChange = () => setPreference(readPreference());
    window.addEventListener('outpost:effects-changed', onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener('outpost:effects-changed', onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  useEffect(() => {
    if (preference !== 'auto') return;
    let cancelled = false;
    probeFrameRate().then((fps) => {
      if (!cancelled) setCapable(fps >= MIN_ACCEPTABLE_FPS);
    });
    return () => {
      cancelled = true;
    };
  }, [preference]);

  if (preference === 'off') return false;
  if (preference === 'on') return true;
  return capable;
}
