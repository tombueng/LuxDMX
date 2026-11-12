// The console's command line, the way desks take it: lights by number (their fixture number,
// model/numbers.ts), "thru" for a run, "+" and "-" to add and take out (in the order said), "group 2",
// "all", "1.3" for cell 3 of light 1 (a sub-fixture), "@" and a level, and a few words on their
// own: clear, record, update, go / back / release (a list by its number), blackout, highlight,
// next / prev (one light of the selection at a time), undo (oops), help (?). Cues by their number (5, 2.5), in the list
// Live plays or "list 2": goto cue 5, record cue 5 (time 3), update cue 5, delete cue 5, cue 5 time 3.
// Levels as on ETC and ChamSys desks: "@ 5" is 50 % (one digit is tens), "@ 05" or "@ 5%" is 5 %,
// "@ 75", "@ full", "@ out", "@ +10" / "@ -10" from where each light is; "full" and "out" also
// without the "@". Parsing only: the app does what it says (app.runCommand).

export type Level = { abs: number } | { rel: number };
export interface Pick { fixtures: number[]; groups: number[]; cells: { fixture: number; cells: number[] }[]; all?: boolean }
// One step of a selection: add it, or take it out. `base`: start from nothing (a new selection)
// or from what's selected now (a command starting with + or -).
export interface Step { sign: '+' | '-'; pick: Pick }
export interface Command {
  steps?: Step[];
  base?: 'new' | 'current';
  level?: Level;            // on what was said, or on the selection
  action?: 'clear' | 'record' | 'go' | 'back' | 'release' | 'blackout' | 'highlight' | 'update' | 'next' | 'prev' | 'goto' | 'delete' | 'time' | 'undo' | 'help';
  list?: number;            // which list (from 1); none: the one Live plays
  cue?: number;             // a cue by its number (goto, record, update, delete, time)
  time?: number;            // a fade in seconds (cue 5 time 3, record cue 5 time 3)
  error?: string;
}

const WORDS: Record<string, string> = {
  thru: 'thru', through: 'thru', t: 'thru', '>': 'thru', to: 'thru',
  at: '@', '@': '@', full: 'full', ff: 'full', out: 'out',
  group: 'group', g: 'group', grp: 'group', all: 'all',
  clear: 'clear', clr: 'clear', record: 'record', rec: 'record', update: 'update', upd: 'update',
  go: 'go', back: 'back', release: 'release', rel: 'release', blackout: 'blackout', bo: 'blackout',
  highlight: 'highlight', hl: 'highlight', list: 'list', l: 'list',
  next: 'next', prev: 'prev', previous: 'prev', last: 'prev',
  goto: 'goto', cue: 'cue', q: 'cue', time: 'time', delete: 'delete', del: 'delete',
  undo: 'undo', oops: 'undo', help: 'help', '?': 'help',
};

// "-" takes out, as on MA and Eos desks ("1-4" is light 1 without 4; a run is "1 thru 4" or "1>4").
function tokens(text: string): string[] {
  return text.toLowerCase().replace(/%/g, ' % ').replace(/([@+\-.>])/g, ' $1 ').split(/\s+/).filter(Boolean).map((t) => WORDS[t] ?? t);
}
// (a number a light, a cell, a group or a cue can have: no bigger than 99999, so a typo of twenty
// digits is said, not counted to)
const isNum = (t: string | undefined) => t !== undefined && /^\d{1,5}$/.test(t);
const empty = (): Pick => ({ fixtures: [], groups: [], cells: [] });
// (a run: at most this long, "1 thru 999999999" is a typo, not a selection)
export const MAX_RUN = 10000;
const run = (a: number, b: number) => { const out: number[] = []; const s = b >= a ? 1 : -1; for (let k = a; ; k += s) { out.push(k); if (k === b) break; } return out; };
const tooLong = (a: number, b: number) => Math.abs(b - a) >= MAX_RUN;
const pushAll = (to: number[], xs: number[]) => { for (const x of xs) to.push(x); };

function levelOf(v: string[]): Level | string {
  const bad = `"${v.join(' ')}" isn't a level: 5 (50 %), 05 (5 %), 75, full, out, +10`;
  if (v[v.length - 1] === '%') { const n = v.slice(0, -1); if (n.length === 1 && /^\d+(\.\d+)?$/.test(n[0])) return { abs: Math.min(100, +n[0]) / 100 }; return bad; }
  if (v.length === 1 && v[0] === 'full') return { abs: 1 };
  if (v.length === 1 && v[0] === 'out') return { abs: 0 };
  if (v.length === 1 && /^\d+$/.test(v[0])) return { abs: Math.min(100, v[0].length === 1 ? +v[0] * 10 : +v[0]) / 100 };   // (one digit: tens)
  if (v.length === 2 && (v[0] === '+' || v[0] === '-') && /^\d+$/.test(v[1])) return { rel: (v[0] === '+' ? 1 : -1) * Math.min(100, +v[1]) / 100 };
  if (v.length === 3 && isNum(v[0]) && v[1] === '.' && isNum(v[2])) return { abs: Math.min(100, +`${v[0]}.${v[2]}`) / 100 };
  return bad;
}

const ACTS = ['clear', 'record', 'go', 'back', 'release', 'blackout', 'highlight', 'update', 'next', 'prev', 'goto', 'delete', 'undo', 'help'];
const PLAIN = ['clear', 'blackout', 'highlight', 'next', 'prev', 'undo', 'help'];
function actionOf(t: string[]): Command {
  let action: string | undefined, list: number | undefined, cue: number | undefined, time: number | undefined, i = 0;
  // (a number, "2.5" too)
  const num = () => { if (!isNum(t[i])) return undefined; let s = t[i++]; if (t[i] === '.' && isNum(t[i + 1])) { s += `.${t[i + 1]}`; i += 2; } return +s; };
  while (i < t.length) {
    const w = t[i++];
    if (w === 'list') { const n = num(); if (n === undefined || n < 1 || !Number.isInteger(n)) return { error: 'list takes a number from 1' }; list = n; continue; }
    if (w === 'cue') { const n = num(); if (n === undefined || !(n > 0)) return { error: 'cue takes a number (5, 2.5)' }; cue = n; continue; }
    if (w === 'time') { const n = num(); if (n === undefined || n > 3600) return { error: 'time takes seconds (3, 0.5)' }; time = n; continue; }
    if (ACTS.includes(w) && !action) {
      action = w;
      // (a number straight after: "go 2" is list 2, "goto 5" cue 5)
      if (isNum(t[i])) {
        if (['go', 'back', 'release'].includes(w)) { const n = num()!; if (n < 1 || !Number.isInteger(n)) return { error: `"${w}" takes a list number or nothing` }; list = n; }
        // ("goto 5", and as on ETC desks "record 5", "update 5", "delete 5": cue 5)
        else if (['goto', 'record', 'update', 'delete'].includes(w)) { const n = num()!; if (!(n > 0)) return { error: 'cue takes a number (5, 2.5)' }; cue = n; }
        else return { error: `"${w}" takes ${PLAIN.includes(w) ? 'nothing after it' : '"cue" and a number'}` };
      }
      continue;
    }
    return { error: `"${w}"? Try 1 thru 4 @ 50, group 2, goto cue 5, go, clear` };
  }
  if (action === 'go' && cue !== undefined) action = 'goto';             // ("go cue 5": to cue 5)
  if (!action) {
    if (cue !== undefined && time !== undefined) action = 'time';
    else return { error: cue !== undefined ? `cue ${cue} what? goto cue ${cue}, update cue ${cue}, delete cue ${cue}, cue ${cue} time 3` : 'list what? go list 2, goto list 2 cue 5' };
  }
  if (PLAIN.includes(action) && (list !== undefined || cue !== undefined || time !== undefined)) return { error: `"${action}" takes nothing after it` };
  if ((action === 'goto' || action === 'delete') && cue === undefined) return { error: `"${action}" takes a cue: ${action} cue 5` };
  if (['go', 'back', 'release'].includes(action) && time !== undefined) return { error: `"${action}" takes a list number or nothing` };
  if (time !== undefined && action !== 'time' && action !== 'record') return { error: `"time" goes with a cue: cue 5 time 3` };
  const c: Command = { action: action as Command['action'] };
  if (list !== undefined) c.list = list;
  if (cue !== undefined) c.cue = cue;
  if (time !== undefined) c.time = time;
  return c;
}

export function parseCommand(text: string): Command {
  const t = tokens(text);
  if (!t.length) return {};
  // a word on its own, or about a list and a cue
  if (ACTS.includes(t[0]) || t[0] === 'cue' || t[0] === 'list') return actionOf(t);
  const steps: Step[] = [];
  let i = 0, sign: '+' | '-' = '+', base: Command['base'] = 'new';
  if (t[0] === '+' || t[0] === '-') { base = 'current'; sign = t[0]; i = 1; }
  const put = (f: (p: Pick) => void) => {
    const last = steps[steps.length - 1];
    if (last && last.sign === sign) f(last.pick); else { const p = empty(); f(p); steps.push({ sign, pick: p }); }
  };
  while (i < t.length && t[i] !== '@' && t[i] !== 'full' && t[i] !== 'out') {
    const w = t[i];
    if (w === '+' || w === '-') { sign = w; i++; continue; }
    if (w === 'all') { put((p) => (p.all = true)); i++; continue; }
    if (w === 'group') {
      if (!isNum(t[i + 1]) || +t[i + 1] < 1) return { error: 'group takes a number from 1' };
      const a = +t[i + 1];
      let b = a; i += 2;
      if (t[i] === 'thru' && isNum(t[i + 1])) { b = +t[i + 1]; i += 2; }
      if (b < 1) return { error: 'groups count from 1' };
      if (tooLong(a, b)) return { error: `a run of at most ${MAX_RUN}` };
      put((p) => pushAll(p.groups, run(a, b)));
      continue;
    }
    if (isNum(w)) {
      const a = +w;
      if (t[i + 1] === '.') {
        // cells: "1.3", "1.3 thru 1.16", "1.3 thru 16"
        if (!isNum(t[i + 2])) return { error: `"${a}." takes a cell number` };
        const c0 = +t[i + 2];
        let c1 = c0; i += 3;
        if (t[i] === 'thru') {
          if (isNum(t[i + 1]) && t[i + 2] === '.' && isNum(t[i + 3])) { if (+t[i + 1] !== a) return { error: 'a run of cells stays in one light' }; c1 = +t[i + 3]; i += 4; }
          else if (isNum(t[i + 1])) { c1 = +t[i + 1]; i += 2; }
          else return { error: '"thru" takes a number after it' };
        }
        if (a < 1) return { error: 'lights count from 1' };
        if (c0 < 1 || c1 < 1) return { error: 'cells count from 1' };
        if (tooLong(c0, c1)) return { error: `a run of at most ${MAX_RUN}` };
        put((p) => p.cells.push({ fixture: a, cells: run(c0, c1).map((k) => k - 1) }));
        continue;
      }
      let b = a; i++;
      if (t[i] === 'thru') { if (!isNum(t[i + 1])) return { error: '"thru" takes a number after it' }; b = +t[i + 1]; i += 2; }
      if (a < 1 || b < 1) return { error: 'lights count from 1' };
      if (tooLong(a, b)) return { error: `a run of at most ${MAX_RUN}` };
      put((p) => pushAll(p.fixtures, run(a, b)));
      continue;
    }
    return { error: `"${w}"? Try 1 thru 4 @ 50, group 2, goto cue 5, go, clear` };
  }
  const cmd: Command = {};
  if (steps.length) { cmd.steps = steps; cmd.base = base; }
  if (t[i] === 'full' || t[i] === 'out') {
    if (t.length > i + 1) return { error: `nothing goes after "${t[i]}"` };
    cmd.level = { abs: t[i] === 'full' ? 1 : 0 };
  } else if (t[i] === '@') {
    const v = t.slice(i + 1);
    if (!v.length) return { error: '"@" takes a level: 5 (50 %), 05 (5 %), 75, full, out, +10' };
    const l = levelOf(v);
    if (typeof l === 'string') return { error: l };
    cmd.level = l;
  }
  if (!cmd.steps && !cmd.level) return { error: 'say which lights (1 thru 4, group 2, 1.3) or a level (@ 50)' };
  return cmd;
}
