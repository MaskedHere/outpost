// A container that Outpost itself just stopped can still exit with a nonzero code (e.g. 137/143
// if the game didn't handle SIGTERM in time and Docker had to SIGKILL it after the stop timeout)
// — that's a normal shutdown, not a crash. Tracking "we just asked this server to stop" lets
// readinessService.ts tell the two apart instead of judging by exit code alone.
const GRACE_MS = 60_000;
const recentStops = new Map<string, number>();

export function markStopRequested(serverId: string): void {
  recentStops.set(serverId, Date.now());
}

export function wasRecentlyStoppedByUser(serverId: string): boolean {
  const at = recentStops.get(serverId);
  return at !== undefined && Date.now() - at < GRACE_MS;
}
