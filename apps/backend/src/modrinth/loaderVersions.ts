/**
 * Best-effort lookup of a concrete mod-loader version to pin in an exported .mrpack's
 * `dependencies` block (e.g. "fabric-loader": "0.15.11"). Fabric and Quilt both publish simple,
 * stable public meta APIs we can rely on. Forge/NeoForge publish loader builds via Maven metadata
 * with no equivalently simple "latest for this Minecraft version" endpoint, so for now we omit
 * the pin for those two loaders rather than guess — most launchers (Prism, the Modrinth App) will
 * still import the pack and prompt the player to install a matching Forge/NeoForge build.
 * Tracked as a roadmap item in README.md.
 */
export async function resolveLoaderVersion(loader: string, mcVersion: string): Promise<string | null> {
  try {
    if (loader === 'fabric') {
      const res = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}`);
      if (!res.ok) return null;
      const data = (await res.json()) as Array<{ loader: { version: string } }>;
      return data[0]?.loader.version ?? null;
    }

    if (loader === 'quilt') {
      const res = await fetch(`https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mcVersion)}`);
      if (!res.ok) return null;
      const data = (await res.json()) as Array<{ loader: { version: string } }>;
      return data[0]?.loader.version ?? null;
    }

    return null;
  } catch {
    return null;
  }
}
