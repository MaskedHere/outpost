import net from 'node:net';
import { config } from '../config.js';
import { readContainerLogs } from '../docker/cli.js';
import { getGameDefinition } from '../games/registry.js';
import { rconExec, RconAuthError } from '../rcon/client.js';

export type ServerReadiness = 'offline' | 'crashed' | 'installing' | 'booting' | 'running';

// 'installing' covers two very different sub-phases that byte-count progress means nothing alike
// for: the mod loader's own installer (Forge/NeoForge downloading and unpacking its own library
// jars — has zero relationship to how many mods the pack has) and itzg's own MODRINTH_PROJECTS
// mod-by-mod download (the only phase a "bytes downloaded / pack's total mod size" percentage is
// actually meaningful for). Exposing which one so the UI can show honest, phase-specific text
// instead of a byte count that either means nothing or, worse, races past 100% during the loader
// phase and reads as "stuck" — see routes/servers.ts's attachStatus.
export type InstallPhase = 'loader' | 'mods' | null;

const MOD_DOWNLOAD_RE = /Downloading (mod|MODRINTH)/i;

// A container can be "Running" from Docker's point of view long before the game inside it has
// actually finished loading a world/save and started accepting players — this is what tells the
// two apart for the UI's "Booting up! / Running! / Offline!" badge.

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

// A bare TCP connect succeeding is *not* proof RCON actually works — confirmed live via a GMod
// server on Docker Desktop for Windows, where the host-side port-forwarding proxy accepts the
// connection before it even reaches the container (nothing listening on the game's RCON port yet),
// then closes it once it realizes there's no real backend. probeTcp reported "ready" instantly, the
// Players tab then tried a real RCON call against that same not-actually-open port, and got "RCON
// connection closed before completing" — a raw error instead of the "still booting" state it should
// have shown. Running an actual (cheap) authenticated RCON round-trip is the only way to know RCON
// really answers. A wrong password still counts as "ready" here — that's a config problem the
// Players tab itself surfaces clearly, not a "the server hasn't started yet" state.
async function probeRcon(host: string, port: number, password: string, timeoutMs = 2000): Promise<boolean> {
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
  exitInfo: { exitCode: number | null; oomKilled: boolean; deliberateStop: boolean; restartCount: number },
): Promise<{ readiness: ServerReadiness; installPhase: InstallPhase; confirmed: boolean }> {
  if (!containerRunning) {
    // A container Outpost itself just stopped can still exit nonzero (e.g. SIGKILLed after the
    // stop timeout) — that's not a crash. Otherwise, a nonzero exit or an OOM kill means the game
    // process ended on its own, unprompted — worth flagging distinctly from a clean "Offline!" so
    // it's obvious at a glance whether the server just isn't running or actually went down hard.
    if (!exitInfo.deliberateStop && (exitInfo.oomKilled || (exitInfo.exitCode !== null && exitInfo.exitCode !== 0))) {
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
    // A real RCON auth round-trip, not just a bare TCP connect — see probeRcon's doc comment for
    // why the bare-connect version actively lied about readiness.
    ready = await probeRcon(config.rconHost, rconPort, rconPassword);
  } else {
    // No RCON to authenticate against: fall back to a plain port probe (the game port, since
    // there's no RCON port either). If that port turns out to be UDP-only, the TCP connect just
    // fails fast and we fall through to the grace-period safety valve below rather than
    // misreporting "running".
    ready = await probeTcp(config.rconHost, rconPort ?? gamePort);
  }

  // `confirmed` marks a 'running' that something actually proved — a matched ready-log line or an
  // answered RCON/port probe — as opposed to the grace-period guess below. The badge treats both
  // the same, but anything that acts on "this server is genuinely healthy" must not trust the
  // guess: a crash-looping Garry's Mod server (segfaulting on boot every 20s, RCON never
  // answering) still reads as 'running' once the grace period lapses, and caching that install
  // would seed every future server with a broken copy.
  if (ready) return { readiness: 'running', installPhase: null, confirmed: true };

  // Not ready *and* Docker has already restarted this container at least once: it isn't booting,
  // it's crash-looping. Under the `unless-stopped` policy a crashing container is back up within
  // seconds, so it's almost never caught in an exited state — every individual poll saw a
  // freshly-started container and reported "Booting up!" indefinitely, which is exactly what a
  // Sodium-crashed Minecraft server did while showing a calm orange badge. RestartCount is the one
  // signal that survives the restart, so it's what turns a loop into an honest "Crashed!".
  if (!exitInfo.deliberateStop && exitInfo.restartCount > 0) {
    return { readiness: 'crashed', installPhase: null, confirmed: true };
  }

  const upMs = startedAt ? Date.now() - new Date(startedAt).getTime() : Infinity;

  // Matching the installer pattern is itself positive evidence of real progress, not a stall — so
  // it gets a much longer leash than plain "booting" before falling through to the safety valve
  // below (NeoForge's ~100 library jars alone took several minutes in testing).
  if (installing && upMs < 30 * 60 * 1000) {
    return { readiness: 'installing', installPhase: MOD_DOWNLOAD_RE.test(logs) ? 'mods' : 'loader', confirmed: true };
  }

  // Safety valve: never get stuck showing "Booting up!" forever because a log pattern didn't
  // match or a port stayed closed — after a generous grace period, trust Docker's own "running".
  if (upMs > 5 * 60 * 1000) return { readiness: 'running', installPhase: null, confirmed: false };

  return { readiness: 'booting', installPhase: null, confirmed: true };
}
