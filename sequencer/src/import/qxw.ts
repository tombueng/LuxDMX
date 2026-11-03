// QLC+ workspace (.qxw) -> a show. What comes over:
//   - fixtures: library fixtures through the QLC+ library (same definitions QLC+ uses), "Generic"
//     dimmer packs split into single dimmers, anything else as raw channels
//   - fixture groups -> groups
//   - scenes -> cues in a "Scenes" list (one per scene, GO-able, and buttons on the live page)
//   - chasers and sequences -> cue lists with their fades, holds, order and direction
//   - EFX -> move effects (circle, eight, line...) on their fixtures
//   - collections -> a list with one cue that sets the scenes and starts the chasers and EFX
// Channel values become colours, intensities and positions where the fixture says what a channel
// is, raw DMX otherwise. What doesn't come over (RGB matrices, shows, scripts, audio, the virtual
// console) is listed in the report.
//
// Format details from QLC+'s engine sources (scene.cpp, chaser.cpp, chaserstep.cpp, efx.cpp):
// times are milliseconds, 4294967294 means "forever", fixture addresses are 0-based, scene values
// are "channel,value,channel,value", sequence steps "fixture:channel,value,...:fixture:...".
import type { Color, Cue, CueList, Effect, Fixture, FixtureMode, FixtureType, Group, Show, Values } from '../model/types';
import { emptyShow } from '../model/format';
import { GENERIC } from '../model/library';
import { kid, kids, num, parseXml, text } from './xml';

const FOREVER = 4294967294;
// QLC+'s own generic fixtures that are the same as built-in generic types here.
export const QLC_GENERIC: [string, string, string][] = [   // [QLC+ model, QLC+ mode, our type]
  ['Generic RGB', 'RGB', 'gen-rgb'], ['Generic RGB', 'Dimmer RGB', 'gen-drgb'], ['Generic RGB', 'RGB Dimmer', 'gen-rgbd'],
  ['Generic RGBW', 'RGBW', 'gen-rgbw'], ['Generic Smoke', 'Amount', 'gen-fog'],
];
export interface QxwReport { fixtures: number; fromLibrary: number; generic: number; unknown: string[]; scenes: number; lists: number; effects: number; skipped: Record<string, number> }
// How to get a QLC+ fixture definition: by manufacturer and model (the app asks its library).
export type QxfResolver = (manufacturer: string, model: string) => Promise<FixtureType | undefined>;

interface QFixture { qid: number; ids: string[]; perChannel: boolean; mode?: FixtureMode }

export async function fromQxw(xml: string, resolve: QxfResolver, name = 'QLC+ workspace'): Promise<{ show: Show; report: QxwReport }> {
  const root = parseXml(xml).documentElement;
  if (root.localName !== 'Workspace') throw new Error('not a QLC+ workspace (.qxw)');
  const engine = kid(root, 'Engine');
  if (!engine) throw new Error('this workspace has no Engine section');
  const show = emptyShow(name);
  const cache = new Map<string, Promise<FixtureType | undefined>>();
  const lookup = (man: string, model: string) => {
    const k = `${man}\u0000${model}`;
    if (!cache.has(k)) cache.set(k, resolve(man, model).catch(() => undefined));
    return cache.get(k)!;
  };
  const report: QxwReport = { fixtures: 0, fromLibrary: 0, generic: 0, unknown: [], scenes: 0, lists: 0, effects: 0, skipped: {} };
  const skip = (what: string) => (report.skipped[what] = (report.skipped[what] ?? 0) + 1);

  // ---- fixtures
  const fx = new Map<number, QFixture>();
  const qfixtures = kids(engine, 'Fixture');
  const rows = Math.max(1, Math.ceil(qfixtures.length / 8));
  let placed = 0;
  const place = () => { const i = placed++; return { x: ((i % 8) + 0.5) / 8, y: (Math.floor(i / 8) + 0.5) / (rows + 0.5) }; };
  for (const q of qfixtures) {
    const qid = num(text(kid(q, 'ID')), -1), fname = text(kid(q, 'Name')) || `Fixture ${qid}`;
    const man = text(kid(q, 'Manufacturer')), model = text(kid(q, 'Model')), modeName = text(kid(q, 'Mode'));
    const universe = num(text(kid(q, 'Universe'))), address = num(text(kid(q, 'Address'))) + 1, channels = Math.max(1, num(text(kid(q, 'Channels')), 1));
    report.fixtures++;
    if (man === 'Generic' && (model === 'Generic' || model === 'Dimmer')) {
      // A dimmer pack: one dimmer per channel, so each can be set on its own.
      const ids: string[] = [];
      for (let c = 0; c < channels; c++) {
        const id = `q${qid}_${c}`;
        show.fixtures.push({ id, name: channels > 1 ? `${fname} ${c + 1}` : fname, typeId: 'gen-dimmer', mode: GENERIC[0].modes[0].name, universe, address: address + c, ...place() });
        ids.push(id);
      }
      fx.set(qid, { qid, ids, perChannel: true, mode: GENERIC[0].modes[0] });
      report.generic++;
      continue;
    }
    const gen = man === 'Generic' ? QLC_GENERIC.find(([mo, md]) => mo === model && md === modeName) : undefined;
    const found = gen ? GENERIC.find((t) => t.id === gen[2]) : await lookup(man, model);
    if (gen) report.generic++;
    else if (found) report.fromLibrary++;
    else report.unknown.push(`${man} ${model}`);
    const type: FixtureType = found ?? rawType(man, model, modeName, channels);
    if (type.source !== 'generic' && !show.fixtureTypes.some((t) => t.id === type.id)) show.fixtureTypes.push(type);
    const mode = type.modes.find((m) => m.name === modeName) ?? type.modes.find((m) => m.channels.length === channels) ?? type.modes[0];
    const id = `q${qid}`;
    const f: Fixture = { id, name: fname, typeId: type.id, mode: mode.name, universe, address, ...place() };
    show.fixtures.push(f);
    fx.set(qid, { qid, ids: [id], perChannel: false, mode });
  }

  // ---- groups
  for (const g of kids(engine, 'FixtureGroup')) {
    const ids = kids(g, 'Head').flatMap((h) => {
      const q = fx.get(num(h.getAttribute('Fixture'), -1));
      return q ? (q.perChannel ? [q.ids[num(text(h))] ?? q.ids[0]] : q.ids) : [];
    });
    if (ids.length) show.groups.push({ id: `qg${g.getAttribute('ID') ?? show.groups.length}`, name: text(kid(g, 'Name')) || 'Group', fixtures: [...new Set(ids)] } satisfies Group);
  }

  // ---- functions
  const funcs = new Map<number, Element>();
  for (const f of kids(engine, 'Function')) funcs.set(num(f.getAttribute('ID'), -1), f);
  const ms = (v: string | null | undefined) => { const n = num(v, 0); return n >= FOREVER ? Infinity : n / 1000; };
  const speed = (f: Element) => { const s = kid(f, 'Speed'); return { fadeIn: ms(s?.getAttribute('FadeIn')), fadeOut: ms(s?.getAttribute('FadeOut')), duration: ms(s?.getAttribute('Duration')) }; };

  // DMX values for (qlc fixture, channel) -> per-fixture Values.
  function toValues(pairs: [number, number, number][]): Record<string, Values> {
    const byFixture = new Map<string, Map<number, number>>();
    for (const [qid, ch, v] of pairs) {
      const q = fx.get(qid);
      if (!q) continue;
      if (q.perChannel) { const id = q.ids[ch]; if (id) byFixture.set(id, new Map([[0, v]])); continue; }
      const m = byFixture.get(q.ids[0]) ?? new Map<number, number>();
      m.set(ch, v);
      byFixture.set(q.ids[0], m);
    }
    const out: Record<string, Values> = {};
    for (const [id, chs] of byFixture) {
      const q = [...fx.values()].find((x) => x.ids.includes(id))!;
      out[id] = valuesFromDmx(q.mode, chs);
    }
    return out;
  }
  const sceneValues = (f: Element) => toValues(kids(f, 'FixtureVal').flatMap((fv) => {
    const qid = num(fv.getAttribute('ID'), -1), a = text(fv).split(',').filter((x) => x !== '').map(Number);
    const out: [number, number, number][] = [];
    for (let i = 0; i + 1 < a.length; i += 2) out.push([qid, a[i], a[i + 1]]);
    return out;
  }));

  // Scenes first: one list, a cue per scene.
  const sceneCue = new Map<number, { values: Record<string, Values>; fade: number; name: string }>();
  const scenes: CueList = { id: 'qscenes', name: 'Scenes', cues: [], end: 'stop' };
  for (const [id, f] of funcs) {
    if (f.getAttribute('Type') !== 'Scene') continue;
    const values = sceneValues(f), sp = speed(f), sname = f.getAttribute('Name') ?? `Scene ${id}`;
    const fade = Number.isFinite(sp.fadeIn) ? sp.fadeIn : 0;
    sceneCue.set(id, { values, fade, name: sname });
    scenes.cues.push({ id: `qs${id}`, name: sname, values, fade, advance: { mode: 'manual' } });
    report.scenes++;
  }
  if (scenes.cues.length) show.cueLists.push(scenes);

  // EFX -> effects (by function id, so collections can start them)
  const effectOf = new Map<number, string>();
  for (const [id, f] of funcs) {
    if (f.getAttribute('Type') !== 'EFX') continue;
    const e = efx(f, id, fx);
    if (e) { show.effects.push(e); effectOf.set(id, e.id); report.effects++; }
  }

  // Chasers and sequences -> lists
  const listOf = new Map<number, string>();
  for (const [id, f] of funcs) {
    const type = f.getAttribute('Type');
    if (type !== 'Chaser' && type !== 'Sequence') continue;
    const sp = speed(f);
    const modes = kid(f, 'SpeedModes');
    const mode = (k: string) => modes?.getAttribute(k) ?? (k === 'Duration' ? 'Common' : 'Default');
    const steps = kids(f, 'Step').sort((a, b) => num(a.getAttribute('Number')) - num(b.getAttribute('Number')));
    const cues: Cue[] = [];
    steps.forEach((st, i) => {
      let values: Record<string, Values>, own = 0, label = `Step ${i + 1}`;
      if (type === 'Sequence' || st.hasAttribute('Values')) {
        const pairs: [number, number, number][] = [];
        const parts = text(st).split(':');
        for (let p = 0; p + 1 < parts.length; p += 2) {
          const a = parts[p + 1].split(',').filter((x) => x !== '').map(Number);
          for (let k = 0; k + 1 < a.length; k += 2) pairs.push([num(parts[p], -1), a[k], a[k + 1]]);
        }
        values = toValues(pairs);
      } else {
        const sc = sceneCue.get(num(text(st), -1));
        if (!sc) { skip('chaser steps that run something other than a scene'); return; }
        values = sc.values; own = sc.fade; label = sc.name;
      }
      const stepFade = ms(st.getAttribute('FadeIn')), hold = ms(st.getAttribute('Hold'));
      const stepDur = st.hasAttribute('Hold') ? stepFade + hold : ms(st.getAttribute('Duration'));
      const fade = mode('FadeIn') === 'PerStep' ? stepFade : mode('FadeIn') === 'Common' ? sp.fadeIn : own;
      const dur = mode('Duration') === 'PerStep' ? stepDur : sp.duration;
      const note = st.getAttribute('Note') ?? undefined;
      cues.push({ id: `qc${id}_${i}`, name: note || label, values: JSON.parse(JSON.stringify(values)), fade: Number.isFinite(fade) ? fade : 0,
        advance: Number.isFinite(dur) ? { mode: 'wait', time: Math.max(0.05, dur) } : { mode: 'manual' } });
    });
    if (!cues.length) continue;
    const dir = text(kid(f, 'Direction')), order = text(kid(f, 'RunOrder'));
    if (dir === 'Backward') cues.reverse();
    if (order === 'PingPong' && cues.length > 2) cues.push(...cues.slice(1, -1).reverse().map((c, i) => ({ ...c, id: `${c.id}_back${i}` })));
    const l: CueList = { id: `ql${id}`, name: f.getAttribute('Name') ?? `Chaser ${id}`, cues, end: order === 'SingleShot' ? 'release' : 'loop' };
    if (order === 'Random') skip('random order (plays in order here)');
    show.cueLists.push(l);
    listOf.set(id, l.id);
    report.lists++;
  }

  // Collections: one cue that sets the scenes and starts the rest.
  for (const [id, f] of funcs) {
    if (f.getAttribute('Type') !== 'Collection') continue;
    const values: Record<string, Values> = {}, actions: Cue['actions'] = [], effects: string[] = [];
    for (const step of kids(f, 'Step')) {
      const fid = num(text(step), -1);
      const sc = sceneCue.get(fid);
      if (sc) for (const [k, v] of Object.entries(sc.values)) values[k] = { ...values[k], ...v };
      else if (listOf.has(fid)) actions.push({ do: 'start', list: listOf.get(fid)! });
      else if (effectOf.has(fid)) effects.push(effectOf.get(fid)!);
      else skip('collection parts that are not scenes, chasers or EFX');
    }
    show.cueLists.push({ id: `qcol${id}`, name: f.getAttribute('Name') ?? `Collection ${id}`, end: 'stop',
      cues: [{ id: `qcol${id}_c`, name: f.getAttribute('Name') ?? 'Collection', values, fade: 0, advance: { mode: 'manual' }, ...(actions.length ? { actions } : {}), ...(effects.length ? { effects } : {}) }] });
    report.lists++;
  }
  for (const f of funcs.values()) {
    const t = f.getAttribute('Type') ?? '?';
    if (!['Scene', 'Chaser', 'Sequence', 'EFX', 'Collection'].includes(t)) skip(t === 'RGBMatrix' ? 'RGB matrices' : `${t} functions`);
  }
  if (kid(root, 'VirtualConsole')) skip('the virtual console (the live page is built from the show instead)');
  return { show, report };
}

// A type for a fixture whose definition we don't have: its channels, raw.
function rawType(man: string, model: string, mode: string, channels: number): FixtureType {
  return { id: `qraw:${man}/${model}/${channels}`, manufacturer: man || 'Unknown', model: model || 'Fixture', source: 'user', ref: 'QLC+ workspace',
    modes: [{ name: mode || `${channels} ch`, channels: Array.from({ length: channels }, (_, i) => ({ name: `Channel ${i + 1}`, attr: 'raw' as const })) }] };
}

// DMX values of one fixture's channels -> Values: intensity, colour and position where the mode
// says what a channel is, raw for the rest.
export function valuesFromDmx(mode: FixtureMode | undefined, chs: Map<number, number>): Values {
  const v: Values = {};
  if (!mode) { v.raw = Object.fromEntries([...chs].map(([c, x]) => [String(c), x])); return v; }
  const raw: Record<string, number> = {};
  const rgb: Partial<Record<'red' | 'green' | 'blue', number>> = {};
  let wv: number | undefined;
  const hasW = mode.channels.some((c) => c.attr === 'white' && c.cell === undefined);
  const coarse = new Map<string, number>(), fine = new Map<string, number>();
  for (const [i, x] of chs) {
    const c = mode.channels[i];
    if (!c) continue;
    if (c.attr === 'red' || c.attr === 'green' || c.attr === 'blue') { if (c.cell === undefined) rgb[c.attr] = x; else raw[String(i)] = x; continue; }
    if (c.attr === 'intensity' || c.attr === 'pan' || c.attr === 'tilt') { (c.fine ? fine : coarse).set(c.attr, x); continue; }
    if (c.attr === 'white' && c.cell === undefined) { wv = x / 255; continue; }
    raw[String(i)] = x;
  }
  const word = (a: string) => ((coarse.get(a) ?? 0) * 256 + (fine.get(a) ?? 0)) / 65535;
  for (const a of ['intensity', 'pan', 'tilt'] as const) if (coarse.has(a)) v[a] = fine.has(a) ? word(a) : coarse.get(a)! / 255;
  if (Object.keys(rgb).length || wv !== undefined) {
    const col: Color = { r: (rgb.red ?? 0) / 255, g: (rgb.green ?? 0) / 255, b: (rgb.blue ?? 0) / 255 };
    // The white LED as the scene has it (a scene that leaves it out means "off", not "make white
    // from the RGB", which is what the app would do with no white value).
    const w = hasW ? wv ?? 0 : undefined;
    if (mode.channels.some((c) => c.attr === 'intensity')) {
      if (Object.keys(rgb).length) v.color = col;
      if (w !== undefined) v.white = w;
    } else {
      // No dimmer: the brightest emitter (white included) is the intensity, the colour and white
      // are relative to it (how the app drives such fixtures), so it renders back to the same bytes.
      const m = Math.max(col.r, col.g, col.b, w ?? 0);
      v.intensity = m;
      v.color = m > 0 ? { r: col.r / m, g: col.g / m, b: col.b / m } : { r: 1, g: 1, b: 1 };
      if (w !== undefined) v.white = m > 0 ? w / m : 0;
    }
  }
  if (Object.keys(raw).length) v.raw = raw;
  return v;
}

// EFX -> a move effect.
function efx(f: Element, id: number, fx: Map<number, QFixture>): Effect | undefined {
  const algo = text(kid(f, 'Algorithm'));
  const kind = algo === 'Eight' || algo === 'Leaf' || algo === 'Lissajous' ? 'figure8' : algo === 'Line' || algo === 'Line2' ? 'pan' : 'circle';
  const fixtures = kids(f, 'Fixture').flatMap((e) => fx.get(num(text(kid(e, 'ID')), -1))?.ids ?? []);
  if (!fixtures.length) return undefined;
  const w = num(text(kid(f, 'Width')), 127), h = num(text(kid(f, 'Height')), 127);
  const dur = num(kid(f, 'Speed')?.getAttribute('Duration'), 20000);
  const prop = text(kid(f, 'PropagationMode'));
  return { id: `qe${id}`, name: f.getAttribute('Name') ?? `EFX ${id}`, kind, fixtures,
    params: { size: Math.min(1, Math.max(w, h) / 127), tempo: false, speed: dur >= FOREVER ? 20 : Math.max(0.1, dur / 1000), spread: prop === 'Serial' ? 1 : prop === 'Asymmetric' ? 0.5 : 0, lightUp: false } };
}

