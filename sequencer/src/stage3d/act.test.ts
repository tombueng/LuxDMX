// @vitest-environment happy-dom
// A stage nobody plays on (a play, a service, a premiere): the hall without the band, its drum kit
// and backline, an audience standing calmly (no flags, nobody on shoulders, no phones or fists in
// the air), and the banners showing the show's name. The templates for those ask for it.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildVenue, type Venue } from './venue';
import { buildCrowd } from './crowd';
import { TEMPLATES } from '../content/templates';
import { upgrade } from '../model/format';

const meshes = (g: THREE.Object3D) => { let n = 0; g.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; }); return n; };

describe('a stage without the band', () => {
  it('has no band, no drum mics, no strummers, and fewer things on it; the band\'s stage has them', () => {
    const band = buildVenue({ room: 'hall', crowd: 30 }) as Venue, none = buildVenue({ room: 'hall', crowd: 30, act: 'none' }) as Venue;
    expect(band.band.length).toBeGreaterThan(3);
    expect(none.band).toEqual([]);
    expect(none.drumMics).toEqual([]);
    expect(none.strummers).toEqual([]);
    expect(none.mics).toEqual([]);
    expect(meshes(none.group)).toBeLessThan(meshes(band.group));
  }, 60_000);   // (two whole halls built)
  it('puts the name it is given on the banners and the screens', () => {
    const v = buildVenue({ room: 'hall', crowd: 30, act: 'none', band: 'Sunday service' }) as Venue;
    const info = v.bandInfo();
    expect(info.name).toBe('Sunday service');
    expect(info.surfaces.find((s) => s.what === 'screens')?.shows).toBe('SUNDAY SERVICE');
  }, 60_000);
  it('a calm audience: nobody with a phone, a fist or a hand in the air', () => {
    const area = { z0: 2, z1: 12, spread: () => 6, keepOut: () => false, flags: 0, riders: 0 };
    const calm = buildCrowd(200, { ...area, calm: true }), wild = buildCrowd(200, area);
    const lifted = (c: ReturnType<typeof buildCrowd>) => c.fans.filter((f) => [f.arms.L, f.arms.R].some((a) => ['up', 'wave', 'fist', 'phone'].includes(a))).length;
    expect(lifted(calm)).toBe(0);
    expect(lifted(wild)).toBeGreaterThan(40);
  });
});

describe('the templates nobody plays in', () => {
  it('theatre, church and cinema ask for a stage without the band; the bar is in the pub', () => {
    const of = (name: string) => TEMPLATES.find((t) => t.name === name)!.build().settings.stage3d;
    for (const n of ['Theatre', 'Church', 'Cinema']) expect(of(n)?.act, n).toBe('none');
    expect(of('Bar')?.room).toBe('pub');
    expect(of('Band')?.act).toBeUndefined();
  });
  it('the file: an act it doesn\'t know is left out', () => {
    const s = upgrade({ format: 'luxdmx-show', version: '1.2.0', name: 'x', settings: { bpm: 120, stage3d: { act: 'ghosts', room: 'hall' } } });
    expect(s.settings.stage3d).toEqual({ room: 'hall' });
    const t = upgrade({ format: 'luxdmx-show', version: '1.2.0', name: 'x', settings: { bpm: 120, stage3d: { act: 'none' } } });
    expect(t.settings.stage3d?.act).toBe('none');
  });
});
