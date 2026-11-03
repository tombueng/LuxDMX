// A cue sheet: every cue list with its cues, timing, what happens next, notes. As a page to print
// (or save as PDF from the print dialog) and as CSV for a spreadsheet.
import type { Advance, Show } from '../model/types';
import { cueNumber } from '../model/cuenum';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const then = (a: Advance) => a.mode === 'manual' ? 'GO' : a.mode === 'wait' ? `auto after ${a.time} s` : a.mode === 'follow' ? (a.time ? `${a.time} s after the fade` : 'follows when the fade is done') : `after ${a.beats} beats`;

interface Row { list: string; n: string; name: string; fade: string; then: string; lights: string; effects: string; actions: string; note: string }
function rows(show: Show): Row[] {
  const fx = new Map(show.effects.map((e) => [e.id, e.name]));
  const lists = new Map(show.cueLists.map((l) => [l.id, l.name]));
  const names = new Map(show.fixtures.map((f) => [f.id, f.name]));
  return show.cueLists.flatMap((l) => l.cues.map((c, i) => ({
    list: l.name, n: cueNumber(l, i), name: c.name,
    fade: `${c.fade} s${c.delay ? ` (delay ${c.delay} s)` : ''}${c.fadeOut !== undefined && c.fadeOut !== c.fade ? `, out ${c.fadeOut} s` : ''}`,
    then: then(c.advance),
    lights: Object.keys(c.values).map((id) => names.get(id) ?? '?').join(', '),
    effects: (c.effects ?? []).map((id) => fx.get(id) ?? '?').join(', '),
    actions: (c.actions ?? []).map((a) => a.do === 'blackout' ? `blackout ${a.on ? 'on' : 'off'}` : a.do === 'off' ? 'everything off' : a.do === 'master' ? `level of ${lists.get(a.list)} to ${Math.round(a.level * 100)}%`
      : a.do === 'goto' ? `play "${show.cueLists.find((l) => l.id === a.list)?.cues.find((x) => x.id === a.cue)?.name ?? '?'}" on ${lists.get(a.list) ?? '?'}`
      : `${{ start: 'start', go: 'GO on', release: 'fade out', stop: 'stop' }[a.do]} ${lists.get(a.list) ?? '?'}`).join(', '),
    note: c.note ?? '',
  })));
}

export function cueSheetCsv(show: Show): string {
  const q = (s: string | number) => /[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s);
  const head = ['List', 'Cue', 'Name', 'Fade', 'Then', 'Lights', 'Effects', 'Also', 'Note'];
  return [head, ...rows(show).map((r) => [r.list, r.n, r.name, r.fade, r.then, r.lights, r.effects, r.actions, r.note])].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}

export function cueSheetHtml(show: Show): string {
  const all = rows(show);
  const lists = [...new Set(all.map((r) => r.list))];
  const tables = lists.map((l) => `
    <h2>${esc(l)}</h2>
    <table><thead><tr><th>#</th><th>Cue</th><th>Fade</th><th>Then</th><th>Effects / also</th><th>Note</th></tr></thead><tbody>
    ${all.filter((r) => r.list === l).map((r) => `<tr><td class="n">${r.n}</td><td><b>${esc(r.name)}</b><div class="l">${esc(r.lights)}</div></td><td>${esc(r.fade)}</td><td>${esc(r.then)}</td><td>${esc([r.effects, r.actions].filter(Boolean).join('; '))}</td><td class="note">${esc(r.note)}</td></tr>`).join('')}
    </tbody></table>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Cue sheet: ${esc(show.meta.name)}</title>
<style>
  body { font: 11pt/1.35 system-ui, sans-serif; color: #111; margin: 1.5cm; }
  h1 { font-size: 16pt; margin: 0 0 .2rem; } .sub { color: #555; margin-bottom: 1rem; }
  h2 { font-size: 12pt; margin: 1.2rem 0 .3rem; border-bottom: 2px solid #111; padding-bottom: .15rem; }
  table { width: 100%; border-collapse: collapse; } th, td { text-align: left; vertical-align: top; padding: .3rem .4rem; border-bottom: 1px solid #ccc; }
  th { font-size: 9pt; text-transform: uppercase; letter-spacing: .05em; color: #555; }
  .n { font-weight: 700; width: 2rem; } .l { color: #666; font-size: 9pt; } .note { font-style: italic; }
  tr { break-inside: avoid; }
  @media screen { body { max-width: 60rem; } .print { position: fixed; top: 1rem; right: 1rem; font: inherit; padding: .4rem 1rem; } }
  @media print { .print { display: none; } }
</style></head><body>
<button class="print" onclick="print()">Print</button>
<h1>${esc(show.meta.name)}</h1><div class="sub">Cue sheet, ${new Date().toLocaleDateString()} · ${show.fixtures.length} fixtures · ${all.length} cues</div>
${tables || '<p>No cues yet.</p>'}
</body></html>`;
}
