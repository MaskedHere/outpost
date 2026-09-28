import { spawn } from 'node:child_process';

/** dockerode's attach()/logs() streams never deliver data over this app's target transports. */

export function followContainerLogs(
  containerId: string,
  onChunk: (text: string) => void,
): { stop(): void } {
  const proc = spawn('docker', ['logs', '-f', '--tail', '200', containerId]);
  proc.stdout.on('data', (chunk: Buffer) => onChunk(chunk.toString('utf8')));
  proc.stderr.on('data', (chunk: Buffer) => onChunk(chunk.toString('utf8')));
  return {
    stop() {
      proc.kill();
    },
  };
}

/** One-shot log read (not streaming) */
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
