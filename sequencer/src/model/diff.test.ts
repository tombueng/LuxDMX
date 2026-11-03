import { describe, expect, it } from 'vitest';
import { describeChange } from './diff';
import { emptyShow } from './format';
import type { Fixture, Show } from './types';

const fx = (id: string, name: string, x = 0.5): Fixture => ({ id, name, typeId: 'gen-rgb', mode: '3ch', universe: 0, address: 1, x, y: 0.5 }) as Fixture;
const clone = (s: Show) => JSON.parse(JSON.stringify(s)) as Show;

describe('describeChange', () => {
  const a = emptyShow();
  a.fixtures = [fx('f1', 'Par 1'), fx('f2', 'Par 2')];

  it('names a single light that went', () => {
    const b = clone(a); b.fixtures.pop();
    expect(describeChange(a, b)).toBe('light “Par 2” removed');
  });
  it('counts several', () => {
    const b = clone(a); b.fixtures.push(fx('f3', 'Par 3'), fx('f4', 'Par 4'));
    expect(describeChange(a, b)).toBe('2 lights added');
  });
  it('a drag on the stage is a move', () => {
    const b = clone(a); b.fixtures[0].x = 0.1;
    expect(describeChange(a, b)).toBe('light “Par 1” moved');
  });
  it('a new order', () => {
    const b = clone(a); b.fixtures.reverse();
    expect(describeChange(a, b)).toBe('lights reordered');
  });
  it('cues by name, and the show name', () => {
    const b = clone(a);
    b.cueLists = [{ id: 'l', name: 'Main', cues: [{ id: 'c', name: 'Intro' }] }] as Show['cueLists'];
    expect(describeChange(a, b)).toBe('cue “Intro” added, cue list “Main” added');
    const c = clone(a); c.meta.name = 'Gig';
    expect(describeChange(a, c)).toBe('show renamed to “Gig”');
  });
});
