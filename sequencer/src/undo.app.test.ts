// @vitest-environment happy-dom
// Undo brings the show back by changing only what differs (model/reconcile.ts): what didn't change
// keeps its identity (the screen redraws only what changed: on the festival undo froze the page
// most of a second), the show ends exactly as the step was, and the next change after an undo is
// one step, not a phantom one (the show's text after the undo is what the next save compares with).
import { describe, expect, it } from 'vitest';
import { freshApp } from './app.harness';

describe('undo on a big rig', () => {
  it('only what changed changes; the text is the step\'s; redo works after; a change after is one step', async () => {
    const { app } = await freshApp();
    const { buildDemo } = await import('./content/demo');
    app.replaceShow(buildDemo());
    app.checkpoint();
    const before = JSON.stringify(app.show);
    const f0 = app.show.fixtures[0], f1 = app.show.fixtures[1], list = app.show.fixtures, cues = app.show.cueLists[0];
    // a rename, a fixture deleted, a setting that wasn't there
    app.checkpoint(); app.show.fixtures[1].name = 'Renamed'; app.checkpoint();
    app.checkpoint(); app.show.fixtures.splice(5, 1); app.checkpoint();
    app.checkpoint(); (app.show.settings as any).bandName = 'Night Owl'; app.checkpoint();
    for (let i = 0; i < 3; i++) {
      app.undo();
      expect(JSON.stringify(app.show)).toBe(app.lastSnap);                // (what the next save compares with)
    }
    expect(JSON.stringify(app.show)).toBe(before);
    expect(app.show.fixtures).toBe(list); expect(app.show.fixtures[0]).toBe(f0); expect(app.show.fixtures[1]).toBe(f1); expect(app.show.cueLists[0]).toBe(cues);
    expect(f1.name).not.toBe('Renamed');
    // redo all three, then undo one and change something: one new step, redo gone
    for (let i = 0; i < 3; i++) { app.redo(); expect(JSON.stringify(app.show)).toBe(app.lastSnap); }
    expect((app.show.settings as any).bandName).toBe('Night Owl');
    app.undo();
    const depth = app.undoStack.length;
    app.checkpoint();                                                       // (nothing changed: no step)
    expect(app.undoStack.length).toBe(depth); expect(app.canRedo).toBe(true);
    app.show.fixtures[0].name = 'X'; app.checkpoint();
    expect(app.undoStack.length).toBe(depth + 1); expect(app.canRedo).toBe(false);
  }, 60000);
});

// A click on a view's tab changes nothing in the show: it doesn't book a save (a compare of the whole
// show, tens of milliseconds on the big demo); a click anywhere else that could change it does.
describe('what books a save', () => {
  it('a view\'s tab: nothing; an edit field: a save', async () => {
    const { app } = await freshApp();
    app.checkpoint();
    const top = document.createElement('div'); top.className = 'top';
    top.innerHTML = '<div class="modes"><button role="tab">Live</button></div><input id="nm">';
    document.body.append(top);
    const pending = () => (app as any).savePending as boolean;
    top.querySelector('[role="tab"]')!.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(pending()).toBe(false);
    top.querySelector('#nm')!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(pending()).toBe(true);
    top.remove();
  });
});
