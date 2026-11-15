// The PIN as the show file keeps it: a hash, never the digits; the right PIN matches it, another
// doesn't; a show from before that kept the digits still unlocks with them, and gets the hash when
// it's opened (format.ts).
import { describe, expect, it } from 'vitest';
import { isPinHash, pinHash, pinMatches } from './pin';
import { upgrade } from './format';

describe('the PIN', () => {
  it('kept as a hash: not the digits, the same each time, different for another PIN', () => {
    const h = pinHash('4711');
    expect(isPinHash(h)).toBe(true);
    expect(h).not.toContain('4711');
    expect(pinHash(' 4711 ')).toBe(h);
    expect(pinHash('4712')).not.toBe(h);
    expect(new Set(['000', '001', '0001', '12345678', '87654321'].map(pinHash)).size).toBe(5);
  });
  it('the right PIN matches, another doesn\'t; the digits of a show from before still do', () => {
    expect(pinMatches(pinHash('4711'), '4711')).toBe(true);
    expect(pinMatches(pinHash('4711'), '1234')).toBe(false);
    expect(pinMatches('4711', '4711 ')).toBe(true);
    expect(pinMatches(undefined, '4711')).toBe(false);
  });
  it('a show file with the digits gets the hash when opened; a hash stays as it is; an empty one goes', () => {
    const open = (lockPin: unknown) => upgrade({ format: 'luxdmx-show', version: '1.2.0', name: 'x', settings: { bpm: 120, lockPin } }).settings.lockPin;
    expect(open('4711')).toBe(pinHash('4711'));
    expect(open(pinHash('999'))).toBe(pinHash('999'));
    expect(open('  ')).toBeUndefined();
    expect(open(42)).toBeUndefined();
  });
});
