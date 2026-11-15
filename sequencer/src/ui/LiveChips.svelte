<script lang="ts">
  // The chips at the top of a live page: what's going on and what's coming. Blind; a machine moment
  // coming while the machines are safe; the song (play/pause) and whether it sounds here; what's new
  // in the show for this page; the timetable's next change (or that it's off or paused); fog left on
  // by a cue, with a Stop.
  import { app } from '../app.svelte';
  import { ui } from './ui.svelte';
  import Icon from './Icon.svelte';
  import { clockOf } from '../model/timeline';
  import { actionRisk, isGated } from '../model/safety';
  import { machines } from './risk';
  import { inWords, nextUp } from '../model/schedule';
  import { actionShort, actionText } from '../model/actions';
  import { hhmm, pauseItems } from './schedulePause';
  import type { Widget } from '../model/types';
  import { untrack } from 'svelte';

  let { narrow, shown, songAt, fresh, freshNames, onaddnew, onsound }: {
    narrow: boolean; shown: boolean; songAt: number; fresh: Widget[]; freshNames: string; onaddnew: () => void; onsound: () => void;
  } = $props();

  // The timeline is playing towards a machine moment (confetti, flames, sparks, CO2) while they're
  // safe: said a minute and a half before it comes, so it isn't a surprise that nothing fires (or
  // there's time to arm them)
  const MACHINE_WORD: Record<string, string> = { confetti: 'Confetti', flame: 'Flames', sparks: 'Sparks', co2: 'CO2' };
  // (the machine moments on the timeline, in time order: worked out once per change of the show,
  // from its plain copy. Done on every tick of the song's clock it was 20 ms, 40 times a second on
  // the festival demo, and the page's frame is what fires the timeline's cues)
  const machineMoments = $derived.by(() => {
    const s = app.plain, tl = s?.timeline;
    if (!tl) return [];
    const out: { at: number; what: string }[] = [];
    const machineRisk = machines(s);              // (a machine's own programs fire it too)
    for (const i of tl.items) {
      const d = i.do;
      if (d.do === 'burst') { if (isGated(d.attr)) out.push({ at: i.at, what: MACHINE_WORD[d.attr] ?? d.attr }); continue; }
      if (d.do === 'effect' || !('list' in d)) continue;
      const r = actionRisk(s, d, undefined, machineRisk);
      if (r === 'once' || r === 'hazard') {
        const l = s.cueLists.find((x) => x.id === d.list), c = d.do === 'goto' ? l?.cues.find((x) => x.id === d.cue) : undefined;
        out.push({ at: i.at, what: c?.name ?? l?.name ?? 'A machine' });
      }
    }
    return out.sort((a, b) => a.at - b.at);
  });
  const shotAhead = $derived.by(() => {
    if (!app.timeline.playing || app.sfxArmed || app.output !== 'live') return undefined;
    const next = machineMoments.find((m) => m.at > songAt);
    return next && next.at - songAt <= 90 ? next : undefined;
  });
  // (fog machines on: read while the view is shown)
  const hazing = $derived(shown ? app.hazing : untrack(() => app.hazing));
  const hazeOnly = $derived(hazing.every((id) => app.modeOf(id)?.channels.some((c) => c.attr === 'haze')));   // hazers: say haze
  // the timetable's next change, looked at twice a minute
  let nowMs = $state(Date.now());
  $effect(() => { const t = setInterval(() => (nowMs = Date.now()), 5000); return () => clearInterval(t); });
  // (paused: the first after the pause; off: none, the chip says it's off)
  const schedOff = $derived(!!app.show.settings.scheduleOff && !!app.show.settings.schedule?.length);
  const pausedTill = $derived((void nowMs, app.schedulePausedUntil));
  const upcoming = $derived(app.show.settings.schedule?.length && !schedOff ? nextUp(app.show.settings.schedule, new Date(Math.max(nowMs, pausedTill)), app.place) : undefined);
  const upAt = $derived(upcoming ? `${String(upcoming.when.getHours()).padStart(2, '0')}:${String(upcoming.when.getMinutes()).padStart(2, '0')}` : '');
</script>

{#if app.output === 'blind' && app.bridges.length}
  <!-- blind: said here too (on a phone the top bar only has a dot), one tap asks to go on stage -->
  <button class="chip nextup blind" onclick={() => void app.askOnStage()} title="Blind: you see it here, the lights don't get it. Click to send it to the stage.">
    <span class="bdot"></span>Blind{#if !narrow}: only here{/if}</button>
{/if}
{#if shotAhead}
  <!-- a machine moment coming while they're safe -->
  <span class="chip nextup shot" title="It won't fire: the machines are safe. Hold Arm (top right) if it should.">
    <Icon name="warn" size={14} />{shotAhead.what} at {clockOf(shotAhead.at, false)} · safe</span>
{/if}
{#if app.show.timeline?.items.length}
  <!-- the song show (Timeline): play and pause it from here too -->
  <button class="chip nextup song" class:on={app.timeline.playing} onclick={() => app.timeline.toggle()} aria-label={app.timeline.playing ? 'Pause the timeline' : 'Play the timeline'}
    title="The timeline: {app.timeline.playing ? 'pause' : 'play'} the song and what's on it">
    <Icon name={app.timeline.playing ? 'stop' : 'play'} size={14} />{clockOf(songAt, false)}{#if !narrow}<span class="faint">&nbsp;/ {clockOf(app.timeline.duration, false)}</span>{/if}</button>
{/if}
{#if app.show.timeline}
  <!-- the band plays live: no sound out of this device (the song's clock runs on) -->
  <button class="chip nextup sound" class:off={!app.timeline.soundHere} aria-pressed={app.timeline.soundHere} onclick={onsound}
    title={app.timeline.soundHere ? "The song plays out of this device. Click for no sound here (the band plays live): the song's clock runs on" : 'No sound here: the song runs silently (a video of the 3D stage still gets it). Click for sound here'}>
    <Icon name="music" size={14} /><span class:sr-only={narrow}>Sound here</span></button>
{/if}
{#if fresh.length && !app.editPage}
  <!-- the page is behind the show (a look or an effect made since): said, one tap adds them -->
  <button class="chip nextup fresh" onclick={onaddnew} title="New in the show since this page was made: {freshNames}. Click to add them here (Undo takes them back)">
    <Icon name="plus" size={14} />{narrow ? fresh.length : `${fresh.length} new in the show`}</button>
{/if}
{#if schedOff || pausedTill}
  <!-- the timetable switched off or paused (a party tonight): said, so nobody wonders why 18:00 didn't come -->
  <button class="chip nextup paused" onclick={() => (ui.modal = 'schedule')} oncontextmenu={(e) => { e.preventDefault(); if (!app.locked) ui.openMenu(e, pauseItems()); }}
    title={schedOff ? 'The timetable is off (right-click to switch it on)' : `The timetable is paused until ${hhmm(pausedTill)} (right-click to play it again)`}>
    <Icon name="clock" size={14} />{schedOff ? 'Timetable off' : `Paused till ${hhmm(pausedTill)}`}</button>
{:else if upcoming}
  <!-- the timetable's next change, said in clock time (a bar's 21:00, not "14400 s") -->
  <button class="chip nextup" onclick={() => (ui.modal = 'schedule')} oncontextmenu={(e) => { e.preventDefault(); if (!app.locked) ui.openMenu(e, pauseItems()); }} title="The timetable, next: {upAt}{upcoming.entry.sun ? ` (${upcoming.entry.sun === 'set' ? 'sunset' : 'sunrise'})` : ''} {actionText(app.show, upcoming.entry.do)} (right-click to pause it)">
    <Icon name="clock" size={14} />{#if narrow}{upAt}{:else}{actionShort(app.show, upcoming.entry.do)} · {inWords(upcoming.when, new Date(nowMs)).replace(/^at /, '')}{/if}</button>
{/if}
{#if hazing.length}
  <span class="chip haze" title="A fog or haze machine is running from a cue">
    <Icon name="fog" size={14} />{#if !narrow}<span>{hazing.length > 1 ? `${hazing.length} fog machines on` : hazeOnly ? 'Haze on' : 'Fog on'}</span>{/if}
    <button class="stop" onclick={() => { app.stopHaze(); ui.toast(`${hazeOnly ? 'Haze' : 'Fog'} stopped until the next cue that fogs.`, 4000); }}
      aria-label={hazeOnly ? 'Stop the haze' : 'Stop the fog'}>Stop</button></span>
{/if}

<style>
  .chip.haze, .chip.nextup { font-size: .85rem; min-height: 29px; padding: .2rem .7rem; border-radius: 999px; display: inline-flex; gap: .35rem; align-items: center; background: none; }
  .chip.haze { border: 1px solid var(--orange); color: var(--orange); padding-right: .25rem; }
  .chip.haze .stop { min-height: 0; padding: .1rem .55rem; border-radius: 999px; border: 0; border-left: 1px solid #ffaa1c66; background: #ffaa1c1f; color: var(--orange); font-weight: 650; font-size: .8rem; }
  .chip.nextup { border: 1px solid var(--line2); color: var(--muted); }
  .chip.nextup.paused { border-style: dashed; }
  .chip.nextup.song { font-variant-numeric: tabular-nums; } .chip.nextup.song.on { color: var(--green); border-color: #45d85c66; }
  .chip.nextup.sound[aria-pressed='true'] { color: var(--text); }
  .chip.nextup.sound.off { border-style: dashed; text-decoration: line-through; }
  .chip.nextup.fresh { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
  .chip.nextup.blind { color: #9fc0ff; border-color: #6aa2ff66; }
  .chip.nextup.shot { color: var(--orange); border-color: color-mix(in srgb, var(--orange) 45%, transparent); }
  .bdot { width: .55rem; height: .55rem; border-radius: 50%; background: #5b6676; box-shadow: inset 0 0 0 1px #0006; }
  @media (pointer: coarse) { .chip.haze, .chip.nextup { min-height: 38px; } .chip.haze { padding-top: 0; padding-bottom: 0; } .chip.haze .stop { min-height: 38px; padding: .2rem .9rem; } }
</style>
