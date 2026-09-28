/** The running build's version, tucked into the bottom-right corner. */
export default function VersionLabel() {
  return (
    <span className="pointer-events-none fixed bottom-2 right-3 z-50 select-none font-mono text-[11px] text-base-500/40">
      v{__APP_VERSION__}
    </span>
  );
}
