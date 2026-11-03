// @vitest-environment happy-dom
// QLC+ workspaces in and out: a workspace written the way QLC+ writes them (test/fixtures/qxw), with
// fixture definitions from the QLC+ library (test/fixtures/qxf), checked down to the DMX bytes.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fromQxw, valuesFromDmx } from './qxw';
import { fromQxf } from './qxf';
import { toQxw } from '../export/qxw';
import { Engine } from '../engine/engine';
import { TEMPLATES } from '../content/templates';
import type { FixtureType, Show } from '../model/types';

const library: FixtureType[] = fs.readdirSync('test/fixtures/qxf').map((f) => ({ ...fromQxf(fs.readFileSync(`test/fixtures/qxf/${f}`, 'utf8'), f), id: `qlc:${f}` }));
const resolve = async (man: string, model: string) => library.find((t) => t.manufacturer === man && t.model === model);
const sample = () => fromQxw(fs.readFileSync('test/fixtures/qxw/sample.qxw', 'utf8'), resolve, 'sample');
function play(show: Show, list: string, cue = 0, at = 5): Uint8Array {
  let t = 0;
  const e = new Engine(() => show, () => t);
  e.jumpTo(list, cue, 0);
  e.tick(); t = at;
  return e.tick().frames.get(0)!;
}

describe('QLC+ workspace import', () => {
  it('reports what came over and what did not', async () => {
    const { report } = await sample();
    expect(report).toMatchObject({ fixtures: 4, fromLibrary: 2, generic: 1, unknown: ['Acme Mystery Box'], scenes: 2, lists: 3, effects: 1 });
    expect(report.skipped).toMatchObject({ 'RGB matrices': 1, 'Script functions': 1 });
  });
  it('patches fixtures at the same addresses, dimmer packs as single dimmers', async () => {
    const { show } = await sample();
    const at = Object.fromEntries(show.fixtures.map((f) => [f.name, [f.typeId, f.address]]));
    expect(at['Dimmers 1']).toEqual(['gen-dimmer', 1]);
    expect(at['Dimmers 4']).toEqual(['gen-dimmer', 4]);
    expect(at['PAR left'][1]).toBe(11);
    expect(at['Mystery'][1]).toBe(21);
    expect(at['Sharpy 1'][1]).toBe(31);
    expect(show.groups[0]).toMatchObject({ name: 'Dimmer row', fixtures: ['q0_0', 'q0_2'] });
  });
  it('scenes become cues that send the same bytes', async () => {
    const { show } = await sample();
    const scenes = show.cueLists.find((l) => l.name === 'Scenes')!;
    expect(scenes.cues.map((c) => c.name)).toEqual(['Warm', 'Blue']);
    expect(scenes.cues[0].fade).toBe(1.5);
    expect(scenes.cues[0].values.q1).toMatchObject({ intensity: 1, white: 64 / 255 });
    const warm = play(show, scenes.id, 0);
    expect([...warm.slice(0, 2)]).toEqual([255, 128]);                 // dimmers 1, 2
    expect([...warm.slice(10, 14)]).toEqual([255, 128, 0, 64]);         // the PAR: R G B W
    const blue = play(show, scenes.id, 1);
    expect([...blue.slice(10, 14)]).toEqual([0, 0, 255, 0]);
    expect([...blue.slice(20, 23)]).toEqual([10, 20, 30]);              // unknown fixture: raw channels
  });
  it('chasers keep fades, holds, "wait forever" and notes', async () => {
    const { show } = await sample();
    const l = show.cueLists.find((x) => x.name === 'Warm blue chase')!;
    expect(l.end).toBe('loop');
    expect(l.cues[0]).toMatchObject({ name: 'Warm', fade: 0.5, advance: { mode: 'wait', time: 2 } });
    expect(l.cues[1]).toMatchObject({ name: 'wait here', advance: { mode: 'manual' } });
  });
  it('sequences: backward and ping-pong order, common times', async () => {
    const { show } = await sample();
    const l = show.cueLists.find((x) => x.name === 'Dimmer walk')!;
    expect(l.cues.map((c) => Object.keys(c.values)[0])).toEqual(['q0_2', 'q0_1', 'q0_0', 'q0_1']);
    expect(l.cues[0].advance).toEqual({ mode: 'wait', time: 0.25 });
  });
  it('EFX become move effects; collections start what they hold', async () => {
    const { show } = await sample();
    expect(show.effects[0]).toMatchObject({ kind: 'circle', fixtures: ['q3'], params: { size: 64 / 127, tempo: false, speed: 8 } });
    const col = show.cueLists.find((x) => x.name === 'Show start')!;
    expect(col.cues[0].actions).toEqual([{ do: 'start', list: 'ql2' }]);
    expect(col.cues[0].effects).toEqual(['qe4']);
    expect(Object.keys(col.cues[0].values)).toContain('q1');
  });
  it('turns channel values into colour and intensity where it can', () => {
    const rgb = { name: 'm', channels: [{ name: 'R', attr: 'red' as const }, { name: 'G', attr: 'green' as const }, { name: 'B', attr: 'blue' as const }] };
    expect(valuesFromDmx(rgb, new Map([[0, 128], [1, 0], [2, 0]]))).toEqual({ intensity: 128 / 255, color: { r: 1, g: 0, b: 0 } });
  });
  it('rejects files that are not workspaces', async () => {
    await expect(fromQxw('<FixtureDefinition/>', resolve)).rejects.toThrow(/not a QLC\+ workspace/);
  });
});

describe('QLC+ workspace export', () => {
  it('a template goes out and comes back with the same patch, cues and output', async () => {
    const band = TEMPLATES[0].build();
    const { xml, skipped } = toQxw(band);
    expect(xml).toContain('<Model>Generic RGB</Model>');
    expect(skipped.join()).toContain('Back wave');                       // an intensity effect: no EFX for it
    const back = (await fromQxw(xml, resolve, 'again')).show;
    const songs = band.cueLists[0], songsBack = back.cueLists.find((l) => l.name === 'Songs')!;
    expect(songsBack.cues).toHaveLength(songs.cues.length);
    expect(songsBack.cues[1].advance).toEqual({ mode: 'manual' });
    // the "Verse" cue sends the same bytes both ways (effects aside: compare without them)
    for (const l of [songs]) for (const c of l.cues) delete c.effects;
    const a = play(band, songs.id, 1), b = play(back, songsBack.id, 1);
    // equal to the bit, give or take one step of rounding (a crossfade lands on 25.49 here, 25.5 there)
    expect([...b.slice(0, 72)].every((v, i) => Math.abs(v - a[i]) <= 1)).toBe(true);
    expect([...b.slice(0, 72)].filter((v, i) => v !== a[i]).length).toBeLessThan(4);
    // the band's heads are generic 16-bit movers QLC+ has no definition for: said so, and no EFX
    // pretending to move them
    expect(skipped.join()).toContain("QLC+ can't move them");
    expect(back.effects).toHaveLength(0);
  });
});

describe('QLC+ colours on RGBW fixtures', () => {
  const mode = (dimmer: boolean) => ({ name: 'm', channels: [
    ...(dimmer ? [{ name: 'D', attr: 'intensity' as const }] : []),
    { name: 'R', attr: 'red' as const }, { name: 'G', attr: 'green' as const }, { name: 'B', attr: 'blue' as const }, { name: 'W', attr: 'white' as const }] });
  const render = async (m: ReturnType<typeof mode>, chs: [number, number][]) => {
    const { renderFixture } = await import('../engine/render');
    const v = valuesFromDmx(m, new Map(chs));
    const b = new Uint8Array(512);
    renderFixture({ id: 'a', name: 'a', typeId: 't', mode: 'm', universe: 0, address: 1, x: 0, y: 0 }, m, { color: { r: 1, g: 1, b: 1 }, ...v } as never, b);
    return [...b.slice(0, m.channels.length)];
  };
  it('white only, no dimmer, stays white', async () => expect(await render(mode(false), [[0, 0], [1, 0], [2, 0], [3, 255]])).toEqual([0, 0, 0, 255]));
  it('red plus white, no dimmer, keeps both', async () => expect(await render(mode(false), [[0, 128], [1, 0], [2, 0], [3, 255]])).toEqual([128, 0, 0, 255]));
  it('RGB without W leaves the white LED off', async () => expect(await render(mode(false), [[0, 255], [1, 255], [2, 255]])).toEqual([255, 255, 255, 0]));
  it('with a dimmer too', async () => expect(await render(mode(true), [[0, 255], [1, 255], [2, 255], [3, 255]])).toEqual([255, 255, 255, 255, 0]));
});
