// MIDI that can't start says why in plain words, not the browser's error text.
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
const refuse = (name: string) => vi.stubGlobal('navigator', { requestMIDIAccess: () => Promise.reject(Object.assign(new Error(`${name}: whatever the browser says`), { name })) });

describe('MIDI refused', () => {
  it('blocked: where to allow it', async () => {
    refuse('NotAllowedError');
    const { enableMidi } = await import('./midi');
    await expect(enableMidi()).rejects.toThrow(/blocked for this page: allow it in the site settings/);
  });
  it('anything else: plain words, never the raw error', async () => {
    refuse('AbortError');
    const { enableMidi } = await import('./midi');
    await expect(enableMidi()).rejects.toThrow("MIDI couldn't start here. Plug the controller in and try again");
  });
});
