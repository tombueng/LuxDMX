<script lang="ts">
  // Every key in one sheet. Opened with ? (or from the menu).
  import Modal from './Modal.svelte';
  let { onclose }: { onclose: () => void } = $props();
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const C = mac ? '⌘' : 'Ctrl';
  const GROUPS: [string, [string, string][]][] = [
    ['Everywhere', [[`${C}+K`, 'Find anything: a light, a cue, an effect, a command'], [`${C}+Z`, 'Undo'], [`${C}+Shift+Z`, 'Redo'], ['?', 'This sheet'], ['Esc', 'Close a dialog or menu, cancel a rename, clear a selection (lists, the stage)'], [`${C}+S`, 'Save now (it saves by itself anyway)'], [`${C}+Shift+S`, 'Save the show as a file'], [`${C}+Y`, 'Redo']]],
    ['Lists (fixtures, effects, cues)', [['Click, Shift+click, Ctrl+click', 'Select one, a range, add or remove one'], ['↑ ↓ (← → for cues)', 'Move the selection'], ['Shift+arrows', 'Extend the selection'], ['Alt+arrows', 'Move the selected items'], [`${C}+C / X / V`, 'Copy, cut, paste (also between shows)'], [`${C}+D`, 'Duplicate'], ['Delete', 'Delete'], [`${C}+A`, 'Select all'], ['Enter', 'Open (fixtures, effects) or go to (cues)'], ['F2', 'Rename (cues, groups)'], ['P', 'Start or stop the selected effects'], ['Right-click, long press, Menu key or Shift+F10', 'Everything else']]],
    ['Stage', [['Drag on the floor', 'Select with a box (Shift adds)'], ['Drag a light', 'Move it (and the other selected ones); it snaps to the rows and columns of the others, Alt drags freely'], ['Arrows (stage focused)', 'Move the selected lights (Shift: bigger steps)'], [`${C}+A / Esc / Delete (stage focused)`, 'Select every light, none, remove the selected'], ['Mouse wheel / pinch', 'Zoom'], ['Middle button / two fingers', 'Pan']]],
    ['Playing', [['Space', 'GO on the current cue list (Live: the first one); on a button you got to with Tab, presses it'], ['Enter on a cue', 'Go straight to it'], ['Keys on live buttons', 'Press them; hold for flash and fog'], ['B (Live)', 'Blackout on / off'], ['Hold the padlock', 'Unlock a page locked for the show (or hold Enter or Space on it)'], ['Alt+arrows (Live Edit)', 'Move the focused control']]],
    ['Timeline', [['Space', 'Play or pause the song'], ['Home / End', 'The start or the end of the song'], ['← →', 'A bar back or on'], ['P', 'A new part of the song at the bar line nearest the playhead'], ['Delete', 'Remove what is selected on the tracks'], [`${C}+wheel`, 'Zoom']]],
    ['Programmer', [['1 … 9, 0, F', 'Intensity of the selected lights: 10 … 90%, off, full'], ['R', 'Record a cue'], ['Arrows on the position pad', 'Nudge the heads (Shift: bigger steps)'], ['Arrows on the colour wheel', 'Change the colour']]],
    ['Cells (pixel lights)', [['Alt+click a pixel on the plan', 'Pick that cell (Alt again takes it out)'], ['Arrows, Space (the cell picture)', 'Move the blue ring, pick the cell under it'], ['Alt+drag a box (the cell picture)', 'Take the cells in it out']]],
    ['Console', [['Typing anywhere on it', 'Goes to the command line: 1 thru 4 @ 50, group 2 @ full, 1.3, goto cue 5, record cue 5, next'], ['↑ in the command line', 'The last command again'], ['@ 5 / @ 05 / @ 5%', '50 % (one digit is tens) / 5 % / 5 %'], ['1 - 4', 'Light 1 without 4 (a run is 1 thru 4, or 1>4)'], ['Space', 'GO on the list Live plays'], ['Arrows, Page Up/Down, Home, End (a fader)', 'Move it; Home is 0, End is full'], ['Arrows, Enter (an encoder)', 'Turn it (Shift: fine), type a value']]],
    ['Tools', [['← → (Check the patch)', 'The previous or next light'], ['Arrows, Enter (DMX output)', 'Move between channels, select the fixture'], ['↑ ↓ Enter (fixture library)', 'Pick a result, load it, use it']]],
  ];
</script>

<Modal title="Keyboard and mouse" {onclose} wide>
  <div class="cols">
    {#each GROUPS as [title, rows] (title)}
      <section>
        <h2>{title}</h2>
        <dl>{#each rows as [k, v] (k)}<dt><span class="kbd">{k}</span></dt><dd>{v}</dd>{/each}</dl>
      </section>
    {/each}
  </div>
</Modal>

<style>
  .cols { columns: 2 320px; column-gap: 1.6rem; }
  section { break-inside: avoid; margin-bottom: 1rem; }
  h2 { margin-bottom: .4rem; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: .35rem .8rem; margin: 0; align-items: baseline; }
  dt { white-space: nowrap; } dd { margin: 0; color: var(--muted); font-size: .9rem; }
  /* a narrow window (a phone, 400 % zoom): one column, each key over what it does */
  @media (max-width: 420px) { .cols { columns: 1; } dl { grid-template-columns: minmax(0, 1fr); } dt { white-space: normal; } }
</style>
