<script lang="ts">
  // The big dialogs, one at a time, opened from anywhere (buttons, the command palette, keys).
  // Also the keys that open them: ? for the shortcuts, Ctrl+K for the command palette.
  import ShowManager from './ShowManager.svelte';
  import AddFixtures from './AddFixtures.svelte';
  import EffectLibrary from './EffectLibrary.svelte';
  import Shortcuts from './Shortcuts.svelte';
  import Palette from './Palette.svelte';
  import Question from './Question.svelte';
  import Guide from './Guide.svelte';
  import Monitor from './Monitor.svelte';
  import FogTimer from './FogTimer.svelte';
  import PatchCheck from './PatchCheck.svelte';
  import FixturePatch from './FixturePatch.svelte';
  import PatchMany from './PatchMany.svelte';
  import RemoteDialog from './RemoteDialog.svelte';
  import ScheduleDialog from './ScheduleDialog.svelte';
  import Welcome from './Welcome.svelte';
  import RigCheck from './RigCheck.svelte';
  import { app } from '../app.svelte';
  import { ui } from './ui.svelte';
  import { onMount } from 'svelte';

  const close = () => (ui.modal = null);
  // The welcome comes up by itself when the app opens on a show with nothing in it, once per show
  // (a reload doesn't bring it back; "Get started" on the empty stage does). Never over a locked page.
  const WELCOMED = 'luxdmx.seq.welcomed';
  onMount(() => {
    let seen: string | null = null;
    try { seen = localStorage.getItem(WELCOMED); } catch { /* storage blocked */ }
    if (ui.modal || app.show.fixtures.length || app.locked || seen === app.showId) return;
    ui.modal = 'welcome';
    try { localStorage.setItem(WELCOMED, app.showId); } catch { /* storage blocked */ }
  });
  function key(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement).isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!app.locked) ui.modal = ui.modal === 'palette' ? null : 'palette'; }
    else if (!typing && e.key === '?' && !ui.modal) { e.preventDefault(); ui.modal = 'shortcuts'; }
  }
</script>

<svelte:window onkeydown={key} />

{#if ui.modal === 'welcome'}<Welcome onclose={close} />
{:else if ui.modal === 'shows'}<ShowManager onclose={close} />
{:else if ui.modal === 'addFixtures'}<AddFixtures onclose={close} />
{:else if ui.modal === 'effects'}<EffectLibrary onclose={close} onadded={(id) => { ui.fxSel = [id]; app.sideTab = 'effects'; }} />
{:else if ui.modal === 'shortcuts'}<Shortcuts onclose={close} />
{:else if ui.modal === 'palette'}<Palette onclose={close} />
{:else if ui.modal === 'guide'}<Guide onclose={close} />
{:else if ui.modal === 'monitor'}<Monitor onclose={close} />
{:else if ui.modal === 'fogTimer'}<FogTimer onclose={close} />
{:else if ui.modal === 'patchCheck'}<PatchCheck onclose={close} />
{:else if ui.modal === 'remote'}<RemoteDialog onclose={close} />
{:else if ui.modal === 'schedule'}<ScheduleDialog onclose={close} />
{:else if ui.modal === 'rig'}<RigCheck onclose={close} />{/if}
{#if ui.patch}<FixturePatch id={ui.patch} onclose={() => { ui.patch = null; ui.patchTab = 'patch'; }} />{/if}
{#if ui.patchMany}<PatchMany ids={ui.patchMany} onclose={() => (ui.patchMany = null)} />{/if}
{#if ui.question}{#key ui.question}<Question />{/key}{/if}
