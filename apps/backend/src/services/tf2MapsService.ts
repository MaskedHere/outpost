import { docker } from '../docker/client.js';

// ghcr.io/melkortf/tf2-base ships with exactly one map (cp_badlands) to keep the image small.
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

/**
 * Fire-and-forget: kicks off the validate pass inside the container and returns immediately rather
 * than waiting the several minutes it can take.
 */
export async function startInstallingMaps(
  containerId: string,
  onComplete?: (ok: boolean) => void,
): Promise<void> {
  if (inProgress.has(containerId)) return;
  inProgress.add(containerId);

  try {
    const container = docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: VALIDATE_CMD,
      AttachStdout: true,
      AttachStderr: true,
    });
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
