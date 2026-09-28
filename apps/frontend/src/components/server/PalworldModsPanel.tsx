import { FormEvent, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { palworldModsApi, type CurseForgeModSummary, type PalworldModType } from '../../lib/api';
import { staggerContainer, staggerItem } from '../../lib/motion';
import Select from '../Select';
import InfoTip from '../InfoTip';

/** Radix reserves the empty string for "nothing selected", so the unfiltered option needs a value. */
const ANY_TAG = '__any__';

/** Browse and install CurseForge's Palworld mods. */
export default function PalworldModsPanel({ serverId }: { serverId: string }) {
  const [filters, setFilters] = useState<{
    types: PalworldModType[];
    tags: { value: string; label: string }[];
  } | null>(null);
  const [type, setType] = useState('patch-pak-mods');
  const [tag, setTag] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CurseForgeModSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installed, setInstalled] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    palworldModsApi
      .filters()
      .then(setFilters)
      .catch(() => undefined);
  }, []);

  // Filter values are passed explicitly so a control can re-run the search with its own new value
  // rather than waiting a render for state to settle.
  const runSearch = async (e?: FormEvent, overrides: { type?: string; tag?: string } = {}) => {
    e?.preventDefault();
    const nextType = overrides.type ?? type;
    const nextTag = overrides.tag ?? tag;
    setSearching(true);
    setError(null);
    try {
      const res = await palworldModsApi.search(query, nextType, nextTag || undefined);
      setResults(res.hits);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const install = async (hit: CurseForgeModSummary) => {
    setInstalling(hit.slug);
    setError(null);
    try {
      const res = await palworldModsApi.install(serverId, hit.slug, hit.fileId, type);
      setInstalled((prev) => ({ ...prev, [hit.slug]: res.installDir }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install this mod');
    } finally {
      setInstalling(null);
    }
  };

  const activeType = filters?.types.find((t) => t.value === type);

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="font-medium text-base-50">Mods</h3>
        <InfoTip text="Palworld has no server-side mod manager, so Outpost installs mods by placing their files where the game reads them. Anything installed here shows up in the Files tab, which is also how you remove one." />
      </div>
      <p className="mb-4 text-sm text-base-500">
        From CurseForge. Restart the server after installing.
      </p>

      <form onSubmit={runSearch} className="mb-3 flex gap-2">
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search mods…"
        />
        <button type="submit" className="btn-secondary shrink-0" disabled={searching}>
          {searching ? '…' : 'Search'}
        </button>
      </form>

      {filters && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="w-48">
            <Select
              value={type}
              onChange={(value) => {
                setType(value);
                runSearch(undefined, { type: value });
              }}
              options={filters.types.map((t) => ({ value: t.value, label: t.label }))}
            />
          </div>
          <div className="w-44">
            <Select
              value={tag || ANY_TAG}
              onChange={(value) => {
                const next = value === ANY_TAG ? '' : value;
                setTag(next);
                runSearch(undefined, { tag: next });
              }}
              options={[{ value: ANY_TAG, label: 'All categories' }, ...filters.tags]}
            />
          </div>
        </div>
      )}

      {/* Shows whether the selected type works on a dedicated server, since CurseForge's listing
         doesn't say. */}
      {activeType && (
        <p
          className={`mb-3 text-xs ${activeType.installable ? 'text-base-500' : 'text-ember-400'}`}
        >
          {activeType.note}
        </p>
      )}

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
        className="divide-y divide-base-800 rounded-xl border border-base-800 bg-base-950/60 px-3"
      >
        {results.map((hit) => (
          <motion.div
            variants={staggerItem}
            key={hit.slug}
            className="flex items-center gap-3 py-2.5"
          >
            {hit.logoUrl && <img src={hit.logoUrl} alt="" className="h-8 w-8 shrink-0 rounded" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-base-100">{hit.name}</p>
              <p className="truncate text-xs text-base-500">
                {installed[hit.slug] ? `Installed into ${installed[hit.slug]}` : hit.summary}
              </p>
            </div>
            {/* No install button for types that can't run on the server; the note above the list
               explains why. */}
            <button
              className="btn-secondary shrink-0 !py-1 !text-xs"
              disabled={
                !activeType?.installable || installing === hit.slug || Boolean(installed[hit.slug])
              }
              title={activeType?.installable ? undefined : activeType?.note}
              onClick={() => install(hit)}
            >
              {!activeType?.installable
                ? 'Unsupported'
                : installed[hit.slug]
                  ? 'Installed'
                  : installing === hit.slug
                    ? '…'
                    : 'Install'}
            </button>
          </motion.div>
        ))}
        {results.length === 0 && (
          <p className="py-6 text-center text-sm text-base-500">
            {searching ? 'Searching…' : 'Search for mods to install on this server.'}
          </p>
        )}
      </motion.div>
    </div>
  );
}
