import { describe, expect, it } from 'vitest';
import { dipSwitches, patchSheetHtml } from './patchsheet';
import { emptyShow } from '../model/format';
import type { Fixture } from '../model/types';

describe('patch sheet', () => {
  it('DIP switches add up to the address', () => {
    const on = (a: number) => dipSwitches(a).map((x, i) => (x ? i + 1 : 0)).filter(Boolean);
    expect(on(1)).toEqual([1]);
    expect(on(25)).toEqual([1, 4, 5]);          // 1 + 8 + 16
    expect(on(511)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it('lists every fixture by universe and address, with its range', () => {
    const s = emptyShow('Gig');
    s.fixtures = [
      { id: 'b', name: 'Wash 2', typeId: 'gen-rgb', mode: '3ch', universe: 0, address: 4, x: 0, y: 0 },
      { id: 'a', name: 'Wash 1', typeId: 'gen-rgb', mode: '3ch', universe: 0, address: 1, x: 0, y: 0 },
    ] as Fixture[];
    const html = patchSheetHtml(s);
    expect(html.indexOf('Wash 1')).toBeLessThan(html.indexOf('Wash 2'));
    expect(html).toContain('4<span>–6</span>');
    expect(html).toMatch(/–6<\/span>.*<span class="c">3<\/span>/s);   // address 4 = switch 3 alone
    expect(html).toContain('aria-label="DIP switches for 4"');
  });
});
