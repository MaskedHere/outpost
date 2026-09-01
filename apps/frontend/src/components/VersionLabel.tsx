/**
 * The running build's version, tucked into the bottom-right corner.
 *
 * Deliberately faint and non-interactive: it exists so you can tell at a glance which build a NAS is
 * actually serving after a deploy — the common "did the update land, or is it still the old image?"
 * question — without becoming part of the interface. `pointer-events-none` keeps it from ever
 * swallowing a click meant for something underneath.
 *
 * The value is stamped in at build time from the repo-root package.json (see vite.config.ts), the
 * same number used for the published image tag, so what's on screen matches what was pushed.
 */
export default function VersionLabel() {
  return (
    <span className="pointer-events-none fixed bottom-2 right-3 z-50 select-none font-mono text-[11px] text-base-500/40">
      v{__APP_VERSION__}
    </span>
  );
}
