import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { packsApi, type Pack } from '../lib/api';

const LOADERS = ['fabric', 'forge', 'neoforge', 'quilt'];

export default function ModpackList() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [mcVersion, setMcVersion] = useState('1.21.1');
  const [loader, setLoader] = useState('fabric');
  const [error, setError] = useState<string | null>(null);

  const load = () => packsApi.list().then(setPacks);

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const pack = await packsApi.create({ name, mcVersion, loader });
      setShowForm(false);
      setName('');
      setPacks((prev) => [pack, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create pack');
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-base-50">Modpack Studio</h1>
          <p className="mt-1 text-sm text-base-500">
            Build a modpack from Modrinth, deploy it as a server, or export it for friends to install.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm((s) => !s)}>
          + New modpack
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card mb-6 space-y-4 p-6">
          <div>
            <label className="label" htmlFor="pack-name">
              Pack name
            </label>
            <input id="pack-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="pack-version">
                Minecraft version
              </label>
              <input
                id="pack-version"
                className="input"
                value={mcVersion}
                onChange={(e) => setMcVersion(e.target.value)}
                placeholder="1.21.1"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="pack-loader">
                Loader
              </label>
              <select id="pack-loader" className="input" value={loader} onChange={(e) => setLoader(e.target.value)}>
                {LOADERS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" className="btn-primary">
            Create pack
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {packs.map((pack) => (
          <Link key={pack.id} to={`/modpacks/${pack.id}`} className="card p-5 transition-colors hover:border-accent-500/50">
            <h2 className="font-medium text-base-50">{pack.name}</h2>
            <p className="text-xs text-base-500">
              {pack.mcVersion} · {pack.loader} · {pack._count?.items ?? 0} mods
            </p>
          </Link>
        ))}
        {packs.length === 0 && !showForm && (
          <p className="col-span-2 py-10 text-center text-sm text-base-500">No modpacks yet. Create one to get started.</p>
        )}
      </div>
    </div>
  );
}
