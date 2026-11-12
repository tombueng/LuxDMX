// @vitest-environment happy-dom
// The beam and effect channels of a pro spot from each format: two gobo wheels (each with its own
// rotation), prism rotation, an animation wheel, the light's built-in effects and their speed, its
// colour programs. And what goes out for them.
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { fromGdtf } from './gdtf';
import { fromOfl } from './ofl';
import { fromQxf } from './qxf';
import { renderFixture } from '../engine/render';
import type { Fixture, FixtureMode, Resolved } from '../model/types';

const attrs = (m: FixtureMode) => m.channels.map((c) => c.attr);
const render = (m: FixtureMode, v: Resolved) => { const b = new Uint8Array(512); renderFixture({ id: 'f', name: 'f', typeId: 't', mode: '', universe: 0, address: 1, x: 0, y: 0 } as Fixture, m, v, b); return [...b.slice(0, m.channels.length)]; };

describe('GDTF', () => {
  const slots = (n: number) => Array.from({ length: n }, (_, i) => `<Slot Name="Slot ${i + 1}"/>`).join('');
  const sets = (attr: string, wheel: string, n: number) => `<ChannelFunction Attribute="${attr}" Wheel="${wheel}" DMXFrom="0/1">${Array.from({ length: n }, (_, i) => `<ChannelSet Name="${wheel} ${i + 1}" DMXFrom="${i * 10}/1" WheelSlotIndex="${i + 1}"/>`).join('')}</ChannelFunction>`;
  const ch = (offset: number, attr: string, fns = `<ChannelFunction Attribute="${attr}" DMXFrom="0/1"/>`) =>
    `<DMXChannel DMXBreak="1" Offset="${offset}" Geometry="Body"><LogicalChannel Attribute="${attr}">${fns}</LogicalChannel></DMXChannel>`;
  const t = fromGdtf(zipSync({ 'description.xml': strToU8(`<?xml version="1.0"?><GDTF DataVersion="1.1">
    <FixtureType Name="Spot 9" Manufacturer="LuxTest"><Wheels><Wheel Name="Gobo1">${slots(4)}</Wheel><Wheel Name="Gobo2">${slots(5)}</Wheel></Wheels>
    <DMXModes><DMXMode Name="Default" Geometry="Body"><DMXChannels>
      ${ch(1, 'Dimmer')}${ch(2, 'Gobo1', sets('Gobo1', 'Gobo1', 4))}${ch(3, 'Gobo2', sets('Gobo2', 'Gobo2', 5))}${ch(4, 'Gobo2PosRotate')}${ch(5, 'Prism1PosRotate')}
      ${ch(6, 'AnimationWheel1')}${ch(7, 'AnimationWheel1PosRotate')}
      ${ch(8, 'Effects1', '<ChannelFunction Attribute="Effects1" DMXFrom="0/1"><ChannelSet Name="Off" DMXFrom="0/1"/><ChannelSet Name="Rainbow" DMXFrom="20/1"/><ChannelSet Name="Fire" DMXFrom="40/1"/></ChannelFunction>')}
      ${ch(9, 'Effects1Rate')}${ch(10, 'ColorMacro1', '<ChannelFunction Attribute="ColorMacro1" DMXFrom="0/1"><ChannelSet Name="None" DMXFrom="0/1"/><ChannelSet Name="Sunset" DMXFrom="100/1"/></ChannelFunction>')}
    </DMXChannels></DMXMode></DMXModes></FixtureType></GDTF>`) }), 'spot9.gdtf');
  const m = t.modes[0];
  it('each channel is what it says', () => {
    expect(attrs(m)).toEqual(['intensity', 'gobo', 'gobo2', 'gobo2Rotation', 'prismRotation', 'animation', 'animationRotation', 'effectMacro', 'effectSpeed', 'colorMacro']);
  });
  it('the second gobo wheel, an effect and a colour program are picked by their place in their list', () => {
    const b = render(m, { intensity: 1, gobo2: 1, effectMacro: 0.5, colorMacro: 1, effectSpeed: 0.5, prismRotation: 1 });
    expect(b[2]).toBe(Math.round((40 + 255) / 2));     // gobo 2's last slot (40..255)
    expect(b[7]).toBe(Math.round((20 + 39) / 2));      // "Rainbow", the middle of three
    expect(b[9]).toBe(Math.round((100 + 255) / 2));    // "Sunset"
    expect(b[8]).toBe(128);
    expect(b[4]).toBe(255);
    // nothing set: their defaults (not driven)
    expect(render(m, { intensity: 1 }).slice(2, 10)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('Open Fixture Library', () => {
  const j = { name: 'Spot 9', categories: ['Moving Head'],
    wheels: {
      'Static Gobo Wheel': { slots: [{ type: 'Open' }, { type: 'Gobo', name: 'Dots' }, { type: 'Gobo', name: 'Star' }] },
      'Rotating Gobo Wheel': { slots: [{ type: 'Open' }, { type: 'Gobo', name: 'Ring' }] },
    },
    availableChannels: {
      'Rotating Gobo Wheel': { capabilities: [{ dmxRange: [0, 99], type: 'WheelSlot', slotNumber: 1 }, { dmxRange: [100, 255], type: 'WheelSlot', slotNumber: 2 }] },
      'Static Gobo Wheel': { capabilities: [{ dmxRange: [0, 49], type: 'WheelSlot', slotNumber: 1 }, { dmxRange: [50, 149], type: 'WheelSlot', slotNumber: 2 }, { dmxRange: [150, 255], type: 'WheelSlot', slotNumber: 3 }] },
      'Gobo Rotation': { capability: { type: 'WheelSlotRotation', wheel: 'Rotating Gobo Wheel', speedStart: 'slow CW', speedEnd: 'fast CW' } },
      'Prism Rotation': { capability: { type: 'PrismRotation', speedStart: 'slow CW', speedEnd: 'fast CW' } },
      'Program': { capabilities: [{ dmxRange: [0, 9], type: 'NoFunction' }, { dmxRange: [10, 255], type: 'Effect', effectName: 'Auto show' }] },
      'Program Speed': { capability: { type: 'EffectSpeed', speedStart: 'slow', speedEnd: 'fast' } },
    },
    modes: [{ name: '6ch', channels: ['Static Gobo Wheel', 'Rotating Gobo Wheel', 'Gobo Rotation', 'Prism Rotation', 'Program', 'Program Speed'] }] };
  it('the second wheel (by the order of the mode) is gobo 2, and the rotation goes with its own wheel', () => {
    expect(attrs(fromOfl('x/spot9', j, 'X').modes[0])).toEqual(['gobo', 'gobo2', 'gobo2Rotation', 'prismRotation', 'effectMacro', 'effectSpeed']);
  });
  it('a colour preset channel is the light\'s colour programs (at its default until picked)', () => {
    const bar = { name: 'Bar', categories: ['Pixel Bar'], availableChannels: {
      Red: { capability: { type: 'ColorIntensity', color: 'Red' } },
      Presets: { capabilities: [{ dmxRange: [0, 9], type: 'NoFunction' }, { dmxRange: [10, 255], type: 'ColorPreset', comment: 'Rainbow' }] },
    }, modes: [{ name: '2ch', channels: ['Red', 'Presets'] }] };
    const m = fromOfl('x/bar', bar, 'X').modes[0];
    expect(attrs(m)).toEqual(['red', 'colorMacro']);
    expect(render(m, { intensity: 1, color: { r: 1, g: 0, b: 0 } })).toEqual([255, 0]);
  });
});

describe('QLC+', () => {
  const xml = `<?xml version='1.0' encoding='UTF-8'?><FixtureDefinition xmlns="http://www.qlcplus.org/FixtureDefinition">
    <Manufacturer>Acme</Manufacturer><Model>Spot 9</Model><Type>Moving Head</Type>
    <Channel Name="Gobo 1" Preset="GoboWheel"/><Channel Name="Gobo 2" Preset="GoboWheel"/>
    <Channel Name="Gobo 1 rot"><Group Byte="0">Gobo</Group><Capability Min="0" Max="255">Rotation</Capability></Channel>
    <Channel Name="Gobo 2 rot"><Group Byte="0">Gobo</Group><Capability Min="0" Max="255">Rotation</Capability></Channel>
    <Channel Name="Prism rot" Preset="PrismRotationSlowFast"/>
    <Channel Name="Auto"><Group Byte="0">Effect</Group><Capability Min="0" Max="9">Off</Capability><Capability Min="10" Max="255">Show 1</Capability></Channel>
    <Channel Name="Auto speed"><Group Byte="0">Effect</Group><Capability Min="0" Max="255">Speed</Capability></Channel>
    <Channel Name="Colour macro"><Group Byte="0">Colour</Group><Capability Min="0" Max="9">Off</Capability><Capability Min="10" Max="255">Fade</Capability></Channel>
    <Mode Name="8ch">${['Gobo 1', 'Gobo 2', 'Gobo 1 rot', 'Gobo 2 rot', 'Prism rot', 'Auto', 'Auto speed', 'Colour macro'].map((n, i) => `<Channel Number="${i}">${n}</Channel>`).join('')}</Mode>
    </FixtureDefinition>`;
  it('two gobo wheels and their rotations in order, prism rotation, the built-in effects, colour programs', () => {
    expect(attrs(fromQxf(xml).modes[0])).toEqual(['gobo', 'gobo2', 'goboRotation', 'gobo2Rotation', 'prismRotation', 'effectMacro', 'effectSpeed', 'colorMacro']);
  });
});

describe('GDTF RDM ids', () => {
  it('maker, model and the mode each personality is', () => {
    const t = fromGdtf(zipSync({ 'description.xml': strToU8(`<?xml version="1.0"?><GDTF DataVersion="1.2">
      <FixtureType Name="Head" Manufacturer="LuxTest"><DMXModes>
        <DMXMode Name="Basic" Geometry="Body"><DMXChannels><DMXChannel DMXBreak="1" Offset="1" Geometry="Body"><LogicalChannel Attribute="Dimmer"><ChannelFunction Attribute="Dimmer" DMXFrom="0/1"/></LogicalChannel></DMXChannel></DMXChannels></DMXMode>
        <DMXMode Name="Extended" Geometry="Body"><DMXChannels><DMXChannel DMXBreak="1" Offset="1" Geometry="Body"><LogicalChannel Attribute="Dimmer"><ChannelFunction Attribute="Dimmer" DMXFrom="0/1"/></LogicalChannel></DMXChannel></DMXChannels></DMXMode>
      </DMXModes><Protocols><FTRDM ManufacturerID="0x4C55" DeviceModelID="0x0010"><SoftwareVersionID Value="0x01">
        <DMXPersonality Value="0x0001" DMXMode="Basic"/><DMXPersonality Value="0x0002" DMXMode="Extended"/><DMXPersonality Value="0x0003" DMXMode="Nope"/>
      </SoftwareVersionID></FTRDM></Protocols></FixtureType></GDTF>`) }), 'head.gdtf');
    expect(t.rdm).toEqual({ maker: 0x4c55, model: 0x10, modes: { 1: 'Basic', 2: 'Extended' } });
  });
});
