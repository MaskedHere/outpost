/**
 * Best-effort lookup of a concrete mod-loader version to pin in an exported .mrpack's
 * `dependencies` block (e.g. "fabric-loader": "0.15.11").
 */
export async function resolveLoaderVersion(
  loader: string,
  mcVersion: string,
): Promise<string | null> {
  try {
    if (loader === 'fabric') {
      const res = await fetch(
        `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}`,
      );
      if (!res.ok) return null;
      const data = (await res.json()) as Array<{ loader: { version: string } }>;
      return data[0]?.loader.version ?? null;
    }

    if (loader === 'quilt') {
      const res = await fetch(
        `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mcVersion)}`,
      );
      if (!res.ok) return null;
      const data = (await res.json()) as Array<{ loader: { version: string } }>;
      return data[0]?.loader.version ?? null;
    }

    return null;
  } catch {
    return null;
  }
}
