<script lang="ts">
  // The ideas in a few minutes of reading, for when the "?" bubbles aren't enough. Opened from the
  // menu, Ctrl+K, or the welcome card; never by itself.
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  let { onclose }: { onclose: () => void } = $props();
  const parts: [string, string, string[]][] = [
    ['par', 'Fixtures', ['Your lights. Pick a type when you add them: most cheap PARs are one of the generic types (the manual\'s channel table says which), the library has 2400+ others, or make your own (the channel wizard finds the channels by trying them on the real light).', 'Each one sits at a DMX address on a universe, like on the fixture\'s display.']],
    ['eye', 'Select and set', ['Click lights on the stage or in the list (Shift for a range, Ctrl to add, drag a box). The programmer on the right sets them: intensity, colour, position, everything else under "All channels".', 'Keys: 1 to 9 set 10 to 90 %, F full, 0 off.']],
    ['record', 'Cues', ['Record stores what you changed as a cue: a look plus a fade time. Only the lights you touched go in; everything else keeps doing what it did. GO (or Space) steps to the next cue.', 'A cue can wait for GO or go on by itself after some seconds or beats; that\'s how a chase is made.']],
    ['loop', 'Cue lists', ['Several lists can run at once: the show on one, house lights on another, a fog timer on a third. Brightness: the highest wins. Everything else: the list that moved last wins.']],
    ['palette', 'Presets', ['Named looks (colours, positions...). Cues remember the preset, not the value: change "Warm white" once and every cue using it follows.']],
    ['effect', 'Effects', ['Chases, rainbows, circles, fire... Pick one and it runs on the selected lights at once. Record while it runs and it\'s in the cue. They follow the tempo: Tap, or let the microphone find the beat (♪).']],
    ['live', 'Live', ['Big buttons for playing the show: looks, GO, flash, fog (only while held), faders. Works with touch, keys and MIDI pads. Edit the page to make it yours.']],
    ['sliders', 'Console', ['A small lighting desk on the screen (its tab, or the ⋯ menu on a tablet or phone): type "1 thru 4 @ 50", "group 2 @ full", "1.3" for cell 3 of light 1, "record cue 5", "goto cue 5", "undo" or "help"; lights go by their own number. Faders per light, masters per group, encoders, cue list faders with GO, and MIDI learn on every fader.', 'Pixel lights have cells: pick single LEDs in the programmer (Cells) and give them their own colour, in cues, effects and groups.']],
    ['sfx', 'Blind, on stage, and the machines', ['Every browser starts Blind: the stage here shows what you do, the real lights keep the look they had. Press Blind (top right) to send what you do to the stage; one click goes back to blind (fog, haze and the machines stop then).', 'Confetti, flames, sparks and CO2 send nothing until you hold Arm for a moment, and an armed one stops by itself after a few seconds. Dragging along the timeline never fires them.']],
    ['folder', 'Shows and files', ['Everything is saved in this browser as you go. Save a file for a backup or another computer; QLC+ workspaces open too. Nothing is sent anywhere except DMX to your LuxDMX.']],
  ];
</script>

<Modal title="How it works" {onclose} wide>
  <div class="g">
    {#each parts as [icon, title, text] (title)}
      <section>
        <h3><span class="i"><Icon name={icon} size={18} /></span>{title}</h3>
        {#each text as p (p)}<p>{p}</p>{/each}
      </section>
    {/each}
  </div>
  <p class="faint">More: the ? next to each panel, <span class="kbd">?</span> for every key, <span class="kbd">Ctrl+K</span> to find anything.</p>
</Modal>

<style>
  .g { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: .4rem 1.4rem; }
  section { break-inside: avoid; }
  h3 { display: flex; align-items: center; gap: .45rem; font-size: .95rem; margin: .6rem 0 .25rem; }
  .i { color: var(--accent); display: inline-flex; }
  p { margin: 0 0 .4rem; color: var(--muted); line-height: 1.45; font-size: .9rem; }
</style>
