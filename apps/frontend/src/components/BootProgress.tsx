import { useEffect, useState } from 'react';

/** Indicator for a server that has started but hasn't finished booting. */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export default function BootProgress({
  startedAt,
  compact = false,
}: {
  /** When the container started, from Docker. */
  startedAt: string | null;
  compact?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const startedMs = startedAt ? new Date(startedAt).getTime() : null;
  const elapsed = startedMs !== null && !Number.isNaN(startedMs) ? now - startedMs : null;
  // Long enough to be worth saying out loud, without nagging during a normal vanilla boot.
  const slow = elapsed !== null && elapsed > 3 * 60 * 1000;

  return (
    <div className={compact ? 'w-full' : ''}>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-base-800">
        <div className="absolute inset-y-0 left-0 w-1/5 animate-sweep rounded-full bg-ember-500/90" />
      </div>
      {!compact && (
        <p className="mt-1 text-xs text-ember-400">
          Booting up{elapsed !== null && ` — ${formatElapsed(elapsed)}`}
          {slow && (
            <span className="text-base-500"> · modded servers often take several minutes</span>
          )}
        </p>
      )}
    </div>
  );
}
