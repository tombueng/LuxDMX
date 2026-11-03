// @vitest-environment happy-dom
// The app as a whole (the real singleton, clock stopped, a fake box): what goes out and what's on
// stage after things people do. See app.harness.ts.
import { describe, expect, it } from 'vitest';
import { freshApp, installLocks, settle, smallShow } from './app.harness';

const pct = (v: number | undefined) => Math.round((v ?? 0) * 100);

describe('a list of looks: a look sets what it names, the rest stays as it is', () => {
  it('"Hall" lights the hall and leaves the church as it was; Record leaves the untouched lights alone', async () => {
    const { app, tick } = await freshApp();
    smallShow(app);
    const L = app.show.cueLists[0];
    L.cues.push({ id: 'c3', name: 'Hall', values: { p2: { intensity: 0.8 } }, fade: 0, advance: { mode: 'manual' } });
    app.checkpoint();
    app.engine.jumpTo('L', 0, 0); tick(2);                          // Warm: p1 100 %, p2 100 %
    app.engine.jumpTo('L', 2, 0); tick(2);                          // Hall: only p2
    expect([pct(app.stage.p1.intensity), pct(app.stage.p2.intensity)]).toEqual([100, 80]);
    app.engine.jumpTo('L', 1, 0); tick(2);                          // Late: p1 50, p2 20
    app.engine.jumpTo('L', 2, 0); tick(2);
    expect([pct(app.stage.p1.intensity), pct(app.stage.p2.intensity)]).toEqual([50, 80]);
    // Record a change to p2 only: p1 stays where it is
    app.selected = ['p2']; app.set({ intensity: 0.5 }); tick(1);
    expect(app.record('L')).toBe(true);
    tick(2);
    expect([pct(app.stage.p1.intensity), pct(app.stage.p2.intensity)]).toEqual([50, 50]);
  });
  it("fog and haze stop with the next look (they are their look's), other lights stay", async () => {
    const { app, tick } = await freshApp();
    smallShow(app);
    app.show.cueLists[0].cues[0].values.fg = { fog: 1 };
    app.checkpoint();
    app.engine.jumpTo('L', 0, 0); tick(2);
    expect(pct(app.stage.fg.fog)).toBe(100);
    app.engine.jumpTo('L', 1, 0); tick(2);
    expect(pct(app.stage.fg?.fog)).toBe(0);
  });
  it('a reload replays the looks played, so the stage is the same', async () => {
    let r = await freshApp();
    smallShow(r.app);
    r.app.show.cueLists[0].cues.push({ id: 'c3', name: 'Hall', values: { p2: { intensity: 0.8 } }, fade: 0, advance: { mode: 'manual' } });
    r.app.checkpoint();
    r.app.engine.jumpTo('L', 0, 0); r.tick(2); r.app.engine.jumpTo('L', 1, 0); r.tick(2); r.app.engine.jumpTo('L', 2, 0); r.tick(2);
    r.app.pbAt = -1e9; r.tick(1);                                   // its playback is saved
    r.app.channel?.close();
    r = await freshApp({ keepStorage: true });                       // F5
    r.tick(3);
    expect([pct(r.app.stage.p1.intensity), pct(r.app.stage.p2.intensity)]).toEqual([50, 80]);
  });
});

describe("refresh after a cue recorded into a list that wasn't playing", () => {
  it("an Update of that cue keeps the stage as it was (the earlier cues' lights don't pop on)", async () => {
    const { app, tick } = await freshApp();
    smallShow(app);
    tick(1);
    app.selected = ['fg']; app.set({ fog: 0.4 }); tick(1);
    expect(app.record('L')).toBe(true);
    tick(2);
    expect(app.stage.p1?.intensity ?? 0).toBe(0);
    app.currentList = 'L';
    app.selected = ['fg']; app.set({ fog: 0.5 }); tick(1);
    expect(app.updateCue(app.show.cueLists[0].cues[2].id)).toBe(true);
    tick(2);
    expect(app.stage.p1?.intensity ?? 0).toBe(0);
  });
});

describe("a fresh start and the box's look", () => {
  it('a reload of a tab that never played stays quiet', async () => {
    let r = await freshApp();
    smallShow(r.app);
    r.tick(3); r.app.pbAt = -1e9; r.tick(1);
    expect(r.sent.length).toBe(0);
    r.app.channel?.close();
    r = await freshApp({ keepStorage: true });
    r.tick(5);
    expect(r.sent.length).toBe(0);
  });
  it('a cold start (tablet off and on) puts back what was playing, at once', async () => {
    let r = await freshApp();
    smallShow(r.app);
    r.app.engine.jumpTo('L', 1, 0); r.tick(3);
    r.app.pbAt = -1e9; r.tick(1);
    r.app.channel?.close();
    sessionStorage.clear();                                          // a new tab: only localStorage is left
    r = await freshApp({ keepStorage: true });
    r.tick(2);
    expect(r.sent.length).toBe(0);                                   // asking the other tabs first
    await new Promise((ok) => setTimeout(ok, 350));
    r.tick(2);
    expect(r.app.engine.status('L').index).toBe(1);
    expect(r.sent[0].data.slice(0, 2)).toEqual([128, 51]);          // the first frame out is the look, no dip
    expect(r.app.output).toBe('live');                               // it was on stage: it carries on there
  });
  it('a cold start of a tab that was blind stays blind (the box keeps holding its look)', async () => {
    let r = await freshApp({ output: 'blind' });
    smallShow(r.app);
    r.app.engine.jumpTo('L', 1, 0); r.tick(3);
    r.app.pbAt = -1e9; r.tick(1);
    r.app.channel?.close();
    sessionStorage.clear();
    r = await freshApp({ keepStorage: true });
    await new Promise((ok) => setTimeout(ok, 350));
    r.tick(3);
    expect(r.app.engine.status('L').index).toBe(1);                  // the screen shows what was playing
    expect(r.app.output).toBe('blind');
    expect(r.sent.length).toBe(0);
  });
});

describe('the timetable', () => {
  const at = (h: number, m = 0, s = 0) => { const d = new Date(); d.setHours(h, m, s, 0); return d; };
  it('a catch-up puts the look on at once (no fade from black, no actions)', async () => {
    const { app, sent, tick } = await freshApp();
    smallShow(app);
    app.show.cueLists[0].cues[1].fade = 20;
    app.show.settings.schedule = [{ id: 'eve', at: '00:00', do: { do: 'goto', list: 'L', cue: 'c2' } }];
    app.checkpoint();
    tick(1);
    expect(app.engine.status('L').index).toBe(1);
    tick(1);
    expect(sent[0].data.slice(0, 2)).toEqual([128, 51]);
  });
  it('plays what came since it last looked, and nothing over a look played by hand', async () => {
    const { app } = await freshApp();
    smallShow(app);
    app.show.settings.schedule = [{ id: 'a', at: '10:00', do: { do: 'goto', list: 'L', cue: 'c1' } }, { id: 'b', at: '11:00', do: { do: 'goto', list: 'L', cue: 'c2' } }];
    app.runSchedule(at(10, 30));                                     // first look: what should be on (10:00)
    expect(app.engine.status('L').index).toBe(0);
    app.engine.jumpTo('L', 1, 0);                                    // by hand
    app.runSchedule(at(10, 30, 5));
    app.runSchedule(at(10, 59, 59));
    expect(app.engine.status('L').index).toBe(1);                    // nothing came: the hand look stays
    app.runSchedule(at(11, 0, 4));
    expect(app.engine.status('L').index).toBe(1);
    app.engine.jumpTo('L', 0, 0);
    app.runSchedule(at(11, 0, 9));
    expect(app.engine.status('L').index).toBe(0);                    // 11:00 ran once, not again
  });
  it('paused (a party tonight) or off, its times are skipped, and not caught up afterwards', async () => {
    const { app } = await freshApp();
    smallShow(app);
    app.show.settings.schedule = [{ id: 'a', at: '18:00', do: { do: 'goto', list: 'L', cue: 'c2' } }, { id: 'b', at: '23:00', do: { do: 'off' } }];
    app.runSchedule(at(17, 0));                                       // (the first look: nothing yet today... the 23:00 of yesterday says off)
    app.engine.jumpTo('L', 0, 0);                                     // the party look, by hand
    app.pauseSchedule(at(23, 30).getTime());
    app.runSchedule(at(17, 59, 58)); app.runSchedule(at(18, 0, 3)); app.runSchedule(at(23, 0, 3));
    expect(app.engine.status('L').index).toBe(0);
    expect(app.engine.status('L').running).toBe(true);
    app.runSchedule(at(23, 30, 4));                                   // the pause is over: 18:00 and 23:00 aren't played late
    expect(app.engine.status('L').running).toBe(true);
    expect(app.show.settings.schedulePause).toBeUndefined();
    app.setScheduleOn(false);
    app.runSchedule(at(23, 59, 0));
    app.show.settings.schedule.push({ id: 'c', at: '23:59', do: { do: 'off' } });
    app.runSchedule(at(23, 59, 5));
    expect(app.engine.status('L').running).toBe(true);                // off: nothing by the clock
  });
  it("an entry moved to a time already past doesn't fire", async () => {
    const { app } = await freshApp();
    smallShow(app);
    app.show.settings.schedule = [{ id: 'a', at: '18:00', do: { do: 'goto', list: 'L', cue: 'c2' } }];
    app.runSchedule(at(14, 0));                                      // (first look: yesterday's 18:00 is what should be on)
    app.engine.stop('L');
    app.show.settings.schedule[0].at = '02:00';
    app.runSchedule(at(14, 0, 5));
    expect(app.engine.status('L').running).toBe(false);
  });
  it('"everything off" fades everything out; the next look comes up (no blackout left on)', async () => {
    const { app, tick } = await freshApp();
    smallShow(app);
    app.show.settings.schedule = [{ id: 'off', at: '11:00', do: { do: 'off' } }, { id: 'choir', at: '19:00', do: { do: 'goto', list: 'L', cue: 'c1' } }];
    app.runSchedule(at(10, 0));
    app.engine.jumpTo('L', 1, 0);
    app.runSchedule(at(11, 0, 3));
    expect(app.engine.status('L').releasing).toBe(true);
    app.runSchedule(at(19, 0, 3));
    tick(2);
    expect(app.blackout).toBe(false);
    expect(app.engine.status('L').index).toBe(0);
    expect(app.engine.status('L').releasing).toBe(false);
  });
});

describe('a look tapped', () => {
  it("ends a blackout (the look you asked for shows), also when it's already the one on", async () => {
    const { app, tick } = await freshApp();
    smallShow(app);
    app.engine.jumpTo('L', 0, 0); tick(1);
    app.blackout = true;
    app.fireWidget({ id: 'w', type: 'cue', list: 'L', cue: 'c1' }, true);
    expect(app.blackout).toBe(false);
  });
  it("switching a list off after Fade out doesn't bring the master back", async () => {
    const { app, tick } = await freshApp();
    smallShow(app);
    app.engine.jumpTo('L', 0, 0); tick(1);
    app.grandMaster = 0; app.fadedOut = true;
    app.fireWidget({ id: 'w', type: 'list', list: 'L', action: 'toggle' }, true);
    expect(app.grandMaster).toBe(0);
  });
});

describe('fog stopped from Live', () => {
  it('stays stopped when you leave Live, until the next look', async () => {
    const { app, tick } = await freshApp();
    smallShow(app);
    app.show.cueLists[0].cues[0].values.fg = { fog: 1 };
    app.engine.jumpTo('L', 0, 0); tick(2);
    app.stopHaze(); tick(1);
    expect(pct(app.stage.fg.fog)).toBe(0);
    app.releaseHolds(); tick(1);                                     // what leaving Live does
    expect(pct(app.stage.fg.fog)).toBe(0);
  });
  it('stays stopped after a reload', async () => {
    let r = await freshApp();
    smallShow(r.app);
    r.app.show.cueLists[0].cues[0].values.fg = { fog: 1 };
    r.app.checkpoint();
    r.app.jump('L', 0); r.tick(2);
    r.app.stopHaze(); r.tick(1);
    (r.app as any).pbAt = -1e9; r.tick(1);
    r.app.channel?.close();
    r = await freshApp({ keepStorage: true });
    r.tick(3);
    expect(r.app.status.L.cue).toBe('c1');
    expect(pct(r.app.stage.fg.fog)).toBe(0);
  });
});

describe('locked for the service', () => {
  it('the masters on the page are out of reach; the looks play', async () => {
    const { app, tick } = await freshApp();
    smallShow(app);
    app.view = 'live';
    app.lockShow(true);
    expect(app.locked).toBe(true);
    app.setFader({ id: 'gm', type: 'fader', target: 'grand' }, 0);
    expect(app.grandMaster).toBe(1);
    app.engine.jumpTo('L', 0, 0); tick(1);
    app.fireWidget({ id: 'r', type: 'special', do: 'releaseAll' }, true);
    expect(app.engine.status('L').releasing).toBe(false);
    app.fireWidget({ id: 'c', type: 'cue', list: 'L', cue: 'c2' }, true);
    expect(app.engine.status('L').index).toBe(1);
  });
});

describe('another type for a light', () => {
  it('a colour temperature becomes that white on an RGB PAR (the looks still light it white, not pink)', async () => {
    const { app } = await freshApp();
    smallShow(app);
    app.show.fixtures.push({ id: 'w', name: 'White 1', typeId: 'gen-cct', mode: '', universe: 0, address: 10, x: 0.5, y: 0.5 });
    app.show.cueLists[0].cues[0].values.w = { intensity: 0.7, cct: 0.35 };
    app.changeType('w', 'gen-drgb');
    const v = app.show.cueLists[0].cues[0].values.w;
    expect(v.cct).toBeUndefined();
    expect(v.intensity).toBe(0.7);
    expect(v.color.r).toBe(1);
    expect(v.color.b).toBeGreaterThan(0.4); expect(v.color.b).toBeLessThan(0.75);   // a warmish white, not pink
  });
});

describe('round 11 review', () => {
  it('a look tapped while its list fades out starts from what is visible; what it doesn\'t name goes on out', async () => {
    const { app, tick } = await freshApp();
    smallShow(app);
    app.show.cueLists[0].cues.push({ id: 'c3', name: 'Hall', values: { p2: { intensity: 0.8 } }, fade: 0, advance: { mode: 'manual' } });
    app.engine.jumpTo('L', 0, 0); tick(2);
    app.engine.release('L'); tick(1);
    app.engine.jumpTo('L', 2, 0); tick(2);
    expect(pct(app.stage.p1?.intensity)).toBeLessThan(100);                   // no pop back to full
    await new Promise((ok) => setTimeout(ok, 120)); tick(2);
    expect(pct(app.stage.p1?.intensity)).toBe(0);                            // and it goes out (fade 0)
    expect(pct(app.stage.p2.intensity)).toBe(80);
  });
  it('a note typed on a look of a loaded show doesn\'t turn its list into a play', async () => {
    const { app } = await freshApp();
    smallShow(app);
    const s = JSON.parse(JSON.stringify(app.show));
    await app.startShow(s);
    const L = app.show.cueLists[0];
    expect(L.play).toBe(false);
    L.cues[0].note = 'when the bride is in';
    app.show.cueLists[0].cues.push({ id: 'c3', name: 'Hall', values: { p2: { intensity: 0.8 } }, fade: 0, advance: { mode: 'manual' } });
    app.engine.jumpTo('L', 0, 0); app.tick(); app.engine.jumpTo('L', 2, 0); app.tick(2);
    expect(pct(app.stage.p1.intensity)).toBe(100);                           // Hall left the church alone
  });
  it('a reload replays the looks by cue: one moved after it played is still the one', async () => {
    let r = await freshApp();
    smallShow(r.app);
    r.app.show.cueLists[0].cues.push({ id: 'c3', name: 'Hall', values: { p2: { intensity: 0.8 } }, fade: 0, advance: { mode: 'manual' } });
    r.app.engine.jumpTo('L', 0, 0); r.tick(); r.app.engine.jumpTo('L', 2, 0); r.tick(2);
    const cues = r.app.show.cueLists[0].cues; cues.splice(0, 0, cues.splice(1, 1)[0]);   // Late moved to the top
    r.app.pbAt = -1e9; r.tick(1);
    r.app.checkpoint();
    r.app.channel?.close();
    r = await freshApp({ keepStorage: true });
    r.tick(3);
    expect([pct(r.app.stage.p1.intensity), pct(r.app.stage.p2.intensity)]).toEqual([100, 80]);   // Warm then Hall, not Late
  });
});

describe('a second tab on the same show', () => {
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  it('only watches the timetable while the first plays; takes over (red bar and all) once it is closed', async () => {
    const L = installLocks();
    try {
      L.as('A');
      const A = await freshApp();
      smallShow(A.app);
      const at = new Date(Date.now() + 2 * 60_000);
      A.app.show.settings.schedule = [{ id: 's1', at: hhmm(at), do: { do: 'goto', list: 'L', cue: 'c2' } }];
      A.app.view = 'live'; A.app.lockShow(true);
      A.app.checkpoint();
      A.app.jump('L', 0); A.tick(3); await settle();
      expect(L.held.get(`luxdmx.out.${A.app.showId}`)?.owner).toBe('A');
      sessionStorage.clear();
      L.as('B');
      const B = await freshApp({ keepStorage: true });
      await settle(20); B.tick(3);
      // the time comes: B leaves it to A (no second copy of the show going to the box)
      B.app.runSchedule(new Date(at.getTime() + 30_000)); await settle(20); B.tick(3);
      expect(B.sent.length).toBe(0);
      expect(B.app.othersPlay).toBe(true);
      const box = B.app.bridges[0];
      box.state = 'closed'; box.lostAt = 0;
      expect(B.app.alarmed(box)).toBe(false);
      // A is closed: B takes the output at its next look at the clock, and speaks for the box
      L.releaseAll('A'); await settle(10);
      B.app.runSchedule(new Date(at.getTime() + 35_000)); await settle(20);
      expect(L.held.get(`luxdmx.out.${B.app.showId}`)?.owner).toBe('B');
      expect(B.app.othersPlay).toBe(false);
      expect(B.app.alarmed(box)).toBe(true);
    } finally { L.uninstall(); }
  });
});

describe('haze stopped from Live, with the haze from a list of its own', () => {
  const hazeShow = (app: any) => {
    app.show.fixtures.push(
      { id: 'p1', name: 'P1', typeId: 'gen-dimmer', mode: '', universe: 0, address: 1, x: 0.2, y: 0.2 },
      { id: 'hz', name: 'Hazer', typeId: 'gen-hazer', mode: '', universe: 0, address: 2, x: 0.6, y: 0.2 });
    app.show.cueLists.push(
      { id: 'L', name: 'Looks', end: 'stop', play: false, cues: [
        { id: 'l1', name: 'Warm', values: { p1: { intensity: 1 } }, fade: 0, advance: { mode: 'manual' } },
        { id: 'l2', name: 'Cool', values: { p1: { intensity: 0.4 } }, fade: 0, advance: { mode: 'manual' } },
        { id: 'l3', name: 'Smoky', values: { p1: { intensity: 0.4 }, hz: { haze: 0.3 } }, fade: 0, advance: { mode: 'manual' } }] },
      { id: 'H', name: 'Haze', end: 'stop', play: false, cues: [{ id: 'h1', name: 'Haze', values: { hz: { haze: 0.5 } }, fade: 0, advance: { mode: 'manual' } }] });
    app.checkpoint();
  };
  it('stays stopped through looks that don\'t fog (tapped or GO); a look that hazes brings it back', async () => {
    const { app, tick } = await freshApp();
    hazeShow(app);
    app.jump('L', 0); app.jump('H', 0); tick(3);
    app.stopHaze(); tick(2);
    app.fireWidget({ id: 'w2', type: 'cue', list: 'L', cue: 'l2' }, true); tick(3);
    expect(app.stage.hz.haze ?? 0).toBe(0);
    app.chooseLiveList('L'); app.go('L'); tick(3);
    expect(app.status.L.cue).toBe('l3');
    expect(app.stage.hz.haze).toBeGreaterThan(0.4);                  // Smoky hazes: the stop is over (the Haze list's 50 % wins)
  });
});

describe('the page closing', () => {
  it('sends the fog machines a 0 first (the box holds the last frame it got)', async () => {
    const { app, sent, tick } = await freshApp();
    smallShow(app);
    app.show.cueLists[0].cues[0].values.fg = { fog: 1 };
    app.jump('L', 0); tick(3);
    expect(sent.filter((x) => x.uni === 0).at(-1)!.data[2]).toBe(255);
    window.dispatchEvent(new Event('pagehide'));
    const last = sent.filter((x) => x.uni === 0).at(-1)!.data;
    expect(last[2]).toBe(0);                                        // fog off
    expect(last[0]).toBeGreaterThan(0);                             // the look stays
  });
});

describe('a new effect', () => {
  it('is named after what it runs on, and numbered when that name is taken', async () => {
    const { app } = await freshApp();
    for (let i = 1; i <= 3; i++) app.show.fixtures.push({ id: `s${i}`, name: `Strip A ${i}`, typeId: 'gen-rgb', mode: '', universe: 0, address: i * 3 - 2, x: 0.1 * i, y: 0.2 });
    app.show.fixtures.push({ id: 'p', name: 'PAR 1', typeId: 'gen-rgb', mode: '', universe: 0, address: 20, x: 0.5, y: 0.5 });
    app.show.groups.push({ id: 'g', name: 'Window', fixtures: ['p'] });
    expect(app.addEffect('chase', { fixtures: ['s1', 's2', 's3'] }).name).toBe('Chase on Strip As');
    expect(app.addEffect('chase', { fixtures: ['s1', 's2', 's3'] }).name).toBe('Chase on Strip As 2');
    expect(app.addEffect('rainbow', { fixtures: ['p'] }).name).toBe('Rainbow on Window');
    expect(app.addEffect('rainbow', { fixtures: ['s1', 'p'] }).name).toBe('Rainbow');
  });
});

describe('round 13 review', () => {
  it('a cue is named Fog or Haze by the machines that make it', async () => {
    const { app } = await freshApp();
    app.show.fixtures.push(
      { id: 'fm', name: 'Fog', typeId: 'gen-fog', mode: '', universe: 0, address: 1, x: 0.2, y: 0.2 },
      { id: 'hz', name: 'Hazer', typeId: 'gen-hazer', mode: '', universe: 0, address: 5, x: 0.6, y: 0.2 });
    expect(app.suggestName({ fm: { fog: 1 }, hz: { haze: 0 } })).toBe('Fog');
    expect(app.suggestName({ hz: { haze: 0.5 } })).toBe('Haze');
    expect(app.suggestName({ fm: { fog: 1 }, hz: { haze: 0.5 } })).toBe('Fog');
  });
  it('Auto GO never steps a staff page of looks (locking there switches it off)', async () => {
    const { app, tick } = await freshApp();
    smallShow(app);
    const { looksPage } = await import('./content/busking');
    app.ownPages();
    const p = looksPage(app.show, 'staff');
    app.show.pages.push(p);
    app.page = 'staff'; app.view = 'live';
    app.autoGo = 1;
    app.lockShow(true);
    expect(app.autoGo).toBe(0);
    app.autoGo = 1;                                         // (back by a cold start: the tick still won't)
    let T = 100; app.engine.now = () => T;
    tick(1);
    app.fireWidget(p.widgets.find((w: any) => w.cue === 'c1'), true);
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) { T += 0.2; tick(); seen.add(app.status.L.cue); }
    expect([...seen]).toEqual(['c1']);
  });
});

describe('a song playing on the timeline', () => {
  it('sets the tempo and the beat clock: its beats, counted from its first downbeat', async () => {
    const { app, tick } = await freshApp();
    smallShow(app);
    app.show.timeline = { duration: 60, bpm: 150, offset: 1, items: [] };
    expect(app.bpm).toBe(app.show.settings.bpm);
    app.timeline.seek(5);
    await app.timeline.play();
    tick(1);
    expect(app.bpm).toBe(150);
    expect(app.engine.beatCount).toBeGreaterThan(9.9);              // (5 s - 1 s) at 150 BPM = 10 beats
    expect(app.engine.beatCount).toBeLessThan(10.6);
    app.timeline.pause();
    expect(app.bpm).toBe(app.show.settings.bpm);                    // stopped: the show's own tempo again
  });
});
