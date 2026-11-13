// A cue sheet: every cue list with its cues, timing, what happens next, notes. As a page to print
// (or save as PDF from the print dialog) and as CSV for a spreadsheet.
import type { Advance, Show, Values } from '../model/types';
import { cueNumber } from '../model/cuenum';
import { printedAt } from './patchsheet';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// (a show's name inside a CSS string in the page's style: quotes and backslashes escaped, no tags)
const cssStr = (s: string) => s.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[<>\n]/g, ' ');
const then = (a: Advance) => a.mode === 'manual' ? 'GO' : a.mode === 'wait' ? `auto after ${a.time} s` : a.mode === 'follow' ? (a.time ? `${a.time} s after the fade` : 'follows when the fade is done') : `after ${a.beats} beats`;

interface Row { list: string; n: string; name: string; fade: string; then: string; lights: string; effects: string; actions: string; note: string }
// The lights of a cue by their level ("Front 1, Front 2 @ 50 % · Back 1 @ full"): names alone
// didn't say what the cue does with them. A level from a preset by the preset's name.
function lightsOf(show: Show, values: Record<string, Values>): string {
  const names = new Map(show.fixtures.map((f) => [f.id, f.name])), presets = new Map(show.presets.map((p) => [p.id, p.name]));
  const by = new Map<string, string[]>();
  for (const [id, v] of Object.entries(values)) {
    const i = v.intensity as unknown;
    const lvl = typeof i === 'number' ? (i <= 0 ? 'out' : i >= 1 ? 'full' : `${Math.round(i * 100)} %`) : i && typeof i === 'object' && 'preset' in i ? presets.get((i as { preset: string }).preset) ?? 'a preset' : '';
    by.set(lvl, [...(by.get(lvl) ?? []), names.get(id) ?? '?']);
  }
  return [...by].map(([lvl, ns]) => `${runs(ns)}${lvl ? ` @ ${lvl}` : ''}`).join(' · ');
}
// Names in runs: "Boom 1–4, Spot 2" for Boom 1, Boom 2, Boom 3, Boom 4, Spot 2 (the festival's cue
// sheet listed some 200 names a cue: 62 pages for 67 cues), and past a dozen, how many more.
export function runs(names: string[]): string {
  const groups = new Map<string, number[]>(), loose: string[] = [];
  for (const n of names) {
    const m = n.match(/^(.*?)(\d+)$/);
    if (m) groups.set(m[1], [...(groups.get(m[1]) ?? []), +m[2]]); else loose.push(n);
  }
  const parts: string[] = [];
  for (const [pre, nums] of groups) {
    const ns = [...new Set(nums)].sort((a, b) => a - b), bits: string[] = [];
    for (let i = 0; i < ns.length; ) {
      let j = i;
      while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
      bits.push(j - i >= 2 ? `${ns[i]}–${ns[j]}` : j > i ? `${ns[i]}, ${ns[j]}` : `${ns[i]}`);
      i = j + 1;
    }
    parts.push(`${pre}${bits.join(', ')}`);
  }
  const all = [...parts, ...loose];
  return all.length > 12 ? `${all.slice(0, 10).join(', ')} and ${all.length - 10} more` : all.join(', ');
}
function rows(show: Show, only?: string): Row[] {
  const fx = new Map(show.effects.map((e) => [e.id, e.name]));
  const lists = new Map(show.cueLists.map((l) => [l.id, l.name]));
  return show.cueLists.filter((l) => !only || l.id === only).flatMap((l) => l.cues.map((c, i) => ({
    list: l.name, n: cueNumber(l, i), name: c.name,
    fade: `${c.fade} s${c.delay ? ` (delay ${c.delay} s)` : ''}${c.fadeOut !== undefined && c.fadeOut !== c.fade ? `, out ${c.fadeOut} s` : ''}`,
    then: then(c.advance),
    lights: lightsOf(show, c.values),
    effects: (c.effects ?? []).map((id) => fx.get(id) ?? '?').join(', '),
    actions: (c.actions ?? []).map((a) => a.do === 'blackout' ? `blackout ${a.on ? 'on' : 'off'}` : a.do === 'off' ? 'everything off' : a.do === 'master' ? `level of ${lists.get(a.list)} to ${Math.round(a.level * 100)}%`
      : a.do === 'goto' ? `play "${show.cueLists.find((l) => l.id === a.list)?.cues.find((x) => x.id === a.cue)?.name ?? '?'}" on ${lists.get(a.list) ?? '?'}`
      : `${{ start: 'start', go: 'GO on', release: 'fade out', stop: 'stop' }[a.do]} ${lists.get(a.list) ?? '?'}`).join(', '),
    note: c.note ?? '',
  })));
}

// `decimal`: ',' for a spreadsheet that writes 2,5 (German Excel): then the columns are split by ';'
// as it expects (with ',' each row landed in one column), and the times are numbers it can add up.
export function cueSheetCsv(show: Show, decimal: '.' | ',' = '.'): string {
  const sep = decimal === ',' ? ';' : ',';
  const q = (s: string | number) => new RegExp(`["\n${sep}]`).test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
  const num = (v: number | undefined) => (v === undefined ? '' : String(Math.round(v * 1000) / 1000).replace('.', decimal));
  const cues = show.cueLists.flatMap((l) => l.cues);
  const head = ['List', 'Cue', 'Name', 'Fade (s)', 'Delay (s)', 'Fade out (s)', 'Then', 'Lights', 'Effects', 'Also', 'Note'];
  return [head, ...rows(show).map((r, i) => {
    const c = cues[i];
    return [r.list, r.n.replace('.', decimal), r.name, num(c.fade), num(c.delay || undefined), num(c.fadeOut !== undefined && c.fadeOut !== c.fade ? c.fadeOut : undefined), r.then, r.lights, r.effects, r.actions, r.note];
  })].map((r) => r.map(q).join(sep)).join('\r\n') + '\r\n';
}

// `only`: one list's cues (a list's own menu), else every list's
export function cueSheetHtml(show: Show, only?: string): string {
  const all = rows(show, only);
  const lists = [...new Set(all.map((r) => r.list))];
  const tables = lists.map((l) => `
    <h2>${esc(l)}</h2>
    <table><colgroup><col style="width:2.6rem"><col style="width:36%"><col style="width:10%"><col style="width:12%"><col style="width:16%"><col></colgroup>
    <thead><tr><th>#</th><th>Cue</th><th>Fade</th><th>Then</th><th>Effects / also</th><th>Note</th></tr></thead><tbody>
    ${all.filter((r) => r.list === l).map((r) => `<tr><td class="n">${r.n}</td><td><b>${esc(r.name)}</b><div class="l">${esc(r.lights)}</div></td><td>${esc(r.fade)}</td><td>${esc(r.then)}</td><td>${esc([r.effects, r.actions].filter(Boolean).join('; '))}</td><td class="note">${esc(r.note)}</td></tr>`).join('')}
    </tbody></table>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Cue sheet: ${esc(show.meta.name)}</title>
<style>
  /* On paper: its own margins (they added up with the print dialog's to 2.5 cm), the page number and
     the show on every page (62 loose pages said neither), a heading kept with its table, every cell
     wrapping (a pasted link in a note made Chrome shrink the whole sheet and still cut it off), and
     the columns in fixed widths with room for the notes. */
  @page { margin: 12mm 12mm 14mm; @top-left { content: "${cssStr(show.meta.name)} · cue sheet"; font: 8pt system-ui, sans-serif; color: #555; } @bottom-right { content: "page " counter(page) " of " counter(pages); font: 8pt system-ui, sans-serif; color: #555; } }
  body { font: 11pt/1.35 system-ui, sans-serif; color: #111; margin: 1.5cm; }
  h1 { font-size: 16pt; margin: 0 0 .2rem; } .sub { color: #555; margin-bottom: 1rem; }
  h2 { font-size: 12pt; margin: 1.2rem 0 .3rem; border-bottom: 2px solid #111; padding-bottom: .15rem; break-after: avoid; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; } th, td { text-align: left; vertical-align: top; padding: .3rem .4rem; border-bottom: 1px solid #ccc; overflow-wrap: anywhere; }
  th { font-size: 9pt; text-transform: uppercase; letter-spacing: .05em; color: #555; }
  .n { font-weight: 700; } .l { color: #666; font-size: 9pt; } .note { font-style: italic; }
  tr { break-inside: avoid; }
  @media screen { body { max-width: 60rem; } .print { position: fixed; top: 1rem; right: 1rem; font: inherit; padding: .4rem 1rem; } }
  @media print { .print { display: none; } body { margin: 0; } }
</style></head><body>
<button class="print" onclick="print()">Print</button>
<h1>${esc(show.meta.name)}</h1><div class="sub">Cue sheet, ${printedAt(show)} · ${show.fixtures.length} fixtures · ${all.length} cues</div>
${tables || '<p>No cues yet.</p>'}
</body></html>`;
}
