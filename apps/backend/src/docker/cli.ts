import { spawn } from 'node:child_process';

/**
 * dockerode's attach()/logs() streams never deliver data over this app's target transports
 * (verified against Docker Desktop's Windows npipe backend — attach and logs-follow both hang
 * indefinitely on both read and write, while the `docker` CLI streams the exact same endpoints
 * instantly). Shelling out to the CLI sidesteps whatever docker-modem's stream parsing is doing
 * wrong and is the same binary ZimaOS/CasaOS installs already ship alongside the daemon.
 */

export function followContainerLogs(containerId: string, onChunk: (text: string) => void): { stop(): void } {
  const proc = spawn('docker', ['logs', '-f', '--tail', '200', containerId]);
  proc.stdout.on('data', (chunk: Buffer) => onChunk(chunk.toString('utf8')));
  proc.stderr.on('data', (chunk: Buffer) => onChunk(chunk.toString('utf8')));
  return {
    stop() {
      proc.kill();
    },
  };
}

/** One-shot log read (not streaming) — for polling a container's recent output on demand, e.g.
 *  tunnel-agent status checks, without keeping a subprocess open for the life of the request. */
export function readContainerLogs(containerId: string, tailLines = 50): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['logs', '--tail', String(tailLines), containerId]);
    let out = '';
    proc.stdout.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    proc.stderr.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    proc.on('close', () => resolve(out));
    proc.on('error', () => resolve(out));
  });
}
