// Cut / copy / paste for cues, fixtures and presets. Goes through the system clipboard as JSON, so
// it works between shows and browser tabs; a copy kept here covers browsers that won't let a page
// read the clipboard without asking.
import type { FixtureType } from '../model/types';

export type ClipKind = 'cues' | 'fixtures' | 'presets' | 'groups' | 'effects';
export interface Clip {
  luxdmxClipboard: 1;
  kind: ClipKind;
  items: unknown[];
  types?: FixtureType[];          // fixture types the items need (pasting fixtures into another show)
  show?: string;                  // the show it was copied from
  names?: Record<string, string>; // fixture id -> name, so cues pasted into another show find their lights
}

let local: Clip | null = null;

// The browser may ask the person before a page reads the clipboard, and that question can stand
// open for good. Nothing here waits on it longer than this: a copy made here is good enough.
const within = <T>(p: Promise<T>, ms: number): Promise<T | undefined> => Promise.race([p, new Promise<undefined>((done) => setTimeout(done, ms))]);
async function mayRead() {
  try { return (await navigator.permissions.query({ name: 'clipboard-read' as PermissionName })).state === 'granted'; } catch { return false; }
}

export async function copyClip(kind: ClipKind, items: unknown[], types?: FixtureType[], extra: Pick<Clip, 'show' | 'names'> = {}) {
  local = { luxdmxClipboard: 1, kind, items: JSON.parse(JSON.stringify(items)), types, ...extra };
  try { await within(navigator.clipboard.writeText(JSON.stringify(local)), 300); } catch { /* not allowed: the local copy is enough */ }
}

export async function readClip(kind: ClipKind): Promise<Clip | null> {
  const mine: Clip | null = local?.kind === kind ? JSON.parse(JSON.stringify(local)) : null;
  // With a copy of our own, only look further if that needs no question (it may be newer: another
  // tab's). Without one, asking is worth it: it's the only way to get what another tab copied.
  if (!mine || await mayRead()) {
    try {
      const text = await within(navigator.clipboard.readText(), mine ? 300 : 8000);
      const j = text ? JSON.parse(text) : null;
      if (j?.luxdmxClipboard === 1 && j.kind === kind) return j;
    } catch { /* no permission or not ours */ }
  }
  return mine;
}
