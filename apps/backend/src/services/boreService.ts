import { docker } from '../docker/client.js';
import { removeContainer } from '../docker/containers.js';
import { readContainerLogs } from '../docker/cli.js';

// ekzhang/bore (github.com/ekzhang/bore) + its free public bore.pub relay.
const BORE_IMAGE = 'ekzhang/bore:latest';

export const BORE_PORT_MIN = 10000;
export const BORE_PORT_MAX = 59999;

export function pickBorePort(): number {
  return BORE_PORT_MIN + Math.floor(Math.random() * (BORE_PORT_MAX - BORE_PORT_MIN));
}

export async function createBoreTunnel(
  containerName: string,
  gamePort: number,
  remotePort: number,
): Promise<string> {
  const images = await docker.listImages({ filters: { reference: [BORE_IMAGE] } });
  if (images.length === 0) {
    await new Promise<void>((resolve, reject) => {
      docker.pull(BORE_IMAGE, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        docker.modem.followProgress(stream, (progressErr) =>
          progressErr ? reject(progressErr) : resolve(),
        );
      });
    });
  }

  const container = await docker.createContainer({
    name: containerName,
    Image: BORE_IMAGE,
    // Requesting a specific remote port (rather than letting bore.pub assign one) means Outpost
    // already knows the address.
    Cmd: ['local', String(gamePort), '--to', 'bore.pub', '--port', String(remotePort)],
    // Host networking so "local <port>" resolves to the Docker host's localhost, where the game
    // container's published port lives.
    HostConfig: { NetworkMode: 'host', RestartPolicy: { Name: 'unless-stopped' } },
    Labels: { 'outpost.managed': 'true', 'outpost.bore': 'true' },
  });
  await container.start();
  return container.id;
}

export interface BoreStatus {
  running: boolean;
  /** True once the logs show bore's own "connected to server" line. */
  connected: boolean;
  /**
   * True when the logs suggest the requested port was rejected (e.g. already taken by someone else
   * on bore.pub)
   */
  failed: boolean;
  recentLogs: string;
}

export async function getBoreStatus(containerId: string): Promise<BoreStatus> {
  const container = docker.getContainer(containerId);
  const inspect = await container.inspect().catch(() => null);
  if (!inspect) return { running: false, connected: false, failed: false, recentLogs: '' };

  const logs = await readContainerLogs(containerId, 40);
  const connected = inspect.State.Running && /connected to server/i.test(logs);
  const failed = !inspect.State.Running || /error|refused|already in use|denied/i.test(logs);

  return {
    running: inspect.State.Running,
    connected,
    failed,
    recentLogs: logs,
  };
}

export async function removeBoreTunnel(containerId: string): Promise<void> {
  await removeContainer(containerId);
}
