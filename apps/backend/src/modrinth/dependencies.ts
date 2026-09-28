import { getProjectVersions, getVersion, type ModrinthVersion } from './client.js';

/**
 * Recursively resolves a Modrinth version's required dependencies so a pack is self-contained.
 * Outpost pins exact versions instead of letting the image resolve them (see
 * MODRINTH_DOWNLOAD_DEPENDENCIES in games/minecraft.ts).
 */
export async function resolveDependencies(
  version: ModrinthVersion,
  mcVersion: string,
  loader: string,
  seenProjectIds: Set<string> = new Set([version.project_id]),
): Promise<ModrinthVersion[]> {
  const required = version.dependencies.filter((d) => d.dependency_type === 'required');
  const resolved: ModrinthVersion[] = [];

  for (const dep of required) {
    let depVersion: ModrinthVersion | null = null;

    if (dep.version_id) {
      depVersion = await getVersion(dep.version_id);
    } else if (dep.project_id && !seenProjectIds.has(dep.project_id)) {
      const candidates = await getProjectVersions(dep.project_id, { mcVersion, loader });
      depVersion = candidates[0] ?? null;
    }

    if (!depVersion || seenProjectIds.has(depVersion.project_id)) continue;
    seenProjectIds.add(depVersion.project_id);
    resolved.push(depVersion);

    const nested = await resolveDependencies(depVersion, mcVersion, loader, seenProjectIds);
    resolved.push(...nested);
  }

  return resolved;
}
