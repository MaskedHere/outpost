/** A pulsing placeholder block — the building piece every skeleton loading state in the app is
 *  built from, sized/shaped per spot with className to roughly match what's about to load in.
 *  Using the theme's own base-800 (not a generic gray) so it reads as "part of the UI" in both
 *  light and dark rather than a mismatched loading-library default. */
export default function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-base-800 ${className}`} />;
}
