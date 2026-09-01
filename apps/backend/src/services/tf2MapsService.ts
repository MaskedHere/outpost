import { docker } from '../docker/client.js';

// ghcr.io/melkortf/tf2-base ships with exactly one map (cp_badlands) to keep the image small —
// confirmed via the maintainer's docs and by inspecting a running container. But the steamcmd
// install that built it is still present inside the container, and re-running it with `validate`
// (forcing a full integrity check instead of trusting the — stale, post-stripping — local
// manifest) genuinely restores the complete stock map set: verified live, 233 real .bsp files
// appeared after one full validate pass, matching every map Outpost's own picker offers. This
// downloads several GB, so it runs detached rather than blocking the request that triggers it.
const VALIDATE_CMD = [
  'steamcmd',
  '+force_install_dir',
  '/home/tf2/server',
  '+login',
  'anonymous',
  '+app_update',
  '232250',
  'validate',
  '+quit',
];

const inProgress = new Set<string>();

export function isInstallingMaps(containerId: string): boolean {
  return inProgress.has(containerId);
}

/** Fire-and-forget: kicks off the validate pass inside the container and returns immediately
 *  rather than waiting the several minutes it can take. Callers poll isInstallingMaps() (or just
 *  retry a map change) to know when it's done, or pass onComplete to be notified directly (used
 *  by serverService.ts to auto-switch to the player's originally-requested map once it lands). */
export async function startInstallingMaps(containerId: string, onComplete?: (ok: boolean) => void): Promise<void> {
  if (inProgress.has(containerId)) return;
  inProgress.add(containerId);

  try {
    const container = docker.getContainer(containerId);
    const exec = await container.exec({ Cmd: VALIDATE_CMD, AttachStdout: true, AttachStderr: true });
    const stream = await exec.start({ hijack: true, stdin: false });
    stream.on('data', () => undefined);
    stream.on('end', () => {
      inProgress.delete(containerId);
      onComplete?.(true);
    });
    stream.on('error', () => {
      inProgress.delete(containerId);
      onComplete?.(false);
    });
  } catch {
    inProgress.delete(containerId);
    onComplete?.(false);
  }
}
