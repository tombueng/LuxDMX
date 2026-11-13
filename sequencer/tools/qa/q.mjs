// Drive the QA browser (tools/qa/browser.mjs) from the shell.
//   node tools/qa/q.mjs click 'role=button[name="GO"]'
//   node tools/qa/q.mjs fill 'label=Tilt (percent)' 80
//   node tools/qa/q.mjs eval 'return window.__luxdmx.show.fixtures.length'
//   node tools/qa/q.mjs shot after-go            (PNG in the out folder)
//   node tools/qa/q.mjs snap '.prog'             (the accessibility tree as text)
//   node tools/qa/q.mjs controls '.top'          (what can be clicked, with names)
//   node tools/qa/q.mjs logs 0 errors            (console, page errors, failed requests)
//   node tools/qa/q.mjs <action> '{"sel":"...","nth":2}'   (any action with its full options)
// Several steps in one go: separate them with ' -- ' as one argument list.
const PORT = Number(process.env.QA_PORT ?? 9333);
const POS = {
  click: ['sel'], dblclick: ['sel'], hover: ['sel'], fill: ['sel', 'value'], type: ['text'], press: ['key', 'sel'],
  select: ['sel', 'value'], check: ['sel', 'on'], goto: ['url'], reset: ['url'], eval: ['js'], shot: ['name', 'sel'],
  snap: ['sel'], text: ['sel'], count: ['sel'], controls: ['sel'], logs: ['since', 'errors'], page: ['i'], wait: ['ms'],
  viewport: ['w', 'h'], drag: ['from', 'to'], files: ['sel', 'paths'],
};
const steps = [];
let cur = [];
for (const a of process.argv.slice(2)) { if (a === '--') { steps.push(cur); cur = []; } else cur.push(a); }
if (cur.length) steps.push(cur);
let failed = false;
for (const [cmd, ...rest] of steps) {
  let body = {};
  if (rest.length === 1 && /^\s*\{/.test(rest[0])) body = JSON.parse(rest[0]);
  else (POS[cmd] ?? []).forEach((k, i) => { if (rest[i] === undefined) return; let v = rest[i]; if (/^-?\d+(\.\d+)?$/.test(v) && !['value', 'text', 'sel'].includes(k)) v = Number(v); if (k === 'errors') v = true; if (k === 'on') v = v !== 'false'; if (k === 'paths') v = v.split(','); body[k] = v; });
  const r = await fetch(`http://127.0.0.1:${PORT}/${cmd}`, { method: 'POST', body: JSON.stringify(body) }).then((x) => x.json()).catch((e) => ({ ok: false, error: `QA browser not running? ${e.message}` }));
  if (!r.ok) failed = true;
  const said = r.said; delete r.said;
  const text = r.text; delete r.text;
  const show = (o) => { const s = JSON.stringify(o); return s.length > 12000 ? s.slice(0, 12000) + ' …' : s; };
  if (cmd === 'controls' && r.list) { console.log(r.list.map((c) => `${c.tag}${c.role ? '/' + c.role : ''} "${c.name}"${c.hint ? ` (${c.hint})` : ''}${c.dis ? ' [disabled]' : ''}${c.on !== undefined && c.on !== null ? ' on=' + c.on : ''} @${c.x},${c.y} ${c.w}x${c.h}`).join('\n')); }
  else if (cmd === 'lint' && r.found) { console.log(r.found.map((f) => `${f.what}: ${f.el} "${f.text}"`).join('\n') || '(clean)'); }
  else if (cmd === 'logs' && r.list) { console.log(r.list.map((e) => `#${e.seq} ${e.t} p${e.page} ${e.type}/${e.level}: ${e.text}${e.at && e.level !== 'log' ? '  (' + e.at + ')' : ''}`).join('\n') || '(nothing)'); console.log(`seq ${r.seq}`); }
  else { console.log(`${cmd}: ${show(r)}`); if (text !== undefined) console.log(text); }
  if (said) console.log(said.map((e) => `  ! ${e.type}/${e.level}: ${e.text.split('\n').slice(0, 4).join(' | ')}`).join('\n'));
}
process.exit(failed ? 1 : 0);
