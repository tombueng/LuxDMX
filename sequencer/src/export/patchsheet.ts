// The patch on paper, for setting up at the venue: every fixture with its universe, address range,
// mode, and the DIP switches for fixtures that set their address with little switches.
import type { Show } from '../model/types';
import { modeOf, typeLabel, typeMap } from '../model/library';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cssStr = (s: string) => s.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[<>\n]/g, ' ');

// Switch n is worth 2^(n-1); the address is the sum of the ones that are ON.
export function dipSwitches(address: number): boolean[] {
  return Array.from({ length: 10 }, (_, i) => ((address >> i) & 1) === 1);    // switch 10 only for 512
}

// When it was printed, and the show's last change: a patch changed during the day can be told from
// an older printout
export function printedAt(show: Show): string {
  const at = (d: Date) => `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  const m = show.meta.modified ? new Date(show.meta.modified) : null;
  return `printed ${at(new Date())}${m && !isNaN(+m) ? `, show saved ${at(m)}` : ''}`;
}

export function patchSheetHtml(show: Show): string {
  const types = typeMap(show);
  const unis = [...new Set(show.fixtures.map((f) => f.universe))].sort((a, b) => a - b);
  // Drawn (an SVG, not CSS backgrounds: browsers leave those out when printing), the way the app
  // shows them: 10 switches, the knob up is ON, numbered underneath; 10 is worth 512 (only address
  // 512 uses it, on many fixtures it's a mode switch otherwise).
  const dip = (a: number) => {
    const on = dipSwitches(a);
    const sw = on.map((x, i) => `<rect x="${3 + i * 12}" y="3" width="10" height="18" rx="1.5" fill="#fff" stroke="#111"/>`
      + `<rect x="${4.5 + i * 12}" y="${x ? 4.5 : 12.5}" width="7" height="7" fill="#111"/>`
      + `<text x="${8 + i * 12}" y="30" font-size="7" text-anchor="middle" fill="#444">${i + 1}</text>`).join('');
    return `<svg class="dip" width="126" height="33" viewBox="0 0 126 33" role="img" aria-label="DIP switches for ${a}"><rect x="0.5" y="0.5" width="125" height="23" rx="3" fill="#c62828"/>${sw}</svg>`;
  };
  const chs = (name: string, n: number) => (/\bch\b|channel/i.test(name) ? '' : ` <span class="c">(${n} ch)</span>`);
  const tables = unis.map((u) => {
    const fs = show.fixtures.filter((f) => f.universe === u).sort((a, b) => a.address - b.address);
    return `<h2>Universe ${u}</h2>
    <table><colgroup><col style="width:5.4rem"><col style="width:26%"><col><col style="width:12%"><col style="width:9rem"></colgroup>
    <thead><tr><th>Address</th><th>Fixture</th><th>Type</th><th>Mode</th><th>DIP switches (knob up = ON)</th></tr></thead><tbody>
    ${fs.map((f) => {
      const t = types.get(f.typeId), m = modeOf(t, f.mode), n = m?.channels.length ?? 1;
      return `<tr><td class="a">${f.address}${n > 1 ? `<span>–${f.address + n - 1}</span>` : ''}</td><td>${f.num ? `<span class="c">${f.num}</span> ` : ''}<b>${esc(f.name)}</b></td><td>${esc(t ? typeLabel(t) : f.typeId)}</td><td>${esc(m?.name ?? f.mode)}${chs(m?.name ?? f.mode, n)}</td><td>${dip(f.address)}${f.address + n - 1 > 512 ? '<div class="warn">runs past 512</div>' : ''} <span class="c sw">${dipSwitches(f.address).map((on, i) => (on ? i + 1 : 0)).filter(Boolean).join(', ') || 'none'}</span></td></tr>`;
    }).join('')}
    </tbody></table>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Patch: ${esc(show.meta.name)}</title>
<style>
  /* On paper: its own margins, the page and the show on every page, a heading kept with its table,
     fixed columns so the DIP column holds its numbers (they wrapped under the drawing), every cell wrapping */
  @page { margin: 12mm 12mm 14mm; @top-left { content: "${cssStr(show.meta.name)} · patch"; font: 8pt system-ui, sans-serif; color: #555; } @bottom-right { content: "page " counter(page) " of " counter(pages); font: 8pt system-ui, sans-serif; color: #555; } }
  body { font: 11pt/1.35 system-ui, sans-serif; color: #111; margin: 1.5cm; }
  h1 { font-size: 16pt; margin: 0 0 .2rem; } .sub { color: #555; margin-bottom: 1rem; }
  h2 { font-size: 12pt; margin: 1.2rem 0 .3rem; border-bottom: 2px solid #111; padding-bottom: .15rem; break-after: avoid; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; } th, td { text-align: left; vertical-align: middle; padding: .3rem .4rem; border-bottom: 1px solid #ccc; overflow-wrap: anywhere; }
  .sw { display: block; white-space: nowrap; font-size: 8pt; } .warn { color: #b00020; font-size: 9pt; font-weight: 700; }   /* (the switches ON under the drawing, on one line) */
  th { font-size: 9pt; text-transform: uppercase; letter-spacing: .05em; color: #555; }
  .a { font-weight: 800; font-size: 13pt; white-space: nowrap; } .a span { font-weight: 400; font-size: 9pt; color: #666; }
  .c { color: #666; font-size: 9pt; }
  .dip { vertical-align: middle; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  tr { break-inside: avoid; }
  @media screen { body { max-width: 60rem; } .print { position: fixed; top: 1rem; right: 1rem; font: inherit; padding: .4rem 1rem; } }
  @media print { .print { display: none; } body { margin: 0; } }
</style></head><body>
<button class="print" onclick="print()">Print</button>
<h1>${esc(show.meta.name)}</h1><div class="sub">Patch, ${printedAt(show)} · ${show.fixtures.length} fixtures</div>
${tables || '<p>No fixtures yet.</p>'}
</body></html>`;
}
