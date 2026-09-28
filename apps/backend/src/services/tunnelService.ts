import { docker } from '../docker/client.js';
import { removeContainer } from '../docker/containers.js';
import { readContainerLogs } from '../docker/cli.js';

// ghcr.io/playit-cloud/playit-agent - lets friends outside the LAN join without touching router
// port-forwarding.
const TUNNEL_IMAGE = 'ghcr.io/playit-cloud/playit-agent:latest';

export const PLAYIT_KEY_URL =
  'https://playit.gg/account/setup/wizard/new-account/docker/docker-name';
export const PLAYIT_TUNNELS_URL = 'https://playit.gg/account/tunnels';

export async function createTunnel(containerName: string, secretKey: string): Promise<string> {
  const images = await docker.listImages({ filters: { reference: [TUNNEL_IMAGE] } });
  if (images.length === 0) {
    await new Promise<void>((resolve, reject) => {
      docker.pull(TUNNEL_IMAGE, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        docker.modem.followProgress(stream, (progressErr) =>
          progressErr ? reject(progressErr) : resolve(),
        );
      });
    });
  }

  const container = await docker.createContainer({
    name: containerName,
    Image: TUNNEL_IMAGE,
    Env: [`SECRET_KEY=${secretKey}`],
    // playit's own docs target "localhost:<port>" as the tunnel destination.
    HostConfig: { NetworkMode: 'host', RestartPolicy: { Name: 'unless-stopped' } },
    Labels: { 'outpost.managed': 'true', 'outpost.tunnel': 'true' },
  });
  await container.start();
  return container.id;
}

export interface TunnelStatus {
  running: boolean;
  /**
   * A https://playit.gg/claim/... link, only present for legacy no-key agent runs; normally null.
   */
  claimUrl: string | null;
  /** True once the agent's logs show it successfully connected to playit's relay network. */
  connected: boolean;
  recentLogs: string;
}

export async function getTunnelStatus(containerId: string): Promise<TunnelStatus> {
  const container = docker.getContainer(containerId);
  const inspect = await container.inspect().catch(() => null);
  if (!inspect) return { running: false, claimUrl: null, connected: false, recentLogs: '' };

  const logs = await readContainerLogs(containerId, 60);
  const claimMatch = logs.match(/https:\/\/playit\.gg\/claim\/\S+/);
  const connected = /tunnel.*running|connected to relay|control.*established/i.test(logs);

  return {
    running: inspect.State.Running,
    claimUrl: claimMatch?.[0] ?? null,
    connected,
    recentLogs: logs,
  };
}

export async function removeTunnel(containerId: string): Promise<void> {
  await removeContainer(containerId);
}
