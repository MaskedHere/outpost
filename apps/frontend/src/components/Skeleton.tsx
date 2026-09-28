/** A pulsing placeholder block. */
export default function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-base-800 ${className}`} />;
}
