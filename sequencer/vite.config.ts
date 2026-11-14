import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { holdWhileBusy } from './src/dev/holdWhileBusy.ts';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

// This build's id: when, and from which commit (LUXDMX_BUILD sets it, for the update e2e). The app
// shows it, and the service worker carries it: a new id is a new worker, which is how an installed
// app learns there's an update (public/sw.js, src/pwa.ts).
const BUILD = process.env.LUXDMX_BUILD || (() => {
  let rev = '';
  try { rev = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a checkout */ }
  const d = new Date(), p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}${rev ? ` ${rev}` : ''}`;
})();
// The service worker gets this build's id and its files to keep (it's copied from public/ as it is)
function serviceWorker(): Plugin {
  let cfg: ResolvedConfig;
  return {
    name: 'luxdmx-sw', apply: 'build',
    configResolved(c) { cfg = c; },
    closeBundle() {
      const out = cfg.build.outDir, sw = join(out, 'sw.js'), dir = join(out, cfg.build.assetsDir);
      if (!existsSync(sw)) return;
      const files = existsSync(dir) ? readdirSync(dir).filter((f) => !f.endsWith('.map')).map((f) => `./${cfg.build.assetsDir}/${f}`) : [];
      const text = readFileSync(sw, 'utf8').replace("const BUILD = 'dev';", `const BUILD = ${JSON.stringify(BUILD)};`).replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(files)};`);
      writeFileSync(sw, text);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [svelte(), holdWhileBusy(), serviceWorker()],
  define: { 'import.meta.env.VITE_BUILD': JSON.stringify(BUILD) },
  // Its own dependency cache per dev server (the e2e runs start their own on other ports): servers
  // sharing one rebuild it under each other's feet and a lazy chunk (the 3D stage) fails to load.
  ...(process.env.VITE_CACHE_DIR ? { cacheDir: process.env.VITE_CACHE_DIR } : {}),
  // three's add-ons the 3D stage loads lazily: bundled at start, not discovered mid-test (that
  // reloads the page under a running test)
  optimizeDeps: { include: ['three', 'three/examples/jsm/controls/OrbitControls.js', 'three/examples/jsm/controls/TransformControls.js',
    'three/examples/jsm/postprocessing/EffectComposer.js', 'three/examples/jsm/postprocessing/RenderPass.js', 'three/examples/jsm/postprocessing/UnrealBloomPass.js',
    'three/examples/jsm/postprocessing/OutputPass.js', 'three/examples/jsm/postprocessing/Pass.js', 'three/examples/jsm/environments/RoomEnvironment.js',
    'three/examples/jsm/geometries/RoundedBoxGeometry.js', 'three/examples/jsm/utils/BufferGeometryUtils.js', 'three/examples/jsm/loaders/GLTFLoader.js'] },
  // Build and test output isn't source: changes there mustn't reload open dev pages (the offline
  // e2e builds the app while other tests or people use the dev server).
  server: { watch: { ignored: ['**/dist/**', '**/dist-*/**', '**/test-results/**', '**/playwright-report/**'] } },
  // app-level tests load the real app (Svelte runes) in happy-dom: Svelte's browser build
  ...(process.env.VITEST ? { resolve: { conditions: ['browser'] } } : {}),
  test: { include: ['src/**/*.test.ts'], server: { deps: { inline: [/svelte/] } } },
});
