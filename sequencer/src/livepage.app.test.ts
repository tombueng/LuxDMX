// @vitest-environment happy-dom
// A show without a live page of its own gets the generated one, and the phone remote reads
// `pages`, `livePage` and `liveList` several times a tick. Built on every read that was ~100 ms
// each on the big demo: a phone on the demo froze the laptop (and its output) and never got its
// page. Now they're worked out once per change of the show, and still follow every change.
import { describe, expect, it } from 'vitest';
import { freshApp } from './app.harness';

describe('the generated live page', () => {
  it('is built once per change of the show, not on every read', async () => {
    const { app } = await freshApp();
    const { buildDemo } = await import('./content/demo');
    app.replaceShow(buildDemo());
    expect(app.show.pages.length).toBe(0);                     // the demo has none of its own
    const pages = app.pages, list = app.liveList;
    expect(pages[0].widgets.length).toBeGreaterThan(50);
    expect(app.pages).toBe(pages);
    expect(app.livePage).toBe(pages[0]);
    expect(app.liveList).toBe(list);
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) { void app.pages; void app.livePage; void app.liveList; }
    expect(performance.now() - t0).toBeLessThan(50);            // (was ~25 s for these 100)
  });

  it('follows a change of the show, an undo, and another show', async () => {
    const { app } = await freshApp();
    const { buildDemo } = await import('./content/demo');
    app.replaceShow(buildDemo());
    const before = app.pages[0], n = before.widgets.length;
    const first = app.liveList;
    // a new list of looks, first in line: a new page with it, and GO plays it
    app.show.cueLists.unshift({ id: 'Lnew', name: 'Encore', end: 'stop', cues: [
      { id: 'cn', name: 'All red', values: { [app.show.fixtures[0].id]: { intensity: 1 } }, fade: 0, advance: { mode: 'manual' } },
    ] });
    app.checkpoint();
    const after = app.pages[0];
    expect(after).not.toBe(before);
    expect(JSON.stringify(after.widgets)).toContain('Lnew');
    expect(after.widgets.length).not.toBe(n);
    expect(app.liveList?.id).toBe('Lnew');
    // GO's list picked by hand: followed too
    app.goList = first!.id;
    expect(app.liveList?.id).toBe(first!.id);
    app.undo();
    expect(JSON.stringify(app.pages[0].widgets)).not.toContain('Lnew');
    expect(app.pages[0].widgets.length).toBe(n);
    // a show with a page of its own: that one, as before
    const { buildDemo: again } = await import('./content/demo');
    const s = again();
    s.pages.push({ id: 'mine', name: 'Mine', widgets: [] } as never);
    app.replaceShow(s);
    expect(app.pages).toBe(app.show.pages);
    expect(app.livePage?.id).toBe('mine');
  }, 20_000);   // (it builds the big demo twice, a hundred heads and all: about 3 s alone, more next to the rest)
});
