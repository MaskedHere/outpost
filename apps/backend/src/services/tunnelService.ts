import { docker } from '../docker/client.js';
import { removeContainer } from '../docker/containers.js';
import { readContainerLogs } from '../docker/cli.js';

// ghcr.io/playit-cloud/playit-agent — lets friends outside the LAN join without touching router
// port-forwarding. Requires a free secret key from the user's own playit.gg account (generated
// via a one-time visit to their setup wizard); Outpost can't create that account or key on
// someone's behalf, so this is the one manual step that has to happen on playit's own site.
const TUNNEL_IMAGE = 'ghcr.io/playit-cloud/playit-agent:latest';

export const PLAYIT_KEY_URL = 'https://playit.gg/account/setup/wizard/new-account/docker/docker-name';
export const PLAYIT_TUNNELS_URL = 'https://playit.gg/account/tunnels';

export async function createTunnel(containerName: string, secretKey: string): Promise<string> {
  const images = await docker.listImages({ filters: { reference: [TUNNEL_IMAGE] } });
  if (images.length === 0) {
    await new Promise<void>((resolve, reject) => {
      docker.pull(TUNNEL_IMAGE, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        docker.modem.followProgress(stream, (progressErr) => (progressErr ? reject(progressErr) : resolve()));
      });
    });
  }

  const container = await docker.createContainer({
    name: containerName,
    Image: TUNNEL_IMAGE,
    Env: [`SECRET_KEY=${secretKey}`],
    // playit's own docs target "localhost:<port>" as the tunnel destination — host networking
    // makes that literally true, matching their instructions exactly instead of making the user
    // translate to a Docker-bridge address.
    HostConfig: { NetworkMode: 'host', RestartPolicy: { Name: 'unless-stopped' } },
    Labels: { 'outpost.managed': 'true', 'outpost.tunnel': 'true' },
  });
  await container.start();
  return container.id;
}

export interface TunnelStatus {
  running: boolean;
  /** A https://playit.gg/claim/... link, only present for legacy/no-key agent runs — the current
   *  image requires a key up front, so this is normally null. Kept for forward-compatibility. */
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
