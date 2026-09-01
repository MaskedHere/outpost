import { TF2_CURATED_PLUGINS, TF2_PLUGINS_BROWSE_URL } from '../../lib/tf2Plugins';

/** TF2 has no Modrinth-equivalent — AlliedModders' SourceMod plugin directory has no public API to
 *  search or download from reliably, so unlike Minecraft's Plugins tab this can't be a live
 *  search-and-install flow. Just a curated pointer to genuinely popular plugins instead. */
export default function Tf2PluginsPanel() {
  return (
    <div>
      <div className="mb-4 rounded-lg bg-base-800/70 px-3 py-2.5 text-xs text-base-500">
        TF2 plugins run through SourceMod, and there's no reliable API Outpost can install these from
        automatically — this is a pointer to genuinely popular ones, not a one-click installer. Download from the
        link, then drop the files into this server's <code className="text-base-300">tf/addons/sourcemod</code> via
        the Files tab.
      </div>

      <div className="card divide-y divide-base-800">
        {TF2_CURATED_PLUGINS.map((p) => (
          <div key={p.name} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="text-sm text-base-100">{p.name}</p>
              <p className="text-xs text-base-500">{p.description}</p>
            </div>
            <a
              className="btn-secondary shrink-0 !py-1 !text-xs"
              href={p.url}
              target="_blank"
              rel="noreferrer"
            >
              View →
            </a>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-base-500">
        Looking for something else?{' '}
        <a className="text-accent-400 hover:underline" href={TF2_PLUGINS_BROWSE_URL} target="_blank" rel="noreferrer">
          Browse the AlliedModders TF2 plugins forum
        </a>
        .
      </p>
    </div>
  );
}
