<script lang="ts">
  import { SONG_NAME, SPECIAL_NAME } from './widgetFace';
  // Settings of the live control selected in Edit mode.
  import Icon from './Icon.svelte';
  import { app } from '../app.svelte';
  import { enableMidi, learnMidi, bindingLabel, midiSupported } from '../input/midi';
  import { ui } from './ui.svelte';
  import type { ListAction, Widget } from '../model/types';

  let { page, id, onremove, onclose }: { page: string; id: string; onremove: () => void; onclose: () => void } = $props();
  // Looked up in the show, so the edits land in the show's own object.
  const w = $derived(app.show.pages.find((p) => p.id === page)?.widgets.find((x) => x.id === id) as Widget);
  const ACTIONS: [ListAction, string][] = [
    ['go', 'GO: next cue'], ['toggle', 'On / off'], ['flash', 'Flash while held'], ['back', 'Back one cue'],
    ['release', 'Fade out'], ['solo', 'Solo: start it, fade the others out'], ['select', 'Make GO play it (set list)'],
  ];
  const listOf = (id: string) => app.show.cueLists.find((l) => l.id === id);
  let learning = $state(false);
  async function learn() {
    try { await enableMidi(); } catch (e) { ui.toast((e as Error).message); return; }
    learning = true;
    learnMidi((m) => { learning = false; w.midi = { kind: m.kind, ch: m.ch, num: m.num }; });
  }
  $effect(() => () => learnMidi(null));      // stop listening when the editor closes
  const KIND: Record<string, string> = { list: 'Cue list button', cue: 'Look', effect: 'Effect button', fader: 'Fader', group: 'Flash', fog: 'Fog', special: 'Button', label: 'Heading', cuelist: 'Cue list', song: 'Song button' };
  // Escape closes it (not while typing a name: there it only leaves the field)
  function esc(e: KeyboardEvent) { if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input, textarea, select') && !document.querySelector('[aria-modal="true"]')) { e.preventDefault(); onclose(); } }
</script>

<svelte:window onkeydown={esc} />
<aside class="we" aria-label="Control settings">
  <div class="row"><h2>{KIND[w.type] ?? 'Control'}{w.label ? `: ${w.label}` : ''}</h2><span class="grow"></span><button class="ghost" onclick={onclose} aria-label="Close settings" title="Close (Esc)"><Icon name="close" /></button></div>
  <label>Label <input bind:value={w.label} placeholder="(automatic)" aria-label="Label" /></label>

  {#if w.type === 'list'}
    <label>Cue list <select bind:value={w.list} aria-label="Cue list">{#each app.show.cueLists as l (l.id)}<option value={l.id}>{l.name}</option>{/each}</select></label>
    <label>Does <select bind:value={w.action} aria-label="Action">{#each ACTIONS as [a, t] (a)}<option value={a}>{t}</option>{/each}</select></label>
  {:else if w.type === 'cue'}
    <label>Cue list <select value={w.list} aria-label="Cue list" onchange={(e) => { w.list = (e.target as HTMLSelectElement).value; w.cue = listOf(w.list)?.cues[0]?.id ?? ''; }}>
      {#each app.show.cueLists as l (l.id)}<option value={l.id}>{l.name}</option>{/each}</select></label>
    <label>Cue <select bind:value={w.cue} aria-label="Cue">{#each listOf(w.list)?.cues ?? [] as c, i (c.id)}<option value={c.id}>{i + 1}. {c.name}</option>{/each}</select></label>
  {:else if w.type === 'effect'}
    <label>Effect <select bind:value={w.effect} aria-label="Effect">{#each app.show.effects as e (e.id)}<option value={e.id}>{e.name}</option>{/each}</select></label>
    <label>Does <select bind:value={w.action} aria-label="Action"><option value="toggle">On / off</option><option value="flash">Flash while held</option></select></label>
  {:else if w.type === 'fader'}
    <label>Controls <select value={w.target === 'list' || w.target === 'effect' ? `${w.target}:${w.ref}` : w.target} aria-label="Fader target" onchange={(e) => {
      const [t, ref] = (e.target as HTMLSelectElement).value.split(':');
      w.target = t as typeof w.target; w.ref = ref;
    }}>
      <option value="grand">Grand master</option><option value="bpm">Tempo</option>
      <optgroup label="Cue list level">{#each app.show.cueLists as l (l.id)}<option value="list:{l.id}">{l.name}</option>{/each}</optgroup>
      <optgroup label="Effect level">{#each app.show.effects as e (e.id)}<option value="effect:{e.id}">{e.name}</option>{/each}</optgroup>
    </select></label>
  {:else if w.type === 'fog'}
    <p class="faint">Fog only runs while the button is held, and switches off after the maximum even if it's still held.</p>
    <label>Output <input type="range" min="0.1" max="1" step="0.05" bind:value={w.level} aria-label="Fog output" /></label>
    <label>Maximum (s) <input type="number" min="1" max="60" value={w.max} aria-label="Maximum seconds" onchange={(e) => { const v = (e.target as HTMLInputElement).valueAsNumber; if (Number.isFinite(v)) w.max = Math.max(1, Math.min(60, v)); }} /></label>
    <div class="fx">
      {#each app.show.fixtures.filter((f) => app.caps(f.id).fog) as f (f.id)}
        <label class="ck"><input type="checkbox" checked={w.fixtures.includes(f.id)} onchange={(e) => { w.fixtures = (e.target as HTMLInputElement).checked ? [...w.fixtures, f.id] : w.fixtures.filter((x) => x !== f.id); }} />{f.name}</label>
      {:else}<p class="err">No fog or haze machine in the patch.</p>{/each}
    </div>
  {:else if w.type === 'group'}
    <label>Group <select bind:value={w.group} aria-label="Group">{#each app.show.groups as g (g.id)}<option value={g.id}>{g.name}</option>{/each}</select></label>
    <label>Level <input type="range" min="0" max="1" step="0.05" bind:value={w.level} aria-label="Flash level" /></label>
    <label>Strobe while held <input type="range" min="0" max="1" step="0.05" value={w.strobe ?? 0} oninput={(e) => (w.strobe = +(e.target as HTMLInputElement).value || undefined)} aria-label="Strobe" /></label>
    <label class="ck"><input type="checkbox" checked={!!w.white} onchange={(e) => { w.white = (e.target as HTMLInputElement).checked || undefined; }} /> White while held (a blinder), whatever colour they had</label>
  {:else if w.type === 'song'}
    <!-- the set list (Timeline): a name that was only the old action's goes with it -->
    <label>Does <select value={w.do} aria-label="Song action" onchange={(e) => { if (w.label === SONG_NAME[w.do]) w.label = undefined; w.do = (e.target as HTMLSelectElement).value as typeof w.do; }}>
      <option value="play">Play / pause the song</option><option value="next">Next song: the next one up, ready to play</option>
      <option value="part">Next part: on the next beat, on to the song's next part</option></select></label>
    <p class="faint">The songs are the set list on the Timeline. Going to the next song never darkens the stage, and a jump to the next part never fires what it skips.</p>
  {:else if w.type === 'cuelist'}
    <label>Cue list <select bind:value={w.list} aria-label="Cue list">{#each app.show.cueLists as l (l.id)}<option value={l.id}>{l.name}</option>{/each}</select></label>
    <p class="faint">All its cues, with their numbers, fades and notes. In the show a cue is jumped to by holding its row.</p>
  {:else if w.type === 'special'}
    <!-- a name that was only the old action's ("Blackout") goes with it: a blinder must never read Blackout -->
    <label>Does <select value={w.do} aria-label="Special action" onchange={(e) => { if (w.label === SPECIAL_NAME[w.do]) w.label = undefined; w.do = (e.target as HTMLSelectElement).value as typeof w.do; }}>
      <option value="blackout">Blackout on / off</option><option value="releaseAll">Release everything</option>
      <option value="tap">Tap the tempo</option><option value="stopEffects">Stop effects started by hand</option>
      <option value="blinder">Blinder: every light white while held</option><option value="drop">Drop: white, strobes and a fog burst while held</option>
      <option value="fadeOut">Fade out to black (and back in on the next press)</option></select></label>
    {#if w.do === 'fadeOut'}
      <label>Over <input type="number" min="0.5" max="60" step="0.5" value={w.seconds ?? 5} aria-label="Fade out time in seconds"
        onchange={(e) => { const v = (e.target as HTMLInputElement).valueAsNumber; if (Number.isFinite(v)) w.seconds = Math.max(0.5, Math.min(60, v)); }} /> s</label>
    {/if}
  {/if}

  {#if w.type !== 'label'}
    <div class="two">
      <label>Key <input maxlength="1" bind:value={w.key} placeholder="none" aria-label="Keyboard key" /></label>
      <label title="The button's own colour on this page (not the lights')">Button colour <input type="color" value={w.color ?? '#45d85c'} oninput={(e) => (w.color = (e.target as HTMLInputElement).value)} aria-label="Colour" /></label>
    </div>
    <div class="midi">
      <span class="lab">MIDI</span>
      {#if learning}<span class="learn">move a knob or hit a pad…</span><button class="ghost" onclick={() => { learning = false; learnMidi(null); }}>Cancel</button>
      {:else if w.midi}<span class="chip">{bindingLabel(w.midi)}</span><button class="ghost" onclick={learn}>Learn again</button><button class="ghost" aria-label="Forget MIDI" onclick={() => { delete w.midi; }}><Icon name="close" size={12} /></button>
      {:else}<button onclick={learn} disabled={!midiSupported()} title={midiSupported() ? 'Press, then touch the control on your MIDI controller' : 'This browser has no Web MIDI (Chrome and Edge do)'}>Learn</button>{/if}
    </div>
    {#if w.type !== 'fader'}<label class="ck"><input type="checkbox" checked={w.size === 2} onchange={(e) => (w.size = (e.target as HTMLInputElement).checked ? 2 : 1)} /> double width</label>{/if}
  {/if}
  <button class="ghost danger" onclick={onremove}><Icon name="trash" />Remove</button>
</aside>

<style>
  .we { width: 260px; display: flex; flex-direction: column; gap: .45rem; background: var(--panel); border: 0; border-radius: var(--radius); padding: .6rem; font-size: .86rem; }
  .we :global(input:not([type=checkbox]):not([type=color])), .we :global(select) { width: 100%; min-width: 0; }
  .two > :global(*) { min-width: 0; }
  label { display: flex; flex-direction: column; gap: .15rem; color: var(--muted); }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: .4rem; }
  .two input[type=color] { width: 100%; height: 2rem; padding: 0; }
  .ck { flex-direction: row; align-items: center; gap: .35rem; }
  .fx { display: flex; flex-direction: column; gap: .2rem; }
  .midi { display: flex; align-items: center; gap: .35rem; flex-wrap: wrap; }
  .midi .lab { color: var(--muted); width: 2.6rem; }
  .learn { color: var(--orange); font-size: .82rem; animation: blink 1s infinite; }
  @keyframes blink { 50% { opacity: .4; } }
  @media (max-width: 900px) { .we { width: auto; } }
</style>
