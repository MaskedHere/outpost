import { AnimatePresence, motion } from 'framer-motion';
import type { ServerReadiness } from '../lib/api';

/** Actions that change the server's state take a few seconds to have any visible effect. */
export type PendingAction = 'start' | 'stop' | 'restart';

type BadgeState = ServerReadiness | 'starting' | 'stopping' | 'restarting';

const PENDING_STATE: Record<PendingAction, BadgeState> = {
  start: 'starting',
  stop: 'stopping',
  restart: 'restarting',
};

const STYLES: Record<BadgeState, string> = {
  running: 'bg-accent-500/15 text-accent-400',
  installing: 'bg-ember-500/15 text-ember-400',
  booting: 'bg-ember-500/15 text-ember-400',
  offline: 'bg-base-700 text-base-200',
  crashed: 'bg-red-500/15 text-red-400',
  // Transitions borrow the same amber as booting/installing: something is underway.
  starting: 'bg-ember-500/15 text-ember-400',
  stopping: 'bg-ember-500/15 text-ember-400',
  restarting: 'bg-ember-500/15 text-ember-400',
};

// Soft color-matched glow behind each badge.
const GLOWS: Record<BadgeState, string> = {
  running: 'shadow-[0_0_12px_2px_rgba(9,222,120,0.35)]',
  installing: 'shadow-[0_0_12px_2px_rgba(249,115,22,0.35)]',
  booting: 'shadow-[0_0_12px_2px_rgba(249,115,22,0.35)]',
  offline: '',
  crashed: 'shadow-[0_0_12px_2px_rgba(239,68,68,0.35)]',
  starting: 'shadow-[0_0_12px_2px_rgba(249,115,22,0.35)]',
  stopping: 'shadow-[0_0_12px_2px_rgba(249,115,22,0.35)]',
  restarting: 'shadow-[0_0_12px_2px_rgba(249,115,22,0.35)]',
};

const LABELS: Record<BadgeState, string> = {
  running: 'Running!',
  installing: 'Installing…',
  booting: 'Booting up!',
  offline: 'Offline!',
  crashed: 'Crashed!',
  starting: 'Starting…',
  stopping: 'Stopping…',
  restarting: 'Restarting…',
};

// Pulsing signals "something's actively happening".
const PULSES: Record<BadgeState, boolean> = {
  running: true,
  installing: true,
  booting: true,
  offline: false,
  crashed: false,
  starting: true,
  stopping: true,
  restarting: true,
};

export default function StatusBadge({
  readiness,
  /** An action the user just triggered that the server hasn't caught up with yet. */
  pending,
}: {
  readiness: ServerReadiness;
  pending?: PendingAction | null;
}) {
  const state: BadgeState = pending ? PENDING_STATE[pending] : readiness;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-300 ${STYLES[state]} ${GLOWS[state]}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {PULSES[state] && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
        )}
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
      </span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={state}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.15 }}
        >
          {LABELS[state]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
