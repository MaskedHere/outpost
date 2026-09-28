import net from 'node:net';

/**
 * Minimal client for Valve's Source RCON protocol
 * (https://developer.valvesoftware.com/wiki/Source_RCON_Protocol).
 * Minecraft's RCON is a direct copy of this same wire format, and Factorio/Project Zomboid/most
 * Source-engine dedicated servers all speak it too.
 */

const TYPE_AUTH = 3;
const TYPE_EXEC = 2;
const TYPE_AUTH_RESPONSE = 2;
const TYPE_RESPONSE_VALUE = 0;

function encodePacket(id: number, type: number, body: string): Buffer {
  const bodyBuf = Buffer.from(body, 'utf8');
  const size = 4 + 4 + bodyBuf.length + 2;
  const packet = Buffer.alloc(4 + size);
  packet.writeInt32LE(size, 0);
  packet.writeInt32LE(id, 4);
  packet.writeInt32LE(type, 8);
  bodyBuf.copy(packet, 12);
  packet.writeInt8(0, 12 + bodyBuf.length);
  packet.writeInt8(0, 12 + bodyBuf.length + 1);
  return packet;
}

interface DecodedPacket {
  id: number;
  type: number;
  body: string;
}

/** Pulls complete packets off a growing receive buffer, returning leftover unread bytes. */
function decodePackets(buf: Buffer<ArrayBufferLike>): {
  packets: DecodedPacket[];
  rest: Buffer<ArrayBufferLike>;
} {
  const packets: DecodedPacket[] = [];
  let offset = 0;
  while (offset + 4 <= buf.length) {
    const size = buf.readInt32LE(offset);
    if (offset + 4 + size > buf.length) break;
    const id = buf.readInt32LE(offset + 4);
    const type = buf.readInt32LE(offset + 8);
    const body = buf.toString('utf8', offset + 12, offset + 4 + size - 2);
    packets.push({ id, type, body });
    offset += 4 + size;
  }
  return { packets, rest: Buffer.from(buf.subarray(offset)) };
}

export class RconAuthError extends Error {}

/** Connects, authenticates, runs one command, and disconnects. */
export function rconExec(
  host: string,
  port: number,
  password: string,
  command: string,
  timeoutMs = 8000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let recvBuf: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let authed = false;
    const authId = 1;
    const execId = 2;

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('RCON request timed out'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      socket.destroy();
    };

    socket.on('connect', () => {
      socket.write(encodePacket(authId, TYPE_AUTH, password));
    });

    socket.on('data', (chunk) => {
      recvBuf = Buffer.concat([recvBuf, chunk]);
      const { packets, rest } = decodePackets(recvBuf);
      recvBuf = rest;

      for (const pkt of packets) {
        if (!authed) {
          // Some servers send an empty SERVERDATA_RESPONSE_VALUE before the real auth response.
          if (pkt.type !== TYPE_AUTH_RESPONSE) continue;
          if (pkt.id === -1) {
            cleanup();
            reject(new RconAuthError('RCON authentication failed (wrong password)'));
            return;
          }
          authed = true;
          socket.write(encodePacket(execId, TYPE_EXEC, command));
          continue;
        }

        if (pkt.type === TYPE_RESPONSE_VALUE && pkt.id === execId) {
          cleanup();
          resolve(pkt.body);
          return;
        }
      }
    });

    socket.on('error', (err) => {
      cleanup();
      reject(err);
    });

    socket.on('close', () => {
      // No-op if already settled. If the remote end closed first (e.g. a server dropping a banned
      // IP), this is the only place the promise gets settled.
      clearTimeout(timer);
      reject(new Error('RCON connection closed before completing'));
    });
  });
}
