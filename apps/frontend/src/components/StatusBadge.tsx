import type { ServerStatus } from '../lib/api';

const STYLES: Record<string, string> = {
  running: 'bg-accent-500/15 text-accent-400',
  restarting: 'bg-ember-500/15 text-ember-400',
  exited: 'bg-base-700 text-base-200',
  created: 'bg-base-700 text-base-200',
  paused: 'bg-base-700 text-base-200',
  dead: 'bg-red-500/15 text-red-400',
  unknown: 'bg-base-700 text-base-200',
};

export default function StatusBadge({ status }: { status: ServerStatus | null }) {
  const state = status?.state ?? 'unknown';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STYLES[state]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {state}
    </span>
  );
}
