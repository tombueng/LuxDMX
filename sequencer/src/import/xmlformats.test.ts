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
    const m = t.modes[0];
    expect(m.channels.map((c) => c.attr)).toEqual(expect.arrayContaining(['intensity', 'red', 'green', 'blue', 'white']));
    const out = render(m, { intensity: 1, color: { r: 0, g: 1, b: 0 } });
    expect(byAttr(out, 'green')).toBe(255);
    expect(byAttr(out, 'red')).toBe(0);
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
