import { AnimatePresence, motion } from 'framer-motion';
import type { ServerReadiness } from '../lib/api';

const STYLES: Record<ServerReadiness, string> = {
  running: 'bg-accent-500/15 text-accent-400',
  installing: 'bg-ember-500/15 text-ember-400',
  booting: 'bg-ember-500/15 text-ember-400',
  offline: 'bg-base-700 text-base-200',
  crashed: 'bg-red-500/15 text-red-400',
};

// Soft color-matched glow behind each badge — echoes its dot/text color so "Running" reads as a
// calm green halo, "Crashed" as a red one, etc. Offline stays flat (nothing to draw attention to).
const GLOWS: Record<ServerReadiness, string> = {
  running: 'shadow-[0_0_12px_2px_rgba(9,222,120,0.35)]',
  installing: 'shadow-[0_0_12px_2px_rgba(249,115,22,0.35)]',
  booting: 'shadow-[0_0_12px_2px_rgba(249,115,22,0.35)]',
  offline: '',
  crashed: 'shadow-[0_0_12px_2px_rgba(239,68,68,0.35)]',
};

const LABELS: Record<ServerReadiness, string> = {
  running: 'Running!',
  installing: 'Installing…',
  booting: 'Booting up!',
  offline: 'Offline!',
  crashed: 'Crashed!',
};

// Pulsing signals "something's actively happening" — true for the live states, but not for a
// crashed server (it's not doing anything anymore) or a plain offline one.
const PULSES: Record<ServerReadiness, boolean> = {
  running: true,
  installing: true,
  booting: true,
  offline: false,
  crashed: false,
};

export default function StatusBadge({ readiness }: { readiness: ServerReadiness }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-300 ${STYLES[readiness]} ${GLOWS[readiness]}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {PULSES[readiness] && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />}
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
      </span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={readiness}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.15 }}
        >
          {LABELS[readiness]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
