import { FormEvent, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FaExternalLinkAlt } from 'react-icons/fa';
import { factorioModsApi, filesApi, type FactorioModSummary } from '../../lib/api';
import { staggerContainer, staggerItem } from '../../lib/motion';
import Select from '../Select';
import InfoTip from '../InfoTip';
import DropZone from '../DropZone';

/** Radix reserves the empty string for "nothing selected", so the unfiltered option needs a value. */
const ANY_CATEGORY = '__any__';

/** Where Factorio's headless server looks for mods, relative to the server's data directory. */
const MODS_DIR = 'mods';

/** Browse the Factorio Mod Portal and drop mods onto the server. */
export default function FactorioModsPanel({ serverId }: { serverId: string }) {
  const [categories, setCategories] = useState<{ value: string; label: string }[]>([]);
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FactorioModSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [deps, setDeps] = useState<Record<string, string[]>>({});
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    factorioModsApi
      .categories()
      .then((r) => setCategories(r.categories))
      .catch(() => undefined);
    void runSearch(undefined, {});
    // Run once on mount; the filter controls trigger their own searches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter values are passed explicitly so a control can re-run the search with its own new value
  // rather than waiting a render for state to settle.
  const runSearch = async (e?: FormEvent, overrides: { category?: string } = {}) => {
    e?.preventDefault();
    const nextCategory = overrides.category ?? category;
    setSearching(true);
    setError(null);
    try {
      const res = await factorioModsApi.search(query, nextCategory || undefined);
      setResults(res.hits);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  /** Fetched per-mod on demand rather than for the whole page. */
  const loadDeps = async (mod: FactorioModSummary) => {
    if (deps[mod.name]) return;
    try {
      const res = await factorioModsApi.dependencies(mod.name);
      setDeps((prev) => ({ ...prev, [mod.name]: res.dependencies }));
    } catch {
      setDeps((prev) => ({ ...prev, [mod.name]: [] }));
    }
  };

  const uploadMods = async (files: File[]) => {
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        if (!file.name.toLowerCase().endsWith('.zip')) {
          throw new Error(
            `${file.name} isn't a .zip — Factorio mods are distributed as zip files.`,
          );
        }
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(filesApi.uploadUrl(serverId, MODS_DIR), {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`Failed to upload ${file.name}`);
        setUploaded((prev) => [...prev, file.name]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="font-medium text-base-50">Mods</h3>
        <InfoTip text="Factorio's mod portal requires a factorio.com login to download a file — that's their rule on the download itself, so Outpost can't fetch it for you without your account. Browse here, download in your browser, then drop the zip below. Factorio enables anything in its mods folder on the next start." />
      </div>
      <p className="mb-4 text-sm text-base-500">
        From the Factorio Mod Portal. Restart the server after adding mods.
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

      {categories.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="w-44">
            <Select
              value={category || ANY_CATEGORY}
              onChange={(value) => {
                const next = value === ANY_CATEGORY ? '' : value;
                setCategory(next);
                void runSearch(undefined, { category: next });
              }}
              options={[{ value: ANY_CATEGORY, label: 'All categories' }, ...categories]}
            />
          </div>
          {total > 0 && (
            <span className="text-xs text-base-500">
              {total.toLocaleString()} match{total === 1 ? '' : 'es'}
            </span>
          )}
        </div>
      )}

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
        className="mb-4 divide-y divide-base-800 rounded-xl border border-base-800 bg-base-950/60 px-3"
      >
        {results.map((hit) => (
          <motion.div variants={staggerItem} key={hit.name} className="py-2.5">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-base-100">
                  {hit.title}
                  <span className="ml-2 text-xs text-base-500">by {hit.owner}</span>
                </p>
                <p className="truncate text-xs text-base-500">{hit.summary}</p>
                <p className="mt-0.5 text-xs text-base-600">
                  {hit.latestVersion && <>v{hit.latestVersion} · </>}
                  {hit.factorioVersion && <>for Factorio {hit.factorioVersion} · </>}
                  {hit.downloadsCount.toLocaleString()} downloads
                </p>
              </div>
              <button
                className="btn-secondary shrink-0 !py-1 !text-xs"
                onClick={() => loadDeps(hit)}
              >
                Requires…
              </button>
              <a
                className="btn-secondary inline-flex shrink-0 items-center gap-1.5 !py-1 !text-xs"
                href={hit.downloadPageUrl}
                target="_blank"
                rel="noreferrer"
              >
                Download
                <FaExternalLinkAlt className="h-2.5 w-2.5" />
              </a>
            </div>
            {deps[hit.name] && (
              <p className="mt-1.5 text-xs text-base-500">
                {deps[hit.name]!.length === 0
                  ? 'No other mods required.'
                  : `Also needs: ${deps[hit.name]!.join(', ')}`}
              </p>
            )}
          </motion.div>
        ))}
        {results.length === 0 && (
          <p className="py-6 text-center text-sm text-base-500">
            {searching ? 'Searching…' : 'No mods matched that search.'}
          </p>
        )}
      </motion.div>

      <DropZone
        onDrop={uploadMods}
        className="rounded-xl border border-dashed border-base-700 p-5 text-center"
        hint={`They'll be added to /${MODS_DIR}`}
      >
        <p className="text-sm text-base-300">
          {uploading ? 'Uploading…' : 'Drop downloaded mod .zip files here'}
        </p>
        <p className="mt-1 text-xs text-base-500">
          They go straight into the server's <code>{MODS_DIR}</code> folder — the same place the
          Files tab shows, which is also how you remove one.
        </p>
        {uploaded.length > 0 && (
          <p className="mt-2 text-xs text-accent-400">Added: {uploaded.join(', ')}</p>
        )}
      </DropZone>
    </div>
  );
}
