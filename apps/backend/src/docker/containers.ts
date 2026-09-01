import path from 'node:path';
import fs from 'node:fs/promises';
import type { Container } from 'dockerode';
import { docker } from './client.js';
import { toHostPath } from '../config.js';
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
  /** Host port for each entry in spec.ports, same order. */
  hostPorts: number[],
  labels: Record<string, string>,
): Promise<Container> {
  await ensureImage(spec.image);

  const exposedPorts: Record<string, object> = {};
  const portBindings: Record<string, { HostPort: string }[]> = {};
  spec.ports.forEach((p, i) => {
    const key = `${p.containerPort}/${p.protocol}`;
    exposedPorts[key] = {};
    portBindings[key] = [{ HostPort: String(hostPorts[i]) }];
  });

  const binds: string[] = [];
  const hostPaths: Record<string, string> = {};
  for (const v of spec.volumes) {
    // Two different views of the same directory. `localDir` is where *this* process can read and
    // write it; `toHostPath` converts that to where the Docker daemon will find it on the host,
    // which is the only form valid as a bind-mount source. In development they're identical; in a
    // container deploy they are not, and using the local form is what produced
    // `mkdir /data: read-only file system` on ZimaOS.
    const localDir = path.join(spec.dataPath, v.hostSubdir);
    await fs.mkdir(localDir, { recursive: true });
    // Bind-mounted dirs are created by this (Node) process, but plenty of these game images run
    // as a non-root in-container user (e.g. a rootless "steam" account) — without this the
    // container can't write its own save/config files into a dir we just created as ourselves.
    await fs.chmod(localDir, 0o777).catch(() => undefined);
    binds.push(`${toHostPath(localDir)}:${v.containerPath}`);
    // preCreate hooks write real files (Factorio's rconpw, 7 Days to Die's serverconfig.xml), so
    // they get the local form — the host form isn't reachable from in here.
    hostPaths[v.hostSubdir] = localDir;
  }

  if (spec.preCreate) await spec.preCreate(hostPaths);

  return docker.createContainer({
    name: spec.containerName,
    Image: spec.image,
    Env: spec.env,
    Cmd: spec.cmd,
    Tty: true,
    OpenStdin: true,
    StdinOnce: false,
    AttachStdin: false,
    AttachStdout: false,
    AttachStderr: false,
    ExposedPorts: exposedPorts,
    HostConfig: {
      Binds: binds,
      PortBindings: portBindings,
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
  running: boolean;
  startedAt: string | null;
  cpuPercent: number;
  memoryUsedMb: number;
  memoryLimitMb: number;
  /** Last exit code once stopped — null while still running. Used to tell a crash apart from a
   *  clean shutdown (see readinessService.ts's 'crashed' state). */
  exitCode: number | null;
  /** True if the Linux OOM killer ended the container (ran out of its memory limit) — always a
   *  crash regardless of the exit code it happened to leave behind. */
  oomKilled: boolean;
  /** How many times Docker has restarted this container under its `unless-stopped` policy. The
   *  key signal for catching a crash *loop*: the container keeps coming back up, so polling almost
   *  never catches it in an exited state, and every individual sample looks like a fresh boot. A
   *  nonzero count on a server that isn't ready means it's been dying and restarting, not booting.
   *  See readinessService.ts. */
  restartCount: number;
}

export async function getContainerStatus(containerId: string): Promise<ServerStatus> {
  const container = getContainer(containerId);
  const inspect = await container.inspect();
  const state = (inspect.State.Status as ServerStatus['state']) ?? 'unknown';
  const startedAt = inspect.State.Running ? inspect.State.StartedAt : null;

  if (!inspect.State.Running) {
    return {
      state,
      running: false,
      startedAt: null,
      cpuPercent: 0,
      memoryUsedMb: 0,
      memoryLimitMb: 0,
      exitCode: inspect.State.ExitCode ?? null,
      oomKilled: Boolean(inspect.State.OOMKilled),
      restartCount: inspect.RestartCount ?? 0,
    };
  }

  const stats = await container.stats({ stream: false });
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  // Share of the whole machine, 0-100 -- deliberately NOT docker stats' convention.
  //
  // `docker stats` multiplies this by the core count, so a container using four cores flat out
  // reads "400%". That is meaningful to someone who knows the convention and baffling to everyone
  // else, which is most people opening a server panel. systemDelta already spans every core, so
  // cpuDelta/systemDelta is the fraction of total capacity; leaving the multiply off keeps the
  // number in the range the label "%" implies. Clamped because sampling jitter between the two
  // snapshots can otherwise nudge it a hair over.
  const cpuPercent = systemDelta > 0 && cpuDelta > 0
    ? Math.min(100, (cpuDelta / systemDelta) * 100)
    : 0;

  return {
    state,
    running: true,
    startedAt,
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    memoryUsedMb: Math.round(stats.memory_stats.usage / 1024 / 1024),
    memoryLimitMb: Math.round(stats.memory_stats.limit / 1024 / 1024),
    exitCode: null,
    oomKilled: false,
    restartCount: inspect.RestartCount ?? 0,
  };
}
