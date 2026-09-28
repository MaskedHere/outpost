// A server Outpost just stopped can still exit nonzero (e.g. 137/143 after a SIGKILL). Tracking
// requested stops lets readinessService tell a normal shutdown from a crash.
const GRACE_MS = 60_000;
const recentStops = new Map<string, number>();

export function markStopRequested(serverId: string): void {
  recentStops.set(serverId, Date.now());
}

export function wasRecentlyStoppedByUser(serverId: string): boolean {
  const at = recentStops.get(serverId);
  return at !== undefined && Date.now() - at < GRACE_MS;
}
