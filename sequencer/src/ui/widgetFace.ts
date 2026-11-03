// What a live control shows: its name, colour, symbol, the small line under the name, whether
// it's on, its fader value. Worked out in one place, so the live page and a phone used as a remote
// (which only ever gets these, never the show) draw the same tile.
import type { Widget } from '../model/types';
import { cueRiskOf, listRiskOf } from './risk';
import { clockOf, songIndex, songName, songsOf } from '../model/timeline';
import { partAfter, partsOf } from '../timeline/gig';
import type { app as theApp } from '../app.svelte';

type App = typeof theApp;

export interface Face {
  id: string;
  type: Widget['type'];
  label: string;
  color: string;
  glyph?: string;
  sub: string;                    // the small line under the name
  on: boolean;
  missing: boolean;               // its cue list, effect or group is gone
  inert?: boolean;                // a master on a page locked for the service: shown, not usable
  wide: boolean;
  holds: boolean;                 // acts while held (flash, fog, blinder): fires on press, lets go on release
  key?: string;                   // the key and MIDI badge
  bar?: number;                   // 0..1 along the bottom: a list's fade, the fog time left
  fader?: { v: number; text: string };
  burst?: number;                 // fog: seconds of the burst button next to it
  fx?: { kind: string; params: Record<string, unknown>; bpm: number };   // an effect's preview
  risk?: 'once' | 'hazard';       // it fires confetti (once) or flames, sparks or CO2 (model/safety.ts)
}

const GLYPH_LIST: Record<string, string> = { go: 'play', back: 'back', release: 'stop', flash: 'bolt', toggle: 'loop', solo: 'eye', select: 'note' };
const GLYPH_SPECIAL: Record<string, string> = { blackout: 'moon', releaseAll: 'stop', tap: 'note', stopEffects: 'stop', blinder: 'sun', drop: 'effect', fadeOut: 'fade' };
export const SPECIAL_NAME: Record<string, string> = { blackout: 'Blackout', releaseAll: 'Release all', tap: 'Tap', stopEffects: 'Stop effects', blinder: 'Blinder', drop: 'Drop', fadeOut: 'Fade out' };
const ACTION: Record<string, string> = { go: 'GO', back: 'BACK', toggle: 'ON / OFF', flash: 'FLASH', release: 'RELEASE', solo: 'SOLO', select: 'SONG' };

export const holdsWhilePressed = (w: Widget) => (w.type === 'list' && w.action === 'flash') || (w.type === 'effect' && w.action === 'flash') || w.type === 'fog' || w.type === 'group'
  || (w.type === 'special' && (w.do === 'blinder' || w.do === 'drop'));

// A fader's value, 0..1. `fresh`: this very moment (two quick key presses must add up), not the last frame's.
export function faderValue(app: App, w: Widget, fresh = false): number {
  if (w.type !== 'fader') return 0;
  if (w.target === 'grand') return app.grandMaster;
  if (w.target === 'bpm') return (app.show.settings.bpm - 40) / 160;
  if (w.target === 'list') return !w.ref ? 1 : fresh ? app.engine.status(w.ref).master : app.status[w.ref]?.master ?? 1;
  const fx = app.show.effects.find((e) => e.id === w.ref);
  return fx ? app.effectParams(fx).level : 0;
}

// The set list's buttons: Play / pause the song that's up, Next song, Next part. What they say
// moves with the song (its name, where it is, the song after it, the part a jump goes to).
export const SONG_NAME: Record<string, string> = { play: 'Play', next: 'Next song', part: 'Next part' };
// (a phone gets the name once with the layout: one that doesn't change while it plays)
export const SONG_STILL: Record<string, { label: string; glyph: string }> = {
  play: { label: 'Play / pause', glyph: 'play' }, next: { label: 'Next song', glyph: 'note' }, part: { label: 'Next part', glyph: 'right' } };
// the key and MIDI badge
const keyOf = (w: Widget) => `${w.key ?? ''}${w.midi ? `${w.key ? ' · ' : ''}${w.midi.kind === 'note' ? 'N' : 'CC'}${w.midi.num}` : ''}`;
function songFace(app: App, w: Widget & { type: 'song' }): Face {
  const P = app.timeline, tl = app.show.timeline, i = songIndex(app.show);
  let label = w.label || SONG_NAME[w.do] || 'Song', glyph = SONG_STILL[w.do]?.glyph, sub = '', on = false, bar: number | undefined;
  if (tl && w.do === 'play') {
    if (!w.label) label = P.playing ? 'Pause' : 'Play';
    glyph = P.playing ? 'stop' : 'play';
    on = P.playing;
    // counting in: the click it's on; else where the song is
    sub = `${songName(tl, i)} · ${P.count ? `${((P.count - 1) % 4) + 1} …` : `${clockOf(P.position, false)} / ${clockOf(P.duration, false)}`}`;
    // (in steps of half a percent: the tile isn't drawn again on every tick for a line that hasn't moved)
    if (P.position > 0) bar = Math.round((P.position / Math.max(1, P.duration)) * 200) / 200;
  } else if (tl && w.do === 'next') {
    const songs = songsOf(app.show);
    sub = i + 1 < songs.length ? songName(songs[i + 1], i + 1) : 'that was the last one';
  } else if (tl) {
    // (a song without parts: its cues are the parts)
    const cue = (it: { do: { do: string; list?: string; cue?: string } }) => app.show.cueLists.find((l) => l.id === it.do.list)?.cues.find((c) => c.id === it.do.cue)?.name ?? '';
    const to = P.pending?.to ?? partAfter(partsOf(tl, cue), P.position);
    on = !!P.pending;
    sub = to ? `${to.name || clockOf(to.at, false)}${P.pending ? ' · on the beat' : ''}` : 'last part';
  }
  const color = w.color ?? (w.do === 'play' ? '#45d85c' : w.do === 'next' ? '#6aa2ff' : '#9a6bff');
  const face: Face = { id: w.id, type: w.type, label, color, glyph, sub: tl ? sub : 'no song on the timeline yet', on, missing: !tl, wide: w.size === 2, holds: false };
  if (w.key || w.midi) face.key = keyOf(w);
  if (bar !== undefined) face.bar = bar;
  return face;
}

// `manyLists`: the page has cue buttons from more than one list (they say which). `now`: ms, for the fog countdown.
export function widgetFace(app: App, w: Widget, manyLists = false, now = performance.now()): Face {
  if (w.type === 'song') return songFace(app, w);
  const list = w.type === 'list' || w.type === 'cue' || w.type === 'cuelist' ? app.show.cueLists.find((l) => l.id === w.list) : w.type === 'fader' && w.target === 'list' ? app.show.cueLists.find((l) => l.id === w.ref) : undefined;
  const st = list ? app.status[list.id] : undefined;
  const grp = w.type === 'group' ? app.show.groups.find((g) => g.id === w.group) : undefined;
  const fx = w.type === 'effect' ? app.show.effects.find((e) => e.id === w.effect) : w.type === 'fader' && w.target === 'effect' ? app.show.effects.find((e) => e.id === w.ref) : undefined;
  const cueIndex = w.type === 'cue' && list ? list.cues.findIndex((c) => c.id === w.cue) : -1;
  const cue = cueIndex >= 0 ? list!.cues[cueIndex] : undefined;
  // (an effect whose lights are all gone, the pixel bars deleted, counts as gone too: it lights nothing)
  const noLights = !!fx && !(fx.group ? app.show.groups.find((g) => g.id === fx.group)?.fixtures.length : fx.fixtures?.length);
  const missing = ((w.type === 'list' || w.type === 'cue' || w.type === 'cuelist') && !list) || (w.type === 'cue' && !cue) || (w.type === 'effect' && (!fx || noLights)) || (w.type === 'group' && !grp)
    || (w.type === 'fader' && (w.target === 'list' || w.target === 'effect') && !list && !fx);
  // held things (flash a group, blinder, drop) are on while something holds them: a finger, a MIDI pad or a phone
  const on = w.type === 'list' && w.action === 'select' ? app.liveList?.id === w.list
    : w.type === 'list' ? (w.action === 'toggle' || w.action === 'flash' || w.action === 'solo' || w.action === 'go') && !!st?.running && !st.releasing
    : w.type === 'cue' ? !!st?.running && st.index === cueIndex
    : w.type === 'effect' ? (app.fx[w.effect] ?? 0) > 0
    : w.type === 'fog' || w.type === 'group' || (w.type === 'special' && (w.do === 'blinder' || w.do === 'drop')) ? !!app.fogUntil[w.id]
    : w.type === 'special' && w.do === 'blackout' ? app.blackout
    : w.type === 'special' && w.do === 'fadeOut' ? app.fadedOut
    : false;
  const label = w.label || (w.type === 'group' ? grp?.name : w.type === 'list' ? list?.name : w.type === 'cue' ? cue?.name : w.type === 'effect' ? fx?.name
    : w.type === 'fader' ? (w.target === 'grand' ? 'Grand master' : w.target === 'bpm' ? 'Tempo' : list?.name ?? fx?.name)
    : w.type === 'special' ? SPECIAL_NAME[w.do] : w.type === 'cuelist' ? list?.name : '') || (w.type === 'label' ? '' : '(missing)');
  const glyph = w.type === 'list' ? GLYPH_LIST[w.action] : w.type === 'group' ? 'bolt' : w.type === 'fog' ? 'fog' : w.type === 'special' ? GLYPH_SPECIAL[w.do] : undefined;
  const color = w.color ?? list?.color ?? (w.type === 'effect' ? '#ffaa1c' : w.type === 'fog' ? '#8a94a3' : w.type === 'group' ? '#36d6e7'
    : w.type === 'special' && w.do === 'blackout' ? '#f33abc' : w.type === 'special' && w.do === 'fadeOut' ? '#9a6bff' : w.type === 'special' && (w.do === 'blinder' || w.do === 'drop') ? '#f5f7fa' : '#45d85c');
  const left = w.type === 'fog' && app.fogUntil[w.id] ? Math.max(0, (app.fogUntil[w.id] - now) / 1000) : 0;

  let sub = '', bar: number | undefined;
  if (w.type === 'list') {
    // what it does (an on/off is plain from the tile's glow), and the cue it's on
    const act = w.action === 'toggle' || label.toUpperCase() === ACTION[w.action] ? '' : ACTION[w.action];
    const at = st?.running ? list?.cues[st.index]?.name : undefined;
    sub = `${act}${at ? `${act ? ' · ' : ''}${at}` : ''}`;
    if (st?.running) bar = st.progress ?? 0;
  } else if (w.type === 'cue') sub = manyLists ? list?.name ?? '' : '';
  else if (w.type === 'effect') sub = w.action === 'flash' ? 'FLASH' : '';
  else if (w.type === 'group') sub = `${w.strobe ? 'STROBE' : 'FLASH'} · ${grp?.fixtures.length ?? 0} light${grp?.fixtures.length === 1 ? '' : 's'}`;
  else if (w.type === 'fog') { sub = on ? `${left.toFixed(1)} s left` : `hold · max ${w.max} s`; if (on) bar = left / w.max; }
  else if (w.type === 'special' && w.do === 'fadeOut') {
    const f = app.gmFade, g = app.grandMaster;     // the bar follows the master (it moves every frame of a fade)
    sub = f ? (f.to === 0 ? 'fading out' : 'coming back') : app.fadedOut ? 'out · tap to come back' : `${w.seconds ?? 5} s to black`;
    if (f) bar = Math.max(0, Math.min(1, f.to === 0 ? 1 - g / Math.max(0.01, f.from) : g / Math.max(0.01, f.to)));
  }
  else if (w.type === 'special') sub = w.do === 'tap' ? `${app.bpm} BPM` : w.do === 'blackout' ? (app.blackout ? 'ON' : '') : w.do === 'blinder' ? 'HOLD · all white' : w.do === 'drop' ? `HOLD · white, strobe${app.show.fixtures.some((f) => app.caps(f.id).fog) ? ', fog' : ''}` : '';
  if (missing) sub = 'its target is gone';
  const inert = app.lockedOut(w);
  if (inert) sub = 'not while locked';

  const face: Face = { id: w.id, type: w.type, label, color, glyph, sub, on, missing, wide: w.size === 2, holds: holdsWhilePressed(w), ...(inert ? { inert } : {}) };
  if (w.key || w.midi) face.key = keyOf(w);
  if (bar !== undefined) face.bar = bar;
  if (w.type === 'fader') {
    const v = faderValue(app, w);
    face.fader = { v, text: w.target === 'bpm' ? `${app.bpm} BPM` : `${Math.round(v * 100)}%` };
  }
  if (w.type === 'fog' && !on) face.burst = Math.min(w.burst, w.max);
  if (w.type === 'effect' && fx) face.fx = { kind: fx.kind, params: fx.params, bpm: app.bpm };
  // what it sets off, marked on the tile: a cue's own values and the lists it plays, a list's cues
  const risk = cue ? cueRiskOf(app.show, cue, app.showRev) : list && (w.type === 'cuelist' || (w.type === 'list' && w.action !== 'select' && w.action !== 'release')) ? listRiskOf(app.show, list, app.showRev) : 'light';
  if (risk === 'once' || risk === 'hazard') face.risk = risk;
  return face;
}
