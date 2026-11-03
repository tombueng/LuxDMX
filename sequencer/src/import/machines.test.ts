// @vitest-environment happy-dom
// Effect machines from fixture files get the attributes the safety model works on: confetti,
// flames, sparks and CO2 gated (0 on the wire until armed), fog and haze as fog and haze (never a
// dimmer, off when the page closes). Real QLC+ files (testdata/, copies from the QLC+ library),
// OFL and GDTF fixtures written here, and lights that must stay what they were.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { fromQxf } from './qxf';
import { fromOfl } from './ofl';
import { fromGdtf } from './gdtf';
import { machineKind, machineAttrs, machineSpan } from './machines';
import { renderFixture } from '../engine/render';
import { Engine } from '../engine/engine';
import { emptyShow } from '../model/format';
import { ATTR_RISK, enableValue, isGated, riskOf } from '../model/safety';
import { ATTR_GROUPS } from '../ui/attrs';
import type { Fixture, FixtureMode, FixtureType, Resolved, Show } from '../model/types';

const qxf = (f: string) => fromQxf(fs.readFileSync(`src/import/testdata/${f}`, 'utf8'), f);
const chs = (m: FixtureMode) => m.channels.map((c) => `${c.name}=${c.attr}`);
const mode = (t: FixtureType, name: string) => t.modes.find((m) => m.name === name)!;
const fx = { id: 'a', name: 'a', typeId: 't', mode: '', universe: 0, address: 1, x: 0, y: 0 } as Fixture;
function render(m: FixtureMode, v: Resolved) {
  const b = new Uint8Array(512); renderFixture(fx, m, v, b);
  return [...b.slice(0, m.channels.length)];
}
// The whole engine with this type patched at address 1: what reaches the wire.
function wire(t: FixtureType, modeName = '') {
  const show: Show = { ...emptyShow(), fixtureTypes: [t], fixtures: [{ ...fx, id: 'm', typeId: t.id, mode: modeName }] };
  let now = 0;
  const e = new Engine(() => show, () => now);
  const at = (s: number) => { now = s; return [...e.tick().frames.get(0)!.slice(0, 8)]; };
  return { e, at };
}

describe('real QLC+ machines', () => {
  it('MagicFX Stage Flame: Fire is a flame, its Safety follows the arming ("LIVE" while armed)', () => {
    const t = qxf('MagicFX-Stage-Flame.qxf');
    expect(chs(t.modes[0])).toEqual(['Safety=enable', 'Fire=flame']);
    expect(enableValue(t.modes[0].channels[0].ranges)).toEqual({ on: 127, off: 0 });       // LIVE is 101..153; 255 would be SAFE
    expect(riskOf(t.modes[0].channels.map((c) => c.attr))).toBe('hazard');
    expect(render(t.modes[0], { flame: 1 })).toEqual([0, 255]);
    expect(render(t.modes[0], { flame: 0 })).toEqual([0, 0]);
  });

  it('MagicFX Stage Flame at full sends 0 until armed, then fires', () => {
    const w = wire(qxf('MagicFX-Stage-Flame.qxf'));
    w.e.programmer = { m: { flame: 1, intensity: 1 } };
    expect(w.at(0)[1]).toBe(0);
    expect(w.at(0.5)[1]).toBe(0);
    w.e.programmer = {}; w.e.armed = true; w.at(1);
    w.e.programmer = { m: { flame: 1 } };
    expect(w.at(1.1)[1]).toBe(255);
    w.e.armed = false;
    expect(w.at(1.2)[1]).toBe(0);
  });

  it('MagicFX Psyco2Jet: the valve and GO are CO2; angle, speed and presets stay what they are', () => {
    const t = qxf('MagicFX-Psyco2Jet.qxf');
    expect(chs(mode(t, 'RAW'))).toEqual(['Safety=enable', 'Angle=tilt', 'Speed=speed', 'Output=co2']);
    expect(chs(mode(t, 'Preset'))).toEqual(['Safety=enable', 'Preset=raw', 'Speed=speed', 'Direction=control', 'GO=co2']);
    expect(enableValue(mode(t, 'RAW').channels[0].ranges)).toEqual({ on: 128, off: 0 });    // "Device enabled"; the top is a test mode
    for (const m of t.modes) expect(riskOf(m.channels.map((c) => c.attr))).toBe('hazard');
    expect(render(mode(t, 'RAW'), { co2: 1 })[3]).toBe(255);             // 200..255: valve open
    expect(render(mode(t, 'RAW'), { co2: 0 })[3]).toBe(0);
  });

  it('MagicFX Eco2Jet (QLC+ calls it "Smoke"): its effect channel is CO2, in both modes', () => {
    const t = qxf('MagicFX-Eco2Jet.qxf');
    expect(chs(mode(t, 'Standard Personality'))).toEqual(['Enable=enable', 'Effect=co2']);
    expect(chs(mode(t, 'Extended Personality'))).toEqual(['Enable=enable', 'Effect=co2', 'Heater=control']);
    expect(enableValue(mode(t, 'Standard Personality').channels[0].ranges)).toEqual({ on: 127, off: 0 });   // "Enable", not "pre-Enable"
    const w = wire(t, 'Standard Personality');
    w.e.programmer = { m: { co2: 1 } };
    expect(w.at(0)[1]).toBe(0);
  });

  it('Stairville AF-180: the fog amount is fog, not a dimmer; its LEDs stay a light', () => {
    // (the "Co2 FX" in its name is the look of its fog: it has no CO2 channel)
    const t = qxf('Stairville-AF-180-LED-Fogger-Co2-FX.qxf');
    const m = t.modes[0];
    expect(chs(m)).toEqual(['Amount of Fog=fog', 'Brightness of All LEDs=intensity', 'Colour effect=colorWheel', 'Stroboscope Effect=raw',
      'Intensity Colour Effect Red=red', 'Intensity Colour Effect Green=green', 'Intensity Colour Effect Blue=blue']);
    expect(m.channels[0].span).toBeUndefined();                          // fog 0 is DMX 0 (0..9: no fog)
    expect(riskOf(m.channels.map((c) => c.attr))).toBe('atmosphere');
    // a flash or a blinder (full white) lights the LEDs and doesn't fog the room
    expect(render(m, { intensity: 1, color: { r: 1, g: 1, b: 1 } }).slice(0, 2)).toEqual([0, 255]);
    expect(render(m, { fog: 1 })[0]).toBe(255);
    expect(render(m, { fog: 0, intensity: 1 })[0]).toBe(0);
  });

  it('a PAR with a "Fire effect" program and a "Fog" named macro stays a light', () => {
    const xml = `<?xml version='1.0' encoding='UTF-8'?><FixtureDefinition xmlns="http://www.qlcplus.org/FixtureDefinition">
      <Manufacturer>Acme</Manufacturer><Model>Fire PAR 7</Model><Type>Color Changer</Type>
      <Channel Name="Dimmer" Preset="IntensityMasterDimmer"/><Channel Name="Red" Preset="IntensityRed"/>
      <Channel Name="Fire effect"><Group Byte="0">Effect</Group><Capability Min="0" Max="9">Off</Capability><Capability Min="10" Max="255">Fire flicker</Capability></Channel>
      <Channel Name="Flame macro"><Group Byte="0">Effect</Group><Capability Min="0" Max="255">Flame colours</Capability></Channel>
      <Mode Name="4ch"><Channel Number="0">Dimmer</Channel><Channel Number="1">Red</Channel><Channel Number="2">Fire effect</Channel><Channel Number="3">Flame macro</Channel></Mode>
      </FixtureDefinition>`;
    expect(chs(fromQxf(xml).modes[0])).toEqual(['Dimmer=intensity', 'Red=red', 'Fire effect=raw', 'Flame macro=raw']);
  });

  it('a home-made .qxf confetti cannon ("Effect" type, a "Fire" channel) fires confetti, not flames', () => {
    const xml = `<FixtureDefinition xmlns="http://www.qlcplus.org/FixtureDefinition">
      <Manufacturer>Me</Manufacturer><Model>Confetti cannon</Model><Type>Effect</Type>
      <Channel Name="Fire"><Group Byte="0">Effect</Group><Capability Min="0" Max="127">Off</Capability><Capability Min="128" Max="255">Shoot</Capability></Channel>
      <Mode Name="1ch"><Channel Number="0">Fire</Channel></Mode></FixtureDefinition>`;
    expect(chs(fromQxf(xml).modes[0])).toEqual(['Fire=confetti']);
  });
});

describe('Open Fixture Library machines', () => {
  it('a flame machine: the flame channel and its height are gated, the safety channel stays put', () => {
    const j = { name: 'Test flame', categories: ['Effect'], availableChannels: {
      Safety: { capability: { type: 'Maintenance' } },
      Flame: { capabilities: [{ dmxRange: [0, 9], type: 'NoFunction' }, { dmxRange: [10, 255], type: 'Effect', effectName: 'Flame' }] },
      Height: { capability: { type: 'Intensity' } },
    }, modes: [{ name: '3ch', channels: ['Safety', 'Flame', 'Height'] }] };
    const m = fromOfl('x/flame', j, 'X').modes[0];
    expect(m.channels.map((c) => c.attr)).toEqual(['control', 'flame', 'flame']);
    expect(m.channels[1].span).toBeUndefined();
    expect(render(m, { flame: 0, intensity: 1 })).toEqual([0, 0, 0]);   // a flash never raises the flame
  });

  it('a fog machine with a dead band: fog 0 reaches the wire as 0 (it used to send 10, fog on)', () => {
    const j = { name: 'Fogger 900', categories: ['Smoke'], availableChannels: {
      Fog: { capabilities: [{ dmxRange: [0, 9], type: 'NoFunction' }, { dmxRange: [10, 255], type: 'Fog', fogType: 'Fog' }] },
    }, modes: [{ name: '1ch', channels: ['Fog'] }] };
    const m = fromOfl('x/fogger', j, 'X').modes[0];
    expect(m.channels[0].attr).toBe('fog');
    expect(render(m, { fog: 0 })).toEqual([0]);
    expect(render(m, { fog: 1 })).toEqual([255]);
  });

  it('a fog machine whose output came in as a dimmer is fog; with LEDs, the LED dimmer stays a dimmer', () => {
    const j = { name: 'LED Fogger', categories: ['Smoke', 'Color Changer'], availableChannels: {
      'Fog Volume': { capability: { type: 'Intensity' } },
      Dimmer: { capability: { type: 'Intensity' } },
      Red: { capability: { type: 'ColorIntensity', color: 'Red' } },
      Fan: { capability: { type: 'Speed', speedStart: 'slow', speedEnd: 'fast' } },
    }, modes: [{ name: '4ch', channels: ['Fog Volume', 'Dimmer', 'Red', 'Fan'] }] };
    expect(fromOfl('x/led-fogger', j, 'X').modes[0].channels.map((c) => c.attr)).toEqual(['fog', 'intensity', 'red', 'raw']);
  });

  it('a hazer: its output is haze, its fan a fan', () => {
    const j = { name: 'Hz 1', categories: ['Hazer'], availableChannels: {
      Output: { capability: { type: 'Intensity' } },
      'Fan Speed': { capability: { type: 'Intensity' } },
    }, modes: [{ name: '2ch', channels: ['Output', 'Fan Speed'] }] };
    expect(fromOfl('x/hz', j, 'X').modes[0].channels.map((c) => c.attr)).toEqual(['haze', 'fan']);
  });

  it('a cold spark machine and a CO2 jet named by their own words', () => {
    const spark = { name: 'Sparkular', categories: ['Effect'], availableChannels: {
      Fountain: { capabilities: [{ dmxRange: [0, 15], type: 'NoFunction' }, { dmxRange: [16, 255], type: 'EffectParameter', parameterStart: 'low', parameterEnd: 'high' }] },
      Control: { capabilities: [{ dmxRange: [0, 10], type: 'Maintenance', comment: 'Pre-heat off' }, { dmxRange: [11, 255], type: 'NoFunction' }] },
    }, modes: [{ name: '2ch', channels: ['Fountain', 'Control'] }] };
    expect(fromOfl('showven/sparkular', spark, 'Showven').modes[0].channels.map((c) => c.attr)).toEqual(['sparks', 'control']);
    const jet = { name: 'Cryo Jet', categories: ['Effect'], availableChannels: {
      Safety: { capabilities: [{ dmxRange: [0, 99], type: 'Generic', comment: 'Disabled' }, { dmxRange: [100, 255], type: 'Generic', comment: 'Test mode (CO2 disabled)' }] },
      Go: { capabilities: [{ dmxRange: [0, 199], type: 'Generic', comment: 'Off' }, { dmxRange: [200, 255], type: 'Generic', comment: 'Valve on' }] },
    }, modes: [{ name: '2ch', channels: ['Safety', 'Go'] }] };
    expect(fromOfl('x/cryo-jet', jet, 'X').modes[0].channels.map((c) => c.attr)).toEqual(['raw', 'co2']);
  });

  it('a light that is also an "Effect" (a fireworks program) stays a light', () => {
    const j = { name: 'LS 600', categories: ['Dimmer', 'Effect'], availableChannels: {
      Intensity: { capability: { type: 'Intensity' } },
      Effects: { capabilities: [{ dmxRange: [0, 127], type: 'Effect', effectName: 'Fireworks' }, { dmxRange: [128, 255], type: 'Effect', effectName: 'Explosion' }] },
    }, modes: [{ name: '2ch', channels: ['Intensity', 'Effects'] }] };
    expect(fromOfl('x/ls', j, 'X').modes[0].channels.map((c) => c.attr)).toEqual(['intensity', 'raw']);
  });

  it('the fog machine from the library (Stairville M-Fog 1000) sends 0 for no fog', () => {
    const t = fromOfl('stairville/m-fog-1000', JSON.parse(fs.readFileSync('test/fixtures/ofl/stairville__m-fog-1000.json', 'utf8')), 'Stairville');
    const m = t.modes[0];
    const i = m.channels.findIndex((c) => c.attr === 'fog');
    expect(render(m, { fog: 0 })[i]).toBe(0);
    expect(render(m, { fog: 1 })[i]).toBe(255);
  });
});

describe('GDTF machines', () => {
  const gdtf = (name: string, channels: string) => fromGdtf(zipSync({ 'description.xml': strToU8(`<?xml version="1.0"?><GDTF DataVersion="1.1">
    <FixtureType Name="${name}" LongName="${name}" Manufacturer="LuxTest"><AttributeDefinitions><Attributes>
      <Attribute Name="Effects1" Pretty="Fx1"/><Attribute Name="Control1" Pretty="Ctrl1"/></Attributes></AttributeDefinitions>
    <DMXModes><DMXMode Name="Default" Geometry="Body"><DMXChannels>${channels}</DMXChannels></DMXMode></DMXModes></FixtureType></GDTF>`) }));
  const ch = (offset: number, attr: string, fns = `<ChannelFunction Attribute="${attr}" DMXFrom="0/1"/>`) =>
    `<DMXChannel DMXBreak="1" Offset="${offset}" Geometry="Body"><LogicalChannel Attribute="${attr}">${fns}</LogicalChannel></DMXChannel>`;

  it('a flame projector under general attributes: its effect and its dimmer fire flames, its safety follows the arming', () => {
    const t = gdtf('Flame Projector FP1', ch(1, 'Control1', '<ChannelFunction Attribute="Control1" Name="Safety on" DMXFrom="0/1"/><ChannelFunction Attribute="Control1" Name="Safety off" DMXFrom="128/1"/>')
      + ch(2, 'Effects1', '<ChannelFunction Attribute="Effects1" Name="Off" DMXFrom="0/1"/><ChannelFunction Attribute="Effects1" Name="Flame" DMXFrom="10/1"/>')
      + ch(3, 'Dimmer'));
    expect(t.modes[0].channels.map((c) => c.attr)).toEqual(['enable', 'flame', 'flame']);
    expect(t.modes[0].channels.filter((c) => isGated(c.attr))).toHaveLength(2);
    // its interlock: "Safety off" (open) while armed, "Safety on" while safe
    const v = enableValue(t.modes[0].channels[0].ranges);
    expect(v.off).toBe(0);
    expect(v.on).toBeGreaterThanOrEqual(128);
  });

  it('a fog machine: Fog(n), Fan(n) and Blower(n) as GDTF names them', () => {
    const t = gdtf('Fog 2000', ch(1, 'Fog1') + ch(2, 'Fan1') + ch(3, 'Blower1'));
    expect(t.modes[0].channels.map((c) => c.attr)).toEqual(['fog', 'fan', 'fan']);
  });

  it('a PAR with a "Fire" effect program stays a light', () => {
    const t = gdtf('LED PAR 7', ch(1, 'Dimmer') + ch(2, 'ColorAdd_R')
      + ch(3, 'Effects1', '<ChannelFunction Attribute="Effects1" Name="Fire" DMXFrom="0/1"/><ChannelFunction Attribute="Effects1" Name="Lightning" DMXFrom="128/1"/>'));
    expect(t.modes[0].channels.map((c) => c.attr)).toEqual(['intensity', 'red', 'raw']);
  });
});

describe('what kind of machine', () => {
  it('by type and by name; lights never', () => {
    expect(machineKind('maybe', 'MagicFX Stage Flame')).toBe('flame');
    expect(machineKind('maybe', 'Showven Sparkular')).toBe('sparks');
    expect(machineKind('smoke', 'MagicFX Eco2Jet')).toBe('co2');
    expect(machineKind('smoke', 'Stairville AF-180 LED Fogger Co2 FX')).toBe('fog');   // fog that looks like CO2
    expect(machineKind('maybe', 'MagicFX StadiumShot III')).toBe('confetti');
    expect(machineKind('maybe', 'Bubble machine')).toBe('bubbles');
    expect(machineKind('smoke', 'Martin ZR24/7 Hazer')).toBe('haze');
    expect(machineKind('hazer', 'Stairville M-Fog 1000')).toBe('haze');
    expect(machineKind('smoke', 'Generic Smoke')).toBe('fog');
    expect(machineKind('maybe', 'Acme Moonflower')).toBeUndefined();
    for (const w of ['Lanta Fireball P64', 'Microh Firefly', 'Fireworks PRO II', 'Pro-Lights Jet Wash19', 'beamZ SparkleWall', 'Stage Flame'])
      expect(machineKind('light', w)).toBeUndefined();
    expect(machineKind('maybe', 'beamZ SparkleWall')).toBeUndefined();
    expect(machineKind('maybe', 'Lanta Fireball P64')).toBeUndefined();
  });

  it('a dark "effect" fixture: what plainly fires it is gated, whatever it is', () => {
    const a = machineAttrs('maybe', 'Acme X1', [
      { name: 'Enable', attr: 'control', caps: ['Off', 'On'] },
      { name: 'Trigger', attr: 'raw', caps: [] },
      { name: 'Effect', attr: 'raw', caps: ['Valve closed', 'Valve open'] },
      { name: 'Speed', attr: 'speed', caps: [] },
    ]);
    expect(a).toEqual(['control', 'flame', 'co2', 'speed']);
    // ...and nothing in one that has colours (an LED effect light)
    expect(machineAttrs('maybe', 'Acme X2', [{ name: 'Red', attr: 'red', caps: [] }, { name: 'Trigger', attr: 'raw', caps: [] }]))
      .toEqual(['red', 'raw']);
  });
});

describe('machine levels', () => {
  it('fog runs from DMX 0, stopping below a prime or auto range; gated machines use the whole channel', () => {
    const r = (spec: [number, number, string][]) => spec.map(([from, to, label]) => ({ from, to, label }));
    expect(machineSpan('fog', r([[0, 9, 'No fog'], [10, 255, 'Fog output']]))).toBeUndefined();
    expect(machineSpan('haze', r([[0, 4, 'Zero output'], [5, 219, 'Proportional output'], [220, 255, 'Prime function']]))).toEqual([0, 219]);
    expect(machineSpan('fan', r([[0, 19, 'Fan off'], [20, 220, 'Fan speed'], [221, 240, 'Auto fan mode'], [241, 255, 'No function']]))).toEqual([0, 220]);
    expect(machineSpan('flame', r([[0, 100, 'Off'], [101, 200, 'Flame'], [201, 255, 'Test']]))).toBeUndefined();
  });
});

describe('the fixture editor and the channel wizard', () => {
  it('offer every machine, with the gated ones saying they wait for arming', () => {
    const offered = new Map(ATTR_GROUPS.flatMap((g) => g.attrs));
    for (const a of Object.keys(ATTR_RISK)) expect(offered.has(a as never), a).toBe(true);
    const machines = ATTR_GROUPS.find((g) => g.label === 'Machines')!.attrs.map(([a]) => a);
    expect(machines).toEqual(['confetti', 'bubbles', 'flame', 'sparks', 'co2', 'enable']);
    for (const [a, label] of ATTR_GROUPS.flatMap((g) => g.attrs)) if (isGated(a)) expect(label).toMatch(/only while armed/);
  });
});
