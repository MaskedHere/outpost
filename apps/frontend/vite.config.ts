import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The repo-root package.json version is the single source of truth for the app's release number:
// it's stamped into the UI's corner label here and used for the published image tag, so the version
// someone reads on screen is always the build they're actually running. Bumped once per release —
// see the "Releasing" section in README.
const { version } = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    port: 5173,
    // Vite only binds to localhost by default — this is what was blocking access from other
    // devices on the same network (the backend already listens on all interfaces).
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
