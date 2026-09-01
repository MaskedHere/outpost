import { useEffect, useRef, useState } from 'react';
import { serversApi, type GameServer } from '../../lib/api';
import Skeleton from '../Skeleton';

const MAX_POINTS = 60;
const POLL_MS = 1000;
const WIDTH = 600;
const HEIGHT = 64;

interface Sample {
  cpu: number;
  memPercent: number;
  players: number;
  playersMax: number | null;
}

function buildPath(values: number[], max: number): string {
  if (values.length === 0) return '';
  const stepX = WIDTH / (MAX_POINTS - 1);
  const offset = MAX_POINTS - values.length;
  return values
    .map((v, i) => {
      const x = (offset + i) * stepX;
      const clamped = Math.max(0, Math.min(max, v));
      const y = HEIGHT - (max === 0 ? 0 : (clamped / max) * (HEIGHT - 6)) - 3;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

function Trace({
  label,
  values,
  max,
  formatValue,
  color,
}: {
  label: string;
  values: number[];
  max: number;
  formatValue: (v: number) => string;
  color: string;
}) {
  const last = values.at(-1);
  const stepX = WIDTH / (MAX_POINTS - 1);
  const offset = MAX_POINTS - values.length;
  const lastX = last !== undefined ? (offset + values.length - 1) * stepX : null;
  const lastY = last !== undefined ? HEIGHT - (max === 0 ? 0 : (Math.max(0, Math.min(max, last)) / max) * (HEIGHT - 6)) - 3 : null;

  return (
    <div className="relative">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-base-300">{label}</span>
        <span className="font-mono text-base-100">{last !== undefined ? formatValue(last) : '—'}</span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-16 w-full overflow-visible" preserveAspectRatio="none">
        {/* Faint oscilloscope-style grid */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} y1={HEIGHT * f} x2={WIDTH} y2={HEIGHT * f} stroke="currentColor" strokeWidth={1} className="text-base-800" />
        ))}
        {values.length > 1 && (
          <path
            d={buildPath(values, max)}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{ transition: 'd 0.3s linear' }}
          />
        )}
        {lastX !== null && lastY !== null && (
          <g>
            <circle cx={lastX} cy={lastY} r={7} fill={color} opacity={0.25}>
              <animate attributeName="r" values="4;10;4" dur="1.2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.35;0;0.35" dur="1.2s" repeatCount="indefinite" />
            </circle>
            <circle cx={lastX} cy={lastY} r={3} fill={color} />
          </g>
        )}
      </svg>
    </div>
  );
}

/** A live, scrolling "vitals monitor" for the server — CPU/memory/player-count traces styled after
 *  a heart-rate monitor (oscilloscope grid, glowing scan point) rather than a fake ECG waveform, so
 *  it's genuinely useful at a glance and not just decorative.
 *
 *  CPU/memory are polled once a second directly (via /stats — plain docker stats, no RCON, no log
 *  tailing) purely while this tab is mounted, independent of ServerDetail's own slower ~5s poll.
 *  Player count rides along on that same 1s tick but its *value* only actually changes when
 *  ServerDetail's poll delivers a fresh one — RCON round-trips are exactly what's too expensive (and
 *  on some games, like TF2, outright risky — a Source engine server's own anti-flood protection can
 *  ban an IP that reconnects too often) to also run every second. */
export default function StatusPanel({ server }: { server: GameServer }) {
  const [history, setHistory] = useState<Sample[]>([]);
  const playersRef = useRef<{ current: number; max: number | null }>({ current: 0, max: null });

  useEffect(() => {
    playersRef.current = { current: server.players?.current ?? 0, max: server.players?.max ?? null };
  }, [server.players?.current, server.players?.max]);

  useEffect(() => {
    if (!server.status?.running) {
      // A restart shouldn't graph a misleading jump from the last-known-running numbers.
      setHistory([]);
      return;
    }

    let cancelled = false;
    const tick = () => {
      serversApi
        .stats(server.id)
        .then((s) => {
          if (cancelled || !s.running) return;
          setHistory((prev) => {
            const next: Sample[] = [
              ...prev,
              {
                cpu: s.cpuPercent,
                memPercent: s.memoryLimitMb > 0 ? (s.memoryUsedMb / s.memoryLimitMb) * 100 : 0,
                players: playersRef.current.current,
                playersMax: playersRef.current.max,
              },
            ];
            return next.length > MAX_POINTS ? next.slice(next.length - MAX_POINTS) : next;
          });
        })
        .catch(() => undefined);
    };

    tick();
    const interval = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id, server.status?.running]);

  const playersMax = history.at(-1)?.playersMax ?? null;

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-medium text-base-50">Status</h3>
        <span className={`flex items-center gap-1.5 text-xs font-medium ${server.status?.running ? 'text-accent-400' : 'text-base-500'}`}>
          <span className="relative flex h-1.5 w-1.5">
            {server.status?.running && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
            )}
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
          </span>
          {server.status?.running ? 'Live · updates every second' : 'No signal'}
        </span>
      </div>

      {!server.status?.running ? (
        <p className="py-6 text-center text-sm text-base-500">Start the server to see live stats here.</p>
      ) : history.length === 0 ? (
        <div className="space-y-5">
          {['CPU', 'Memory', 'Players'].map((label) => (
            <div key={label}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-base-300">{label}</span>
              </div>
              <Skeleton className="h-16 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          <Trace
            label="CPU"
            values={history.map((h) => h.cpu)}
            max={Math.max(100, ...history.map((h) => h.cpu))}
            formatValue={(v) => `${v.toFixed(1)}%`}
            color="#09de78"
          />
          <Trace
            label="Memory"
            values={history.map((h) => h.memPercent)}
            max={100}
            formatValue={(v) => `${v.toFixed(0)}%`}
            color="#22d3ee"
          />
          <Trace
            label="Players"
            values={history.map((h) => h.players)}
            max={Math.max(1, playersMax ?? Math.max(...history.map((h) => h.players)))}
            formatValue={(v) => (playersMax !== null ? `${v}/${playersMax}` : `${v}`)}
            color="#fb923c"
          />
        </div>
      )}
    </div>
  );
}
