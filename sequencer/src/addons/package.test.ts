// Effects as packages: every one of ours describes itself (what it's for, which standard knobs
// change it, its own parameters) and reads back; one from a show travels as a file and comes back
// the same; a package from somewhere else is read strictly, and a broken or hostile one is refused
// with a plain reason, never run.
import { describe, expect, it } from 'vitest';
import { EFFECTS, paramsOf } from '../engine/effects';
import { unpackPicture } from '../engine/custom';
import { packPicture } from '../engine/gif';
import { builtinPackage, builtinPackages, effectOfPackage, PackageError, packageOfEffect, readPackage, STANDARDS, type EffectPackage } from './package';
import { previewOf, PREVIEW } from './preview';

const round = (p: EffectPackage) => readPackage(JSON.stringify(p));

describe('our effects as packages', () => {
  it('every built-in describes itself and reads back the same', () => {
    const all = builtinPackages();
    expect(all.length).toBe(EFFECTS.length - 3);
    for (const p of all) {
      expect(round(p)).toEqual(p);
      expect(p.uses).toContain('level');
      expect(p.uses.every((u) => STANDARDS.includes(u))).toBe(true);
      expect(p.description.length).toBeGreaterThan(10);
    }
    // what changes them: the eye has Size and Orientation, no palette; a random colour no Size
    expect(builtinPackage('eye').uses).toEqual(expect.arrayContaining(['size', 'orientation', 'speed']));
    expect(builtinPackage('eye').uses).not.toContain('palette');
    expect(builtinPackage('random').uses).not.toContain('size');
    expect(builtinPackage('scrollText').params).toEqual([expect.objectContaining({ id: 'text', type: 'text' })]);
    expect(builtinPackage('eye').fits).toEqual(['ring', 'disc', 'matrix']);
    expect(() => packageOfEffect({ id: 'p', name: 'Empty', kind: 'picture', params: {} } as any, { author: 'Tom' })).toThrow('Give it a picture first');
    expect(builtinPackage('circle').fits).toEqual(['heads']);
  });
  it('a preview: two seconds of it on what it\'s for, small', () => {
    for (const id of ['eye', 'plasmaClouds', 'chase', 'circle', 'fire2012']) {
      const pic = unpackPicture(previewOf(builtinPackage(id)));
      expect([pic.w, pic.h, pic.frames.length]).toEqual([PREVIEW.side, PREVIEW.side, PREVIEW.frames]);
      expect(pic.frames.some((f) => f.some((v) => v > 40)), id).toBe(true);
    }
    expect(previewOf(builtinPackage('plasmaClouds')).length).toBeLessThan(40_000);
  });
});

describe('an effect from a show as a file', () => {
  it('a built-in as it\'s set: its knobs come back', () => {
    const e = { id: 'e1', name: 'My eye', kind: 'eye', fixtures: [], params: { speed: 12, size: 0.6, direction: 'backward', contrast: 0.3 } } as any;
    const pkg = packageOfEffect(e, { author: 'Tom B', description: 'Faster and smaller' });
    expect(pkg.id).toBe('tom-b.my-eye');
    expect(pkg.native).toBe('eye');
    const back = effectOfPackage(round(pkg));
    expect(back.kind).toBe('eye');
    expect(paramsOf('eye', back.params)).toMatchObject({ speed: 12, size: 0.6, direction: 'backward', contrast: 0.3 });
  });
  it('a formula travels as its formula, a picture as its frames', () => {
    const f = packageOfEffect({ id: 'e', name: 'Waves', kind: 'formula', params: { formula: 'sin(x * 6 + t)' } } as any, { author: 'Tom' });
    expect(f.code).toEqual({ lang: 'formula-1', pixel: 'sin(x * 6 + t)' });
    expect(effectOfPackage(round(f))).toMatchObject({ kind: 'formula', params: { formula: 'sin(x * 6 + t)' } });
    const clip = packPicture(2, 2, [new Uint8Array(12).fill(200), new Uint8Array(12)], [100, 100]);
    const pic = packageOfEffect({ id: 'p', name: 'Clip', kind: 'picture', params: { picture: clip } } as any, { author: 'Tom' });
    expect(pic.media?.clip.startsWith('pic1:')).toBe(true);
    expect(effectOfPackage(round(pic)).kind).toBe('picture');
  });
});

describe('a package from somewhere else', () => {
  const good = () => JSON.parse(JSON.stringify(builtinPackage('chase')));
  const refuses = (v: unknown, says: RegExp) => { expect(() => readPackage(typeof v === 'string' ? v : JSON.stringify(v))).toThrow(PackageError); expect(() => readPackage(typeof v === 'string' ? v : JSON.stringify(v))).toThrow(says); };
  it('refuses what isn\'t one, or needs a newer app', () => {
    refuses('<html>', /not JSON/);
    refuses({ ...good(), format: 'something' }, /isn't a LuxDMX effect/);
    refuses({ ...good(), formatVersion: 99 }, /newer/);
    refuses({ ...good(), native: 'nuke' }, /doesn't have/);
    refuses({ ...good(), native: undefined }, /doesn't say what to play/);
    refuses({ ...good(), native: undefined, code: { lang: 'js', pixel: 'alert(1)' } }, /language this app doesn't know/);
    refuses({ ...good(), native: undefined, code: { lang: 'formula-1', pixel: 'window.location' } }, /formula doesn't read/);
    refuses({ ...good(), id: '../../etc' }, /isn't like/);
    refuses({ ...good(), params: [{ id: '__proto__', name: 'x', type: 'toggle', default: true }] }, /can't be used/);
    refuses({ ...good(), params: [{ id: 'speed', name: 'x', type: 'toggle', default: true }] }, /can't be used/);
    refuses({ ...good(), params: [{ id: 'arms', name: 'Arms', type: 'number', min: 5, max: 1, default: 3 }] }, /range/);
    refuses({ ...good(), media: { clip: 'not a picture' }, native: undefined }, /picture this app can read/);
    refuses('x'.repeat(2_000_001), /too big/);
  });
  it('keeps only what it knows: extra fields, odd defaults and an author link that isn\'t https go', () => {
    const p = readPackage(JSON.stringify({ ...good(), script: 'evil()', author: { name: 'X', url: 'javascript:alert(1)' }, defaults: { speed: 2, colors: [{ r: 1, g: 0, b: 0 }, { r: 'x' }], onload: 'x', direction: 'forward' }, tags: ['ok', 7, 'y'.repeat(50)] }));
    expect((p as any).script).toBeUndefined();
    expect(p.author).toEqual({ name: 'X' });
    expect(p.defaults).toEqual({ speed: 2, colors: [{ r: 1, g: 0, b: 0 }], direction: 'forward' });
    expect(p.tags).toEqual(['ok']);
  });
  it('its own parameters: numbers, choices, on/off, colours, text', () => {
    const p = readPackage(JSON.stringify({ ...good(), params: [
      { id: 'arms', name: 'Arms', description: 'How many', type: 'number', min: 1, max: 12, step: 1, default: 4 },
      { id: 'mood', name: 'Mood', type: 'choice', choices: [{ value: 'calm', name: 'Calm' }, { value: 'wild', name: 'Wild' }], default: 'calm' },
      { id: 'twin', name: 'Twin', type: 'toggle', default: false },
      { id: 'glow', name: 'Glow', type: 'colour', default: '#ff8000' },
      { id: 'words', name: 'Words', type: 'text', default: 'HI', maxLength: 20 },
    ] }));
    expect(p.params.map((q) => q.type)).toEqual(['number', 'choice', 'toggle', 'colour', 'text']);
    expect(effectOfPackage(p).params).toMatchObject({ arms: 4, mood: 'calm', twin: false, glow: '#ff8000', words: 'HI' });
  });
});

describe('an add-on as it was set, there and back (the review)', () => {
  it('shared with Speed doubled: imported again, its time runs as before; its own defaults come back', async () => {
    const { themePackage } = await import('./catalog');
    const { THEMES } = await import('./themes');
    const th = THEMES[0], src = th.effects[0];
    const run = effectOfPackage(themePackage(th, src, ['level', 'speed']));
    const e = { id: 'e', name: 'Mine', kind: 'script', params: { ...run.params, speed: (run.params.speed as number) * 2 } } as any;
    const back = effectOfPackage(round(packageOfEffect(e, { author: 'Tom' })));
    const was = JSON.parse(run.params.script as string), now = JSON.parse(back.params.script as string);
    expect(now.speed).toBe(was.speed);                         // the Speed its time runs at 1:1
    expect(back.params.speed).toBe((run.params.speed as number) * 2);   // the Speed it was set to
    expect(now.defaults.speed).toBe((run.params.speed as number) * 2);
  });
});
