import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { gamesApi, packsApi, serversApi, type GameDef, type Pack } from '../lib/api';

const MEMORY_OPTIONS = [1024, 2048, 3072, 4096, 6144, 8192];

export default function CreateServerWizard() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'fresh' | 'pack'>('fresh');
  const [games, setGames] = useState<GameDef[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [loader, setLoader] = useState('paper');
  const [mcVersion, setMcVersion] = useState('1.21.1');
  const [memoryMb, setMemoryMb] = useState(2048);
  const [packId, setPackId] = useState('');

  useEffect(() => {
    gamesApi.list().then((g) => {
      setGames(g);
      if (g[0]) setLoader(g[0].loaders.includes('paper') ? 'paper' : (g[0].loaders[0] ?? 'vanilla'));
    });
    packsApi.list().then((p) => {
      setPacks(p);
      if (p[0]) setPackId(p[0].id);
    });
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const server =
        mode === 'pack'
          ? await packsApi.deploy(packId, name, memoryMb)
          : await serversApi.create({ name, loader, mcVersion, memoryMb });
      navigate(`/servers/${server.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create server');
    } finally {
      setSubmitting(false);
    }
  };

  const minecraft = games.find((g) => g.id === 'minecraft');

  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <h1 className="mb-1 text-2xl font-semibold text-base-50">New server</h1>
      <p className="mb-8 text-sm text-base-500">
        This creates a real Docker container on your NAS. It's ready to join within a minute or two.
      </p>

      <div className="mb-6 flex gap-1 rounded-lg border border-base-700 bg-base-900 p-1">
        <button
          type="button"
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${mode === 'fresh' ? 'bg-accent-500 text-base-950' : 'text-base-200 hover:text-base-50'}`}
          onClick={() => setMode('fresh')}
        >
          Fresh server
        </button>
        <button
          type="button"
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${mode === 'pack' ? 'bg-accent-500 text-base-950' : 'text-base-200 hover:text-base-50'}`}
          onClick={() => setMode('pack')}
        >
          From a modpack
        </button>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-5 p-6">
        <div>
          <label className="label" htmlFor="name">
            Server name
          </label>
          <input
            id="name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Friday Night Crew"
            required
          />
        </div>

        {mode === 'fresh' ? (
          <>
            <div>
              <label className="label" htmlFor="loader">
                Server type
              </label>
              <select id="loader" className="input" value={loader} onChange={(e) => setLoader(e.target.value)}>
                {(minecraft?.loaders ?? ['vanilla', 'paper', 'fabric', 'forge', 'neoforge', 'quilt']).map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="version">
                Minecraft version
              </label>
              <input
                id="version"
                className="input"
                value={mcVersion}
                onChange={(e) => setMcVersion(e.target.value)}
                placeholder="1.21.1 (or LATEST)"
                required
              />
            </div>
          </>
        ) : (
          <div>
            <label className="label" htmlFor="pack">
              Modpack
            </label>
            {packs.length === 0 ? (
              <p className="text-sm text-base-500">
                You don't have any modpacks yet. Build one in the Modpack Studio first.
              </p>
            ) : (
              <select id="pack" className="input" value={packId} onChange={(e) => setPackId(e.target.value)}>
                {packs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.mcVersion} · {p.loader} ({p._count?.items ?? 0} mods)
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <div>
          <label className="label" htmlFor="memory">
            Memory
          </label>
          <select id="memory" className="input" value={memoryMb} onChange={(e) => setMemoryMb(Number(e.target.value))}>
            {MEMORY_OPTIONS.map((mb) => (
              <option key={mb} value={mb}>
                {mb >= 1024 ? `${mb / 1024}GB` : `${mb}MB`}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button type="submit" className="btn-primary w-full" disabled={submitting || (mode === 'pack' && packs.length === 0)}>
          {submitting ? 'Creating…' : 'Create server'}
        </button>
      </form>
    </div>
  );
}
