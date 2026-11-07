// @vitest-environment happy-dom
// The ring and matrix starter: it builds, passes the published schema, loads back, keeps clear of
// the box's DMX universes, shares no channel, and every effect it names is a ring or matrix effect.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { ALL_TEMPLATES, RING_MATRIX, buildRingMatrix } from './ringMatrix';
import { TEMPLATES } from './templates';
import { buskingPage } from './busking';
import { EFFECT_MAP } from '../engine/effects';
import { modeOf, typeMap } from '../model/library';
import { parseShow, serializeShow } from '../model/format';
import { placesOf, spansOf } from '../model/pixelLayout';

const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(fs.readFileSync('schema/luxdmx-show.schema.json', 'utf8')));

describe('the ring and matrix starter', () => {
  const s = buildRingMatrix(), types = typeMap(s), mode = (id: string) => { const f = s.fixtures.find((x) => x.id === id)!; return modeOf(types.get(f.typeId), f.mode); };
  it('is offered with the templates, without being one of the big rigs', () => {
    expect(ALL_TEMPLATES).toContain(RING_MATRIX); expect(TEMPLATES).not.toContain(RING_MATRIX);
  });
  it('validates against the schema and loads back the same', () => {
    const text = serializeShow(JSON.parse(JSON.stringify(s)));
    expect(validate(JSON.parse(text)) ? [] : validate.errors!.map((e) => `${e.instancePath} ${e.message}`)).toEqual([]);
    const back = parseShow(text);
    expect(back.fixtures).toEqual(s.fixtures); expect(back.cueLists).toEqual(s.cueLists); expect(back.effects).toEqual(s.effects);
  });
  it('every light has a shape, from universe 10 up, sharing no channel', () => {
    const used = new Set<string>();
    for (const f of s.fixtures) {
      expect(placesOf(mode(f.id)), f.name).toBeDefined();
      expect(f.universe).toBeGreaterThanOrEqual(10);
      for (const sp of spansOf(f, mode(f.id))) for (let c = 0; c < sp.count; c++) {
        const k = `${sp.universe}.${sp.at + c}`;
        expect(used.has(k), `${f.name} on ${k}`).toBe(false); used.add(k);
      }
    }
  });
  it('names only what\'s there, every effect one for these shapes', () => {
    const fx = new Set(s.effects.map((e) => e.id)), ids = new Set(s.fixtures.map((f) => f.id));
    for (const e of s.effects) expect(EFFECT_MAP.get(e.kind)?.shape, e.kind).toBe(true);
    for (const l of s.cueLists) for (const c of l.cues) {
      expect(c.effects?.length, c.name).toBe(1);
      for (const id of c.effects!) expect(fx.has(id)).toBe(true);
      for (const id of Object.keys(c.values)) expect(ids.has(id)).toBe(true);
    }
    expect(s.effects.length).toBeGreaterThanOrEqual(20);
  });
  it('the live page has every list on it', () => {
    const w = buskingPage(s).widgets;
    for (const l of s.cueLists) expect(w.some((x) => 'list' in x && x.list === l.id), l.name).toBe(true);
  });
});
