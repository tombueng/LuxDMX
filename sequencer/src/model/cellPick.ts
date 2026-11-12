// Picking single cells by typing, the way a desk takes sub-fixtures: "1-16, 20, 30-40/2". Cell
// numbers count from 1 here (what people see), from 0 in the show.

// "1-16" a run, "20" one cell, "30-40/2" every second one of a run, "/3" every third of all of
// them, "16-1" a run backwards (the order a rainbow takes). Spaces, commas, semicolons or "+"
// between parts; "thru" and "to" for the dash. Returns cell numbers from 0, in the order typed,
// each once, and what couldn't be read.
export function parseCells(text: string, n: number): { cells: number[]; bad: string[] } {
  const out: number[] = [], seen = new Set<number>(), bad: string[] = [];
  const add = (k: number) => { if (k >= 0 && k < n && !seen.has(k)) { seen.add(k); out.push(k); } };
  const parts = text.toLowerCase().replace(/\s*(thru|through|to)\s*/g, '-').split(/[,;+\s]+/).filter(Boolean);
  for (const p of parts) {
    const m = /^(?:(\d+)(?:-(\d+))?)?(?:\/(\d+))?$/.exec(p);
    if (!m || (!m[1] && !m[3])) { bad.push(p); continue; }
    const a0 = m[1] ? +m[1] : 1, b0 = m[2] ? +m[2] : m[1] ? a0 : n, step = m[3] ? Math.max(1, +m[3]) : 1;
    if (a0 < 1 || b0 < 1) { bad.push(p); continue; }
    // (past the end: only as far as there are cells, however big the number typed)
    const a = Math.min(a0, n + 1), b = Math.min(b0, n + 1);
    if (a <= b) for (let k = a; k <= b; k += step) add(k - 1);
    else for (let k = a; k >= b; k -= step) add(k - 1);
  }
  return { cells: out, bad };
}

// The other way round: cells as short as they can be said ("1-16, 20", "16-1"), from 1, in the
// order they're in (a backwards run stays backwards).
export function cellsText(cells: number[]): string {
  const s = [...new Set(cells)];
  const out: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    const d = s[i + 1] - s[i];
    if (d === 1 || d === -1) while (j + 1 < s.length && s[j + 1] - s[j] === d) j++;
    out.push(j > i ? `${s[i] + 1}-${s[j] + 1}` : `${s[i] + 1}`);
    i = j + 1;
  }
  return out.join(', ');
}
