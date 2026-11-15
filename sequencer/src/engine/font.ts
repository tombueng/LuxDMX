// The word effects' font (scrollText in shapes.ts, the matrix words in matrix.ts): five columns
// of seven dots per character, what a pixel strip or a small matrix can show.
import { TEXT_MAX } from './fxkit';

// A 5 x 7 capital font: five columns of seven dots, the top row in the low bit.
const FONT = [
  '0000000000 00005f0000 0007000700 147f147f14 242a7f2a12 2313086462 3649552250 0005030000 001c224100 0041221c00 ',
  '14083e0814 08083e0808 0050300000 0808080808 0060600000 2010080402 3e5149453e 00427f4000 4261514946 2141454b31 ',
  '1814127f10 2745454539 3c4a494930 0171090503 3649494936 064949291e 0036360000 0056360000 0814224100 1414141414 ',
  '0041221408 0201510906 324979413e 7e1111117e 7f49494936 3e41414122 7f4141221c 7f49494941 7f09090901 3e4149497a ',
  '7f0808087f 00417f4100 2040413f01 7f08142241 7f40404040 7f020c027f 7f0408107f 3e4141413e 7f09090906 3e4151215e ',
  '7f09192946 4649494931 01017f0101 3f4040403f 1f2040201f 3f4038403f 6314081463 0708700807 6151494543',
].join('').split(' ');
// (one glyph per ASCII code from 32, as ten hex digits)
const GLYPHS: number[][] = FONT.map((g) => [0, 2, 4, 6, 8].map((k) => parseInt(g.slice(k, k + 2), 16)));
// One character's five columns (what the font has: accents dropped, small letters as capitals; a
// character it hasn't got is a space). For the word effects (matrix.ts).
export const plainText = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/ß/g, 'SS').slice(0, TEXT_MAX);
export const glyph = (ch: string): number[] => GLYPHS[ch.charCodeAt(0) - 32] ?? GLYPHS[0];
const columnsOf = new Map<string, Uint8Array>();
export function textColumns(text: string): Uint8Array {
  let cols = columnsOf.get(text);
  if (cols) return cols;
  // (accents dropped, small letters as capitals: what the five-by-seven has)
  const plain = plainText(text);
  const out: number[] = [];
  for (const ch of plain) {
    const g = GLYPHS[ch.charCodeAt(0) - 32] ?? GLYPHS[0];
    out.push(...g, 0);
  }
  cols = Uint8Array.from(out);
  if (columnsOf.size > 40) columnsOf.clear();
  columnsOf.set(text, cols);
  return cols;
}
