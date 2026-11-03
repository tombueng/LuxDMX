// @vitest-environment happy-dom
// The starter shows: each builds, saves and loads again, every light fits its universe without
// sharing a channel, everything a cue, an effect or a group names is there, every effect machine
// has its one-shot list (which ends by itself), and the generated live page has the buttons for a
// show: the looks, the machines, fog or haze, Blinder, Drop and the strobe and blinder flashes.
import { describe, expect, it } from 'vitest';
import { TEMPLATES, gobo } from './templates';
import { buskingPage, isMachineList } from './busking';
import { parseShow, serializeShow } from '../model/format';
import { isPlay, modeOf, typeMap } from '../model/library';
import { EFFECT_MAP } from '../engine/effects';
import { freshApp } from '../app.harness';
import type { Show, Widget } from '../model/types';

const MACHINES = ['confetti', 'co2', 'sparks', 'flame', 'bubbles'] as const;
const attrsOf = (s: Show, id: string) => { const f = s.fixtures.find((x) => x.id === id)!; return modeOf(typeMap(s).get(f.typeId), f.mode)!.channels.map((c) => c.attr); };

describe('the templates', () => {
  for (const t of TEMPLATES) {
    describe(t.name, () => {
      const s = t.build();
      it('is a rich rig: lights of many kinds, the machines, groups, effects and plenty of cues', () => {
        expect(s.fixtures.length).toBeGreaterThanOrEqual(25);
        const types = new Set(s.fixtures.map((f) => f.typeId));
        expect(types.size).toBeGreaterThanOrEqual(8);
        for (const a of ['confetti', 'bubbles', 'sparks'] as const) expect(s.fixtures.some((f) => attrsOf(s, f.id).includes(a)), a).toBe(true);
        expect(s.fixtures.some((f) => attrsOf(s, f.id).some((a) => a === 'fog' || a === 'haze'))).toBe(true);
        expect(s.groups.length).toBeGreaterThanOrEqual(5);
        expect(s.effects.length).toBeGreaterThanOrEqual(9);
        expect(s.cueLists[0].cues.length).toBeGreaterThanOrEqual(10);
      });
      it('saves and loads back the same', () => {
        const back = parseShow(serializeShow(JSON.parse(JSON.stringify(s))));
        expect(back.fixtures).toEqual(s.fixtures);
        expect(back.cueLists).toEqual(s.cueLists);
        expect(back.effects).toEqual(s.effects);
      });
      it('every light fits its universe and shares no channel; one box (two universes) runs it', () => {
        const types = typeMap(s), used = new Map<string, string>();
        for (const f of s.fixtures) {
          const n = modeOf(types.get(f.typeId), f.mode)!.channels.length;
          expect(f.address, f.name).toBeGreaterThanOrEqual(1);
          expect(f.address + n - 1, f.name).toBeLessThanOrEqual(512);
          for (let c = 0; c < n; c++) { const k = `${f.universe}.${f.address + c}`; expect(used.get(k), `${f.name} on ${k}`).toBeUndefined(); used.set(k, f.name); }
          expect(f.x).toBeGreaterThanOrEqual(0); expect(f.x).toBeLessThanOrEqual(1); expect(f.y).toBeGreaterThanOrEqual(0); expect(f.y).toBeLessThanOrEqual(1);
          for (const v of [f.p3?.x, f.p3?.y, f.p3?.z, f.rot?.yaw, f.rot?.pitch, f.rot?.roll]) if (v !== undefined) expect(Number.isFinite(v), f.name).toBe(true);
        }
        expect(new Set(s.fixtures.map((f) => f.universe)).size).toBeLessThanOrEqual(2);
        expect(new Set(s.fixtures.map((f) => f.name)).size, 'names are unique').toBe(s.fixtures.length);
      });
      it('everything named is there: lights in cues and groups, effects in cues, lists in actions; effects are known ones', () => {
        const ids = new Set(s.fixtures.map((f) => f.id)), fx = new Set(s.effects.map((e) => e.id)), lists = new Set(s.cueLists.map((l) => l.id));
        for (const g of s.groups) { expect(g.fixtures.length, g.name).toBeGreaterThan(0); for (const id of g.fixtures) expect(ids.has(id), g.name).toBe(true); }
        for (const e of s.effects) {
          expect(s.groups.some((g) => g.id === e.group), e.name).toBe(true);
          expect(EFFECT_MAP.has(e.kind), `${e.name}: ${e.kind}`).toBe(true);
        }
        for (const l of s.cueLists) for (const c of l.cues) {
          for (const id of Object.keys(c.values)) expect(ids.has(id), `${l.name} / ${c.name}`).toBe(true);
          for (const id of c.effects ?? []) expect(fx.has(id), `${l.name} / ${c.name}`).toBe(true);
          for (const a of c.actions ?? []) if ('list' in a) expect(lists.has(a.list), `${l.name} / ${c.name}`).toBe(true);
        }
        // a cue's own pan, tilt, zoom or gobo only goes to a light that has one
        for (const l of s.cueLists) for (const c of l.cues) for (const [id, v] of Object.entries(c.values))
          for (const k of ['pan', 'tilt', 'zoom', 'gobo', 'prism', 'strobe', 'confetti', 'flame', 'sparks', 'co2', 'bubbles', 'fog', 'haze'] as const)
            if (v[k] !== undefined && (v[k] as number) > 0) expect(attrsOf(s, id), `${c.name}: ${k} on ${s.fixtures.find((f) => f.id === id)!.name}`).toContain(k);
      });
      it('each kind of effect machine has its one-shot list, which ends by itself within seconds', () => {
        for (const m of MACHINES) {
          const has = s.fixtures.filter((f) => attrsOf(s, f.id).includes(m));
          const l = s.cueLists.find((x) => isMachineList(x) && x.cues.some((c) => Object.values(c.values).some((v) => (v[m] as number) > 0)));
          if (!has.length) { expect(l, m).toBeUndefined(); continue; }
          expect(l, m).toBeDefined();
          expect(l!.end).toBe('release');
          expect(l!.cues).toHaveLength(1);
          const c = l!.cues[0];
          expect(c.advance.mode).toBe('wait');
          expect((c.advance as { time: number }).time).toBeLessThanOrEqual(30);
          expect(Object.keys(c.values).sort()).toEqual(has.map((f) => f.id).sort());
        }
        // and no look leaves a machine running: machines only ever run from their shots
        for (const l of s.cueLists.filter((x) => !isMachineList(x))) for (const c of l.cues) for (const v of Object.values(c.values))
          for (const m of [...MACHINES, 'fog'] as const) if ((v[m] as number) > 0) expect(c.advance.mode, `${l.name} / ${c.name}`).toBe('wait');
      });
      it('the generated live page: the looks, a button per machine, fog or haze, and (not for a play) Blinder, Drop, strobe and blinder flashes', () => {
        const w = buskingPage(s).widgets, main = s.cueLists[0], play = isPlay(main);
        expect(play, 'only the Theatre is a play').toBe(t.name === 'Theatre');
        if (play) expect(w.some((x) => x.type === 'cuelist' && x.list === main.id)).toBe(true);
        else expect(w.filter((x) => x.type === 'cue' && x.list === main.id)).toHaveLength(main.cues.length);
        const machineButtons = w.filter((x): x is Widget & { type: 'list' } => x.type === 'list' && x.id.startsWith('sfx-'));
        const kinds = MACHINES.filter((m) => s.fixtures.some((f) => attrsOf(s, f.id).includes(m)));
        expect(machineButtons).toHaveLength(kinds.length);
        for (const b of machineButtons) expect(isMachineList(s.cueLists.find((l) => l.id === b.list)!)).toBe(true);
        expect(w.some((x) => x.type === 'fog')).toBe(true);
        if (!play) {
          expect(w.some((x) => x.type === 'special' && x.do === 'blinder')).toBe(true);
          expect(w.some((x) => x.type === 'special' && x.do === 'drop')).toBe(true);
          const flash = (name: RegExp) => w.find((x) => x.type === 'group' && name.test(s.groups.find((g) => g.id === x.group)?.name ?? ''));
          // (a rig without strobes, the church and the cinema: Drop strobes every light)
          if (s.groups.some((g) => /strobe/i.test(g.name))) expect((flash(/strobe/i) as { strobe?: number } | undefined)?.strobe).toBeGreaterThan(0);
          if (s.groups.some((g) => /blinder/i.test(g.name))) expect(flash(/blinder/i)).toBeDefined();
        }
        // a machine's shot has no master fader, and isn't a cue list toggle
        for (const b of machineButtons) expect(w.some((x) => (x.type === 'fader' && x.ref === b.list) || x.id === `tog-${b.list}`)).toBe(false);
      });
    });
  }
  it('the gobo helper picks slots of the generic spot', () => {
    expect(gobo('Open')).toBe(0);
    expect(gobo('Spiral')).toBe(1);
  });
});

describe('the templates in the app', () => {
  for (const t of TEMPLATES) {
    it(`${t.name}: the first look lights universe 0, and the confetti button fires a shot that ends by itself`, async () => {
      const { app, tick } = await freshApp();
      await app.startShow(t.build());
      let T = 100; app.engine.now = () => T;
      const w: Widget[] = app.pages[0].widgets;
      const main = app.show.cueLists[0];
      app.engine.jumpTo(main.id, 0, 0);
      tick(2);
      const lit = app.show.fixtures.filter((f: { universe: number; id: string }) => f.universe === 0 && (app.stage[f.id]?.intensity ?? 0) > 0);
      expect(lit.length).toBeGreaterThan(0);
      const conf = app.show.fixtures.filter((f: { id: string }) => attrsOf(app.show, f.id).includes('confetti')).map((f: { id: string }) => f.id);
      const button = w.find((x) => x.type === 'list' && x.id.startsWith('sfx-') && app.show.cueLists.find((l: { id: string }) => l.id === x.list)?.name === 'Confetti');
      expect(button).toBeDefined();
      app.fireWidget(button, true); app.fireWidget(button, false);
      T += 0.1; tick();
      expect(conf.every((id: string) => app.stage[id]?.confetti === 1)).toBe(true);
      for (let i = 0; i < 10; i++) { T += 0.1; tick(); }
      expect(conf.every((id: string) => !app.stage[id]?.confetti)).toBe(true);
    });
  }
});
