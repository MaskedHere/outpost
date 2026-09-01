/** A stacked server rack — two rounded units each with a status light, the same shape as Feather's
 *  familiar "server" icon, filled with Modrinth's dark-to-bright green gradient instead of a flat
 *  color and sitting directly on the background with no badge behind it (Modrinth's own mark has
 *  no flat-color container either — the gradient glyph carries the color itself). */
export default function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className}>
      <defs>
        <linearGradient id="outpost-logo-grad" x1="4" y1="28" x2="28" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#04914f" />
          <stop offset="100%" stopColor="#76ffbc" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="24" height="10" rx="3" fill="url(#outpost-logo-grad)" />
      <rect x="4" y="18" width="24" height="10" rx="3" fill="url(#outpost-logo-grad)" />
      <circle cx="10" cy="9" r="1.5" fill="#0b1f16" />
      <circle cx="10" cy="23" r="1.5" fill="#0b1f16" />
    </svg>
  );
}
