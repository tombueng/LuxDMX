// The templates' shows: every template with a show has its song in the catalog, and its looks cued
// to that song's parts (and to the demo beat without one): a look from the start, every cue it goes
// to one of the template's own, the machines it fires ones it has (and only those the room takes),
// the theatre's house lights out as it starts. The DJ / Party template is in the club.
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../timeline/catalog';
import { TEMPLATES } from './templates';
import { TEMPLATE_SHOWS, templatePlayable, templateTimeline } from './templateShows';

const song = (id: string) => CATALOG.find((s) => s.id === id)!;

describe('the templates play as shows', () => {
  it('every template has a show, on a song of the catalog', () => {
    for (const t of TEMPLATES) {
      expect(TEMPLATE_SHOWS[t.name], t.name).toBeTruthy();
      expect(song(TEMPLATE_SHOWS[t.name].song), t.name).toBeTruthy();
    }
  });
  for (const t of TEMPLATES) it(`${t.name}: its looks on its song's parts, and on the demo beat`, () => {
    for (const sg of [song(TEMPLATE_SHOWS[t.name].song), undefined]) {
      const s = t.build(), tl = templateTimeline(t.name, s, sg)!;
      expect(tl, t.name).toBeTruthy();
      expect(tl.duration).toBeGreaterThan(60);
      if (sg) { expect(tl.bpm).toBe(sg.bpm); expect(tl.sections?.length).toBe(sg.sections.length); } else expect(tl.demo).toBe(true);
      const cues = new Map(s.cueLists.flatMap((l) => l.cues.map((c) => [c.id, l.id] as const)));
      const gotos = tl.items.filter((i) => i.do.do === 'goto');
      expect(gotos.length).toBeGreaterThan(8);
      for (const i of gotos) { const a = i.do as { list: string; cue: string }; expect(cues.get(a.cue), `${t.name}: ${a.cue}`).toBe(a.list); }
      // a look from the first part on, and the show's end look near the end
      const main = s.cueLists.find((l) => l.name === TEMPLATE_SHOWS[t.name].list)!;
      const first = gotos.filter((i) => (i.do as { list: string }).list === main.id)[0];
      expect(first.at).toBeLessThan((sg?.sections[0].at ?? 0) + 0.5);
      for (const i of tl.items) { expect(i.at).toBeGreaterThanOrEqual(0); expect(i.at).toBeLessThanOrEqual(tl.duration); }
      // the machines: only the ones the show takes
      const fired = new Set(tl.items.filter((i) => i.do.do === 'burst').map((i) => (i.do as { attr: string }).attr));
      for (const a of fired) if (a !== 'blinder') expect(TEMPLATE_SHOWS[t.name].hits, `${t.name}: ${a}`).toContain(a);
    }
  });
  it('no CO2 or flames in the church; the theatre\'s house lights go out as it starts and come half up at the end', () => {
    const ch = templatePlayable('Church')!.build(song('walls-come-down'));
    expect(ch.timeline!.items.some((i) => i.do.do === 'burst' && ['co2', 'flame'].includes((i.do as { attr: string }).attr))).toBe(false);
    const th = templatePlayable('Theatre')!.build(song('everybody-on-your-block')), house = th.cueLists.find((l) => l.name === 'House lights')!;
    const hl = th.timeline!.items.filter((i) => i.lane === `list:${house.id}`);
    expect(hl.map((i) => house.cues.find((c) => c.id === (i.do as { cue: string }).cue)?.name)).toEqual(['House out', 'House half']);
    expect(hl[0].at).toBe(0);
  });
  it('the DJ / Party template is in the club, with the DJ', () => {
    const s = TEMPLATES.find((t) => t.name === 'DJ / Party')!.build();
    expect(s.settings.stage3d?.room).toBe('club');
    expect(s.fixtures.every((f) => !!f.p3)).toBe(true);
  });
  it('built to play, a template has its timeline; built to work on (Start), none', () => {
    expect(templatePlayable('Bar')!.build(song('light-me-on-fire')).timeline).toBeTruthy();
    expect(TEMPLATES.find((t) => t.name === 'Bar')!.build().timeline).toBeUndefined();
    expect(templatePlayable('Ring and matrix')).toBeUndefined();
  });
});
