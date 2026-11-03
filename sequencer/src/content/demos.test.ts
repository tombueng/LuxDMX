// @vitest-environment happy-dom
// The demos: the festival first, then the club, the party and the test truss. Each new one builds,
// validates against the schema and loads back, fits its universes without sharing a channel, names
// only what's there, fires its machines only from their one-shots (which end by themselves), has a
// button per machine on the live page, and every light sits somewhere real in its room: on a piece
// of its truss, on its deck or on its floor. Their timelines point at real things inside the song;
// the club's drops get CO2, a strobe hit and the blinders and its breaks fog; the test truss has
// two of each kind and a cue for each.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { DEMOS, demoById } from './demos';
import { buildDemo, partKind } from './demo';
import { buildTrussTest, TRUSS_KINDS, TRUSS_MACHINES } from './trussTest';
import { buskingPage, isMachineList } from './busking';
import { CATALOG } from '../timeline/catalog';
import { DEMO_SECONDS } from '../timeline/beat';
import { parseShow, serializeShow } from '../model/format';
import { capsOf, kindOf, modeOf, typeMap } from '../model/library';
import { EFFECT_MAP } from '../engine/effects';
import { DECK, DJ_BOOTH, onDeck, roomOf, toWorld, type Room, type Seg, type V3 } from '../stage3d/geometry';
import type { Fixture, Show } from '../model/types';

const MACHINES = ['confetti', 'co2', 'sparks', 'flame', 'bubbles'] as const;
const schema = JSON.parse(fs.readFileSync('schema/luxdmx-show.schema.json', 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const attrsOf = (s: Show, f: Fixture) => modeOf(typeMap(s).get(f.typeId), f.mode)!.channels.map((c) => c.attr);
const kindIn = (s: Show, f: Fixture) => kindOf(modeOf(typeMap(s).get(f.typeId), f.mode));
const cellsOf = (s: Show, f: Fixture) => capsOf(modeOf(typeMap(s).get(f.typeId), f.mode)).cells;
const songOf = (id?: string) => CATALOG.find((x) => x.id === id);

// the shortest way from p to a piece of truss (its middle line)
function toSeg(p: V3, [a, b]: Seg) {
  const d = { x: b[0] - a[0], y: b[1] - a[1], z: b[2] - a[2] }, L2 = d.x * d.x + d.y * d.y + d.z * d.z;
  const k = Math.max(0, Math.min(1, ((p.x - a[0]) * d.x + (p.y - a[1]) * d.y + (p.z - a[2]) * d.z) / L2));
  return Math.hypot(p.x - a[0] - d.x * k, p.y - a[1] - d.y * k, p.z - a[2] - d.z * k);
}
// Where a light rests: on a piece of truss (within a clamp's reach of its middle line), on the deck
// (its top, or its front face), or on the floor inside the walls. A bar or a strip may rest on
// either end or its middle (a strip stood up on the deck rests on its lower end).
function restsOn(f: Fixture, cells: number, r: Room): string | undefined {
  const p = f.p3!, L = cells > 24 ? cells / 30 : 1, ax = toWorld({ x: L / 2, y: 0, z: 0 }, f.rot!);
  const pts = cells > 1 ? [p, { x: p.x + ax.x, y: p.y + ax.y, z: p.z + ax.z }, { x: p.x - ax.x, y: p.y - ax.y, z: p.z - ax.z }] : [p];
  for (const q of pts) {
    if ((r.frame ?? []).some((s) => toSeg(q, s) < 0.6)) return 'truss';
    if (Math.abs(q.y - DECK) < 0.15 && onDeck(q.x, q.z, r)) return 'deck';
    if (r.deck.x > 0 && Math.abs(q.z - r.deck.z1) < 0.1 && q.y > 0 && q.y < DECK && Math.abs(q.x) <= r.deck.x) return 'deck front';
    if (q.y >= 0 && q.y < 0.15 && Math.abs(q.x) < r.walls.x && q.z > r.walls.z0 && q.z < r.walls.z1 && !onDeck(q.x, q.z, r)) return 'floor';
  }
  return undefined;
}

describe('the list of demos', () => {
  it('the festival first (the big demo on its metal song), then the club, the party and the test truss', () => {
    expect(DEMOS.map((d) => d.id)).toEqual(['festival', 'club', 'party', 'truss']);
    // (the same show as the big demo's, apart from when it was made)
    const same = (x: Show) => ({ ...x, meta: { ...x.meta, created: '', modified: '' } });
    expect(same(DEMOS[0].build())).toEqual(same(buildDemo()));
    expect(DEMOS.map((d) => d.room)).toEqual(['hall', 'club', 'party', 'truss']);
    for (const d of DEMOS) {
      expect(d.name.length).toBeGreaterThan(3); expect(d.blurb.length).toBeGreaterThan(20); expect(d.blurb).not.toMatch(/\u2014/);
      if (d.song) expect(songOf(d.song), d.song).toBeDefined();
      expect(roomOf(d.room).id).toBe(d.room);
    }
    expect(songOf(demoById('club')!.song)!.genre).toBe('techno');
    expect(['house', 'pop']).toContain(songOf(demoById('party')!.song)!.genre);
  });
});

for (const d of DEMOS.filter((x) => x.id !== 'festival')) {
  describe(d.name, () => {
    const song = songOf(d.song), s = d.build(song), beat = d.build(), r = roomOf(d.room);
    it('is in its own room', () => expect(s.settings.stage3d?.room).toBe(d.room));
    it('validates against the published schema, and loads back the same', () => {
      for (const x of [s, beat]) {
        const ok = validate(JSON.parse(serializeShow(JSON.parse(JSON.stringify(x)))));
        expect(ok ? [] : validate.errors!.map((e) => `${e.instancePath} ${e.message}`)).toEqual([]);
        const back = parseShow(serializeShow(JSON.parse(JSON.stringify(x))));
        expect(back.fixtures).toEqual(x.fixtures); expect(back.cueLists).toEqual(x.cueLists); expect(back.effects).toEqual(x.effects);
      }
    });
    it('every light fits its universe and shares no channel; names are unique', () => {
      const used = new Map<string, string>();
      for (const f of s.fixtures) {
        const n = modeOf(typeMap(s).get(f.typeId), f.mode)!.channels.length;
        expect(f.address, f.name).toBeGreaterThanOrEqual(1);
        expect(f.address + n - 1, f.name).toBeLessThanOrEqual(512);
        for (let c = 0; c < n; c++) { const k = `${f.universe}.${f.address + c}`; expect(used.get(k), `${f.name} on ${k}`).toBeUndefined(); used.set(k, f.name); }
        expect(f.x).toBeGreaterThanOrEqual(0); expect(f.x).toBeLessThanOrEqual(1); expect(f.y).toBeGreaterThanOrEqual(0); expect(f.y).toBeLessThanOrEqual(1);
      }
      expect(new Set(s.fixtures.map((f) => f.name)).size).toBe(s.fixtures.length);
      expect(new Set(s.fixtures.map((f) => f.universe)).size).toBeLessThan(24);
    });
    it('everything named is there, and every effect is a known one', () => {
      const ids = new Set(s.fixtures.map((f) => f.id)), fx = new Set(s.effects.map((e) => e.id)), lists = new Set(s.cueLists.map((l) => l.id));
      for (const g of s.groups) { expect(g.fixtures.length, g.name).toBeGreaterThan(0); for (const id of g.fixtures) expect(ids.has(id), g.name).toBe(true); }
      for (const e of s.effects) { expect(s.groups.some((g) => g.id === e.group), e.name).toBe(true); expect(EFFECT_MAP.has(e.kind), `${e.name}: ${e.kind}`).toBe(true); }
      for (const l of s.cueLists) for (const c of l.cues) {
        for (const id of Object.keys(c.values)) expect(ids.has(id), `${l.name} / ${c.name}`).toBe(true);
        for (const id of c.effects ?? []) expect(fx.has(id), `${l.name} / ${c.name}`).toBe(true);
        for (const a of c.actions ?? []) if ('list' in a) expect(lists.has(a.list), `${l.name} / ${c.name}`).toBe(true);
        // a cue's pan, tilt, zoom, gobo or machine only goes to a light that has one
        for (const [id, v] of Object.entries(c.values)) for (const k of ['pan', 'tilt', 'zoom', 'gobo', 'prism', 'strobe', ...MACHINES, 'fog', 'haze'] as const)
          if (v[k] !== undefined && (v[k] as number) > 0) expect(attrsOf(s, s.fixtures.find((f) => f.id === id)!), `${c.name}: ${k}`).toContain(k);
      }
    });
    it('the machines only fire from their one-shots, which end by themselves; the live page has a button for each, and the fog', () => {
      for (const m of MACHINES) {
        const has = s.fixtures.filter((f) => attrsOf(s, f).includes(m));
        const l = s.cueLists.find((x) => isMachineList(x) && x.cues.some((c) => Object.values(c.values).some((v) => (v[m] as number) > 0)));
        if (!has.length) { expect(l, m).toBeUndefined(); continue; }
        expect(l!.end).toBe('release'); expect(l!.cues).toHaveLength(1);
        expect(l!.cues[0].advance.mode).toBe('wait'); expect((l!.cues[0].advance as { time: number }).time).toBeLessThanOrEqual(30);
      }
      for (const l of s.cueLists.filter((x) => !isMachineList(x))) for (const c of l.cues) for (const v of Object.values(c.values))
        for (const m of [...MACHINES, 'fog'] as const) if ((v[m] as number) > 0) expect(c.advance.mode, `${l.name} / ${c.name}`).toBe('wait');
      const w = buskingPage(s).widgets, kinds = MACHINES.filter((m) => s.fixtures.some((f) => attrsOf(s, f).includes(m)));
      expect(w.filter((x) => x.type === 'list' && x.id.startsWith('sfx-'))).toHaveLength(kinds.length);
      expect(w.some((x) => x.type === 'fog')).toBe(true);
      expect(w.some((x) => x.type === 'special' && x.do === 'blinder')).toBe(true);
    });
    it('every light has its place in the room: on the truss, on the deck or on the floor', () => {
      const bad = s.fixtures.filter((f) => !f.p3 || !f.rot || !restsOn(f, cellsOf(s, f), r)).map((f) => `${f.name} at ${JSON.stringify(f.p3)}`);
      expect(bad).toEqual([]);
      for (const f of s.fixtures) {
        for (const v of [f.p3!.x, f.p3!.y, f.p3!.z, f.rot!.yaw, f.rot!.pitch, f.rot!.roll]) expect(Number.isFinite(v), f.name).toBe(true);
        expect(Math.abs(f.p3!.x), f.name).toBeLessThan(r.walls.x); expect(f.p3!.y).toBeLessThan(r.ceiling - 0.5);
        expect(f.p3!.z).toBeGreaterThan(r.walls.z0); expect(f.p3!.z).toBeLessThan(r.walls.z1);
      }
    });
    it('everything on the timeline is real and inside the song; every part gets a look', () => {
      for (const [x, t] of [[s, s.timeline!], [beat, beat.timeline!]] as const) {
        expect(t.items.length).toBeGreaterThan(10);
        for (const i of t.items) {
          expect(i.at).toBeGreaterThanOrEqual(0); expect(i.at + (i.len ?? 0)).toBeLessThanOrEqual(t.duration + 1e-6);
          const a = i.do;
          if (a.do === 'goto') expect(x.cueLists.find((l) => l.id === a.list)?.cues.some((c) => c.id === a.cue), JSON.stringify(a)).toBe(true);
          if (a.do === 'release') expect(x.cueLists.some((l) => l.id === a.list)).toBe(true);
          if (a.do === 'effect') expect(x.effects.some((e) => e.id === a.effect)).toBe(true);
          if (a.do === 'burst') { expect(a.seconds).toBeGreaterThan(0); expect(a.seconds).toBeLessThanOrEqual(30); }
        }
      }
      expect(beat.timeline!.demo).toBe(true); expect(beat.timeline!.duration).toBeCloseTo(DEMO_SECONDS, 3);
      if (song) {
        const t = s.timeline!;
        expect(t.demo).toBeUndefined(); expect(t.duration).toBe(song.duration); expect(t.bpm).toBe(song.bpm); expect(t.offset).toBe(song.offset);
        expect(t.sections!.map((x) => x.name)).toEqual(song.sections.map((x) => x.name));
        const L = s.cueLists[0];
        song.sections.forEach((p, i, a) => {
          const end = i + 1 < a.length ? a[i + 1].at : song.duration;
          expect(t.items.some((x) => x.do.do === 'goto' && x.do.list === L.id && x.at >= p.at - 1e-6 && x.at < end), p.name).toBe(true);
        });
      }
    });
  });
}

describe('the club', () => {
  const song = songOf('in-peace')!, s = demoById('club')!.build(song), t = s.timeline!;
  const at = (attr: string) => t.items.filter((i) => i.do.do === 'burst' && i.do.attr === attr).map((i) => i.at);
  const of = (re: RegExp) => s.fixtures.filter((f) => re.test(f.name));
  it('twenty moving heads, spots and washes, on the trusses and on the deck', () => {
    const heads = s.fixtures.filter((f) => kindIn(s, f) === 'mover');
    expect(heads).toHaveLength(20);
    expect(heads.filter((f) => f.typeId === 'gen-spotgobo').length).toBeGreaterThanOrEqual(8);
    expect(heads.filter((f) => f.typeId === 'gen-wash').length).toBeGreaterThanOrEqual(8);
    const where = heads.map((f) => restsOn(f, 1, roomOf('club')));
    expect(where.filter((w) => w === 'truss').length).toBeGreaterThanOrEqual(10); expect(where.filter((w) => w === 'deck').length).toBeGreaterThanOrEqual(6);
  });
  it('LEDs all round the stage: a pixel wall, strips up the towers and along the truss, a line along the deck edge, LED bars', () => {
    expect(of(/^Wall strip/)).toHaveLength(16); expect(of(/^Tower strip/)).toHaveLength(4); expect(of(/^Header/)).toHaveLength(2); expect(of(/^Edge/)).toHaveLength(6);
    expect(of(/bar \d+$/).length).toBeGreaterThanOrEqual(12);
    for (const f of of(/^Edge/)) expect(restsOn(f, 60, roomOf('club'))).toBe('deck front');
  });
  it('the fog machines stand behind the booth and blow past the DJ', () => {
    const dj = DJ_BOOTH.club!;
    for (const f of of(/^Fog/)) {
      expect(f.p3!.z).toBeLessThan(dj.dj.z); expect(Math.abs(f.p3!.x - dj.dj.x)).toBeLessThan(1.2);
      const blow = toWorld({ x: 0, y: 0, z: 1 }, f.rot!);
      expect(blow.z).toBeGreaterThan(0.95);
    }
  });
  it('the drops get CO2, a strobe hit and the blinders; the builds a strobe and CO2 into the drop; the breaks fog', () => {
    const parts = song.sections.map((p, i, a) => ({ ...p, end: i + 1 < a.length ? a[i + 1].at : song.duration, kind: partKind(p.name, p.energy) }));
    const near = (ts: number[], x: number) => ts.some((y) => Math.abs(y - x) < 1e-6);
    for (const p of parts.filter((x) => x.kind === 'chorus')) for (const a of ['co2', 'strobe', 'blinder']) expect(near(at(a), p.at), `${p.name}: ${a}`).toBe(true);
    for (const p of parts.filter((x) => x.kind === 'break')) expect(near(at('fog'), p.at), p.name).toBe(true);
    for (const p of parts.filter((x) => x.kind === 'build')) expect(near(at('co2'), p.end - 0.5), p.name).toBe(true);
    expect(at('confetti').length).toBeGreaterThanOrEqual(2);
  });
});

describe('the party', () => {
  const s = demoById('party')!.build(songOf(demoById('party')!.song)), r = roomOf('party');
  it('no stage; twenty moving heads all round the square of truss and at its legs', () => {
    expect(r.deck.x).toBeLessThan(0);
    const heads = s.fixtures.filter((f) => kindIn(s, f) === 'mover');
    expect(heads).toHaveLength(20);
    // on all four sides of the square (and on the floor at the legs)
    const sides = new Set<string>(heads.map((f) => (Math.abs(f.p3!.x) > 5.5 ? (f.p3!.x < 0 ? 'left' : 'right') : f.p3!.z < 3 ? 'front' : f.p3!.z > 12 ? 'back' : 'middle')));
    for (const side of ['left', 'right', 'front', 'back']) expect(sides.has(side), side).toBe(true);
    expect(heads.filter((f) => restsOn(f, 1, r) === 'truss').length).toBeGreaterThanOrEqual(16);
  });
  it('strips round the square, LED bars on the legs', () => {
    expect(s.fixtures.filter((f) => f.name.startsWith('Ring strip'))).toHaveLength(8);
    expect(s.fixtures.filter((f) => f.name.startsWith('Leg bar'))).toHaveLength(8);
  });
});

describe('the test truss', () => {
  const s = buildTrussTest(), r = roomOf('truss');
  // what the 3D stage draws each as
  const look = (f: Fixture) => {
    const k = kindIn(s, f), t = typeMap(s).get(f.typeId)!;
    if (k === 'bar') return cellsOf(s, f) > 24 ? 'strip' : 'bar';
    if (k === 'mover') return /wash/i.test(t.model) ? 'wash' : 'spot';
    if (k === 'dimmer') return /blinder/i.test(t.model) ? 'blinder' : 'fresnel';
    if (k === 'fog') return attrsOf(s, f).includes('haze') ? 'hazer' : 'fog';
    if (k === 'sfx') return attrsOf(s, f).find((a) => (MACHINES as readonly string[]).includes(a))!;
    return k;
  };
  it('two of each kind of light on the one truss, two of each machine on the floor in front', () => {
    const count = new Map<string, number>();
    for (const f of s.fixtures) count.set(look(f), (count.get(look(f)) ?? 0) + 1);
    for (const k of [...TRUSS_KINDS, ...TRUSS_MACHINES]) expect(count.get(k), k).toBe(2);
    expect(s.fixtures).toHaveLength((TRUSS_KINDS.length + TRUSS_MACHINES.length) * 2);
    for (const f of s.fixtures) expect(restsOn(f, cellsOf(s, f), r), f.name).toBe(TRUSS_MACHINES.includes(look(f) as never) ? 'floor' : 'truss');
    expect(new Set(s.fixtures.map((f) => f.universe))).toEqual(new Set([0, 1]));
  });
  it('a cue that tests each kind, named for it; a chase round them all; a button per machine', () => {
    const L = s.cueLists[0], names = L.cues.map((c) => c.name);
    for (const k of ['Spots', 'Washes', 'PARs', 'LED bars', 'Pixel strips', 'Strobes', 'Blinders', 'Fresnels', 'Fog', 'Hazers', 'Confetti', 'Flames', 'Sparks', 'CO2', 'Bubbles'])
      expect(names.some((n) => n.startsWith(`${k}:`)), k).toBe(true);
    expect(names).toContain('Spots: pan and tilt'); expect(names).toContain('Washes: colour');
    const chase = s.cueLists.find((l) => l.name === 'Chase')!;
    expect(chase.end).toBe('loop'); expect(chase.cues.length).toBe(8);
    for (const c of chase.cues) expect(c.advance).toEqual({ mode: 'wait', time: 0.5 });
    const w = buskingPage(s).widgets;
    expect(w.filter((x) => x.type === 'list' && x.id.startsWith('sfx-')).map((x) => s.cueLists.find((l) => x.type === 'list' && l.id === x.list)!.name))
      .toEqual(['Confetti', 'CO2', 'Sparks', 'Flames', 'Bubbles']);
    for (const n of ['Haze', 'Fog shot']) expect(w.some((x) => x.type === 'list' && s.cueLists.find((l) => l.id === x.list)?.name === n), n).toBe(true);
    // the machine cues fire their one-shot (never the machine itself)
    for (const c of L.cues.filter((x) => x.actions?.length)) for (const a of c.actions!) if (a.do === 'start') expect(isMachineList(s.cueLists.find((l) => l.id === a.list)!) || ['Haze', 'Fog shot'].includes(s.cueLists.find((l) => l.id === a.list)!.name)).toBe(true);
  });
  it('a little show on the demo beat: through the test list, then the chase', () => {
    const t = s.timeline!, L = s.cueLists[0], chase = s.cueLists.find((l) => l.name === 'Chase')!;
    expect(t.demo).toBe(true);
    const gotos = t.items.filter((i) => i.do.do === 'goto' && i.do.list === L.id);
    expect(gotos.length).toBeGreaterThanOrEqual(20);
    expect(t.items.some((i) => i.do.do === 'goto' && i.do.list === chase.id)).toBe(true);
  });
});
