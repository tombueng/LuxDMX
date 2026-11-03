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

export async function copyClip(kind: ClipKind, items: unknown[], types?: FixtureType[], extra: Pick<Clip, 'show' | 'names'> = {}) {
  local = { luxdmxClipboard: 1, kind, items: JSON.parse(JSON.stringify(items)), types, ...extra };
  try { await navigator.clipboard.writeText(JSON.stringify(local)); } catch { /* not allowed: the local copy is enough */ }
}

export async function readClip(kind: ClipKind): Promise<Clip | null> {
  try {
    const j = JSON.parse(await navigator.clipboard.readText());
    if (j?.luxdmxClipboard === 1 && j.kind === kind) return j;
  } catch { /* no permission or not ours */ }
  return local?.kind === kind ? JSON.parse(JSON.stringify(local)) : null;
}

