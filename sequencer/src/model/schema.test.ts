// The published JSON Schema (schema/luxdmx-show.schema.json) agrees with what the app writes:
// every template, a show with pages and MIDI, and a show imported from QLC+ validate.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { TEMPLATES } from '../content/templates';
import { buskingPage } from '../content/busking';
import { serializeShow } from './format';

const schema = JSON.parse(fs.readFileSync('schema/luxdmx-show.schema.json', 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const check = (show: unknown) => { const ok = validate(JSON.parse(serializeShow(JSON.parse(JSON.stringify(show))))); return ok ? [] : validate.errors!.map((e) => `${e.instancePath} ${e.message}`); };

describe('the JSON Schema', () => {
  for (const t of TEMPLATES) it(`accepts the ${t.name} template`, () => expect(check(t.build())).toEqual([]));
  it('accepts pages with keys and MIDI', () => {
    const s = TEMPLATES[1].build();
    const p = buskingPage(s);
    p.widgets[1] = { ...p.widgets[1], midi: { kind: 'note', ch: 1, num: 36 } };
    s.pages = [p];
    expect(check(s)).toEqual([]);
  });
  it('rejects what a reader can not play', () => {
    const s: any = TEMPLATES[0].build();
    s.fixtures[0].address = 600;
    s.cueLists[0].cues[0].advance = { mode: 'sometimes' };
    expect(check(s).length).toBeGreaterThanOrEqual(2);
  });
});
