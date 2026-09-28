import net from 'node:net';
import { config } from '../config.js';
import { readContainerLogs } from '../docker/cli.js';
import { getGameDefinition } from '../games/registry.js';
import { rconExec, RconAuthError } from '../rcon/client.js';

export type ServerReadiness = 'offline' | 'crashed' | 'installing' | 'booting' | 'running';

// Which sub-phase of 'installing' this is: the mod loader's own installer, or itzg's per-mod
// MODRINTH_PROJECTS download. Byte progress is only meaningful for the latter.
export type InstallPhase = 'loader' | 'mods' | null;

const MOD_DOWNLOAD_RE = /Downloading (mod|MODRINTH)/i;

// Docker reports a container as running long before the game has loaded and is accepting players;
// this tells the two apart for the status badge.

function probeTcp(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

// A bare TCP connect succeeding is *not* proof RCON works.
async function probeRcon(
  host: string,
  port: number,
  password: string,
  timeoutMs = 2000,
): Promise<boolean> {
  try {
    await rconExec(host, port, password, 'status', timeoutMs);
    return true;
  } catch (err) {
    return err instanceof RconAuthError;
  }
}

export async function getServerReadiness(
  gameId: string,
  containerId: string,
  containerRunning: boolean,
  startedAt: string | null,
  gamePort: number,
  rconPort: number | null,
  rconPassword: string | null,
  exitInfo: {
    exitCode: number | null;
    oomKilled: boolean;
    deliberateStop: boolean;
    restartCount: number;
  },
): Promise<{ readiness: ServerReadiness; installPhase: InstallPhase; confirmed: boolean }> {
  if (!containerRunning) {
    // A container Outpost itself just stopped can still exit nonzero (e.g. SIGKILLed after the stop
    // timeout)
    if (
      !exitInfo.deliberateStop &&
      (exitInfo.oomKilled || (exitInfo.exitCode !== null && exitInfo.exitCode !== 0))
    ) {
      return { readiness: 'crashed', installPhase: null, confirmed: true };
    }
    return { readiness: 'offline', installPhase: null, confirmed: true };
  }

  const def = getGameDefinition(gameId);
  let ready: boolean;
  let installing = false;
  let logs = '';

  if (def.readyLogPattern) {
    logs = await readContainerLogs(containerId, 200);
    ready = def.readyLogPattern.test(logs);
    if (!ready) installing = def.installingLogPattern?.test(logs) ?? false;
  } else if (rconPort && rconPassword) {
    // A real RCON auth round-trip, not just a bare TCP connect.
    ready = await probeRcon(config.rconHost, rconPort, rconPassword);
  } else {
    // No RCON to authenticate against: fall back to a plain port probe (the game port, since
    // there's no RCON port either).
    ready = await probeTcp(config.rconHost, rconPort ?? gamePort);
  }

  // `confirmed` marks a 'running' that something proved.
  if (ready) return { readiness: 'running', installPhase: null, confirmed: true };

  // Not ready *and* Docker has already restarted this container at least once: it isn't booting,
  // it's crash-looping.
  if (!exitInfo.deliberateStop && exitInfo.restartCount > 0) {
    return { readiness: 'crashed', installPhase: null, confirmed: true };
  }

  const upMs = startedAt ? Date.now() - new Date(startedAt).getTime() : Infinity;

  // Matching the installer pattern is itself positive evidence of real progress, not a stall.
  if (installing && upMs < 30 * 60 * 1000) {
    return {
      readiness: 'installing',
      installPhase: MOD_DOWNLOAD_RE.test(logs) ? 'mods' : 'loader',
      confirmed: true,
    };
  }

  // Safety valve: after a grace period, trust Docker's "running" so a missed log pattern can't
  // leave the server stuck on "Booting up!".
  if (upMs > 5 * 60 * 1000) return { readiness: 'running', installPhase: null, confirmed: false };

  return { readiness: 'booting', installPhase: null, confirmed: true };
}
