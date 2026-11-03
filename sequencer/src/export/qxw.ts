// A show -> QLC+ workspace (.qxw), for people who want to carry on in QLC+ or run the show there.
//   - fixtures from the QLC+ library keep their manufacturer, model and mode; everything else
//     goes as a QLC+ "Generic" fixture with the same number of channels (QLC+ treats its channels
//     as plain dimmers, the values are exact)
//   - groups -> fixture groups (a row)
//   - every cue -> a scene with the DMX values the cue produces (rendered here, so colours,
//     presets and white extraction come out exactly as this app sends them)
//   - every cue list -> a chaser over its scenes with the cue fades and wait times
//   - move effects (circle, figure eight, pan / tilt sweeps) -> EFX
// Other effects (colour, intensity) have no QLC+ equivalent here and are listed in the result.
import type { FixtureMode, Preset, Show } from '../model/types';
import { modeOf, typeMap } from '../model/library';
import { cueLooks } from '../engine/cuelook';
import { DARK, renderFixture } from '../engine/render';
import { paramsOf } from '../engine/effects';
import { QLC_GENERIC } from '../import/qxw';

const FOREVER = 4294967294;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function toQxw(show: Show): { xml: string; skipped: string[] } {
  const types = typeMap(show);
  const out: string[] = [];
  const skipped: string[] = [];
  const w = (s: string) => out.push(s);
  w('<?xml version="1.0" encoding="UTF-8"?>');
  w('<!DOCTYPE Workspace>');
  w('<Workspace xmlns="http://www.qlcplus.org/Workspace" CurrentWindow="FunctionManager">');
  w(` <Creator><Name>Q Light Controller Plus</Name><Version>4.12.7</Version><Author>${esc(show.meta.app)}</Author></Creator>`);
  w(' <Engine>');
  const unis = [...new Set(show.fixtures.map((f) => f.universe))].sort((a, b) => a - b);
  const maxUni = Math.max(0, ...unis);
  w('  <InputOutputMap>');
  for (let u = 0; u <= Math.min(maxUni, 63); u++) w(`   <Universe Name="Universe ${u + 1}" ID="${u}"/>`);
  w('  </InputOutputMap>');

  // Fixtures, numbered in patch order.
  const qid = new Map<string, number>();
  // Fixtures QLC+ has no definition for go as its generic dimmer type: the values are exact, but
  // QLC+ treats every channel as a dimmer (pan/tilt included). Say so.
  const dimmerOnly = new Set<string>();
  const moverNames: string[] = [];
  const modes = new Map<string, FixtureMode>();
  show.fixtures.forEach((f, i) => {
    const t = types.get(f.typeId), m = modeOf(t, f.mode);
    if (!m) return;
    qid.set(f.id, i);
    modes.set(f.id, m);
    const lib = t?.source === 'qxf';
    const gen = QLC_GENERIC.find(([, , id]) => id === f.typeId);
    if (!lib && !gen) {
      dimmerOnly.add(f.id);
      if (m.channels.some((c) => c.attr === 'pan' || c.attr === 'tilt')) moverNames.push(f.name);
    }
    const [man, model, mode] = lib ? [t!.manufacturer, t!.model, m.name] : gen ? ['Generic', gen[0], gen[1]] : ['Generic', 'Generic', 'Generic'];
    w('  <Fixture>');
    w(`   <Manufacturer>${esc(man)}</Manufacturer>`);
    w(`   <Model>${esc(model)}</Model>`);
    w(`   <Mode>${esc(mode)}</Mode>`);
    w(`   <ID>${i}</ID>`);
    w(`   <Name>${esc(f.name)}</Name>`);
    w(`   <Universe>${f.universe}</Universe>`);
    w(`   <Address>${f.address - 1}</Address>`);
    w(`   <Channels>${m.channels.length}</Channels>`);
    w('  </Fixture>');
  });
  show.groups.forEach((g, gi) => {
    const ids = g.fixtures.filter((id) => qid.has(id));
    w(`  <FixtureGroup ID="${gi}">`);
    w(`   <Name>${esc(g.name)}</Name>`);
    w(`   <Size X="${Math.max(1, ids.length)}" Y="1"/>`);
    ids.forEach((id, x) => w(`   <Head X="${x}" Y="0" Fixture="${qid.get(id)}">0</Head>`));
    w('  </FixtureGroup>');
  });

  // The DMX bytes a look gives one fixture.
  const bytes = (fid: string, look: Parameters<typeof renderFixture>[2]) => {
    const f = show.fixtures.find((x) => x.id === fid)!, m = modes.get(fid)!;
    const buf = new Uint8Array(512 + m.channels.length);
    renderFixture({ ...f, address: 1 }, m, { ...DARK, color: { ...DARK.color! }, ...look }, buf);
    return [...buf.slice(0, m.channels.length)];
  };
  const presets = new Map<string, Preset>(show.presets.map((p) => [p.id, p]));
  let fn = 0;
  const ms = (s: number) => String(Math.round(s * 1000));
  for (const l of show.cueLists) {
    const looks = cueLooks(l, presets);
    const touched = new Set<string>();
    const sceneIds: number[] = [];
    l.cues.forEach((c, i) => {
      for (const id of Object.keys(c.values)) touched.add(id);
      const id = fn++;
      sceneIds.push(id);
      w(`  <Function ID="${id}" Type="Scene" Name="${esc(`${l.name} ${i + 1}: ${c.name}`)}">`);
      w(`   <Speed FadeIn="0" FadeOut="0" Duration="0"/>`);
      for (const fid of touched) {
        if (!qid.has(fid) || !looks[i][fid]) continue;
        w(`   <FixtureVal ID="${qid.get(fid)}">${bytes(fid, looks[i][fid]).flatMap((v, ch) => [ch, v]).join(',')}</FixtureVal>`);
      }
      w('  </Function>');
    });
    const id = fn++;
    w(`  <Function ID="${id}" Type="Chaser" Name="${esc(l.name)}">`);
    w('   <Speed FadeIn="0" FadeOut="0" Duration="0"/>');
    w('   <Direction>Forward</Direction>');
    w(`   <RunOrder>${l.end === 'loop' ? 'Loop' : 'SingleShot'}</RunOrder>`);
    w('   <SpeedModes FadeIn="PerStep" FadeOut="PerStep" Duration="PerStep"/>');
    l.cues.forEach((c, i) => {
      const a = c.advance;
      const after = a.mode === 'wait' ? a.time : a.mode === 'follow' ? c.fade + a.time : a.mode === 'beats' ? a.beats * 60 / show.settings.bpm : Infinity;
      const hold = Number.isFinite(after) ? ms(Math.max(0, after - c.fade)) : String(FOREVER);
      w(`   <Step Number="${i}" FadeIn="${ms(c.fade)}" Hold="${hold}" FadeOut="${ms(c.fadeOut ?? 0)}"${c.note ? ` Note="${esc(c.note)}"` : ''}>${sceneIds[i]}</Step>`);
    });
    w('  </Function>');
  }

  if (moverNames.length) skipped.push(`${moverNames.join(', ')}: QLC+ has no definition for them here, they go as plain channels (scenes are exact, but QLC+ can't move them)`);
  const notes = new Set<string>();
  for (const l of show.cueLists) {
    if (l.end === 'stop') notes.add(`"${l.name}" stays on its last cue here; in QLC+ a chaser that ends goes dark`);
    for (const c of l.cues) {
      if (c.effects?.length) notes.add('effects inside cues (QLC+ chasers can\'t start them)');
      if (c.actions?.length) notes.add('cue actions (start/release other lists, blackout)');
      if (c.delay) notes.add('cue delays');
    }
  }
  skipped.push(...notes);
  // Move effects -> EFX.
  const ALGO: Record<string, string> = { circle: 'Circle', figure8: 'Eight', pan: 'Line', tilt: 'Line' };
  for (const e of show.effects) {
    const algo = ALGO[e.kind];
    if (!algo) { skipped.push(`${e.name} (${e.kind}: no QLC+ equivalent)`); continue; }
    const p = paramsOf(e.kind, e.params);
    const ids = (e.group ? show.groups.find((g) => g.id === e.group)?.fixtures ?? [] : e.fixtures ?? []).filter((id) => qid.has(id) && !dimmerOnly.has(id) && modes.get(id)!.channels.some((c) => c.attr === 'pan' || c.attr === 'tilt'));
    if (!ids.length) { skipped.push(`${e.name} (no moving heads QLC+ knows)`); continue; }
    const secs = p.tempo ? p.speed * 60 / show.settings.bpm : p.speed;
    const amp = Math.round(Math.min(1, p.size) * 127);
    w(`  <Function ID="${fn++}" Type="EFX" Name="${esc(e.name)}">`);
    w(`   <Speed FadeIn="0" FadeOut="0" Duration="${ms(secs)}"/>`);
    w('   <Direction>Forward</Direction>');
    w('   <RunOrder>Loop</RunOrder>');
    w(`   <PropagationMode>${p.spread > 0 ? 'Serial' : 'Parallel'}</PropagationMode>`);
    w(`   <Algorithm>${algo}</Algorithm>`);
    w(`   <Width>${e.kind === 'tilt' ? 0 : amp}</Width>`);
    w(`   <Height>${e.kind === 'pan' ? 0 : amp}</Height>`);
    w(`   <Rotation>${e.kind === 'tilt' ? 90 : 0}</Rotation>`);
    w('   <StartOffset>0</StartOffset>');
    w('   <IsRelative>1</IsRelative>');
    w('   <Axis Name="X"><Offset>127</Offset><Frequency>2</Frequency><Phase>90</Phase></Axis>');
    w('   <Axis Name="Y"><Offset>127</Offset><Frequency>1</Frequency><Phase>0</Phase></Axis>');
    for (const id of ids) w(`   <Fixture><ID>${qid.get(id)}</ID><Head>0</Head><Mode>0</Mode><Direction>Forward</Direction><StartOffset>0</StartOffset></Fixture>`);
    w('  </Function>');
  }
  w(' </Engine>');
  w('</Workspace>');
  return { xml: out.join('\n') + '\n', skipped };
}
