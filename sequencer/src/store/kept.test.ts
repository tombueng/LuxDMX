// @vitest-environment happy-dom
// The one place the app's settings are kept and brought up to date (kept.ts): an old form comes
// along and is written back in the newest at once, nothing unreadable is thrown away, a newer
// app's value is left alone, and every key the app uses is in the list.
import { beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { kept, keptFamily, migrateKept, boolFromText, isNum, isBool, numFromText, VOLUME, SOUND_HERE, OUTPUT_TAB, LAST_PLAYED, STAGE_3D } from './kept';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
const raw = (k: string, s: Storage = localStorage) => s.getItem(k);

describe('a setting', () => {
  it('kept with its version; read back as it was set', () => {
    VOLUME.set(0.4);
    expect(JSON.parse(raw('luxdmx.seq.volume')!)).toEqual({ v: 1, data: 0.4 });
    expect(VOLUME.get()).toBe(0.4);
  });
  it('from before versions: brought up to date and written back in the newest form at once', () => {
    localStorage.setItem('luxdmx.seq.volume', '0.25');
    localStorage.setItem('luxdmx.seq.sound', 'off');
    localStorage.setItem('luxdmx.seq.stage3d', '1');
    sessionStorage.setItem('luxdmx.seq.output', 'live');
    expect(VOLUME.get()).toBe(0.25); expect(SOUND_HERE.get()).toBe(false); expect(STAGE_3D.get()).toBe(true); expect(OUTPUT_TAB.get()).toBe('live');
    expect(JSON.parse(raw('luxdmx.seq.sound')!)).toEqual({ v: 1, data: false });
    expect(JSON.parse(raw('luxdmx.seq.output', sessionStorage)!)).toEqual({ v: 1, data: 'live' });
  });
  it('nothing kept: its default; a value that isn\'t one: put aside, never lost, the default used', () => {
    expect(VOLUME.get()).toBe(0.8);
    localStorage.setItem('luxdmx.seq.volume', JSON.stringify({ v: 1, data: 'loud' }));
    expect(VOLUME.get()).toBe(0.8);
    // (one of this version too: put aside before the next set writes over it)
    expect(raw('luxdmx.seq.volume.unreadable')).toBe(JSON.stringify({ v: 1, data: 'loud' }));
    VOLUME.set(0.5);
    expect(raw('luxdmx.seq.volume.unreadable')).toBe(JSON.stringify({ v: 1, data: 'loud' }));
    localStorage.setItem('luxdmx.seq.volume', JSON.stringify({ v: 0, data: 'x' }));
    // (a step that can't make a number of it: the default, and the old text put aside)
    const k = kept('test.broken', 1, 5, { 1: () => { throw new Error('no'); } }, isNum);
    localStorage.setItem('test.broken', 'hello');
    expect(k.get()).toBe(5);
    expect(raw('test.broken.unreadable')).toBe('hello');
  });
  it('a newer app\'s value is left alone (not overwritten older), the default used here', () => {
    localStorage.setItem('luxdmx.seq.volume', JSON.stringify({ v: 9, data: { per: 'speaker' } }));
    expect(VOLUME.get()).toBe(0.8);
    expect(JSON.parse(raw('luxdmx.seq.volume')!).v).toBe(9);
  });
  it('steps run in order, one version at a time', () => {
    const k = kept('test.steps', 3, 0, { 1: numFromText(0), 2: (o) => (o as number) * 10, 3: (o) => (o as number) + 1 }, isNum);
    localStorage.setItem('test.steps', '4');
    expect(k.get()).toBe(41);
    localStorage.setItem('test.steps', JSON.stringify({ v: 2, data: 7 }));
    expect(k.get()).toBe(8);
    expect(JSON.parse(raw('test.steps')!)).toEqual({ v: 3, data: 8 });
  });
});

describe('at the start', () => {
  it('everything in the list, and each family\'s members, brought up to date before anything reads', () => {
    localStorage.setItem('luxdmx.seq.crowd', 'off');
    localStorage.setItem('luxdmx.seq.lastplay.show-1', JSON.stringify({ id: 'show-1', lists: [], at: 5 }));
    const fam = keptFamily('test.fam.', 1, false, { 1: boolFromText }, isBool);
    localStorage.setItem('test.fam.a', '1');
    migrateKept();
    expect(JSON.parse(raw('luxdmx.seq.crowd')!)).toEqual({ v: 1, data: false });
    expect(JSON.parse(raw('luxdmx.seq.lastplay.show-1')!)).toEqual({ v: 1, data: { id: 'show-1', lists: [], at: 5 } });
    expect(JSON.parse(raw('test.fam.a')!)).toEqual({ v: 1, data: true });
    expect(LAST_PLAYED.of('show-1').get()).toEqual({ id: 'show-1', lists: [], at: 5 });
    expect(fam.of('a').get()).toBe(true);
  });
  it('the app keeps nothing in the browser\'s storage outside this list (the show copy has its own version: format.ts)', () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|svelte)$/.test(f) && !/\.test\.ts$/.test(f)) files.push(p); } };
    walk(join(__dirname, '..'));
    const direct = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/(localStorage|sessionStorage)\.(getItem|setItem|removeItem)\(([^,)]+)/g)].map((m) => `${f.replace(/^.*\/src\//, '')}: ${m[3]}`));
    // (the show copy and its owner: their text carries formatVersion; kept.ts itself)
    expect(direct.filter((d) => !/^store\/kept\.ts|^app\.svelte\.ts: (KEY|KEY_ID|`\$\{KEY\}\.unreadable`)$|^app\.harness\.ts/.test(d))).toEqual([]);
  });
});
