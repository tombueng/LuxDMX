<script lang="ts">
  // The timetable: looks by the clock (a bar's evening, a shop window, the church before the
  // service). Each row: a time, the days, what happens. See model/schedule.ts for how it runs.
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { app, newId } from '../app.svelte';
  import { cueNumber } from '../model/cuenum';
  import { actionShort } from '../model/actions';
  import Help from './Help.svelte';
  import { inWords, minuteOn, minutesOf, nextUp, timeOn, type ScheduleEntry } from '../model/schedule';
  import { sunTimes } from '../model/sun';
  import { hhmm, pauseItems } from './schedulePause';
  import { isFogTimer } from '../model/library';
  import { isMachineList } from '../content/busking';
  import type { CueAction } from '../model/types';
  import { ui } from './ui.svelte';

  let { onclose }: { onclose: () => void } = $props();
  const DAYS = [[1, 'Mo'], [2, 'Tu'], [3, 'We'], [4, 'Th'], [5, 'Fr'], [6, 'Sa'], [0, 'Su']] as const;
  const FULL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  const entries = $derived(app.show.settings.schedule ?? []);
  // (not the fog timers, nor the machines' own shot lists: those are buttons, not looks)
  const lists = $derived(app.show.cueLists.filter((l) => !isFogTimer(l) && !isMachineList(l, app.isMachineFx)));
  const ro = $derived(app.locked);
  // what's next (and today's sun), kept current while the dialog is open
  let now = $state(new Date());
  $effect(() => { const t = setInterval(() => (now = new Date()), 15000); return () => clearInterval(t); });
  const off = $derived(!!app.show.settings.scheduleOff);
  const pausedTill = $derived((void now, app.schedulePausedUntil));
  const next = $derived(entries.length && !off ? nextUp(entries, new Date(Math.max(now.getTime(), pausedTill)), app.place) : undefined);

  // A new row follows the last one: its days (Sunday's service gets another Sunday row, not a daily
  // one that fires all week while it's half done) and an hour after it. The first one: the next hour.
  function add() {
    app.checkpoint();
    const l = app.liveList ?? lists[0], last = sorted[sorted.length - 1];
    const h = ((last ? (minuteOn(last, new Date(), app.place) ?? minutesOf(last.at)) / 60 | 0 : new Date().getHours()) + 1) % 24;
    const e: ScheduleEntry = { id: newId('s'), at: `${String(h).padStart(2, '0')}:00`, do: l?.cues[0] ? { do: 'goto', list: l.id, cue: l.cues[0].id } : { do: 'blackout', on: true } };
    if (last?.days?.length) e.days = [...last.days];
    app.show.settings.schedule = [...entries, e];
    app.markDirty(0);
    focusTime(e.id);
  }
  // straight into its time
  const focusTime = (id: string) => queueMicrotask(() => (document.querySelector(`[data-entry="${id}"] input[type="time"]`) as HTMLInputElement | null)?.focus());
  function duplicate(e: ScheduleEntry) {
    app.checkpoint();
    const c: ScheduleEntry = { ...$state.snapshot(e), id: newId('s') };
    app.show.settings.schedule = [...entries, c];
    app.markDirty(0);
    focusTime(c.id);
  }
  function rowMenu(ev: MouseEvent, e: ScheduleEntry) {
    if (ro) return;
    ui.openMenu(ev, [
      { label: 'Duplicate', icon: 'copy', run: () => duplicate(e) },
      { label: 'Every day', icon: 'clock', disabled: !e.days?.length, run: () => { app.checkpoint(); e.days = undefined; app.markDirty(0); } },
      { sep: true },
      { label: `Remove ${e.at}`, icon: 'trash', danger: true, keys: 'Del', run: () => remove(e.id) },
    ]);
  }
  const whenShort = (d: Date) => `${d.toDateString() === new Date().toDateString() ? '' : `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} `}${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  function remove(id: string) { app.checkpoint(); app.show.settings.schedule = entries.filter((e) => e.id !== id); app.markDirty(0); }
  function setDo(e: ScheduleEntry, kind: string) {
    const was = e.do, l = ('list' in was ? app.show.cueLists.find((x) => x.id === was.list) : undefined) ?? lists[0];
    const a: CueAction = kind === 'goto' ? { do: 'goto', list: l?.id ?? '', cue: l?.cues[0]?.id ?? '' }
      : kind === 'bo-on' ? { do: 'blackout', on: true } : kind === 'bo-off' ? { do: 'blackout', on: false } : kind === 'off' ? { do: 'off' }
      : { do: kind as 'start' | 'release', list: l?.id ?? '' };
    e.do = a;
    app.markDirty(0);
  }
  // a word for one row, said in that row (a toast at the far end of the screen goes unseen)
  let note = $state<{ id: string; text: string } | null>(null);
  let noteT: ReturnType<typeof setTimeout> | undefined;
  function say(id: string, text: string) { note = { id, text }; clearTimeout(noteT); noteT = setTimeout(() => (note = null), 3500); }
  const kindOf = (a: CueAction) => (a.do === 'blackout' ? (a.on ? 'bo-on' : 'bo-off') : a.do);
  // Every day to start with; a tap then picks just that day (Sunday's service is one tap, not six),
  // more taps add or take days. The last day can't go: no days would be every day.
  function toggleDay(e: ScheduleEntry, d: number) {
    const days = !e.days?.length ? [d] : e.days.includes(d) ? e.days.filter((x) => x !== d) : [...e.days, d];
    if (!days.length) { say(e.id, 'At least one day: tap the others to add them, or right-click for every day.'); return; }
    e.days = days.length === 7 ? undefined : days.sort();
    app.markDirty(0);
  }
  // the time is taken when you're done with the field (Chrome reports every digit typed)
  function setTime(e: ScheduleEntry, el: HTMLInputElement) {
    if (/^\d\d:\d\d$/.test(el.value) && el.value !== e.at) { app.checkpoint(); e.at = el.value; app.markDirty(0); }
  }
  // By the sun ("30 min after sunset"): the time moves with the date. `at` keeps today's, for an
  // older app that doesn't know the sun.
  const OFFSETS = [[-120, '2 h before'], [-60, '1 h before'], [-45, '45 min before'], [-30, '30 min before'], [-15, '15 min before'], [0, 'on the dot'],
    [15, '15 min after'], [30, '30 min after'], [45, '45 min after'], [60, '1 h after'], [90, '1½ h after'], [120, '2 h after'], [180, '3 h after']] as const;
  function setWhen(e: ScheduleEntry, v: string) {
    app.checkpoint();
    if (v === 'rise' || v === 'set') { e.sun = v; e.offset ??= 0; const t = timeOn(e, new Date(), app.place); if (t) e.at = t; }
    else { delete e.sun; delete e.offset; }
    app.markDirty(0);
  }
  function setOffset(e: ScheduleEntry, m: number) {
    app.checkpoint(); e.offset = m; const t = timeOn(e, new Date(), app.place); if (t) e.at = t; app.markDirty(0);
  }
  // the place changed: the sun's entries say today's time there (for older apps)
  function sunAt() { for (const e of entries) if (e.sun) { const t = timeOn(e, new Date(), app.place); if (t) e.at = t; } }
  const offsets = (e: ScheduleEntry) => OFFSETS.some(([m]) => m === (e.offset ?? 0)) ? OFFSETS : [...OFFSETS, [e.offset ?? 0, `${e.offset} min`] as const];
  const usesSun = $derived(entries.some((e) => e.sun));
  const place = $derived(app.place);
  const sunToday = $derived.by(() => { const t = sunTimes(now, place); const f = (x?: number) => x === undefined ? 'none' : new Date(x).toTimeString().slice(0, 5); return { rise: f(t.rise), set: f(t.set) }; });
  let locating = $state(false);
  function here() {
    if (!navigator.geolocation) { ui.toast('This browser can\'t say where it is: type the place in instead.', 4000); return; }
    locating = true;
    navigator.geolocation.getCurrentPosition((pos) => {
      locating = false;
      app.checkpoint();
      // to about a kilometre: plenty for the sun, and no more than that kept in the show
      app.show.settings.place = { lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100, name: 'this device\'s location' };
      sunAt();
      app.markDirty(0);
    }, () => { locating = false; ui.toast('No location: allow it for this page, or type the place in.', 4000); }, { timeout: 15000, maximumAge: 864e5 });
  }
  async function placeByHand() {
    const v = await ui.ask('Where is the show?', place.guessed ? '' : `${place.lat}, ${place.lon}`, { label: 'Latitude, longitude', ok: 'Use it', hint: 'Like 52.52, 13.40 (a map app shows it when you hold a spot). Empty: guess from the time zone again.', empty: true });
    if (v === null) return;
    app.checkpoint();
    const m = v.replace(/[°NE]/gi, '').match(/^\s*(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
    if (!v.trim()) delete app.show.settings.place;
    else if (!m || Math.abs(+m[1].replace(',', '.')) > 90 || Math.abs(+m[2].replace(',', '.')) > 180) { ui.toast('That isn\'t a place: two numbers, like 52.52, 13.40', 4000); return; }
    else app.show.settings.place = { lat: +m[1].replace(',', '.'), lon: +m[2].replace(',', '.') };
    sunAt();
    app.markDirty(0);
  }
  // by time when the dialog opens, then the rows stay where they are while you edit them (a row that
  // jumped away under a tap would take the next tap); new ones at the bottom
  const order = [...(app.show.settings.schedule ?? [])].sort((a, b) => (minuteOn(a, new Date(), app.place) ?? 0) - (minuteOn(b, new Date(), app.place) ?? 0)).map((e) => e.id);
  const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? 1e6 : i; };
  const sorted = $derived([...entries].sort((a, b) => rank(a.id) - rank(b.id)));
</script>

<Modal title="Timetable" {onclose} wide>
  <div class="tt">
    <div class="head">
      {#if next}<p class="next" role="status"><Icon name="clock" /> Next: <b>{whenShort(next.when)}</b> · {actionShort(app.show, next.entry.do)} <span class="faint">({inWords(next.when, now)})</span></p>
      {:else}<p class="faint">Looks by the clock: the opening look at 17:00, the evening one at 21:00, everything off at closing.</p>{/if}
      {#if !ro && entries.length}<button class="ghost" onclick={(e) => ui.openMenu(e, pauseItems())} aria-haspopup="menu"><Icon name={off || pausedTill ? 'play' : 'stop'} />{off ? 'Off' : pausedTill ? 'Paused' : 'Pause'}</button>{/if}
      <Help label="About the timetable">
        <p>It runs while this page is open: keep the tablet or laptop on and the tab open. Switched on again later, it plays what came while it was off, at once.</p>
        <p>Changing a time here never switches anything by itself. A look played by hand stays until the next time comes.</p>
        <p>Tap a day to have it on that day only; tap more days to add them. A new time takes the days of the one above it.</p>
        <p>Right-click a row (or hold it) to duplicate it or make it every day again.</p>
        <p>A party in the same room tonight? <b>Pause</b> skips tonight's times (or 3 hours), or switches the timetable off; right-click the next-up chip in Live does the same.</p>
        <p>"At sunset" moves with the seasons: a shop window or the church's floodlights come on at dusk all year. The sun is worked out here for the show's place (no internet needed).</p>
      </Help>
    </div>
    {#if ro}<p class="faint">Locked for the show: unlock to change the timetable. It keeps running.</p>{/if}
    {#if off}<p class="state" role="status">The timetable is off: nothing plays by the clock until it's switched on again.</p>
    {:else if pausedTill}<p class="state" role="status">Paused until {hhmm(pausedTill)}: what comes before then is skipped (a party tonight).</p>{/if}
    <div class="rows">
      {#each sorted as e (e.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions (the menu is also on the keyboard's Menu key, and every item has its own control in the row) -->
        <div class="ent" data-entry={e.id} oncontextmenu={(ev) => rowMenu(ev, e)}
             onkeydown={(ev) => { if (ev.key === 'Delete' && !ro && (ev.target as HTMLElement).tagName !== 'INPUT') { ev.preventDefault(); remove(e.id); } }}>
          <div class="when">
            <select value={e.sun ?? 'time'} disabled={ro} aria-label="When" onchange={(ev) => setWhen(e, ev.currentTarget.value)}>
              <option value="time">at</option><option value="set">sunset</option><option value="rise">sunrise</option></select>
            {#if e.sun}
              <select value={e.offset ?? 0} disabled={ro} aria-label="Before or after" onchange={(ev) => setOffset(e, Number(ev.currentTarget.value))}>
                {#each offsets(e) as [m, label] (m)}<option value={m}>{label}</option>{/each}</select>
              <span class="today" title="Today's time (it moves with the sun)">{timeOn(e, now, place) || 'not today'}</span>
            {:else}
              <input type="time" value={e.at} disabled={ro} aria-label="Time" data-entry-time onblur={(ev) => setTime(e, ev.currentTarget)} onkeydown={(ev) => { if (ev.key === 'Enter') setTime(e, ev.currentTarget); }} />
            {/if}
          </div>
          <!-- one segmented control; every day (none picked) is the quiet default -->
          <div class="days" class:every={!e.days?.length} role="group" aria-label="Days{!e.days?.length ? ': every day' : ''}">
            {#each DAYS as [d, name] (d)}
              <button class="day" class:on={!!e.days?.includes(d)} disabled={ro} aria-pressed={!e.days?.length || e.days.includes(d)} onclick={() => toggleDay(e, d)}
                title={!e.days?.length ? `Tap for ${FULL[d]} only` : ''}>{name}</button>
            {/each}
          </div>
          <select value={kindOf(e.do)} disabled={ro} aria-label="What happens" onchange={(ev) => setDo(e, (ev.target as HTMLSelectElement).value)}>
            <option value="goto">play the look</option><option value="off">everything off</option><option value="start">start the list</option><option value="release">fade out the list</option>
            <option value="bo-on">blackout (until blackout off)</option><option value="bo-off">blackout off</option>
          </select>
          {#if e.do.do === 'goto'}
            {@const a = e.do}
            {@const l = app.show.cueLists.find((x) => x.id === a.list)}
            <select value={a.cue} disabled={ro} aria-label="Cue" onchange={(ev) => { a.cue = (ev.target as HTMLSelectElement).value; app.markDirty(0); }}>
              {#each l?.cues ?? [] as c, i (c.id)}<option value={c.id}>{l ? cueNumber(l, i) : i + 1}. {c.name}</option>{/each}</select>
            <select value={a.list} disabled={ro} aria-label="Cue list" onchange={(ev) => { a.list = (ev.target as HTMLSelectElement).value; a.cue = app.show.cueLists.find((x) => x.id === a.list)?.cues[0]?.id ?? ''; app.markDirty(0); }}>
              {#each lists as x (x.id)}<option value={x.id}>{x.name}</option>{/each}</select>
          {:else if 'list' in e.do}
            {@const a = e.do}
            <select value={a.list} disabled={ro} aria-label="Cue list" onchange={(ev) => { a.list = (ev.target as HTMLSelectElement).value; app.markDirty(0); }}>
              {#each lists as x (x.id)}<option value={x.id}>{x.name}</option>{/each}</select>
          {/if}
          {#if !ro}<button class="ghost x" onclick={() => remove(e.id)} aria-label="Remove {e.at}" title="Remove (Del)"><Icon name="close" /></button>{/if}
          {#if note?.id === e.id}<p class="note" role="status">{note.text}</p>{/if}
        </div>
      {:else}
        <p class="empty faint">Nothing yet: <b>Add a time</b> below, then pick the days and what happens.</p>
      {/each}
    </div>
    {#if usesSun}
      <p class="place"><Icon name="sun" size={15} /><span>Sun times for <b>{place.name ?? `${place.lat}, ${place.lon}`}</b>{place.guessed ? ' (guessed from the time zone)' : ''}: sunrise {sunToday.rise}, sunset {sunToday.set} today.</span>
        {#if !ro}<button class="ghost" onclick={here} disabled={locating}>{locating ? 'Finding it…' : 'Use this device\'s location'}</button><button class="ghost" onclick={placeByHand}>Type it in</button>{/if}</p>
    {/if}
    <!-- svelte-ignore a11y_autofocus (the dialog opens on what you came for, not on its "?") -->
    {#if !ro}<div class="row"><button onclick={add} autofocus><Icon name="plus" />Add a time</button><span class="grow"></span><button class="primary" onclick={onclose}>Done</button></div>{/if}
  </div>
</Modal>

<style>
  .tt { display: flex; flex-direction: column; gap: .7rem; }
  .tt p { margin: 0; }
  .head { display: flex; align-items: center; gap: .5rem; }
  .head > p { flex: 1; }
  .next { display: flex; gap: .4rem; align-items: center; flex-wrap: wrap; }
  .rows { display: flex; flex-direction: column; gap: .4rem; }
  .empty { padding: 1rem; text-align: center; border: 1px dashed var(--line2); border-radius: var(--radius-s); }
  /* one row per time: the × always in the last column */
  .ent { display: grid; grid-template-columns: auto auto minmax(9rem, 1fr) auto auto 2.2rem; gap: .45rem; align-items: center;
    padding: .45rem .55rem; border: 1px solid var(--line); border-radius: var(--radius-s); background: var(--panel2); }
  .ent input[type='time'] { font-variant-numeric: tabular-nums; font-weight: 650; }
  .x { justify-self: end; grid-column: -2; grid-row: 1; }
  .note { grid-column: 1 / -1; color: var(--accent); font-size: .85rem; }
  .state { color: var(--orange); border: 1px dashed #ffaa1c66; border-radius: var(--radius-s); padding: .4rem .6rem; }
  .when { display: flex; gap: .3rem; align-items: center; }
  .when select:first-child { width: auto; }
  .today { font-variant-numeric: tabular-nums; font-weight: 650; padding: 0 .2rem; }
  .place { display: flex; gap: .4rem; align-items: center; flex-wrap: wrap; color: var(--muted); font-size: .88rem; }
  .place > span { flex: 1 1 18rem; }
  .place button { color: var(--accent); }
  .days { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  .day { min-width: 2.3rem; min-height: 30px; padding: 0 .3rem; font-size: .8rem; border: 0; border-radius: 0; border-left: 1px solid var(--line); background: none; color: var(--muted); }
  .day:first-child { border-left: 0; }
  .day.on { background: var(--accent); color: #1a1000; font-weight: 650; }
  .days.every .day { color: var(--text); }
  @media (pointer: coarse) { .day { min-height: 38px; min-width: 2.6rem; } }
  .grow { flex: 1; }
  /* phones: time and ×, then the days across, then the choices full width */
  @media (max-width: 560px) {
    .ent { grid-template-columns: 1fr auto; }
    .days { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(7, 1fr); }
    .day { min-width: 0; }
    .ent select { grid-column: 1 / -1; width: 100%; }
    .x { grid-row: 1; grid-column: 2; }
  }
</style>
