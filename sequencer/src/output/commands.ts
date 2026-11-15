// The engine's commands the page also sends to the output thread (host.svelte.ts wraps them, thread.ts
// applies them at their own moment): what changes what plays. A renamed engine method fails here.
import type { Engine } from '../engine/engine';

export const COMMANDS = ['go', 'back', 'jumpTo', 'start', 'refresh', 'toggle', 'release', 'stop', 'releaseAll', 'flash', 'alignBeat', 'syncBeats', 'releaseFlashes',
  'setMaster', 'wake', 'faderReleased', 'jumpQuiet', 'actQuiet', 'backdate', 'forget', 'startEffect', 'stopEffect', 'toggleEffect', 'flashEffect', 'takeLiveEffects',
  'giveBackEffects', 'stopAllEffects', 'muteCueEffects', 'act'] as const satisfies readonly (keyof Engine)[];
export type Command = (typeof COMMANDS)[number];
