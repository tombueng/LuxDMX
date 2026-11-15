// The console's command line (model/command.ts reads it): what a command does to the show, and
// what's said back. The app's runCommand hands over to this.
import type { app as theApp } from '../app.svelte';
import { parseCommand, type Command } from '../model/command';
import { cueAt } from '../model/values';
import { fmtNum, freezeNumbers } from '../model/cuenum';
import { groupByNumber } from '../model/groupnum';
import { byNum, numberFixtures } from '../model/numbers';

type App = typeof theApp;
type Said = { ok: boolean; said: string };

export function runCommand(app: App, text: string): Said {
  const c = parseCommand(text);
  if (c.error) return { ok: false, said: c.error };
  if (c.action) { const r = commandAction(app, c); if (r) return r; }
  const said: string[] = [], gaps: number[] = [], tail: string[] = [];
  if (c.steps) { const r = commandPick(app, c, said, gaps, tail); if (r) return r; }
  if (c.level) { const r = commandLevel(app, c, said, tail); if (r) return r; }
  if (gaps.length && gaps.length <= 3) said.push(`(no ${gaps.join(', ')})`);
  return { ok: true, said: [...said, ...tail].join(' ') };
}

// A command that does something (GO, record, clear...): what it said, or undefined to go on
function commandAction(app: App, c: Command): Said | undefined {
  const list = c.list ? app.show.cueLists[c.list - 1] : app.liveList;
  if (c.list && !list) return { ok: false, said: `there's no list ${c.list} (${app.show.cueLists.length === 0 ? 'no cue lists yet' : app.show.cueLists.length === 1 ? 'there is 1' : `there are ${app.show.cueLists.length}`})` };
  const needList = () => ({ ok: false, said: 'No cue list to play yet: select lights, set them, record' });
  switch (c.action) {
    // (as on MA: Clear with nothing set lets go of the selection; with something set it says
    // what stays selected, "@ 50" then went to all 47 lights without a word)
    case 'clear': {
      if (!Object.keys(app.programmer).length) { const n = app.selected.length; app.selectNone(); return { ok: true, said: n ? 'Nothing set: the selection let go' : 'Nothing to clear' }; }
      app.clearProgrammer();
      return { ok: true, said: app.selected.length ? `Cleared (${app.selected.length} still selected: clear again lets go)` : 'Cleared' };
    }
    case 'releaseall': app.releaseAll(); return { ok: true, said: 'Released everything' };
    case 'lowlight': app.lowlight = app.lowlight > 0 ? 0 : 0.15; return { ok: true, said: app.lowlight > 0 ? `Lowlight on${app.highlight ? '' : ' (with Highlight)'}` : 'Lowlight off' };
    case 'record': {
      // (where it goes: the list asked for, the one Live plays, else the one open; the same
      // for the cue's number being taken: a second "record cue 12" said nothing to record)
      const into = c.list ? list : app.liveList ?? app.list;
      if (c.cue !== undefined && into) { const k = cueAt(into, c.cue); if (k >= 0) return { ok: false, said: `${into.name} has cue ${fmtNum(c.cue)} (${into.cues[k].name}): update cue ${fmtNum(c.cue)}, or another number` }; }
      if (!app.record(into?.id, { num: c.cue, fade: c.time, name: c.label })) return { ok: false, said: 'Nothing to record yet' };
      const l = into ?? app.list;
      return { ok: true, said: `Recorded${c.cue !== undefined ? ` cue ${fmtNum(c.cue)}` : ''} into ${l?.name ?? 'a new list'}${app.recordedAside ? ' (the play stays where it is; Clear lets go of your changes)' : ''}` };
    }
    case 'update': {
      if (c.cue === undefined) return app.updateOnStage(c.list ? list : undefined);
      if (!list) return needList();
      const k = cueAt(list, c.cue);
      if (k < 0) return { ok: false, said: `${list.name} has no cue ${fmtNum(c.cue)}` };
      return app.updateCue(list.cues[k].id, list.id) ? { ok: true, said: `Updated cue ${fmtNum(c.cue)} in ${list.name}` } : { ok: false, said: 'Nothing changed to update' };
    }
    case 'label': {
      if (!list) return needList();
      const k = cueAt(list, c.cue!);
      if (k < 0) return { ok: false, said: `${list.name} has no cue ${fmtNum(c.cue!)}` };
      app.checkpoint(); list.cues[k].name = c.label!; app.markDirty(0);
      return { ok: true, said: `Cue ${fmtNum(c.cue!)} is "${c.label}" now` };
    }
    case 'goto': case 'delete': case 'time': {
      if (!list) return needList();
      const k = cueAt(list, c.cue!);
      if (k < 0) return { ok: false, said: `${list.name} has no cue ${fmtNum(c.cue!)}` };
      const q = list.cues[k];
      if (c.action === 'goto') { app.jump(list.id, k); return { ok: true, said: `Cue ${fmtNum(c.cue!)} ${q.name} in ${list.name}${app.safeNote(list.id)}` }; }
      app.checkpoint();
      if (c.action === 'delete') { freezeNumbers(list); list.cues.splice(k, 1); app.cueSel = app.cueSel.filter((id) => id !== q.id); return { ok: true, said: `Deleted cue ${fmtNum(c.cue!)} ${q.name} (Undo brings it back)` }; }
      q.fade = c.time!;
      return { ok: true, said: `Cue ${fmtNum(c.cue!)} fades in ${fmtNum(c.time!)} s` };
    }
    // (GO on the last cue and Back on the first did nothing and said they had)
    case 'go': {
      if (!list) return needList();
      const st = app.engine.status(list.id);
      if (st.running && !st.releasing && list.end === 'stop' && list.cues.length && st.index >= list.cues.length - 1) return { ok: false, said: `${list.name} is on its last cue: release lets it go, then GO starts it again` };
      app.go(list.id); return { ok: true, said: `GO ${list.name}${app.safeNote(list.id)}` };
    }
    case 'back': {
      if (!list) return needList();
      const st = app.engine.status(list.id);
      if (!st.running) return { ok: false, said: `${list.name} isn't playing` };
      if (st.index <= 0) return { ok: false, said: `${list.name} is on its first cue` };
      app.back(list.id); return { ok: true, said: `Back ${list.name}` };
    }
    case 'release': if (!list) return needList(); app.release(list.id); return { ok: true, said: `Released ${list.name}` };
    case 'blackout': app.blackout = !app.blackout; return { ok: true, said: app.blackout ? 'Blackout' : 'Blackout off' };
    case 'highlight': app.highlight = !app.highlight; return { ok: true, said: app.highlight ? 'Highlight on' : 'Highlight off' };
    case 'undo': {
      if (!app.canUndo) return { ok: false, said: 'Nothing to undo' };
      app.undo();
      // (what it undid: the last change to the show, which may not be the last command)
      return { ok: true, said: app.stepSaid ? `Undone: ${app.stepSaid}` : 'Undone' };
    }
    case 'redo': {
      if (!app.canRedo) return { ok: false, said: 'Nothing to redo' };
      app.redo();
      return { ok: true, said: app.stepSaid ? `Redone: ${app.stepSaid}` : 'Redone' };
    }
    case 'help': return { ok: true, said: 'Try: 5 @ full · 1 thru 4 @ 50 (one digit is tens: @ 5 is 50 %, @ 05 is 5 %) · 1 - 3 · group 2 @ out · 1.3 thru 1.8 · record cue 5 · goto cue 5 · update · next · clear · release all · undo' };
    case 'next': case 'prev': {
      app.stepSel(c.action === 'next' ? 1 : -1);
      const f = app.show.fixtures.find((x) => x.id === app.selected[0]), all = app.stepAll;
      return f ? { ok: true, said: `${f.num ?? ''} ${f.name}${all ? ` (${all.indexOf(f.id) + 1} of ${all.length})` : ''}`.trim() } : { ok: false, said: 'No lights yet' };
    }
  }
  return undefined;
}

// Lights and cells picked ("1 thru 4", "group 2", "1.3 thru 1.8", "- 3"): the selection, said;
// what's wrong with it said instead
function commandPick(app: App, c: Command, said: string[], gaps: number[], tail: string[]): Said | undefined {
  const steps = c.steps!;
  const fx = app.show.fixtures;
  numberFixtures(fx);
  const lightNo = (n: number) => byNum(fx, n);
  const problems: string[] = [];
  for (const st of steps) {
    // (a number without a light: in a run with others it's a gap, skipped as desks do; all on
    // its own it's said)
    const nums = st.pick.fixtures, have = nums.filter((n) => lightNo(n));
    if (nums.length && !have.length) problems.push(nums.length === 1 ? `no light ${nums[0]}` : `no lights ${nums[0]} to ${nums[nums.length - 1]}`);
    else gaps.push(...nums.filter((n) => !lightNo(n)));
    st.pick.fixtures = have;
    for (const n of st.pick.cells.map((x) => x.fixture)) if (!lightNo(n)) problems.push(`no light ${n}`);
    for (const g of st.pick.groups) if (!groupByNumber(app.show.groups, g)) problems.push(`no group ${g}`);
    for (const x of st.pick.cells) {
      const f = lightNo(x.fixture);
      if (!f) continue;
      const n = app.caps(f.id).cells, over = x.cells.filter((k) => k >= n);
      if (n < 2) problems.push(`light ${x.fixture} has no cells`);
      else if (over.length) problems.push(`light ${x.fixture} has only ${n} cells (${x.fixture}.1 to ${x.fixture}.${n})`);
    }
  }
  if (problems.length) return { ok: false, said: [...new Set(problems)].join('; ') };
  // the steps one after the other, from nothing or from what's selected; cells by light
  let ids = c.base === 'current' ? [...app.selected] : [];
  const outHit: string[] = [], outMiss: string[] = [];
  const cells = new Map<string, number[]>(c.base === 'current' ? Object.entries(app.cellSel) : []);
  for (const st of steps) {
    // whole lights, and cells by light (a group of cells: its cells on each of its lights)
    const whole: string[] = [], picks: { id: string; cells: number[] }[] = [];
    // ("all" while stepping through a selection is that selection again, as on MA and MagicQ)
    if (st.pick.all) whole.push(...(app.stepAll ?? fx.map((f) => f.id)));
    for (const n of st.pick.fixtures) whole.push(lightNo(n)!.id);
    for (const g of st.pick.groups) {
      const grp = groupByNumber(app.show.groups, g);
      if (!grp) continue;
      if (!grp.cells?.length) { whole.push(...grp.fixtures); continue; }
      for (const id of grp.fixtures) { const n = app.caps(id).cells, cs = grp.cells.filter((k) => k < n); if (n > 1 && cs.length) picks.push({ id, cells: cs }); }
    }
    for (const x of st.pick.cells) picks.push({ id: lightNo(x.fixture)!.id, cells: x.cells });
    if (st.sign === '+') {
      for (const id of whole) { if (!ids.includes(id)) ids.push(id); cells.delete(id); }
      for (const x of picks) {
        if (!ids.includes(x.id)) ids.push(x.id);
        const had = cells.get(x.id) ?? [];
        cells.set(x.id, [...had, ...x.cells.filter((k) => !had.includes(k))]);
      }
    } else {
      for (const id of whole) (ids.includes(id) ? outHit : outMiss).push(id);
      ids = ids.filter((id) => !whole.includes(id));
      for (const id of whole) cells.delete(id);
      for (const x of picks) {
        const left = (cells.get(x.id) ?? []).filter((k) => !x.cells.includes(k));
        if (left.length) cells.set(x.id, left); else { cells.delete(x.id); ids = ids.filter((y) => y !== x.id); }
      }
    }
  }
  // cells on some lights and whole lights next to them can't go in one selection (what would a
  // colour do to the whole ones?): said, not guessed
  if (cells.size && ids.some((id) => !cells.has(id))) return { ok: false, said: 'cells and whole lights in one command: say them one after the other (1.3 thru 1.8, then 5 @ 50)' };
  app.selected = ids;
  app.cellSel = Object.fromEntries([...cells].filter(([id]) => ids.includes(id)));
  const nc = [...cells.values()].reduce((a, x) => a + x.length, 0);
  said.push(ids.length ? `${ids.length} light${ids.length > 1 ? 's' : ''}${nc ? `, ${nc} cell${nc > 1 ? 's' : ''}` : ''}` : 'nothing selected');
  // (what "-" took out, said: "1-4" is light 1 without 4 here, as on MA and Eos; one that wasn't
  // in it said so, with how a run is typed: "1-5" read as light 1 said "5 taken out")
  const noOf = (id: string) => app.show.fixtures.find((f) => f.id === id)?.num ?? app.show.fixtures.findIndex((f) => f.id === id) + 1;
  if (outHit.length && outHit.length <= 3) tail.push(`(${outHit.map(noOf).join(', ')} taken out)`);
  if (outMiss.length && outMiss.length <= 3) {
    const from = steps.find((st) => st.sign === '+')?.pick.fixtures, to = noOf(outMiss[0]);
    const run = from?.length === 1 && outMiss.length === 1 && from[0] < to ? `; a run is ${from[0]} thru ${to}` : '';
    tail.push(`(${outMiss.map(noOf).join(', ')} wasn't in it${run})`);
  }
  return undefined;
}

// A level for the selection ("@ 50", "@ +10")
function commandLevel(app: App, c: Command, said: string[], tail: string[]): Said | undefined {
  const level = c.level!;
  if (!app.selected.length) return { ok: false, said: 'Select lights first (1 thru 4, group 2)' };
  if ('abs' in level) { if (level.abs === 0) app.off(); else app.set({ intensity: level.abs }); }
  else app.nudge('intensity', level.rel);
  said.push('abs' in level ? `at ${Math.round(level.abs * 100)}%` : `${level.rel > 0 ? '+' : ''}${Math.round(level.rel * 100)}%`);
  if ('abs' in level && level.asked) tail.push(`(${level.asked} is more than full)`);
  // (a group master pulled down holds some of them lower: said, or "5 @ full" staying dim is a mystery)
  const down = app.show.groups.filter((g) => (app.groupMasters[g.id] ?? 1) < 0.995 && g.fixtures.some((id) => app.selected.includes(id)));
  if (down.length) tail.push(`(${down.map((g) => `${g.name}'s master at ${Math.round(app.groupMasters[g.id] * 100)}%`).join(', ')})`);
  return undefined;
}
