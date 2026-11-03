import { mount } from 'svelte';
import App from './App.svelte';
import { app } from './app.svelte';
import './style.css';

// Dev builds expose the app state for debugging and the e2e tests' introspection.
if (import.meta.env.DEV) (window as unknown as { __luxdmx: typeof app }).__luxdmx = app;

// Offline and installable in the built app (not in development: the dev server reloads by itself).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  // the parts loaded on demand (the 3D stage, the big demo) fetched once while online, so they're
  // there offline at the venue too (the service worker keeps what's fetched)
  setTimeout(() => { if (navigator.onLine) { void import('./stage3d/Stage3D.svelte').catch(() => {}); void import('./content/demo').catch(() => {}); } }, 15000);
}

// The show comes from IndexedDB before the first frame is drawn (a few milliseconds).
export default app.init().catch(() => {}).then(() => mount(App, { target: document.getElementById('app')! }));
