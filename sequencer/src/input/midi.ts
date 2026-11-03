// MIDI controllers (pads, knobs, faders) for the live pages, through Web MIDI (Chrome, Edge,
// Opera; Firefox asks for an add-on; Safari has none). Every incoming note or control change goes
// to one listener; "learn" hands the next one to whoever asked.
export interface MidiMsg { kind: 'note' | 'cc'; ch: number; num: number; value: number }   // value 0..1
export interface MidiBinding { kind: 'note' | 'cc'; ch: number; num: number }

type Listener = (m: MidiMsg) => void;
let access: MIDIAccess | null = null;
let listener: Listener | null = null;
let learn: ((m: MidiMsg) => void) | null = null;
let inputs: string[] = [];
const watchers = new Set<(names: string[]) => void>();

export const midiSupported = () => typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
export const midiReady = () => !!access;
export function onMidiInputs(f: (names: string[]) => void) { watchers.add(f); f(inputs); return () => watchers.delete(f); }

// Ask for MIDI (the browser may show a prompt). Resolves to the input names.
export async function enableMidi(): Promise<string[]> {
  if (!midiSupported()) throw new Error('This browser has no Web MIDI (Chrome and Edge do)');
  if (!access) {
    access = await navigator.requestMIDIAccess({ sysex: false });
    access.onstatechange = () => attach();
  }
  attach();
  return inputs;
}
function attach() {
  if (!access) return;
  inputs = [];
  // a device that was unplugged can stay in the map for a while, marked disconnected
  access.inputs.forEach((inp) => { if (inp.state === 'disconnected') return; inp.onmidimessage = (e) => handle(e.data); inputs.push(inp.name ?? 'MIDI input'); });
  for (const w of watchers) w(inputs);
}

// Raw MIDI bytes -> a message. Note on with velocity 0 is a note off (most pads send that).
export function parseMidi(d: Uint8Array | null): MidiMsg | null {
  if (!d || d.length < 3) return null;
  const type = d[0] & 0xf0, ch = (d[0] & 0x0f) + 1;
  if (type === 0x90) return { kind: 'note', ch, num: d[1], value: d[2] / 127 };
  if (type === 0x80) return { kind: 'note', ch, num: d[1], value: 0 };
  if (type === 0xb0) return { kind: 'cc', ch, num: d[1], value: d[2] / 127 };
  return null;
}
function handle(d: Uint8Array | null) {
  const m = parseMidi(d);
  if (!m) return;
  if (learn && (m.kind === 'cc' || m.value > 0)) { const l = learn; learn = null; l(m); return; }
  listener?.(m);
}
export function onMidi(f: Listener | null) { listener = f; }
// The next note or control that arrives goes to f instead of the pages.
export function learnMidi(f: ((m: MidiMsg) => void) | null) { learn = f; }
export const sameBinding = (b: MidiBinding | undefined, m: MidiMsg) => !!b && b.kind === m.kind && b.ch === m.ch && b.num === m.num;
export const bindingLabel = (b: MidiBinding) => `${b.kind === 'note' ? 'Note' : 'CC'} ${b.num} · ch ${b.ch}`;
