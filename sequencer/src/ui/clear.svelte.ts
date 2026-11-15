// Clear: let go of what's set by hand, the cues take over again. The programmer isn't part of the
// show's undo, so the toast has an Undo of its own that puts it back. One way for every Clear
// button (Program, the console, Live): one of them cleared without a way back.
import { app } from '../app.svelte';
import { ui } from './ui.svelte';

export function clearProgrammer(said = 'Cleared: the cues have their lights back') {
  const keep = $state.snapshot(app.programmer);
  if (!Object.keys(keep).length) return;
  app.clearProgrammer();
  ui.toast(said, 4000, { label: 'Undo', run: () => { app.programmer = keep; } });
}
