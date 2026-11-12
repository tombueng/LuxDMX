// @vitest-environment happy-dom
// QLC+ .qxf and GDTF imports on real files (QLC+ library at a pinned commit, an MIT GDTF from
// python-gdtf) plus a GDTF moving head written here, all checked by what we'd send them.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { fromQxf } from './qxf';
import { fromGdtf, xyYToHex } from './gdtf';
import { renderFixture } from '../engine/render';
import type { Fixture, FixtureMode, Resolved } from '../model/types';

const qxf = (f: string) => fromQxf(fs.readFileSync(`test/fixtures/qxf/${f}`, 'utf8'), f);
const fx = { id: 'a', name: 'a', typeId: 't', mode: '', universe: 0, address: 1, x: 0, y: 0 } as Fixture;
function render(m: FixtureMode, v: Resolved) {
  const b = new Uint8Array(512); renderFixture(fx, m, v, b);
  return m.channels.map((c, i) => [c.name, c.attr, b[i]] as const);
}
const byAttr = (r: ReturnType<typeof render>, a: string) => r.find(([, at]) => at === a)?.[2];

describe('QLC+ .qxf', () => {
  it('Stairville PAR (channel presets)', () => {
    const t = qxf('Stairville-LED-PAR-36-COB-RGBW-12W.qxf');
    expect(t.manufacturer).toBe('Stairville');
    const m = t.modes.find((x) => x.channels.length === 8)!;
    expect(m.channels.map((c) => c.attr)).toEqual(expect.arrayContaining(['red', 'green', 'blue', 'white', 'intensity', 'shutter']));
    const out = render(m, { intensity: 1, color: { r: 1, g: 0, b: 0 } });
    expect(byAttr(out, 'red')).toBe(255);
    expect(byAttr(out, 'intensity')).toBe(255);
    const sh = m.channels.find((c) => c.attr === 'shutter')!;
    const open = sh.ranges!.find((r) => r.kind === 'open')!;
    expect(byAttr(out, 'shutter')).toBeGreaterThanOrEqual(open.from);
    expect(byAttr(out, 'shutter')).toBeLessThanOrEqual(open.to);
  });

  it('Robe Robin 600E Spot: moving head with wheels', () => {
    const t = qxf('Robe-Robin-600E-Spot.qxf');
    // its lens, and other files' (a beam without a zoom: the same twice; "0 to 3.8": 3.8)
    expect(t.physical?.beamDeg).toEqual([10, 45]);
    expect(qxf('Clay-Paky-Sharpy.qxf').physical?.beamDeg).toEqual([3.8, 3.8]);
    expect(qxf('Stairville-LED-PAR-36-COB-RGBW-12W.qxf').physical?.beamDeg).toEqual([60, 60]);
    const m = t.modes.reduce((a, b) => (b.channels.length > a.channels.length ? b : a));
    const attrs = m.channels.map((c) => c.attr);
    expect(attrs).toEqual(expect.arrayContaining(['pan', 'tilt', 'intensity', 'cyan', 'magenta', 'yellow', 'gobo']));
    expect(m.channels.some((c) => c.attr === 'pan' && c.fine)).toBe(true);
    const out = render(m, { intensity: 1, color: { r: 0, g: 0, b: 1 }, pan: 0.5, tilt: 0.5 });
    // subtractive: blue = cyan + magenta, no yellow
    expect([byAttr(out, 'cyan'), byAttr(out, 'magenta'), byAttr(out, 'yellow')]).toEqual([255, 255, 0]);
  });

  it('Clay Paky Sharpy: colour wheel slots carry colours', () => {
    const t = qxf('Clay-Paky-Sharpy.qxf');
    const m = t.modes[0];
    const wheel = m.channels.find((c) => c.attr === 'colorWheel')!;
    expect(wheel.ranges!.filter((r) => r.color).length).toBeGreaterThan(5);
    const out = render(m, { intensity: 1, color: { r: 1, g: 0, b: 0 } });
    const v = byAttr(out, 'colorWheel')!;
    expect(wheel.ranges!.find((r) => r.from <= v && v <= r.to)!.label.toLowerCase()).toContain('red');
  });

  it('Showtec pixel bar: heads become cells', () => {
    const t = qxf('Showtec-Pixel-Bar-12-RGBW.qxf');
    const m = t.modes.reduce((a, b) => (b.channels.length > a.channels.length ? b : a));
    const cells = new Set(m.channels.filter((c) => c.cell !== undefined).map((c) => c.cell));
    expect(cells.size).toBe(12);
  });

  it('rejects things that are not fixture definitions', () => {
    expect(() => fromQxf('<Workspace/>')).toThrow(/not a QLC\+ fixture/);
    expect(() => fromQxf('not xml at all <')).toThrow();
  });
});

describe('GDTF', () => {
  it('a real file (LED PAR 64 RGBW, MIT, from python-gdtf)', () => {
    const t = fromGdtf(new Uint8Array(fs.readFileSync('test/fixtures/gdtf/BlenderDMX@LED_PAR_64_RGBW@v0.3.gdtf')));
    expect(t.source).toBe('gdtf');
    expect(t.physical?.beamDeg).toEqual([60, 60]);                // (its beam's BeamAngle)
    const m = t.modes[0];
    expect(m.channels.map((c) => c.attr)).toEqual(expect.arrayContaining(['intensity', 'red', 'green', 'blue', 'white']));
    const out = render(m, { intensity: 1, color: { r: 0, g: 1, b: 0 } });
    expect(byAttr(out, 'green')).toBe(255);
    expect(byAttr(out, 'red')).toBe(0);
  });

  it('two heads: each head is a cell, its pan (on its yoke), its tilt and its colour', () => {
    const ch = (o: number, geo: string, attr: string) => `<DMXChannel DMXBreak="1" Offset="${o}" Geometry="${geo}"><LogicalChannel Attribute="${attr}"><ChannelFunction Attribute="${attr}" DMXFrom="0/1"/></LogicalChannel></DMXChannel>`;
    const head = (k: number, o: number) => ch(o, `Yoke${k}`, 'Pan') + ch(o + 1, `Head${k}`, 'Tilt') + ch(o + 2, `Head${k}`, 'ColorAdd_R') + ch(o + 3, `Head${k}`, 'ColorAdd_G') + ch(o + 4, `Head${k}`, 'ColorAdd_B');
    const xml = `<?xml version="1.0"?><GDTF DataVersion="1.1"><FixtureType Name="Twin" LongName="Twin head" Manufacturer="LuxTest">
      <DMXModes><DMXMode Name="10ch" Geometry="Base"><DMXChannels>${head(1, 1)}${head(2, 6)}</DMXChannels></DMXMode></DMXModes></FixtureType></GDTF>`;
    const t = fromGdtf(zipSync({ 'description.xml': strToU8(xml) }));
    const m = t.modes[0];
    expect(m.channels.map((c) => [c.attr, c.cell])).toEqual([
      ['pan', 0], ['tilt', 0], ['red', 0], ['green', 0], ['blue', 0],
      ['pan', 1], ['tilt', 1], ['red', 1], ['green', 1], ['blue', 1],
    ]);
  });

  it('pixels on a grid in the geometry: a matrix layout, wired as the file says', () => {
    const file = (order: [number, number][]) => {
      const geo = order.map(([x, z], i) => `<Geometry Name="Px${i + 1}" Position="{1,0,0,${x}}{0,1,0,0}{0,0,1,${z}}{0,0,0,1}"/>`).join('');
      const chs = order.map((_, i) => `<DMXChannel DMXBreak="1" Offset="${i + 1}" Geometry="Px${i + 1}"><LogicalChannel Attribute="ColorAdd_R"><ChannelFunction Attribute="ColorAdd_R" DMXFrom="0/1"/></LogicalChannel></DMXChannel>`).join('');
      const xml = `<?xml version="1.0"?><GDTF DataVersion="1.1"><FixtureType Name="Panel" LongName="Panel" Manufacturer="LuxTest">
        <Geometries><Geometry Name="Body" Position="{1,0,0,0}{0,1,0,0}{0,0,1,1}{0,0,0,1}">${geo}</Geometry></Geometries>
        <DMXModes><DMXMode Name="4ch" Geometry="Body"><DMXChannels>${chs}</DMXChannels></DMXMode></DMXModes></FixtureType></GDTF>`;
      return fromGdtf(zipSync({ 'description.xml': strToU8(xml) })).modes[0];
    };
    // top left, top right, bottom left, bottom right: rows from the top
    expect(file([[-0.1, 0.1], [0.1, 0.1], [-0.1, -0.1], [0.1, -0.1]]).layout).toEqual({ kind: 'matrix', cols: 2, rows: 2 });
    // snaking: the second row runs back
    const z = file([[-0.1, 0.1], [0, 0.1], [0.1, 0.1], [0.1, -0.1], [0, -0.1], [-0.1, -0.1]]).layout;
    expect(z).toMatchObject({ kind: 'matrix', cols: 3, rows: 2, zigzag: true });
    // a row of pixels: no layout (a row is what it is anyway)
    expect(file([[-0.2, 0], [-0.1, 0], [0.1, 0], [0.2, 0]]).layout).toBeUndefined();
  });

  it('xyY colours become sRGB', () => {
    expect(xyYToHex('0.64,0.33,100')).toBe('#ff0000');
    expect(xyYToHex('0.3127,0.3290,100')).toMatch(/^#f[ef]f[ef]f[ef]$/);
  });

  it('a moving head: 16-bit position, colour wheel, gobo, shutter ranges', () => {
    const xml = `<?xml version="1.0"?><GDTF DataVersion="1.1"><FixtureType Name="Spot" LongName="Test Spot 300" Manufacturer="LuxTest">
      <Wheels><Wheel Name="Color1"><Slot Name="Open" Color="0.3127,0.3290,100"/><Slot Name="Red" Color="0.64,0.33,20"/><Slot Name="Blue" Color="0.15,0.06,10"/></Wheel>
              <Wheel Name="Gobo1"><Slot Name="Open"/><Slot Name="Star"/><Slot Name="Dots"/></Wheel></Wheels>
      <DMXModes><DMXMode Name="Standard" Geometry="Base"><DMXChannels>
        <DMXChannel DMXBreak="1" Offset="1,2" Geometry="Yoke"><LogicalChannel Attribute="Pan"><ChannelFunction Attribute="Pan" DMXFrom="0/1" Default="32768/2" PhysicalFrom="-270" PhysicalTo="270"/></LogicalChannel></DMXChannel>
        <DMXChannel DMXBreak="1" Offset="3,4" Geometry="Head"><LogicalChannel Attribute="Tilt"><ChannelFunction Attribute="Tilt" DMXFrom="0/1" Default="32768/2" PhysicalFrom="-135" PhysicalTo="135"/></LogicalChannel></DMXChannel>
        <DMXChannel DMXBreak="1" Offset="5" Geometry="Head"><LogicalChannel Attribute="Dimmer"><ChannelFunction Attribute="Dimmer" DMXFrom="0/1"/></LogicalChannel></DMXChannel>
        <DMXChannel DMXBreak="1" Offset="6" Geometry="Head"><LogicalChannel Attribute="Color1"><ChannelFunction Attribute="Color1" Wheel="Color1" DMXFrom="0/1">
          <ChannelSet Name="Open" DMXFrom="0/1" WheelSlotIndex="1"/><ChannelSet Name="Red" DMXFrom="20/1" WheelSlotIndex="2"/><ChannelSet Name="Blue" DMXFrom="40/1" WheelSlotIndex="3"/></ChannelFunction></LogicalChannel></DMXChannel>
        <DMXChannel DMXBreak="1" Offset="7" Geometry="Head"><LogicalChannel Attribute="Gobo1"><ChannelFunction Attribute="Gobo1" Wheel="Gobo1" DMXFrom="0/1">
          <ChannelSet Name="Open" DMXFrom="0/1" WheelSlotIndex="1"/><ChannelSet Name="Star" DMXFrom="10/1" WheelSlotIndex="2"/><ChannelSet Name="Dots" DMXFrom="20/1" WheelSlotIndex="3"/></ChannelFunction></LogicalChannel></DMXChannel>
        <DMXChannel DMXBreak="1" Offset="8" Geometry="Head"><LogicalChannel Attribute="Shutter1">
          <ChannelFunction Attribute="Shutter1" Name="Closed" DMXFrom="0/1"/><ChannelFunction Attribute="Shutter1" Name="Open" DMXFrom="32/1"/>
          <ChannelFunction Attribute="Shutter1Strobe" Name="Strobe" DMXFrom="64/1"/><ChannelFunction Attribute="Shutter1" Name="Open 2" DMXFrom="200/1"/></LogicalChannel></DMXChannel>
        <DMXChannel DMXBreak="1" Offset="9" Geometry="Head"><LogicalChannel Attribute="Zoom"><ChannelFunction Attribute="Zoom" DMXFrom="0/1"/></LogicalChannel></DMXChannel>
        <DMXChannel DMXBreak="1" Offset="" Geometry="Head"><LogicalChannel Attribute="Dimmer"><ChannelFunction Attribute="Dimmer" DMXFrom="0/1"/></LogicalChannel></DMXChannel>
      </DMXChannels></DMXMode></DMXModes></FixtureType></GDTF>`;
    const t = fromGdtf(zipSync({ 'description.xml': strToU8(xml) }));
    expect(t.manufacturer).toBe('LuxTest');
    expect(t.physical).toEqual({ panDeg: 540, tiltDeg: 270 });
    const m = t.modes[0];
    expect(m.channels.map((c) => c.attr + (c.fine ? '*' : ''))).toEqual(['pan', 'pan*', 'tilt', 'tilt*', 'intensity', 'colorWheel', 'gobo', 'shutter', 'zoom']);
    let out = render(m, { intensity: 1, color: { r: 0.9, g: 0.1, b: 0.1 }, pan: 0.5, tilt: 0.5, gobo: 0.5, zoom: 1 });
    expect(out.map(([, , v]) => v)).toEqual([128, 0, 128, 0, 255, 30, 15, 48, 255]);   // middle of: red slot 20..39, gobo "Star" 10..19, shutter open 32..63
    out = render(m, { intensity: 1, strobe: 0.5 });
    const strobe = out[7][2];
    expect(strobe).toBeGreaterThanOrEqual(64);
    expect(strobe).toBeLessThanOrEqual(199);
  });

  it('rejects things that are not GDTF', () => {
    expect(() => fromGdtf(new Uint8Array([1, 2, 3]))).toThrow(/not a GDTF/);
    expect(() => fromGdtf(zipSync({ 'x.txt': strToU8('hi') }))).toThrow(/no description/);
  });
});

describe('GDTF: a moving bar\'s heads', () => {
  it('tilt on each head\'s axis and the colour on its beam below are one cell; the bar\'s pan is the whole light\'s', () => {
    const head = (k: number) => `<Axis Name="Head${k}" Position="{1,0,0,${k * 0.3}}{0,1,0,0}{0,0,1,0}{0,0,0,1}"><Beam Name="Beam${k}" BeamAngle="4"/></Axis>`;
    const ch = (off: number, geo: string, attr: string) => `<DMXChannel DMXBreak="1" Offset="${off}" Geometry="${geo}"><LogicalChannel Attribute="${attr}"><ChannelFunction Attribute="${attr}" DMXFrom="0/1"/></LogicalChannel></DMXChannel>`;
    const xml = `<?xml version="1.0"?><GDTF DataVersion="1.1"><FixtureType Name="Bar" LongName="Head bar 2" Manufacturer="LuxTest">
      <Geometries><Geometry Name="Base"><Axis Name="Bar">${head(1)}${head(2)}</Axis></Geometry></Geometries>
      <DMXModes><DMXMode Name="7ch" Geometry="Base"><DMXChannels>
        ${ch(1, 'Bar', 'Pan')}${ch(2, 'Head1', 'Tilt')}${ch(3, 'Beam1', 'Dimmer')}${ch(4, 'Beam1', 'ColorAdd_R')}${ch(5, 'Head2', 'Tilt')}${ch(6, 'Beam2', 'Dimmer')}${ch(7, 'Beam2', 'ColorAdd_R')}
      </DMXChannels></DMXMode></DMXModes></FixtureType></GDTF>`;
    const t = fromGdtf(zipSync({ 'description.xml': strToU8(xml) }));
    const m = t.modes[0];
    expect(m.channels.map((c) => [c.attr, c.cell ?? null])).toEqual([['pan', null], ['tilt', 0], ['intensity', 0], ['red', 0], ['tilt', 1], ['intensity', 1], ['red', 1]]);
    expect(t.physical?.beamDeg).toEqual([4, 4]);
  });
  it('a head\'s 16-bit tilt: its fine byte is that head\'s too', () => {
    const head = (k: number) => `<Axis Name="Head${k}"><Beam Name="Beam${k}"/></Axis>`;
    const ch = (off: string, geo: string, attr: string) => `<DMXChannel DMXBreak="1" Offset="${off}" Geometry="${geo}"><LogicalChannel Attribute="${attr}"><ChannelFunction Attribute="${attr}" DMXFrom="0/1"/></LogicalChannel></DMXChannel>`;
    const xml = `<?xml version="1.0"?><GDTF DataVersion="1.1"><FixtureType Name="Bar" LongName="Head bar 2" Manufacturer="LuxTest">
      <Geometries><Geometry Name="Base"><Axis Name="Bar">${head(1)}${head(2)}</Axis></Geometry></Geometries>
      <DMXModes><DMXMode Name="6ch" Geometry="Base"><DMXChannels>
        ${ch('1,2', 'Head1', 'Tilt')}${ch('3', 'Beam1', 'Dimmer')}${ch('4,5', 'Head2', 'Tilt')}${ch('6', 'Beam2', 'Dimmer')}
      </DMXChannels></DMXMode></DMXModes></FixtureType></GDTF>`;
    const m = fromGdtf(zipSync({ 'description.xml': strToU8(xml) })).modes[0];
    expect(m.channels.map((c) => [c.attr, !!c.fine, c.cell ?? null])).toEqual([['tilt', false, 0], ['tilt', true, 0], ['intensity', false, 0], ['tilt', false, 1], ['tilt', true, 1], ['intensity', false, 1]]);
  });
});
