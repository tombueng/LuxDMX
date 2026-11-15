// @vitest-environment happy-dom
// Stage machinery: a curtain track and a fly bar with its painted drop. A light of those types is
// drawn as what it is (its look from its type), its cloth its own size or its type's; on the 3D
// stage the curtain's halves draw back to the sides as it opens and a drop flies in down to the deck,
// at the motor's speed. The Theatre and Cinema templates have them, and their cues move them.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GENERIC, kindOf } from '../model/library';
import { clothOf, rigFixtureFull } from './rigOf';
import { HALL, ROOMS } from './geometry';
import { Rig } from './rig';
import { THEATRE } from './sceneSizes';
import type { Fixture } from '../model/types';

const rf = (typeId: string, own: Partial<Fixture> = {}) => {
  const t = GENERIC.find((g) => g.id === typeId)!, m = t.modes[0];
  return rigFixtureFull({ id: typeId, name: typeId, typeId, mode: m.name, universe: 0, address: 1, x: 0.5, y: 0.5, ...own } as Fixture, m, kindOf(m), t, HALL);
};

describe('the types', () => {
  it('a curtain track and a fly bar are drawn as what they are; a winch stays a winch', () => {
    expect(rf('gen-curtain').look).toBe('curtain');
    expect(rf('gen-flybar').look).toBe('flybar');
    expect(rf('gen-winch').look).toBe('winch');
  });
  it('their cloth: their own size and picture, else their type\'s; a curtain\'s halves travel half its width', () => {
    const c = rf('gen-curtain');
    expect(c.cloth).toEqual({ w: 18, h: 10.4 }); expect(c.winch?.travel).toBe(9);
    const own = rf('gen-curtain', { cloth: { w: 24, h: 12 } });
    expect(own.cloth).toEqual({ w: 24, h: 12 }); expect(own.winch?.travel).toBe(12);
    expect(rf('gen-flybar').cloth?.picture).toBe('forest');
    expect(rf('gen-flybar', { cloth: { picture: 'castle' } }).cloth?.picture).toBe('castle');
    expect(rf('gen-flybar', { cloth: { picture: 'nonsense', w: -3 } }).cloth).toEqual({ w: 1, h: 10.2, picture: 'forest' });
    expect(clothOf({}, 'par', undefined)).toBeUndefined();
  });
});

describe('on the 3D stage', () => {
  // (the rig run for some seconds at 30 frames a second, the curtain sent open, the drop in)
  // (first where they were, `from`: when first seen they're already where they're sent)
  function run(values: Record<string, number>, secs: number, from: Record<string, number> = { curtain: 0, fly: 0 }) {
    const rig = new Rig(), list = [rf('gen-curtain', { p3: { x: 0, y: 11.5, z: 1.4 } }), rf('gen-flybar', { p3: { x: 0, y: 21.4, z: -5 } })];
    for (const f of list) { f.p = { ...f.p }; }
    list[0].p = { x: 0, y: 11.5, z: 1.4 }; list[1].p = { x: 0, y: 21.4, z: -5 };
    rig.build(list); rig.place(list);
    const before = { 'gen-curtain': { hoist: from.curtain }, 'gen-flybar': { hoist: from.fly } }, stage = { 'gen-curtain': { hoist: values.curtain }, 'gen-flybar': { hoist: values.fly } };
    for (let t = 0; t <= 0.5; t += 1 / 30) rig.update(before, t, 0.3, new Set());
    for (let t = 0.5; t <= 0.5 + secs; t += 1 / 30) rig.update(stage, t, 0.3, new Set());
    const cloths = rig.scenery.children as THREE.Mesh[];
    return { rig, cloths };
  }
  it('closed: the two halves meet in the middle; open: each drawn back to its side, gathered there', () => {
    const shut = run({ curtain: 0, fly: 0 }, 1).cloths;
    expect(shut.length).toBe(7);                                                          // (two halves, the valance, three fringes; the drop)
    const [l, r] = shut;
    expect(l.scale.x + r.scale.x).toBeCloseTo(18, 1);                                 // (the whole width)
    expect(l.position.x + l.scale.x / 2).toBeCloseTo(0, 1);                           // (meeting in the middle)
    const open = run({ curtain: 1, fly: 0 }, 12).cloths;
    expect(open[0].scale.x).toBeLessThan(2.2);                                         // (gathered at its side)
    expect(open[0].position.x).toBeLessThan(-7.5); expect(open[1].position.x).toBeGreaterThan(7.5);
    // (it takes its time: half way after a few seconds at its motor's speed)
    const part = run({ curtain: 1, fly: 0 }, 3.5).cloths;
    expect(part[0].scale.x).toBeGreaterThan(3); expect(part[0].scale.x).toBeLessThan(7.5);
  });
  it('a fly curtain flies out: the whole cloth rises into the tower at its motor\'s speed, the valance stays', () => {
    const fly = (open: number, secs: number) => {
      const rig = new Rig(), c = rf('gen-flycurtain', { p3: { x: 0, y: 11.5, z: 1.4 }, cloth: { w: 18, h: 10.4 } });
      c.p = { x: 0, y: 11.5, z: 1.4 };
      rig.build([c]); rig.place([c]);
      for (let t = 0; t <= 0.5; t += 1 / 30) rig.update({ 'gen-flycurtain': { hoist: 0 } }, t, 0.3, new Set());
      for (let t = 0.5; t <= 0.5 + secs; t += 1 / 30) rig.update({ 'gen-flycurtain': { hoist: open } }, t, 0.3, new Set());
      return rig.scenery.children as THREE.Mesh[];
    };
    expect(rf('gen-flycurtain').look).toBe('curtain');
    expect(rf('gen-flycurtain', { cloth: { w: 18, h: 10.4 } }).winch?.travel).toBe(10.4);   // (as high as the cloth)
    const shut = fly(0, 1), bottom = (m: THREE.Mesh) => m.position.y - m.scale.y / 2;
    expect(shut.length).toBe(4);                                                           // (the cloth, its fringe, the valance, its fringe)
    expect(shut[0].scale.x).toBeCloseTo(18, 1);                                            // (one cloth, the whole width)
    expect(bottom(shut[0])).toBeCloseTo(11.5 - 10.4, 1);                                   // (down: its hem at the deck)
    const open = fly(1, 10);
    expect(bottom(open[0])).toBeGreaterThan(11.4);                                         // (out: above the opening)
    expect(open[2].position.y).toBeCloseTo(shut[2].position.y, 3);                         // (the valance where it was)
    expect(bottom(fly(1, 2.5)[0])).toBeLessThan(8);                                        // (it takes its time)
  });
  it('the curtain\'s velvet hangs in real folds, deeper than a flat cloth; its valance stays across the top as it opens', () => {
    const open = run({ curtain: 1, fly: 0 }, 12).cloths, half = open[0].geometry as THREE.BufferGeometry, z = half.attributes.position;
    let lo = 0, hi = 0;
    for (let i = 0; i < z.count; i++) { lo = Math.min(lo, z.getZ(i)); hi = Math.max(hi, z.getZ(i)); }
    expect(hi - lo).toBeGreaterThan(0.15);
    expect(open[2].scale.x).toBeGreaterThan(18);                                           // (the valance: the whole width)
  });
  it('a drop flown out hangs high above the opening; flown in, it stands on the deck', () => {
    const out = run({ curtain: 0, fly: 0 }, 1).cloths.at(-1)!;
    expect(out.position.y - out.scale.y / 2).toBeGreaterThan(11);                      // (its bottom over the 10 m opening)
    const inn = run({ curtain: 0, fly: 1 }, 12).cloths.at(-1)!;
    expect(inn.position.y - inn.scale.y / 2).toBeLessThan(1.4);
    expect(inn.position.y - inn.scale.y / 2).toBeGreaterThan(0.9);
    expect((inn.material as THREE.MeshStandardMaterial).side).toBe(THREE.DoubleSide);
  });
});

describe('the templates', () => {
  it('the Theatre: a house curtain that flies out and four drops upstage (forest, castle, stars, city); its cues fly them in and out', async () => {
    const { TEMPLATES } = await import('../content/templates');
    const s = TEMPLATES.find((t) => t.name === 'Theatre')!.build();
    const curtain = s.fixtures.find((f) => f.name === 'House curtain')!, flys = s.fixtures.filter((f) => /^Fly \d$/.test(f.name));
    expect(curtain.typeId).toBe('gen-flycurtain'); expect(flys.map((f) => f.cloth?.picture)).toEqual(['forest', 'castle', 'stars', 'city']);
    expect(curtain.p3!.z).toBeCloseTo(THEATRE.curtainZ); expect(flys.every((f) => f.p3!.y > ROOMS.theatre.ceiling - 1)).toBe(true);
    // (the drops at the back, behind where the actors play, in front of the cyc)
    expect(flys.every((f) => f.p3!.z < -10 && f.p3!.z > THEATRE.cycZ)).toBe(true);
    const show = s.cueLists.find((l) => l.name === 'Show')!, at = (name: string, id: string) => (show.cues.find((c) => c.name === name)!.values[id] as { hoist?: number } | undefined)?.hoist;
    expect(at('Preset', curtain.id)).toBe(0); expect(at('Scene 1', curtain.id)).toBe(1);
    expect(at('Preset', flys[0].id)).toBe(1);                // (the first scene's drop set behind the closed curtain)
    expect(at('Scene 1', flys[0].id)).toBe(1); expect(at('Night', flys[2].id)).toBe(1); expect(at('Night', flys[0].id)).toBe(0);
    expect(at('End', curtain.id)).toBe(0);
  });
  it('the Cinema: a screen curtain, shut for the walk-in, open for the feature', async () => {
    const { TEMPLATES } = await import('../content/templates');
    const s = TEMPLATES.find((t) => t.name === 'Cinema')!.build(), c = s.fixtures.find((f) => f.name === 'Screen curtain')!;
    const l = s.cueLists[0], at = (name: string) => (l.cues.find((x) => x.name === name)!.values[c.id] as { hoist?: number }).hoist;
    expect(at('Walk-in')).toBe(0); expect(at('Feature')).toBe(1);
    expect(c.cloth!.w).toBeGreaterThan(22);
  });
});
