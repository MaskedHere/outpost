import { motion } from 'framer-motion';

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
    : `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

/** Progress for a modded server's first boot. */
export default function InstallProgressBar({
  installPhase,
  bytes,
  totalBytes,
  compact = false,
}: {
  installPhase: 'loader' | 'mods' | null;
  bytes: number | null;
  totalBytes: number | null;
  compact?: boolean;
}) {
  const rawPercent = totalBytes && bytes !== null ? (bytes / totalBytes) * 100 : null;
  // Never claim 100% while still installing.
  const percent = rawPercent !== null ? Math.min(99, Math.round(rawPercent)) : null;
  const pinned = rawPercent !== null && rawPercent >= 99;
  const indeterminate = percent === null;

  const label =
    percent !== null
      ? pinned
        ? 'Almost done — finishing up…'
        : `${formatBytes(bytes!)} / ${formatBytes(totalBytes!)} (${percent}%)`
      : installPhase === 'loader'
        ? 'Installing the mod loader (Forge/NeoForge/Fabric) — unrelated to mod count, can take a few minutes'
        : installPhase === 'mods'
          ? 'Setting up mods…'
          : 'Installing…';

  return (
    <div className={compact ? 'w-full' : ''}>
      <div
        className={`h-1.5 w-full overflow-hidden rounded-full bg-base-800 ${compact ? '' : 'mb-1'}`}
      >
        <motion.div
          className={`h-full rounded-full bg-ember-500 ${pinned || indeterminate ? 'animate-pulse' : ''}`}
          animate={{ width: `${percent ?? 100}%` }}
          transition={{ duration: 0.4 }}
          style={indeterminate ? { opacity: 0.5 } : undefined}
        />
      </div>
      {!compact && <p className="text-xs text-ember-400">{label}</p>}
    </div>
  );
}
