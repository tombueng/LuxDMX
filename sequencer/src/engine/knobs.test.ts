// Every knob the effect editor shows for an effect changes what that effect puts out, and every
// knob that changes it is shown (engine/knobs.ts keeps the list). Run on a row of lights, a pixel
// bar, three bars, two discs and two matrices, at thirty moments, with each knob moved well away
// from the effect's default. WRITE_KNOBS=1 writes knobs.ts from what it finds.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EFFECTS, paramsOf, runEffect, type Where } from './effects';
import { KNOB_NAMES, LIVE_KNOBS, type Knob } from './knobs';
import { placesFor } from '../model/pixelLayout';
import type { EffectParams } from './fxkit';

const disc = placesFor({ kind: 'rings', rings: [24, 16, 12, 8, 1] });
const mat = placesFor({ kind: 'matrix', cols: 8, rows: 8, zigzag: true });
const two = (at: typeof disc) => Array.from({ length: at.n * 2 }, (_, i): Where => ({ u: 0.5, row: i < at.n ? 0 : 1, rows: 2, at, cell: i % at.n }));
const SCENES: Record<string, Where[]> = {
  lights: Array.from({ length: 8 }, (_, i) => ({ u: i / 7, row: i, rows: 8 })),
  bar: Array.from({ length: 16 }, (_, i) => ({ u: i / 15, row: 0, rows: 1 })),
  bars: Array.from({ length: 48 }, (_, i) => ({ u: (i % 16) / 15, row: Math.floor(i / 16), rows: 3 })),
  discs: two(disc), matrices: two(mat),
};
const TIMES = Array.from({ length: 30 }, (_, i) => 0.173 + i * 0.617);
const r = (v: number | undefined) => (v === undefined ? '_' : String(Math.round(v * 200) / 200));
function picture(kind: string, p: EffectParams, scene: string) {
  const def = EFFECTS.find((d) => d.id === kind)!, where = SCENES[scene], parts: string[] = [];
  for (const t of TIMES) {
    const total = p.tempo ? (t * 2) / p.speed : t / p.speed;
    for (const o of runEffect(def, p, where.length, total, 7, where, { beats: t * 2, secs: t }))
      parts.push([o.intensity, o.color?.r, o.color?.g, o.color?.b, o.pan, o.tilt, o.strike].map(r).join(','));
  }
  return parts.join('|');
}
// each knob moved well away from where it is
const MOVES: Record<Knob, ((p: EffectParams) => Partial<EffectParams>)[]> = {
  speed: [(p) => ({ speed: p.speed * 0.5 })], size: [(p) => ({ size: p.size > 0.5 ? 0.35 : 0.9 })], spread: [(p) => ({ spread: p.spread > 0.5 ? 0 : 1 })],
  direction: [() => ({ direction: 'backward' }), () => ({ direction: 'out' }), () => ({ direction: 'bounce' })], blocks: [() => ({ blocks: 3 })],
  width: [(p) => ({ width: p.width > 0.3 ? 0.1 : 0.6 })], low: [() => ({ low: 0.3 })], high: [() => ({ high: 0.5 })], contrast: [() => ({ contrast: 0.8 })],
  colors: [() => ({ colors: [{ r: 1, g: 0, b: 0 }, { r: 0, g: 0, b: 1 }] })],
};
export function liveKnobs(kind: string): Knob[] {
  const def = EFFECTS.find((d) => d.id === kind)!;
  const scenes = def.shape ? ['discs', 'matrices'] : def.category === 'pixel' ? ['bar', 'bars', 'lights'] : ['lights', 'bar', 'bars'];
  const base = paramsOf(kind, {}), was = Object.fromEntries(scenes.map((s) => [s, picture(kind, base, s)]));
  return KNOB_NAMES.filter((k) => MOVES[k].some((move) => scenes.some((s) => picture(kind, { ...base, ...move(base) } as EffectParams, s) !== was[s])));
}

const KINDS = EFFECTS.map((d) => d.id).filter((id) => !['formula', 'picture', 'script'].includes(id));
describe('the knobs an effect shows are the ones that change it', () => {
  if (process.env.WRITE_KNOBS) {
    it('writes knobs.ts', () => {
      const t = fs.readFileSync(new URL('./knobs.ts', import.meta.url), 'utf8');
      const list = KINDS.map((k) => `  ${k}: [${liveKnobs(k).map((x) => `'${x}'`).join(', ')}],`).join('\n');
      fs.writeFileSync(new URL('./knobs.ts', import.meta.url), t.replace(/(export const LIVE_KNOBS: Record<string, Knob\[\]> = \{\n)[\s\S]*?(\};)/, `$1${list}\n$2`));
    }, 120000);
    return;
  }
  for (const kind of KINDS) it(kind, () => { expect(liveKnobs(kind)).toEqual(LIVE_KNOBS[kind]); });
  it('a shape effect turned Back is the mirror image, and Size makes it smaller', () => {
    const def = EFFECTS.find((d) => d.id === 'radar')!, p = paramsOf('radar', {}), where = SCENES.discs.slice(0, 61);
    const a = runEffect(def, p, 61, 0.3, 7, where, { beats: 1, secs: 7.7 }), b = runEffect(def, { ...p, direction: 'backward' }, 61, 0.3, 7, where, { beats: 1, secs: 7.7 });
    // the LED at 3 o'clock on the rim backwards looks like the one at 9 o'clock forwards
    const same = (x: typeof a[0], y: typeof a[0]) => { expect(x.intensity ?? 0).toBeCloseTo(y.intensity ?? 0, 9); for (const k of ['r', 'g', 'b'] as const) expect(x.color?.[k] ?? 0).toBeCloseTo(y.color?.[k] ?? 0, 9); };
    same(b[6], a[18]); same(b[18], a[6]);
    expect(Math.abs((a[6].intensity ?? 0) - (a[18].intensity ?? 0)) + Math.abs((a[6].color?.g ?? 0) - (a[18].color?.g ?? 0))).toBeGreaterThan(0.01);   // (and they differ)
    const small = runEffect(def, { ...p, size: 0.5 }, 61, 0.3, 7, where, { beats: 1, secs: 7.7 });
    expect(small).not.toEqual(a);
  });
});
