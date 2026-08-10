import type { Container } from 'dockerode';
import { docker } from './client.js';
import type { CreateContainerSpec } from '../games/types.js';

export const MANAGED_LABEL = 'outpost.managed';

/** Pulls `image` if it isn't present locally yet. Streams progress to stdout for server logs. */
export async function ensureImage(image: string): Promise<void> {
  const images = await docker.listImages({ filters: { reference: [image] } });
  if (images.length > 0) return;

  await new Promise<void>((resolve, reject) => {
    docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (progressErr) => (progressErr ? reject(progressErr) : resolve()));
    });
  });
}

export async function createServerContainer(
  spec: CreateContainerSpec,
  labels: Record<string, string>,
): Promise<Container> {
  await ensureImage(spec.image);

  return docker.createContainer({
    name: spec.containerName,
    Image: spec.image,
    Env: spec.env,
    Tty: true,
    OpenStdin: true,
    StdinOnce: false,
    AttachStdin: false,
    AttachStdout: false,
    AttachStderr: false,
    ExposedPorts: { [`${spec.gamePort}/tcp`]: {} },
    HostConfig: {
      Binds: [`${spec.dataPath}:/data`],
      PortBindings: { [`${spec.gamePort}/tcp`]: [{ HostPort: String(spec.hostPort) }] },
      Memory: spec.memoryMb * 1024 * 1024,
      RestartPolicy: { Name: 'unless-stopped' },
    },
    Labels: { [MANAGED_LABEL]: 'true', ...labels },
  });
}

export function getContainer(containerId: string): Container {
  return docker.getContainer(containerId);
}

export async function startContainer(containerId: string): Promise<void> {
  await getContainer(containerId).start();
}

export async function stopContainer(containerId: string, timeoutSec = 30): Promise<void> {
  try {
    await getContainer(containerId).stop({ t: timeoutSec });
  } catch (err: unknown) {
    // 304 = already stopped, not an error for our purposes
    if (!(err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 304)) {
      throw err;
    }
  }
}

export async function restartContainer(containerId: string, timeoutSec = 30): Promise<void> {
  await getContainer(containerId).restart({ t: timeoutSec });
}

export async function removeContainer(containerId: string): Promise<void> {
  try {
    await getContainer(containerId).remove({ force: true });
  } catch (err: unknown) {
    if (!(err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 404)) {
      throw err;
    }
  }
}

export interface ServerStatus {
  state: 'running' | 'exited' | 'created' | 'restarting' | 'paused' | 'dead' | 'unknown';
  cpuPercent: number;
  memoryUsedMb: number;
  memoryLimitMb: number;
}

export async function getContainerStatus(containerId: string): Promise<ServerStatus> {
  const container = getContainer(containerId);
  const inspect = await container.inspect();
  const state = (inspect.State.Status as ServerStatus['state']) ?? 'unknown';

  if (!inspect.State.Running) {
    return { state, cpuPercent: 0, memoryUsedMb: 0, memoryLimitMb: 0 };
  }

  const stats = await container.stats({ stream: false });
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const cpuCount = stats.cpu_stats.online_cpus ?? stats.cpu_stats.cpu_usage.percpu_usage?.length ?? 1;
  const cpuPercent = systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;

  return {
    state,
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    memoryUsedMb: Math.round(stats.memory_stats.usage / 1024 / 1024),
    memoryLimitMb: Math.round(stats.memory_stats.limit / 1024 / 1024),
  };
}
