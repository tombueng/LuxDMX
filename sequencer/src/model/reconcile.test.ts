// reconcile: the live show brought to an undo step's by changing only what differs. Unchanged
// things keep their identity (Svelte redraws only what changed); the result equals the step.
import { describe, expect, it } from 'vitest';
import { reconcile } from './reconcile';

const RAW = Object.create(Object.prototype);
const raw = <T extends object>(x: T): T => Object.setPrototypeOf(x, RAW);
const deepEq = (a: unknown, b: unknown) => expect(JSON.parse(JSON.stringify(a))).toEqual(JSON.parse(JSON.stringify(b)));

describe('reconcile', () => {
  it('ends equal to the step; what didn\'t change keeps its identity', () => {
    const live = { name: 'x', fixtures: [{ id: 'a', name: 'A', p3: { x: 1 } }, { id: 'b', name: 'B' }], settings: { bpm: 120 } };
    const keepA = live.fixtures[0], keepB = live.fixtures[1], keepSettings = live.settings, keepList = live.fixtures;
    const step = JSON.parse(JSON.stringify(live)); step.fixtures[1].name = 'B2';
    const r = reconcile(live, step);
    expect(r).toBe(live); deepEq(live, step);
    expect(live.fixtures).toBe(keepList); expect(live.fixtures[0]).toBe(keepA); expect(live.fixtures[1]).toBe(keepB); expect(live.settings).toBe(keepSettings);
    expect(keepB.name).toBe('B2');
  });
  it('things added, removed and moved: matched by id, new ones in their places', () => {
    const live = { list: [{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'c', v: 3 }] };
    const a = live.list[0], c = live.list[2];
    const step = { list: [{ id: 'c', v: 3 }, { id: 'd', v: 4 }, { id: 'a', v: 1 }] };
    reconcile(live, step);
    deepEq(live, step);
    expect(live.list[0]).toBe(c); expect(live.list[2]).toBe(a);
  });
  it('fields gone go, new ones come; values of another kind are taken as they are', () => {
    const live: Record<string, unknown> = { a: 1, b: { x: 1 }, c: [1, 2, 3], d: 'z' };
    const step = { a: 2, b: [1], c: [1, 2], e: null };
    reconcile(live, step);
    deepEq(live, step); expect('d' in live).toBe(false);
  });
  it('raw things (the fixture types, cell maps) are never changed in place: the same as before stays, else the new one', () => {
    const t1 = raw({ id: 'gen', modes: [{ ch: 3 }] }), live = { types: [t1] };
    reconcile(live, { types: [raw({ id: 'gen', modes: [{ ch: 3 }] })] });
    expect(live.types[0]).toBe(t1);
    const t2 = raw({ id: 'gen', modes: [{ ch: 4 }] });
    reconcile(live, { types: [t2] });
    expect(live.types[0]).toBe(t2); expect(t1.modes[0].ch).toBe(3);
  });
  it('an effect\'s params are a new object when they changed (the engine caches by them), the same one when not', () => {
    const live = { effects: [{ id: 'e', params: { formula: 'sin(t)', speed: 2 } }] }, p0 = live.effects[0].params;
    reconcile(live, { effects: [{ id: 'e', params: { formula: 'sin(t)', speed: 2 } }] });
    expect(live.effects[0].params).toBe(p0);
    reconcile(live, { effects: [{ id: 'e', params: { formula: 'cos(t)', speed: 2 } }] });
    expect(live.effects[0].params).not.toBe(p0); expect(p0.formula).toBe('sin(t)'); expect(live.effects[0].params.formula).toBe('cos(t)');
  });
  it('says when a field came back into a thing that was there (its text may list it elsewhere); not otherwise', () => {
    const n1 = { moved: false }, live: Record<string, unknown> = { a: 1, b: 2 };
    reconcile(live, { a: 3, b: 2 }, n1); expect(n1.moved).toBe(false);
    expect(JSON.stringify(live)).toBe(JSON.stringify({ a: 3, b: 2 }));
    const n2 = { moved: false };
    reconcile(live, { z: 0, a: 3, b: 2 }, n2); expect(n2.moved).toBe(true);
    expect(JSON.stringify(live)).not.toBe(JSON.stringify({ z: 0, a: 3, b: 2 }));    // (why it's said)
    const n3 = { moved: false }, l3 = { list: [{ id: 'a', v: 1 }] };
    reconcile(l3, { list: [{ id: 'a', v: 1 }, { id: 'b', v: 2, w: 3 }] }, n3); expect(n3.moved).toBe(false);
    expect(JSON.stringify(l3)).toBe(JSON.stringify({ list: [{ id: 'a', v: 1 }, { id: 'b', v: 2, w: 3 }] }));
  });
});
