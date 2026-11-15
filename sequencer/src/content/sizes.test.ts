// The welcome's "N lights · M cues" for each template and demo are written down (content/sizes.ts):
// built here, each must still say what it is. A template or demo changed: update its line there.
import { describe, expect, it } from 'vitest';
import { ALL_TEMPLATES } from './ringMatrix';
import { DEMOS } from './demos';
import { SIZES, sizeSaid } from './sizes';
import type { Show } from '../model/types';

const tally = (s: Show) => ({ lights: s.fixtures.length, cues: s.cueLists.reduce((n, l) => n + l.cues.length, 0) });

describe('the sizes on the welcome', () => {
  for (const t of ALL_TEMPLATES) it(`template ${t.name}`, () => expect(SIZES[`t:${t.name}`], 'update content/sizes.ts').toEqual(tally(t.build())));
  for (const d of DEMOS) it(`demo ${d.id}`, () => expect(SIZES[`d:${d.id}`], 'update content/sizes.ts').toEqual(tally(d.build())));
  it('nothing written down for a show that is gone', () => {
    expect(Object.keys(SIZES).sort()).toEqual([...ALL_TEMPLATES.map((t) => `t:${t.name}`), ...DEMOS.map((d) => `d:${d.id}`)].sort());
  });
  it('said as on the tile', () => {
    expect(sizeSaid('d:festival')).toBe(`${SIZES['d:festival'].lights} lights · ${SIZES['d:festival'].cues} cues`);
    expect(sizeSaid('t:nothing')).toBe('');
  });
});
