// The installed app keeps itself up to date: it looks for a new version at the start, every half
// hour and when it comes back to the front (or the network does). A new version is fetched in the
// background by its service worker (public/sw.js) and waits; the app lets it take over by itself, no
// question asked, at a quiet moment: nothing playing, the show saved, nobody at the keys for a while.
// Never in the middle of a show: then it waits, and the next start is on the new version anyway.
// After the reload a short note says it was updated.
import { UPDATED_FROM } from './store/kept';

export const BUILD: string = import.meta.env.VITE_BUILD ?? 'dev';
export const LOOK_EVERY_MS = 30 * 60_000;
// nobody at the keys for this long before a reload (a dialog half filled in mustn't vanish)
const IDLE_MS = 90_000;

// When an update may be put in: `quiet` (the app: nothing playing or held, the show saved), and
// nobody busy with the app (hidden, or no key or click for a while).
export function readyToUpdate(quiet: boolean, hidden: boolean, sinceInput: number, idleMs = IDLE_MS): boolean {
  return quiet && (hidden || sinceInput >= idleMs);
}

export interface Updates { quiet: () => boolean; said: (text: string) => void }
export function keepUpToDate(app: Updates) {
  if (!('serviceWorker' in navigator)) return;
  // (after an update's reload: say so, once)
  const was = UPDATED_FROM.get();
  if (was) { UPDATED_FROM.remove(); if (was !== BUILD) setTimeout(() => app.said(`Updated to the newest version (${BUILD}).`), 1500); }
  let lastInput = Date.now();
  for (const ev of ['pointerdown', 'keydown', 'wheel']) addEventListener(ev, () => { lastInput = Date.now(); }, { capture: true, passive: true });
  // (the e2e's own pace: an update put in at once when it's quiet)
  const idleMs = () => (window as unknown as { __luxdmxUpdateIdleMs?: number }).__luxdmxUpdateIdleMs ?? IDLE_MS;
  let reloading = false, timer: ReturnType<typeof setTimeout> | undefined;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const look = () => { if (navigator.onLine !== false) reg.update().catch(() => {}); };
    setInterval(look, LOOK_EVERY_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) look(); });
    addEventListener('online', look);
    // a new version waiting: in at the first quiet moment
    const tryIn = () => {
      clearTimeout(timer);
      const w = reg.waiting;
      if (!w || reloading) return;
      if (!navigator.serviceWorker.controller) return;        // (the very first install: nothing to replace)
      if (!readyToUpdate(app.quiet(), document.hidden, Date.now() - lastInput, idleMs())) { timer = setTimeout(tryIn, 15_000); return; }
      reloading = true;
      UPDATED_FROM.set(BUILD);
      w.postMessage('take-over');
    };
    const watch = (sw: ServiceWorker | null) => { sw?.addEventListener('statechange', () => { if (sw.state === 'installed') tryIn(); }); };
    if (reg.waiting) tryIn();
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) location.reload(); });
  }).catch(() => {});
}
