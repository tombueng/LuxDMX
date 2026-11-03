import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// base './' so the build works from any sub-path (GitHub Pages serves it under /LuxDMX/...).
export default defineConfig({
  base: './',
  plugins: [svelte()],
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
