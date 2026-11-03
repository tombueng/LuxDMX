// @vitest-environment happy-dom
// The camera crews (director.ts): in every room and every mode over a few minutes of a song that
// goes quiet, loud and drops, the camera stays inside the room, above the floor, out of the deck, the
// truss and the lights under it, the band, the DJ, the crowd and the gear, looks at the stage or the
// crowd, never NaN, and moves no faster than the real thing (a crane, a steadicam operator, a
// drone). Broadcast cuts only on bar lines and holds a shot 2 to 8 bars (shorter when it's loud, to
// the wide shot on a drop); Band cam cuts on the beat. The same inputs give the same pictures. The
// people and the crowd are where director.ts thinks they are (checked against the built rooms), and
// a frame costs well under a tenth of a millisecond.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { blocked, castOf, CAM_MODES, CROWDS, CREW, direct, holdFor, LENS, newMemory, partAt, spaceOf, WALK, type CamMode, type Cast, type Light3, type Music, type Part, type Shot } from './director';
import { DECK, ROOMS, defaultPlace, type Room, type RoomId, type V3 } from './geometry';
import { buildVenue, type Venue } from './venue';
import type { Stage } from './rooms';
import { DEMOS } from '../content/demos';
import { kindOf, modeOf, typeMap } from '../model/library';

const IDS = Object.keys(ROOMS) as RoomId[];
const MODES = CAM_MODES.map((m) => m.id).filter((m) => m !== 'tour') as Exclude<CamMode, 'tour'>[];
const FPS = 30, BPM = 126;
// how fast the real thing goes: m/s and degrees a second (Broadcast and Band cam within a shot)
const LIMIT: Record<Exclude<CamMode, 'tour'>, { v: number; w: number }> = {
  broadcast: { v: 1.0, w: 15 }, crane: { v: 2.5, w: 30 }, steadicam: { v: 1.5, w: 45 }, drone: { v: 12, w: 45 }, bandcam: { v: 0.2, w: 10 },
};
// a song of four minutes: quiet, building, loud with a drop, a break, and again (the lights' energy)
function energyAt(t: number) {
  const ph = (t % 120) / 120;
  return ph < 0.2 ? 0.12 : ph < 0.4 ? 0.4 + 0.3 * ((ph - 0.2) / 0.2) : ph < 0.65 ? 0.92 : ph < 0.8 ? 0.2 : 0.55;
}
const PARTS: Part[] = [{ name: 'Intro', at: 0, energy: 0.3 }, { name: 'Verse', at: 30.48, energy: 0.6 }, { name: 'Build', at: 53.33, energy: 0.7 }, { name: 'Drop', at: 68.57, energy: 0.95 },
  { name: 'Break', at: 99.05, energy: 0.35 }, { name: 'Chorus', at: 129.52, energy: 0.9 }, { name: 'Verse 2', at: 160, energy: 0.6 }, { name: 'Drop 2', at: 190.48, energy: 1 }, { name: 'Outro', at: 220.95, energy: 0.3 }];
interface Frame { t: number; beat: number; s: Shot }
function run(mode: CamMode, id: RoomId, o: { secs?: number; parts?: boolean; cast?: Cast; t0?: number; energy?: (t: number) => number } = {}) {
  const r = ROOMS[id], cast = o.cast ?? castOf(id), mem = newMemory(), out: Frame[] = [], t0 = o.t0 ?? 500;
  for (let i = 0; i < (o.secs ?? 240) * FPS; i++) {
    const t = t0 + i / FPS, song = i / FPS, beat = (song * BPM) / 60;
    const m: Music = { t, beat, energy: (o.energy ?? energyAt)(song), part: o.parts ? partAt(PARTS, song) : null };
    out.push({ t, beat, s: direct(mode, r, m, cast, mem) });
  }
  return { out, mem, r, cast };
}
const sub = (a: V3, b: V3) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a: V3) => Math.hypot(a.x, a.y, a.z);
const dirOf = (s: Shot) => { const d = sub(s.at, s.pos), l = len(d) || 1; return { x: d.x / l, y: d.y / l, z: d.z / l }; };
// a point's distance from a piece of truss
function segDist(p: V3, a: number[], b: number[]) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const k = Math.max(0, Math.min(1, ((p.x - a[0]) * ab[0] + (p.y - a[1]) * ab[1] + (p.z - a[2]) * ab[2]) / l2));
  return Math.hypot(p.x - a[0] - ab[0] * k, p.y - a[1] - ab[1] * k, p.z - a[2] - ab[2] * k);
}
// where the act is (the band's area, the DJ, the test truss and its machines) and where the crowd is
function onAction(r: Room, p: V3) {
  const b = r.band, crowd = CROWDS[r.id];
  // (the front of the stage and the pit in front of it count: the front rows are there)
  const act = Math.abs(p.x) <= b.x + 1.5 && p.z >= b.z0 - 1.5 && p.z <= b.z1 + 3 && p.y >= 0 && p.y <= 6;
  const people = !!crowd && p.z >= crowd.z0 - 1 && p.z <= crowd.z1 + 1 && Math.abs(p.x) <= crowd.half(p.z) + 1 && p.y <= 4;
  return act || people;
}

describe('every mode in every room', () => {
  for (const id of IDS) for (const mode of MODES) for (const parts of [false, true]) {
    it(`${mode} in the ${id}${parts ? ' (the timeline playing)' : ''}: inside, clear of everything, on the action, real speeds`, () => {
      const { out, mem, r } = run(mode, id, { parts });
      const sp = spaceOf(r, castOf(id)), w = r.walls;
      let vmax = 0, wmax = 0;
      out.forEach(({ s }, i) => {
        const where = `${s.cam} at ${i / FPS}s (${s.pos.x.toFixed(2)}, ${s.pos.y.toFixed(2)}, ${s.pos.z.toFixed(2)})`;
        expect([s.pos.x, s.pos.y, s.pos.z, s.at.x, s.at.y, s.at.z, s.fov, s.roll].every(Number.isFinite), where).toBe(true);
        expect(blocked(sp, s.pos), where).toBe('');
        // (and from the room's own numbers: inside the walls, under the ceiling, over the floor and the deck, off the truss)
        expect(Math.abs(s.pos.x) < w.x - 0.3 && s.pos.z > w.z0 + 0.3 && s.pos.z < w.z1 - 0.3 && s.pos.y < r.ceiling - 0.5 && s.pos.y > 1, where).toBe(true);
        if (Math.abs(s.pos.x) <= r.deck.x && s.pos.z >= r.deck.z0 && s.pos.z <= r.deck.z1) expect(s.pos.y, where).toBeGreaterThan(DECK + 0.5);
        for (const [a, b] of r.frame ?? []) expect(segDist(s.pos, a, b), where).toBeGreaterThan(0.4);
        // looking at the stage or the crowd, from a little way off, through a real lens
        expect(onAction(r, s.at), `${where} looks at (${s.at.x.toFixed(1)}, ${s.at.y.toFixed(1)}, ${s.at.z.toFixed(1)})`).toBe(true);
        expect(len(sub(s.at, s.pos)), where).toBeGreaterThan(0.6);
        expect(s.fov).toBeGreaterThanOrEqual(10); expect(s.fov).toBeLessThanOrEqual(55);
        expect(Math.abs(s.roll)).toBeLessThanOrEqual(8);
        if (i && !s.cut) {
          const p = out[i - 1].s, v = len(sub(s.pos, p.pos)) * FPS, d1 = dirOf(p), d2 = dirOf(s);
          const wv = (Math.acos(Math.min(1, d1.x * d2.x + d1.y * d2.y + d1.z * d2.z)) * 180) / Math.PI * FPS;
          vmax = Math.max(vmax, v); wmax = Math.max(wmax, wv);
        }
      });
      expect(vmax, 'm/s').toBeLessThan(LIMIT[mode].v);
      expect(wmax, '°/s').toBeLessThan(LIMIT[mode].w);
      // (the last resort never had to move it: every crew's places are clear by themselves)
      expect(mem.nudged).toBe(0);
    });
  }
});

describe('the modes move like their crews', () => {
  it('Crane, Steadicam and Drone never cut; they keep moving, smoothly (no jumps)', () => {
    for (const id of IDS) for (const mode of ['crane', 'steadicam', 'drone'] as const) {
      const { out } = run(mode, id, { secs: 120 });
      expect(out.filter((f) => f.s.cut).length).toBe(1);        // (the first frame)
      let still = 0;
      for (let i = 1; i < out.length; i++) { if (len(sub(out[i].s.pos, out[i - 1].s.pos)) < 1e-5) still++; }
      expect(still / out.length, `${mode} in the ${id}`).toBeLessThan(0.02);
    }
  });
  it('Crane: from over the crowd up to the stage and back, rising in between', () => {
    for (const id of IDS) {
      const c = CREW[id].crane, { out } = run('crane', id, { secs: c.period, t0: 0 });
      const near = (p: number[]) => Math.min(...out.map((f) => len(sub(f.s.pos, { x: p[0], y: p[1], z: p[2] }))));
      expect(near(c.a), id).toBeLessThan(0.05); expect(near(c.b), id).toBeLessThan(0.05);
      const mid = out[Math.round(out.length / 4)].s.pos;
      expect(mid.y, id).toBeGreaterThan((c.a[1] + c.b[1]) / 2);
    }
  });
  it('Steadicam: walks its way at a walking pace (up to 1.2 m/s), swaying, and comes back', () => {
    for (const id of IDS) {
      const { out } = run('steadicam', id, { secs: 90 });
      const way = CREW[id].walk.way, first = { x: way[0][0], z: way[0][1] }, last = { x: way.at(-1)![0], z: way.at(-1)![1] };
      const reach = (q: { x: number; z: number }) => Math.min(...out.map((f) => Math.hypot(f.s.pos.x - q.x, f.s.pos.z - q.z)));
      expect(reach(first), id).toBeLessThan(0.1); expect(reach(last), id).toBeLessThan(0.1);
      expect(Math.max(...out.map((f) => Math.abs(f.s.roll)))).toBeGreaterThan(0.3);
      expect(Math.max(...out.slice(1).map((f, i) => len(sub(f.s.pos, out[i].s.pos)) * FPS))).toBeLessThan(WALK + 0.1);
    }
  });
  it('Drone: dives in on a drop (closer to the stage and lower), pulls out when it\'s quiet', () => {
    for (const id of IDS) {
      const { out, r } = run('drone', id, { parts: true, t0: 0, secs: 130 });
      const at = (sec: number) => out[Math.round(sec * FPS)].s.pos, dist = (p: V3) => Math.hypot(p.x, p.z - (r.band.z0 + r.band.z1) / 2);
      // (Intro: out; 12 s into the drop: in; 25 s into the break: out again)
      const intro = at(25), drop = at(81), brk = at(124 - 1);
      expect(dist(drop), id).toBeLessThan(dist(intro) - 2);
      expect(drop.y, id).toBeLessThan(intro.y);
      expect(dist(brk), id).toBeGreaterThan(dist(drop) + 1);
    }
  });
});

describe('Broadcast: a live TV director', () => {
  for (const parts of [false, true]) it(`cuts only on bar lines, holds 2 to 8 bars, faster when loud${parts ? ' (song parts)' : ''}`, () => {
    for (const id of IDS) {
      const { out } = run('broadcast', id, { parts });
      const cuts = out.filter((f) => f.s.cut);
      expect(cuts.length).toBeGreaterThan(20);
      const step = BPM / 60 / FPS;
      for (const c of cuts.slice(1)) expect(c.beat % 4, `cut at beat ${c.beat}`).toBeLessThan(step + 1e-9);
      const bars = cuts.map((c) => Math.floor(c.beat / 4)), holds = bars.slice(1).map((b, i) => b - bars[i]);
      for (const h of holds) { expect(h).toBeGreaterThanOrEqual(2); expect(h).toBeLessThanOrEqual(8); }
      // (the quiet stretch's shots last longer than the loud stretch's)
      const during = (a: number, b: number) => { const k = holds.filter((_, i) => { const s = (cuts[i].t - 500) % 120; return s >= a && s < b; }); return k.reduce((x, y) => x + y, 0) / Math.max(1, k.length); };
      expect(during(0, 24), id).toBeGreaterThan(during(48, 78) + 1.5);
      // more than four cameras in use, never the same one twice in a row
      const names = cuts.map((c) => c.s.cam.startsWith('close') ? 'close' : c.s.cam);
      expect(new Set(names).size).toBeGreaterThanOrEqual(5);
      for (let i = 1; i < names.length; i++) expect(names[i] === names[i - 1] && names[i] !== 'close', `${names[i]} twice`).toBe(false);
    }
  });
  it('goes to the wide shot on a drop: at its first bar line with the song\'s parts, the bar after without', () => {
    for (const id of IDS) for (const parts of [true, false]) {
      const { out } = run('broadcast', id, { parts, t0: 0, secs: 100 });
      // (the drop: the part starts at 68.57 s, the lights hit hard from 48 s)
      const from = parts ? 68.57 : 48;
      const first = out.find((f) => f.s.cut && f.t >= from - 1e-6);
      expect(first, `${id} ${parts}`).toBeTruthy();
      expect(['wide', 'high'], `${id} ${parts}: ${first!.s.cam}`).toContain(first!.s.cam);
      expect(first!.t - from, `${id} ${parts}`).toBeLessThan((parts ? 3 : 5) * 4 * 60 / BPM);
    }
  });
  it('mostly the whole stage from out front, from different angles: the band close up (or from the side of the stage) for under a fifth of the time', () => {
    for (const id of IDS) {
      const { out } = run('broadcast', id, { secs: 600 });
      const share = (f: (cam: string) => boolean) => out.filter((x) => f(x.s.cam)).length / out.length;
      expect(share((c) => c.startsWith('close') || c === 'left' || c === 'right'), id).toBeLessThan(0.2);
      expect(share((c) => ['wide', 'high', 'frontL', 'frontR', 'crowd'].includes(c)), id).toBeGreaterThan(0.6);
      expect(share((c) => c === 'frontL') > 0 && share((c) => c === 'frontR') > 0, id).toBe(true);
    }
  });
  it('each camera moves a little in its shot: pans, pushes, a handheld\'s shake', () => {
    const { out } = run('broadcast', 'hall', { secs: 120 });
    let moving = 0, frames = 0;
    for (let i = 1; i < out.length; i++) if (!out[i].s.cut) { frames++; if (len(sub(out[i].s.pos, out[i - 1].s.pos)) > 1e-4 || len(sub(out[i].s.at, out[i - 1].s.at)) > 1e-4 || out[i].s.fov !== out[i - 1].s.fov) moving++; }
    expect(moving / frames).toBeGreaterThan(0.95);
  });
  it('a shot\'s hold: 8 bars when quiet down to 2 when loud', () => {
    for (let b = 0; b < 50; b++) { expect(holdFor(0, b)).toBeGreaterThanOrEqual(7); expect(holdFor(1, b)).toBeLessThanOrEqual(3); }
  });
});

describe('Band cam: close shots cut on the beat', () => {
  it('cuts on beats, holds 2 to 8 beats, goes round the people on stage (or the DJ and the crowd, or the lights)', () => {
    const lights: Light3[] = ['spot', 'spot', 'wash', 'wash', 'par', 'par'].map((kind, i) => ({ kind, p: { x: -5.5 + i, y: 3.65, z: 1.5 } }));
    for (const id of IDS) {
      const { out } = run('bandcam', id, { cast: castOf(id, id === 'truss' ? lights : []) });
      const cuts = out.filter((f) => f.s.cut), step = BPM / 60 / FPS;
      for (const c of cuts.slice(1)) expect(c.beat % 1).toBeLessThan(step + 1e-9);
      const beats = cuts.map((c) => Math.floor(c.beat)), holds = beats.slice(1).map((b, i) => b - beats[i]);
      for (const h of holds) { expect(h).toBeGreaterThanOrEqual(2); expect(h).toBeLessThanOrEqual(8); }
      const seen = new Set(cuts.map((c) => c.s.cam));
      const want = id === 'hall' || id === 'pub' ? ['the singer', 'the guitar', 'the drums', 'the bass', 'the keys'] : id === 'truss' ? ['spot', 'wash', 'par'] : ['the DJ\'s hands', 'the DJ', 'the crowd'];
      for (const w of want) expect(seen.has(w), `${id}: ${w}`).toBe(true);
      // close up: a few metres at most from what it shows (the crowd shot: across the floor)
      for (const f of out) if (f.s.cam !== 'the crowd' && !f.s.cam.startsWith('over')) expect(len(sub(f.s.at, f.s.pos)), f.s.cam).toBeLessThan(3.2);
    }
  });
  it('in the test truss: every kind of light in turn, on the room\'s real lights', () => {
    const s = DEMOS.find((d) => d.id === 'truss')!.build(), types = typeMap(s), r = ROOMS.truss;
    const lights: Light3[] = s.fixtures.map((f) => { const k = kindOf(modeOf(types.get(f.typeId), f.mode)); return { kind: f.typeId, p: f.p3 ?? defaultPlace(f, k, r).p }; });
    const { out, mem } = run('bandcam', 'truss', { cast: castOf('truss', lights), secs: 200 });
    const kinds = new Set(lights.map((l) => l.kind)), seen = new Set(out.filter((f) => f.s.cut).map((f) => f.s.cam));
    expect(seen.size).toBe(kinds.size);
    expect(mem.nudged).toBe(0);
  });
});

it('the same inputs give the same pictures (a take records what you see)', () => {
  for (const mode of MODES) for (const id of ['hall', 'club'] as const) {
    const a = run(mode, id, { secs: 40, parts: true }).out, b = run(mode, id, { secs: 40, parts: true }).out;
    expect(b.map((f) => f.s)).toEqual(a.map((f) => f.s));
  }
});
it('Tour is the old tour; every mode\'s lens is against the normal one', () => {
  const { out } = run('tour', 'hall', { secs: 2 });
  expect(out[0].s.fov).toBe(LENS);
  expect(CAM_MODES.map((m) => m.name)).toEqual(['Tour', 'Broadcast', 'Crane', 'Steadicam', 'Drone', 'Band cam']);
});

// ---- the venues as built: the people and the crowd are where the crews think they are
describe('the cast and the crowd match the built rooms', () => {
  const world = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
  const near = (a: THREE.Vector3, b: V3, what: string) => expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), what).toBeLessThan(0.08);
  for (const id of ['hall', 'pub'] as const) it(`the band in the ${id}`, () => {
    const v = buildVenue({ room: id, crowd: 30 }) as Venue, c = castOf(id);
    v.group.updateMatrixWorld(true);
    const at = (w: string) => c.people.find((p) => p.who === w)!.at;
    const drummer = v.drums.p, singer = v.mics.find((m) => m.person && v.band.indexOf(m.person) === 1)!.person!;
    near(world(drummer.group), { ...at('drums'), z: at('drums').z - 0.65 }, 'drummer');
    near(world(singer.group), at('singer'), 'singer');
    near(world(v.strummers.find((s) => !s.bass)!.p.group), at('guitar'), 'guitar');
    near(world(v.strummers.find((s) => s.bass)!.p.group), at('bass'), 'bass');
    near(world(v.band[4].group), at('keys'), 'keys');
  });
  for (const id of ['club', 'party'] as const) it(`the DJ in the ${id}`, () => {
    const v = buildVenue({ room: id, crowd: 30 }) as Stage, c = castOf(id);
    v.group.updateMatrixWorld(true);
    near(world(v.dj!.p.group), c.people[0].at, 'DJ'); near(world(v.dj!.booth), c.booth!, 'booth');
  });
  for (const id of ['hall', 'pub', 'club', 'party'] as const) it(`the crowd in the ${id}: inside its area, under its heads-and-hands height, jumping`, () => {
    const v = buildVenue({ room: id, crowd: id === 'hall' ? 420 : id === 'pub' ? 40 : 240 }) as Stage, a = CROWDS[id]!, crowd = v.crowd!;
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    for (let i = 0; i < crowd.count; i++) {
      p.setFromMatrixPosition(crowd.frame(i));
      expect(p.z).toBeGreaterThan(a.z0 - 0.3); expect(p.z).toBeLessThan(a.z1 + 0.3); expect(Math.abs(p.x)).toBeLessThan(a.half(p.z) + 0.3);
    }
    // the highest point of anyone (arms up, flags, on shoulders), at the top of a jump
    for (const [name, mesh] of crowd.parts) {
      const g = mesh.geometry, jump = g.attributes.aJump as THREE.InstancedBufferAttribute | undefined;
      const tops = ['position', 'aPos2'].map((k) => g.attributes[k]).filter(Boolean).map((at) => { let y = -Infinity; for (let i = 0; i < at.count; i++) y = Math.max(y, at.getY(i)); return y; });
      const local = Math.max(...tops);
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m); p.setFromMatrixPosition(m);
        const top = new THREE.Vector3(0, local, 0).applyMatrix4(m).y + (jump ? jump.getX(i) : 0);
        const lim = a.high && p.z > a.high[0] - 0.4 && p.z < a.high[1] + 0.4 ? a.high[2] : a.top;
        expect(top, `${id} ${name} ${i} at z ${p.z.toFixed(1)}`).toBeLessThan(lim + 0.15);
      }
    }
  });
});

it('costs well under a tenth of a millisecond a frame (the hall and the pub)', () => {
  for (const id of ['hall', 'pub'] as const) for (const mode of MODES) {
    const cast = castOf(id), mem = newMemory(), r = ROOMS[id], n = 6000;
    for (let i = 0; i < 600; i++) direct(mode, r, { t: i / 60, beat: i / 30, energy: 0.5 }, cast, mem);
    const t0 = performance.now();
    for (let i = 600; i < 600 + n; i++) direct(mode, r, { t: i / 60, beat: i / 30, energy: (i % 300) / 300 }, cast, mem);
    const ms = (performance.now() - t0) / n;
    expect(ms, `${mode} in the ${id}: ${(ms * 1000).toFixed(1)} µs`).toBeLessThan(0.05);
  }
});
