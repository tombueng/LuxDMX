import { mount } from 'svelte';
import App from './App.svelte';
import { app } from './app.svelte';
import { ui } from './ui/ui.svelte';
import './style.css';
import { BUILD, keepUpToDate } from './pwa';
import { migrateKept } from './store/kept';

// Dev builds expose the app state for debugging and the e2e tests' introspection (and the UI's
// state: a module imported again by its path after a hot reload is another copy).
// (VITE_EXPOSE=1: a build for the profiler and the offline e2e, which drive it the same way)
if (import.meta.env.DEV || import.meta.env.VITE_EXPOSE === '1') Object.assign(window, { __luxdmx: app, __ui: ui });

// every setting kept in the browser in its newest form (store/kept.ts), before anything uses them
migrateKept();
// (which build this is: the update e2e reads it)
document.documentElement.dataset.build = BUILD;
// Offline and installable in the built app, and kept up to date by itself (src/pwa.ts; not in
// development: the dev server reloads by itself).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // (the service worker keeps every file of the build, the 3D stage and the demos too)
  keepUpToDate({ quiet: () => app.quietForUpdate(), said: (t) => ui.toast(t, 6000) });
}

// The show comes from IndexedDB before the first frame is drawn (a few milliseconds).
export default app.init().catch(() => {}).then(() => mount(App, { target: document.getElementById('app')! }));
