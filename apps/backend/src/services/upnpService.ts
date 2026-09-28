import { docker } from '../docker/client.js';
import { readContainerLogs } from '../docker/cli.js';

/** Asks the router to forward a port straight to this machine, via UPnP IGD. */

// Alpine plus miniupnpc, installed at run time.
const UPNP_IMAGE = 'alpine:3.20';

/** Long enough for apk to fetch miniupnpc and for SSDP discovery to time out on its own. */
const OPERATION_TIMEOUT_MS = 90_000;

async function ensureImage(): Promise<void> {
  const images = await docker.listImages({ filters: { reference: [UPNP_IMAGE] } });
  if (images.length > 0) return;
  await new Promise<void>((resolve, reject) => {
    docker.pull(UPNP_IMAGE, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (progressErr) =>
        progressErr ? reject(progressErr) : resolve(),
      );
    });
  });
}

/** Runs one upnpc invocation to completion and hands back everything it printed. */
async function runUpnpc(args: string): Promise<{ exitCode: number; output: string }> {
  await ensureImage();

  const container = await docker.createContainer({
    Image: UPNP_IMAGE,
    Cmd: ['sh', '-c', `apk add --no-cache miniupnpc >/dev/null 2>&1 && upnpc ${args}`],
    HostConfig: {
      NetworkMode: 'host',
      // One-shot: nothing here should ever be resurrected by Docker.
      RestartPolicy: { Name: 'no' },
      AutoRemove: false,
    },
    Labels: { 'outpost.managed': 'true', 'outpost.upnp': 'true' },
  });

  try {
    await container.start();
    const finished = container.wait();
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('UPnP request timed out')), OPERATION_TIMEOUT_MS),
    );
    const result = (await Promise.race([finished, timeout])) as { StatusCode: number };
    const output = await readContainerLogs(container.id, 200).catch(() => '');
    return { exitCode: result.StatusCode, output };
  } finally {
    await container.remove({ force: true }).catch(() => undefined);
  }
}

export interface UpnpResult {
  ok: boolean;
  /** The address to hand out, once a mapping exists. */
  externalIp: string | null;
  /**
   * Raw upnpc output, shown on failure (e.g. "No IGD UPnP Device found" when UPnP is disabled on
   * the router).
   */
  output: string;
}

/** Upnpc prints the router's external address as `ExternalIPAddress = 203.0.113.4`. */
function parseExternalIp(output: string): string | null {
  const match = output.match(/ExternalIPAddress\s*=\s*([0-9.]+)/i);
  return match?.[1] ?? null;
}

/** Forwards `port` on the router to this host. */
export async function openPort(port: number, protocol: 'tcp' | 'udp'): Promise<UpnpResult> {
  const proto = protocol.toUpperCase();
  const { exitCode, output } = await runUpnpc(`-r ${port} ${proto}`);
  return { ok: exitCode === 0, externalIp: parseExternalIp(output), output };
}

/** Removes a mapping previously added by openPort. */
export async function closePort(port: number, protocol: 'tcp' | 'udp'): Promise<UpnpResult> {
  const proto = protocol.toUpperCase();
  const { exitCode, output } = await runUpnpc(`-d ${port} ${proto}`);
  return { ok: exitCode === 0, externalIp: null, output };
}

/**
 * Lists the router's current mappings, used to tell whether this server's port is still forwarded.
 */
export async function isPortOpen(
  port: number,
  protocol: 'tcp' | 'udp',
): Promise<UpnpResult & { mapped: boolean }> {
  const proto = protocol.toUpperCase();
  const { exitCode, output } = await runUpnpc('-l');
  // Rows look like:
  //   0 UDP  8211->192.168.1.20:8211 'Outpost' '' 0
  const mapped = new RegExp(`\\b${proto}\\s+${port}->`, 'i').test(output);
  return { ok: exitCode === 0, mapped, externalIp: parseExternalIp(output), output };
}
