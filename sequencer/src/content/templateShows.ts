// The templates' shows: each template's own looks cued to a song's parts, the way the demos are
// (cueing.ts cueParts), so a template plays as a whole show with its music, not only as a rig with
// cues to press. Each has its own song from the catalog (any other can be picked); without one it
// runs on the demo beat. The looks are the template's cues by name; the machines go off where the
// kind of part asks for them, as many as the room takes (a church gets no CO2).
import type { BurstAttr, CrowdAction, CrowdItem, Timeline, TimelineItem } from '../model/timeline';
import type { Show } from '../model/types';
import { cueParts, partsOf, type Cuer, type Part, type PartKind } from './cueing';
import type { DemoSong } from './demo';
import { ALL_TEMPLATES } from './ringMatrix';

export interface TemplateShow {
  song: string;                                    // its own song (catalog.ts id)
  list: string;                                    // the list of its looks (by name)
  sets: Record<PartKind, string[][]>;              // the looks (cue names) for each kind of part, a set per time it comes round
  lastChorus: string[];
  end: string;                                     // the look it ends on, as the music rings out
  hits: BurstAttr[];                               // the machines it fires on the music (bursts)
  start?: [string, string];                        // a list and its cue gone to at the start (the theatre's house lights out)
  close?: [string, string];                        // and before it and at the end (half up)
  crowd: CrowdKind;                                // how the audience sounds (crowdTrack)
}
// a concert crowd cheers the band on and on every chorus; a party's on the drops; a theatre, church
// or cinema audience murmurs before, is quiet through it and cheers at the end; a bar chats all along
export type CrowdKind = 'concert' | 'party' | 'calm' | 'bar';
// seconds of show before the song (the audience waiting) and after it (cheering, then chatting)
export const TEMPLATE_LEAD = 8, TEMPLATE_TAIL = 6;

export const TEMPLATE_SHOWS: Record<string, TemplateShow> = {
  Band: {
    crowd: 'concert', song: 'revolution-now', list: 'Songs', end: 'Blackout',
    sets: {
      intro: [['Intro: thunder']], verse: [['Verse'], ['Verse', 'Love song']], build: [['Drum solo']],
      chorus: [['Chorus', 'Rock out'], ['Rock out', 'Chorus']], solo: [['Guitar solo']], break: [['Ballad'], ['Love song']],
      inst: [['Rock out', 'Guitar solo']], outro: [['Encore']],
    },
    lastChorus: ['Big finish', 'Rock out', 'Big finish'], hits: ['fog', 'co2', 'confetti', 'sparks', 'flame', 'strobe', 'blinder'],
  },
  'DJ / Party': {
    crowd: 'party', song: 'foolish-game', list: 'Moods', end: 'Wind down',
    sets: {
      intro: [['Warm-up']], verse: [['Red / blue', 'Ocean'], ['Neon', 'Juggle'], ['Disco', 'Bounce']], build: [['Matrix'], ['Theater lights']],
      chorus: [['Full on', 'Fire'], ['Peak time', 'Neon', 'Fireworks'], ['Disco', 'Full on', 'Plasma']], solo: [['Fireworks', 'Full on']],
      break: [['Ocean', 'Rain'], ['Plasma', 'Rain']], inst: [['Bass', 'Juggle'], ['Bounce', 'Bass']], outro: [['Wind down']],
    },
    lastChorus: ['Peak time', 'Fireworks', 'Full on', 'Fire', 'Peak time'], hits: ['fog', 'co2', 'confetti', 'sparks', 'flame', 'strobe', 'blinder', 'bubbles'],
  },
  Theatre: {
    crowd: 'calm', song: 'everybody-on-your-block', list: 'Show', end: 'End', start: ['House lights', 'House out'], close: ['House lights', 'House half'],
    sets: {
      intro: [['Night']], verse: [['Scene 1'], ['Fireside'], ['Ballroom']], build: [['Sunrise']],
      chorus: [['Ballroom', 'Dream'], ['Finale'], ['Storm', 'Finale']], solo: [['Storm']], break: [['Dream'], ['Night']],
      inst: [['Storm', 'Ballroom']], outro: [['Bows']],
    },
    lastChorus: ['Finale', 'Storm', 'Finale'], hits: ['fog', 'confetti', 'sparks', 'bubbles'],
  },
  Church: {
    crowd: 'calm', song: 'walls-come-down', list: 'Service', end: 'Goodbye',
    sets: {
      intro: [['Welcome']], verse: [['Worship'], ['Choir']], build: [['Easter morning']],
      chorus: [['Worship concert'], ['Worship concert', 'Easter morning']], solo: [['Kids church']], break: [['Prayer'], ['Christmas Eve']],
      inst: [['Choir', 'Worship concert']], outro: [['Goodbye']],
    },
    lastChorus: ['Worship concert', 'Just married', 'Worship concert'], hits: ['confetti', 'sparks', 'bubbles'],
  },
  Cinema: {
    crowd: 'calm', song: 'wont-fall-in-love', list: 'Screening', end: 'Exit',
    sets: {
      intro: [['Preshow']], verse: [['Red carpet'], ['Trailers']], build: [['Sci-fi night']],
      chorus: [['Premiere applause', 'Red carpet'], ['Premiere applause']], solo: [['Horror night']], break: [['Intermission']],
      inst: [['Sci-fi night']], outro: [['Credits']],
    },
    lastChorus: ['Premiere applause', 'Sci-fi night', 'Premiere applause'], hits: ['co2', 'confetti', 'sparks', 'bubbles'],
  },
  Bar: {
    crowd: 'bar', song: 'light-me-on-fire', list: 'Moods', end: 'Last call',
    sets: {
      intro: [['Evening']], verse: [['Cocktail hour'], ['Jazz night'], ['Late night']], build: [['Happy hour']],
      chorus: [['Party'], ['Party', 'Birthday!']], solo: [['Karaoke']], break: [['Late night']],
      inst: [['Happy hour', 'Party']], outro: [['Last call']],
    },
    lastChorus: ['Birthday!', 'Party', 'Birthday!'], hits: ['confetti', 'sparks', 'bubbles'],
  },
};

// The audience's sound for a show of `kind` on the song's parts (the crowd track, audio/crowd.ts
// plays it, and a render has it too)
export function crowdTrack(kind: CrowdKind, parts: Part[], duration: number): CrowdItem[] {
  const out: CrowdItem[] = [];
  const cr = (at: number, a: CrowdAction, len = 0) => out.push({ id: `tc${out.length + 1}`, at: +at.toFixed(3), do: a, ...(len ? { len } : {}) });
  const mood = (at: number, m: 'chatter' | 'cheer', level: number, len = 0) => cr(at, { do: 'crowd', mood: m, level }, len);
  const cheer = (at: number, level: number, len = 4) => cr(at, { do: 'cheer', level }, len);
  const lead = -TEMPLATE_LEAD, choruses = parts.filter((p) => p.kind === 'chorus');
  // waiting: chatting (a bar's a little louder, a church's hushed)
  mood(lead, 'chatter', kind === 'bar' ? 0.55 : kind === 'calm' ? 0.4 : 0.5);
  if (kind === 'concert' || kind === 'party') {
    // the music starts: a cheer, cheering that dies away into the first part
    cheer(-0.3, kind === 'concert' ? 1 : 0.7, 6); mood(-0.3, 'cheer', kind === 'concert' ? 0.8 : 0.55, 0.5); mood(4, 'cheer', 0, 8);
    // every chorus (a drop at the party) gets its cheer, the last one the biggest
    for (const p of choruses) { const big = p.lastChorus; cheer(p.at, big ? 0.9 : kind === 'party' ? 0.65 : 0.5, big ? 6 : 4); if (kind === 'party' || big) { mood(p.at, 'cheer', big ? 0.6 : 0.4, 0.5); mood(p.at + 6, 'cheer', 0, 6); } }
  } else if (kind === 'calm') {
    mood(-2, 'chatter', 0, 3);                      // (hushed as it starts)
  } else {
    // a bar: the chatting goes on under the music, someone cheers on a chorus
    mood(0, 'chatter', 0.4, 4);
    for (const p of choruses) cheer(p.at, p.lastChorus ? 0.5 : 0.3, 3);
  }
  // the end: cheering, then chatting as they get up
  const last = [...parts].reverse().find((p) => p.kind === 'outro');
  const end = Math.max(0, (last ? last.end : duration) - 0.5);
  cheer(end, kind === 'bar' ? 0.6 : 1, 6); mood(end, 'cheer', kind === 'bar' ? 0.5 : 0.8, 1); mood(end + 3, 'chatter', 0.4, 4);
  return out.sort((a, b) => a.at - b.at);
}

// the machines on the music: fog into the first part and the breaks, CO2 and the blinders as a
// chorus lands, confetti on the first and the last, sparks and flames on the last, a strobe hit
// into it, bubbles over a break; only the ones the show takes
function moments(hits: BurstAttr[]) {
  const can = (a: BurstAttr) => hits.includes(a);
  return (p: Part, c: Cuer) => {
    const { bar } = c;
    if (p.kind === 'intro' && p.n === 0 && can('fog')) c.burst(p.at, 'fog', 6);
    if (p.kind === 'build') {
      if (p.bars >= 3 && can('strobe')) c.burst(p.end - 2 * bar, 'strobe', 2 * bar - 0.2);
      if (can('co2')) c.burst(p.end - 0.5, 'co2', 0.5);
    }
    if (p.kind === 'chorus') {
      if (can('co2')) c.burst(p.at, 'co2', 1.5);
      if (can('blinder')) c.burst(p.at, 'blinder', 0.6);
      if ((p.n === 0 || p.lastChorus) && can('confetti')) c.burst(p.at, 'confetti', 1);
      if (p.lastChorus && can('sparks')) c.burst(p.at, 'sparks', Math.min(6, 2 * bar));
      if (p.lastChorus && can('flame')) for (let k = 0; k < Math.min(p.bars, 8); k += 2) c.burst(p.at + k * bar, 'flame', 0.4);
    }
    if (p.kind === 'solo' && can('sparks')) c.burst(p.at, 'sparks', Math.min(5, 2 * bar));
    if (p.kind === 'break') {
      if (can('fog')) c.burst(p.at, 'fog', 5);
      if (p.bars > 2 && can('bubbles')) c.burst(p.at + bar, 'bubbles', Math.min(20, (p.bars - 2) * bar));
    }
  };
}

// the show for a template's build: its looks cued to `song` (or the demo beat); null when the show
// hasn't the lists or looks it needs (a template changed without this)
export function templateTimeline(name: string, s: Show, song?: DemoSong): Timeline | null {
  const t = TEMPLATE_SHOWS[name];
  if (!t) return null;
  const list = s.cueLists.find((l) => l.name === t.list);
  if (!list) return null;
  const id = (cue: string) => list.cues.find((c) => c.name === cue)?.id;
  const names = new Set([...Object.values(t.sets).flat(2), ...t.lastChorus, t.end]);
  const looks: Record<string, string> = {};
  for (const n of names) { const c = id(n); if (!c) return null; looks[n] = c; }
  const haze = s.cueLists.find((l) => l.name === 'Haze');
  const tl = cueParts(song, {
    list: list.id, looks, sets: t.sets, lastChorus: t.lastChorus, end: t.end, moments: moments(t.hits),
    ...(haze?.cues[0] ? { haze: { list: haze.id, cue: haze.cues[0].id } } : {}),
  });
  // the house lights (the theatre's): out as it starts, half up again at the end
  const more: TimelineItem[] = [];
  for (const [at, pair, k] of [[0, t.start, 'hs'], [Math.max(0, tl.duration - 2), t.close, 'hc']] as const) {
    if (!pair) continue;
    const l = s.cueLists.find((x) => x.name === pair[0]), c = l?.cues.find((x) => x.name === pair[1]);
    if (l && c) more.push({ id: `ct${k}`, at, lane: `list:${l.id}`, do: { do: 'goto', list: l.id, cue: c.id } });
  }
  if (t.close) { const l = s.cueLists.find((x) => x.name === t.close![0]), c = l?.cues.find((x) => x.name === t.close![1]); if (l && c) more.push({ id: 'ctlead', at: -TEMPLATE_LEAD, lane: `list:${l.id}`, do: { do: 'goto', list: l.id, cue: c.id } }); }
  if (more.length) tl.items = [...tl.items, ...more].sort((a, b) => a.at - b.at);
  // the audience, waiting before the song and cheering after it
  tl.lead = TEMPLATE_LEAD; tl.tail = TEMPLATE_TAIL;
  tl.crowd = crowdTrack(t.crowd, partsOf(song).parts, tl.duration);
  return tl;
}

// a template as a show to play (the welcome's "Play the show", ui/startDemo.ts): its build with the
// show cued to the song
export function templatePlayable(name: string): { name: string; build: (song?: DemoSong) => Show } | undefined {
  const t = ALL_TEMPLATES.find((x) => x.name === name);
  if (!t || !TEMPLATE_SHOWS[name]) return undefined;
  return { name: t.name, build: (song) => { const s = t.build(); const tl = templateTimeline(t.name, s, song); if (tl) s.timeline = tl; return s; } };
}
