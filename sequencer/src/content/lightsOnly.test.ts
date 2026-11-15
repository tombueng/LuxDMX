// "Lights only" from the welcome: a template's or a demo's rig, nothing programmed.
import { describe, expect, it } from 'vitest';
import { lightsOnly } from './lightsOnly';
import { TEMPLATES } from './templates';
import { DEMOS } from './demos';

describe('lights only', () => {
  it('keeps the lights, where they are, the groups and the palettes; drops cues, effects, pages', () => {
    const full = TEMPLATES[0].build(), s = lightsOnly(full);
    expect(s.fixtures).toEqual(full.fixtures);
    expect(s.groups).toEqual(full.groups);
    expect(s.presets).toEqual(full.presets);
    expect(s.fixtureTypes).toEqual(full.fixtureTypes);
    expect([s.cueLists.length, s.effects.length, s.pages.length]).toEqual([0, 0, 0]);
    expect(s.meta.name).toBe(`${full.meta.name} (lights only)`);
  });
  it('a demo: its room stays, its song and set list go', () => {
    const full = DEMOS.find((d) => d.id === 'club')!.build(), s = lightsOnly(full);
    expect(full.timeline).toBeTruthy();
    expect('timeline' in s).toBe(false);
    expect('setlist' in s).toBe(false);
    expect(s.settings.stage3d?.room).toBe('club');
    expect(s.fixtures.length).toBe(full.fixtures.length);
  });
});
