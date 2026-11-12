// The live page a show gets before anyone designs one: built from what's in the show, the way you'd
// lay it out on a busking console. Looks of the first list as big buttons, the effect machines
// (confetti, flames...) as one-tap shots, every other list as a toggle, effects as toggles, fog with
// a hard maximum, then the masters.
import type { CueList, Page, Show, Widget } from '../model/types';
import { caps, isFogTimer, isLooks, isPlay, modeOf, typeMap } from '../model/library';
import { songsOf } from '../model/timeline';
import { isMachine } from '../model/safety';

// Keys: the number row plays the looks, the letter rows the lists and effects.
const NUM = [...'1234567890'], ROW1 = [...'qwertyuiop'], ROW2 = [...'asdfghjkl'], ROW3 = [...'zxcm'];

type ListLike = Pick<CueList, 'cues'>;
// (a machine's own programs, built-in effects and colour programs, count as firing it)
const keysOf = (l: ListLike, machine?: (fid: string) => boolean) => l.cues.flatMap((c) => Object.entries(c.values).map(([fid, v]) => Object.keys(v).map((k) => (machine && (k === 'effectMacro' || k === 'colorMacro') && machine(fid) ? 'flame' : k))));
const MACHINE = ['confetti', 'bubbles', 'flame', 'sparks', 'co2'];
// A list that only fires effect machines (a confetti shot, a few seconds of flames): a button that
// fires it, not a look or an on/off. Its cue ends by itself (a wait and the list's end), so a tap
// is a shot, never a machine left running.
export function isMachineList(l: ListLike, machine?: (fid: string) => boolean): boolean {
  const keys = keysOf(l, machine);
  return keys.length > 0 && keys.every((ks) => ks.every((k) => MACHINE.includes(k) || k === 'fan')) && keys.some((ks) => ks.some((k) => MACHINE.includes(k)));
}
// A list that only fogs or hazes (a fog timer, haze for the night with its fan): it lives with the fog.
const fogOnly = (l: ListLike) => isFogTimer(l) || (keysOf(l).length > 0 && keysOf(l).every((ks) => ks.every((k) => k === 'fog' || k === 'haze' || k === 'fan')) && keysOf(l).some((ks) => ks.includes('fog') || ks.includes('haze')));

export function buskingPage(show: Show) {
  const w: Widget[] = [];
  const types = typeMap(show);
  const isM = (fid: string) => { const f = show.fixtures.find((x) => x.id === fid); return !!f && isMachine(modeOf(types.get(f.typeId), f.mode)); };
  // the main looks: the first list that isn't a fog timer or a machine's shot (one made before any
  // look mustn't be it)
  const main = show.cueLists.find((l) => !isFogTimer(l) && !isMachineList(l, isM));
  const machines = show.cueLists.filter((l) => l !== main && isMachineList(l, isM));
  const others = show.cueLists.filter((l) => l !== main && !machines.includes(l));
  // A play (standby notes or follow-ons, or the list says so): the page shows the whole list the
  // way a play is run, and leaves out the DJ's things (blinder, drop, tempo).
  const play = !!main && isPlay(main);
  // A song on the timeline (or a set of them): the band's buttons first and big, Play / pause and
  // Next song, then Next part; their keys take none of the others' (a pedal or a MIDI pad is one
  // Learn away)
  if (songsOf(show).some((t) => t.items.length || t.audio || t.demo)) {
    w.push({ id: 'h-set', type: 'label', label: 'Set list' });
    w.push({ id: 'song-play', type: 'song', do: 'play', size: 2, key: ',' }, { id: 'song-next', type: 'song', do: 'next', size: 2, key: '.' },
      { id: 'song-part', type: 'song', do: 'part', key: '-' });
  }
  if (main) {
    if (!play) w.push({ id: 'h-looks', type: 'label', label: main.name });   // (the list panel has its own)
    // GO, Back and Release for it live in the strip at the top of the live view.
    // a play: the whole list (no number keys anywhere: a stray key mid-show mustn't jump it);
    // moods for busking: a button each, with keys
    if (play) w.push({ id: `cues-${main.id}`, type: 'cuelist', list: main.id });
    else main.cues.slice(0, 48).forEach((c, i) => w.push({ id: `cue-${c.id}`, type: 'cue', list: main.id, cue: c.id, ...(i < NUM.length ? { key: NUM[i] } : {}) }));
  }
  // The big moments: a tap fires the machine for the few seconds its cue says (and a tap while it
  // runs stops it; one you recorded yourself that never ends goes off again the same way).
  if (machines.length) {
    w.push({ id: 'h-machines', type: 'label', label: 'Effect machines' });
    for (const l of machines) w.push({ id: `sfx-${l.id}`, type: 'list', list: l.id, action: 'toggle' });
  }
  // A list that only switches fog or haze (a fog timer) belongs with the fog, not with the cue lists.
  const timers = others.filter(fogOnly), lists = others.filter((l) => !fogOnly(l));
  if (lists.length) {
    w.push({ id: 'h-lists', type: 'label', label: 'Cue lists' });
    // a list over the others (house lights) steps with GO and Back: a toggle would fade it out
    let k = 0;
    for (const l of lists) {
      if ((l.priority ?? 'normal') === 'high') {
        w.push({ id: `go-${l.id}`, type: 'list', list: l.id, action: 'go', key: ROW1[k++] });
        w.push({ id: `back-${l.id}`, type: 'list', list: l.id, action: 'back' });
      } else w.push({ id: `tog-${l.id}`, type: 'list', list: l.id, action: 'toggle', key: ROW1[k++] });
    }
  }
  if (show.effects.length) {
    w.push({ id: 'h-fx', type: 'label', label: 'Effects' });
    show.effects.forEach((e, i) => w.push({ id: `fx-${e.id}`, type: 'effect', effect: e.id, action: 'toggle', key: ROW2[i] }));
    w.push({ id: 'stopfx', type: 'special', do: 'stopEffects', label: 'Stop effects' });
  }
  const fog = show.fixtures.filter((f) => caps(modeOf(types.get(f.typeId), f.mode)).fog).map((f) => f.id);
  if (fog.length || (!play && show.groups.length) || timers.length || (!play && show.fixtures.length > 1)) {
    w.push({ id: 'h-sfx', type: 'label', label: 'Flash and fog' });
    // A flash button per group (a strobe group strobes while held).
    if (!play) show.groups.forEach((g, i) => w.push({ id: `flash-${g.id}`, type: 'group', group: g.id, level: 1, ...(/strobe/i.test(g.name) ? { strobe: 0.8 } : {}), key: ROW3[i] }));
    // a hazer is a hazer: "Haze" when that's all there is
    const hazers = fog.every((id) => modeOf(types.get(show.fixtures.find((f) => f.id === id)!.typeId), show.fixtures.find((f) => f.id === id)!.mode)?.channels.some((c) => c.attr === 'haze'));
    if (fog.length) w.push({ id: 'fog', type: 'fog', fixtures: fog, level: 1, burst: 3, max: 10, label: hazers ? 'Haze' : 'Fog', key: 'v' });
    // the DJ's big moments: everything white, and white + strobe + fog, while held
    if (!play && show.fixtures.length > 1) w.push({ id: 'blinder', type: 'special', do: 'blinder', label: 'Blinder' });
    // (every light can strobe now: one with no strobe channel blinks its level)
    if (!play && show.fixtures.length > 1) w.push({ id: 'drop', type: 'special', do: 'drop', label: 'Drop' });
    timers.forEach((l) => w.push({ id: `tog-${l.id}`, type: 'list', list: l.id, action: 'toggle' }));
  }
  w.push({ id: 'h-masters', type: 'label', label: 'Masters' });
  // (a machine's shot has no level worth a fader)
  for (const l of show.cueLists) if (!machines.includes(l)) w.push({ id: `lvl-${l.id}`, type: 'fader', target: 'list', ref: l.id });
  w.push({ id: 'gm', type: 'fader', target: 'grand', label: 'Grand master' });
  if (!play) w.push({ id: 'bpm', type: 'fader', target: 'bpm', label: 'Tempo' });
  w.push({ id: 'fade', type: 'special', do: 'fadeOut', label: 'Fade out' });    // the end of a song: everything to black over 5 s
  if (!play) w.push({ id: 'tap', type: 'special', do: 'tap', label: 'Tap', key: 'n' });
  w.push({ id: 'relall', type: 'special', do: 'releaseAll', label: 'Release all' });
  return { id: 'busking', name: 'Main', widgets: w };     // not "Live": that's the mode it's in
}

// A page for staff: the looks of the main list and nothing else (no masters, no flashes, no fog, no
// Release all). Blackout and GO stay in the strip above it; locking it is one tap more.
export function looksPage(show: Show, id: string): Page {
  const w: Widget[] = [];
  const main = show.cueLists.find((l) => !isFogTimer(l) && !isMachineList(l));
  if (main && isPlay(main)) return { id, name: 'Looks', widgets: [{ id: `${id}-cues`, type: 'cuelist', list: main.id }] };
  // every list of looks (the church's and the hall's), each under its name when there are several;
  // not the fog timers or the machines' shots, not a list over the others (house lights) or a play
  const lists = show.cueLists.filter((l) => !isFogTimer(l) && !fogOnly(l) && !isMachineList(l) && isLooks(l) && (l.priority ?? 'normal') !== 'high' && l.cues.length);
  let k = 0;
  for (const l of lists) {
    if (lists.length > 1) w.push({ id: `${id}-h-${l.id}`, type: 'label', label: l.name });
    for (const c of l.cues.slice(0, 48)) { w.push({ id: `${id}-${c.id}`, type: 'cue', list: l.id, cue: c.id, ...(k < NUM.length ? { key: NUM[k] } : {}) }); k++; }
  }
  return { id, name: 'Looks', widgets: w, go: false };   // tapped, not stepped (no GO into "All off")
}
