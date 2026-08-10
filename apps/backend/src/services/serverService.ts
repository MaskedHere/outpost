import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { prisma } from '../db/client.js';
import { config } from '../config.js';
import { getGameDefinition } from '../games/registry.js';
import { createServerContainer } from '../docker/containers.js';
import { allocateGamePort } from '../docker/ports.js';

export class ServerCreationError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

export interface CreateServerInput {
  name: string;
  loader: string;
  mcVersion: string;
  memoryMb: number;
  packId?: string;
}

export async function createServer(input: CreateServerInput) {
  let loader = input.loader;
  let mcVersion = input.mcVersion;
  let modrinthMods: { projectId: string; versionId: string }[] = [];

  if (input.packId) {
    const pack = await prisma.pack.findUnique({ where: { id: input.packId }, include: { items: true } });
    if (!pack) throw new ServerCreationError('Pack not found', 404);
    loader = pack.loader;
    mcVersion = pack.mcVersion;
    modrinthMods = pack.items.map((item) => ({ projectId: item.projectId, versionId: item.versionId }));
  }

  const gameDef = getGameDefinition('minecraft');
  if (!gameDef.loaders.includes(loader)) {
    throw new ServerCreationError(`Unsupported loader: ${loader}`, 400);
  }

  const id = crypto.randomUUID();
  const containerName = `outpost-${id}`;
  const dataPath = path.join(config.serversDir, id);
  await fs.mkdir(dataPath, { recursive: true });

  const hostPort = await allocateGamePort();
  const spec = gameDef.buildContainerSpec({
    containerName,
    dataPath,
    hostPort,
    memoryMb: input.memoryMb,
    loader,
    version: mcVersion,
    modrinthMods,
  });

  let containerId: string;
  try {
    const container = await createServerContainer(spec, { 'outpost.serverId': id });
    containerId = container.id;
    await container.start();
  } catch (err) {
    await fs.rm(dataPath, { recursive: true, force: true });
    throw new ServerCreationError(
      `Failed to create game server container: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  }

  return prisma.gameServer.create({
    data: {
      id,
      name: input.name,
      loader,
      mcVersion,
      containerId,
      containerName,
      gamePort: hostPort,
      memoryMb: input.memoryMb,
      dataPath,
      packId: input.packId ?? null,
    },
  });
}
