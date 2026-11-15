// When an update is put in by itself (src/pwa.ts): only when the app is quiet (nothing playing or
// held, the show saved) and nobody is busy with it (hidden, or no key or click for a while).
import { expect, it } from 'vitest';
import { readyToUpdate } from './pwa';

it('an update goes in only when quiet and nobody is at the keys; never while something plays', () => {
  expect(readyToUpdate(true, false, 120_000)).toBe(true);
  expect(readyToUpdate(true, false, 10_000)).toBe(false);          // (someone's busy with it)
  expect(readyToUpdate(true, true, 0)).toBe(true);                 // (in the background)
  expect(readyToUpdate(false, true, 1e9)).toBe(false);             // (a show playing: never)
  expect(readyToUpdate(false, false, 1e9)).toBe(false);
  expect(readyToUpdate(true, false, 0, 0)).toBe(true);
});
