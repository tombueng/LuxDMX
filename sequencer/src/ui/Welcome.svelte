<script lang="ts">
  // The welcome: how to start. Two kinds of start, each a tile that says what it is:
  // - Demo shows: finished shows on the 3D stage, cued to a song (picked on the tile). They can be
  //   folded away (remembered in this browser): someone who starts shows every day doesn't need
  //   the big tiles each time. Folded, they stay as a row of buttons, one click plays one (with the
  //   song picked for it), and one more brings the tiles back.
  // - Start a show: an empty stage, a template, or a show file.
  // Every demo and template also comes as "Lights only": its rig placed, nothing programmed. The
  // templates play as shows too (Play the show: their looks cued to a song, content/templateShows.ts),
  // or Start: the rig and its looks to work on, no music.
  // A dialog over everything (the plan and the 3D stage alike). It comes up by itself when the app
  // opens on a show with nothing in it (Modals.svelte), once per show; "Get started" on an empty
  // stage brings it back.
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { app } from '../app.svelte';
  import { ui } from './ui.svelte';
  import { ALL_TEMPLATES as TEMPLATES } from '../content/ringMatrix';
  import type { Template } from '../content/templates';
  import { lightsOnly } from '../content/lightsOnly';
  import type { DemoInfo } from '../content/demos';
  import type { Show } from '../model/types';
  import { CATALOG, GENRES, type CatalogSong } from '../timeline/catalog';
  import { DEMO_SONG, demoSong, startDemo } from './startDemo';
  import { TEMPLATE_SHOWS } from '../content/templateShows';
  import { onDestroy } from 'svelte';
  import { WELCOME_DEMOS_HIDDEN, WELCOME_SONGS } from '../store/kept';

  let { onclose }: { onclose: () => void } = $props();


  // the demos (content/demos.ts, loaded with the welcome: the shows' code stays out of the page
  // until wanted); their names and words are here at once, the rest when it has come
  type Demo = Pick<DemoInfo, 'id' | 'name' | 'blurb' | 'icon' | 'song'> & { build?: DemoInfo['build'] };
  let demos = $state<Demo[]>([
    { id: 'festival', name: 'Festival stage', icon: 'mover', song: DEMO_SONG, blurb: 'A band on a big stage in a hall: over a hundred moving heads hitting the beat, every effect machine, a crowd of hundreds.' },
  ]);
  import('../content/demos').then((m) => { demos = m.DEMOS.map((d) => ({ ...d })); count(); }).catch(() => {});
  const HUE: Record<string, string> = { festival: 'var(--orange)', club: 'var(--violet)', party: 'var(--pink)', truss: 'var(--cyan)' };
  const TPL_HUES = ['var(--blue)', 'var(--green)', 'var(--violet)', 'var(--orange)', 'var(--cyan)', 'var(--pink)'];
  // a template as a show to play (its own song; `t:` and its name, as startDemo takes it)
  const asShow = (t: Template): Demo | undefined => TEMPLATE_SHOWS[t.name] ? { id: `t:${t.name}`, name: t.name, blurb: t.blurb, icon: t.icon, song: TEMPLATE_SHOWS[t.name].song } : undefined;

  // folded away or not (this browser)
  // (asked for the demos, from Shows or the command palette: shown, the choice kept as it was)
  let demosHidden = $state(WELCOME_DEMOS_HIDDEN.get() && !ui.welcomeDemos);
  ui.welcomeDemos = false;
  // (asked for a new show, from Shows: Empty stage is a new empty show; over an empty show, the
  // first start or Get started, it only closes: the box connected stays)
  const forNew = ui.welcomeNew;
  ui.welcomeNew = false;
  async function empty() { if (forNew) await app.newShow(); onclose(); }
  function fold() { demosHidden = !demosHidden; WELCOME_DEMOS_HIDDEN.set(demosHidden); }

  // each demo's music: a song of the catalog, or 'beat' (the demo beat, made here); its own song
  // unless another was picked on its tile (remembered)
  let songs = $state<Record<string, string>>(WELCOME_SONGS.get());
  const songOf = (d: Demo) => { const v = songs[d.id]; return v === 'beat' || demoSong(v) ? v! : d.song ?? DEMO_SONG; };
  function pickSong(d: Demo, v: string) { songs[d.id] = v; WELCOME_SONGS.set({ ...songs }); }
  const byGenre = (() => {
    const m = new Map<string, CatalogSong[]>();
    for (const s of CATALOG) { const g = GENRES[s.genre] ?? s.genre; m.set(g, [...(m.get(g) ?? []), s]); }
    return [...m];
  })();
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

  // what's in each (lights, cues), worked out once the dialog is up, one at a time
  let counts = $state<Record<string, { lights: number; cues: number }>>({});
  const tally = (s: Show) => ({ lights: s.fixtures.length, cues: s.cueLists.reduce((n, l) => n + l.cues.length, 0) });
  let counting = false;
  function count() {
    if (counting) return;
    counting = true;
    // (the list again each time: the demos come in while the templates are being counted)
    const todo = (): [string, () => Show][] => [
      ...TEMPLATES.map((t) => [`t:${t.name}`, t.build] as [string, () => Show]),
      ...demos.filter((d) => d.build).map((d) => [`d:${d.id}`, () => d.build!()] as [string, () => Show]),
    ];
    const next = () => {
      const job = todo().find(([k]) => !counts[k]);
      if (!job || gone) { counting = false; return; }
      try { counts[job[0]] = tally(job[1]()); } catch { counts[job[0]] = { lights: 0, cues: 0 }; }
      setTimeout(next, 0);
    };
    setTimeout(next, 30);
  }
  count();
  const said = (k: string) => { const c = counts[k]; return c ? `${c.lights} light${c.lights === 1 ? '' : 's'} · ${c.cues} cue${c.cues === 1 ? '' : 's'}` : ' '; };

  // a demo: the song comes down first (its progress on the tile); closing cancels it
  let dl = $state<{ id: string; got: number; total: number; ctl: AbortController } | null>(null);
  const pct = (d: { got: number; total: number }) => (d.total ? `${Math.min(99, Math.round((d.got / d.total) * 100))} %` : `${(d.got / 1e6).toFixed(1)} MB`);
  async function play(d: Demo) {
    if (dl) return;
    const ctl = new AbortController(), song = d.song ? songOf(d) : 'beat';
    dl = { id: d.id, got: 0, total: 0, ctl };
    try {
      await startDemo(song === 'beat' ? null : song, (got, total) => { if (dl?.ctl === ctl) { dl.got = got; dl.total = total; } }, ctl.signal, () => { dl = null; onclose(); }, d.id);
    } catch { /* cancelled */ }
    if (dl?.ctl === ctl) dl = null;
  }
  async function rig(name: string, build: () => Show, in3d: boolean) {
    const s = lightsOnly(build());
    await app.startShow(s);
    if (in3d) ui.stage3d = true;
    onclose();
    ui.toast(`${name}: ${s.fixtures.length} lights in their places, nothing programmed yet. Select some and pick a colour to start.`, 6000);
  }
  async function rigDemo(d: Demo) {
    const m = await import('../content/demos');
    const full = m.demoById(d.id);
    if (full) await rig(d.name, () => full.build(), true);
  }
  function template(t: Template) { void app.startShow(t.build()); onclose(); }

  let gone = false;
  function close() { dl?.ctl.abort(); dl = null; onclose(); }
  onDestroy(() => { gone = true; dl?.ctl.abort(); });

  let showFile = $state<HTMLInputElement>();
  async function open(f: File) {
    try { await app.importShow(f); ui.toast(`Opened "${app.show.meta.name}"`); onclose(); } catch (x) { ui.toast((x as Error).message, 6000); }
  }

  const narrow = typeof window !== 'undefined' && window.innerWidth <= 760;
  const tablet = !narrow && typeof window !== 'undefined' && window.innerWidth <= 1100;
</script>

{#snippet music(d: Demo, song: string, s: CatalogSong | undefined)}
  <label class="music"><Icon name="music" size={15} />
    <select value={song} onchange={(e) => pickSong(d, (e.target as HTMLSelectElement).value)} disabled={!!dl} aria-label="Music for {d.name}">
      {#each byGenre as [g, list] (g)}
        <optgroup label={g}>
          {#each list as c (c.id)}<option value={c.id}>{c.title} · {c.artist}{c.id === d.song ? ' (its own)' : ''}</option>{/each}
        </optgroup>
      {/each}
      <optgroup label="Made here"><option value="beat">The demo beat</option></optgroup>
    </select></label>
  <p class="credit">{#if s}{GENRES[s.genre]}, {Math.round(s.bpm)} BPM, {clock(s.duration)} · {s.license}{:else}Made in the browser, nothing to download{/if}</p>
{/snippet}
{#snippet getting(s: CatalogSong | undefined)}
  <button class="primary" disabled aria-busy="true"><Icon name="play" />{s && dl ? `Getting the song… ${pct(dl)}` : 'Starting…'}</button>
  <button onclick={() => { dl?.ctl.abort(); dl = null; }}>Cancel</button>
{/snippet}

<Modal title="Let's get some light on stage" onclose={close} wide>
  <div class="welcome">
    <!-- the demo shows -->
    <section class="sec" aria-labelledby="w-demos">
      <div class="sh">
        <h3 id="w-demos">Demo shows</h3>
        <span class="sub">Finished shows on the 3D stage, cued to a song. No hardware needed.</span>
        <button class="ghost fold" aria-expanded={!demosHidden} aria-controls="w-demo-tiles" onclick={fold}>
          {demosHidden ? (demos.length > 1 ? `Show the ${demos.length} demos` : 'Show the demos') : 'Hide the demos'}<Icon name={demosHidden ? 'down' : 'up'} size={14} /></button>
      </div>
      {#if !demosHidden}
        <div class="tiles demos" id="w-demo-tiles">
          {#each demos as d (d.id)}
            {@const song = d.song ? songOf(d) : ''}
            {@const s = song && song !== 'beat' ? demoSong(song) : undefined}
            <div class="tile" role="group" aria-label={d.name} style:--hue={HUE[d.id] ?? 'var(--orange)'}>
              <div class="th"><span class="ic"><Icon name={d.icon} size={22} /></span><b>{d.name}</b></div>
              <p class="blurb">{d.blurb}</p>
              <p class="meta">{said(`d:${d.id}`)}</p>
              {#if d.song}
                {@render music(d, song, s)}
              {:else}
                <p class="credit">Its own checks on the timeline, no music.</p>
              {/if}
              <div class="acts">
                {#if dl?.id === d.id}
                  {@render getting(s)}
                {:else}
                  <button class="primary" onclick={() => play(d)} disabled={!!dl} aria-label="Play the show: {d.name}" data-autofocus={d === demos[0] ? '' : undefined}><Icon name="play" />Play the show</button>
                  <button onclick={() => rigDemo(d)} disabled={!!dl} aria-label="{d.name}, lights only" title="Its lights in their places in its room, nothing programmed">Lights only</button>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <!-- (folded: still there, a button each that plays it) -->
        <div class="strip" role="group" aria-label="The demo shows">
          {#each demos as d (d.id)}
            {@const song = d.song ? songOf(d) : ''}
            {@const s = song && song !== 'beat' ? demoSong(song) : undefined}
            <button class="chip" style:--hue={HUE[d.id] ?? 'var(--orange)'} onclick={() => play(d)} disabled={!!dl} aria-label="Play the show: {d.name}"
                    title="{d.blurb}{s ? ` To "${s.title}".` : ''}">
              <span class="ic sm"><Icon name={d.icon} size={16} /></span>
              <span class="cn"><b>{d.name}</b><small>{dl?.id === d.id ? (s ? `Getting the song… ${pct(dl)}` : 'Starting…') : s ? s.title : d.song ? 'the demo beat' : 'no music'}</small></span>
              <Icon name="play" size={16} />
            </button>
          {/each}
        </div>
      {/if}
    </section>

    <!-- every day: empty, a template, a file -->
    <section class="sec" aria-labelledby="w-start">
      <div class="sh">
        <h3 id="w-start">Start a show</h3>
        <span class="sub">Your own lights, or a template to change: lights placed, looks and cues ready. <b>Lights only</b> gives the rig with nothing programmed.</span>
      </div>
      <div class="tiles">
        <div class="tile plain" style:--hue="var(--muted)">
          <div class="th"><span class="ic"><Icon name="plus" size={22} /></span><b>Empty stage</b></div>
          <p class="blurb">Nothing patched. Add your lights from the library ({narrow ? 'the Lights tab below' : tablet ? 'Fixtures, on the right' : 'on the left'}), then pick colours and record cues.</p>
          <div class="acts"><button class="primary" onclick={empty} data-autofocus={demosHidden ? '' : undefined}>Start with an empty stage</button></div>
        </div>
        {#each TEMPLATES as t, i (t.name)}
          {@const d = asShow(t)}
          {@const song = d ? songOf(d) : ''}
          {@const s = song && song !== 'beat' ? demoSong(song) : undefined}
          <div class="tile" role="group" aria-label={t.name} style:--hue={TPL_HUES[i % TPL_HUES.length]}>
            <div class="th"><span class="ic"><Icon name={t.icon} size={22} /></span><b>{t.name}</b></div>
            <p class="blurb">{t.blurb}</p>
            <p class="meta">{said(`t:${t.name}`)}</p>
            {#if d}{@render music(d, song, s)}{/if}
            <div class="acts">
              {#if d && dl?.id === d.id}
                {@render getting(s)}
              {:else}
                {#if d}<button class="primary" onclick={() => play(d)} disabled={!!dl} aria-label="Play the show: {t.name}" title="Its looks cued to the song, playing on the 3D stage"><Icon name="play" />Play the show</button>{/if}
                <button class:primary={!d} onclick={() => template(t)} disabled={!!dl} aria-label="Start {t.name}" title="Its lights and looks to work on, no music">Start</button>
                <button onclick={() => rig(t.name, t.build, false)} disabled={!!dl} aria-label="{t.name}, lights only" title="Its lights in their places, nothing programmed">Lights only</button>
              {/if}
            </div>
          </div>
        {/each}
        <!-- made at home, playing at the venue: the show file from the other computer -->
        <div class="tile plain" style:--hue="var(--muted)">
          <div class="th"><span class="ic"><Icon name="folder" size={22} /></span><b>A show file</b></div>
          <p class="blurb">A show saved on another computer (Shows, Save as file), or a QLC+ workspace.</p>
          <div class="acts"><button onclick={() => showFile?.click()}>Open a show file</button></div>
          <input type="file" accept=".json,.luxdmx,.qxw,.zip,application/json,application/zip" hidden bind:this={showFile}
                 onchange={(e) => { const inp = e.target as HTMLInputElement; const f = inp.files?.[0]; inp.value = ''; if (f) void open(f); }} />
        </div>
      </div>
    </section>

    <!-- how it goes, once there -->
    <footer class="how">
      <ol>
        <li><Icon name="plus" /> <b>Add lights</b></li>
        <li><Icon name="palette" /> <b>Select, pick a colour</b> ({narrow ? 'the Set tab' : tablet ? 'the Set tab' : 'on the right'})</li>
        <li><Icon name="record" /> <b>Record</b> a cue, {narrow ? 'GO' : 'Space'} for the next</li>
        <li><Icon name="link" /> <b>Connect your LuxDMX</b> ({tablet || narrow ? 'the dot at the top right' : 'top right, +'}) and press <b>Blind</b> to go on stage</li>
      </ol>
      <div class="row end">
        <p class="hint">Program builds the show; Live (top) plays it with big buttons. This is an alpha: keep a copy of your show (Shows, Save as file).</p>
        <span class="row lnk">
          <button class="ghost" onclick={() => (ui.modal = 'gallery')}><Icon name="image" />What the 3D stage draws</button>
          <button class="ghost" onclick={() => (ui.modal = 'guide')}><Icon name="help" />How it works, in two minutes</button>
        </span>
      </div>
    </footer>
  </div>
</Modal>

<style>
  .welcome { display: flex; flex-direction: column; gap: 1.1rem; }
  .sec { display: flex; flex-direction: column; gap: .55rem; }
  .sh { display: flex; align-items: baseline; gap: .4rem .8rem; flex-wrap: wrap; }
  .sh h3 { margin: 0; font-size: .95rem; color: var(--text); text-transform: none; letter-spacing: 0; }
  .sub { color: var(--muted); font-size: .84rem; flex: 1 1 18rem; }
  .sub b { color: var(--text); }
  .fold { margin-left: auto; display: inline-flex; align-items: center; gap: .3rem; font-size: .84rem; }
  .strip { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 12.5rem), 1fr)); gap: .5rem; }
  .chip { --hue: var(--orange); display: flex; align-items: center; gap: .55rem; text-align: left; min-height: 3.1rem; padding: .45rem .7rem;
          border: 1px solid color-mix(in srgb, var(--hue) 45%, var(--line2)); border-radius: var(--radius);
          background: linear-gradient(160deg, color-mix(in srgb, var(--hue) 16%, var(--panel2)) 0%, var(--panel2) 70%); }
  .chip:hover:not(:disabled) { border-color: var(--hue); }
  .chip > :global(svg:last-child) { color: var(--hue); flex: none; }
  .cn { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .cn b { color: var(--text); font-size: .92rem; }
  .cn small { color: var(--muted); font-size: .76rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ic.sm { width: 1.9rem; height: 1.9rem; }

  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 14.5rem), 1fr)); gap: .6rem; }
  .tiles.demos { grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr)); }
  .tile { --hue: var(--orange); position: relative; display: flex; flex-direction: column; gap: .4rem; padding: .8rem .85rem .75rem;
          border: 1px solid var(--line2); border-radius: var(--radius); overflow: hidden;
          background: linear-gradient(160deg, color-mix(in srgb, var(--hue) 13%, var(--panel2)) 0%, var(--panel2) 55%); }
  .tile::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 3px; background: var(--hue); opacity: .85; }
  .tile.plain { background: var(--panel2); border-style: dashed; }
  .tile.plain::before { display: none; }
  .tile:hover, .tile:focus-within { border-color: color-mix(in srgb, var(--hue) 60%, var(--line2)); }
  .th { display: flex; align-items: center; gap: .55rem; }
  .th b { font-size: 1rem; color: var(--text); }
  .ic { display: grid; place-items: center; width: 2.3rem; height: 2.3rem; border-radius: 50%; flex: none;
        color: var(--hue); background: color-mix(in srgb, var(--hue) 16%, transparent); }
  .blurb { margin: 0; color: var(--muted); font-size: .84rem; line-height: 1.4; flex: 1; }
  .meta { margin: 0; font-size: .78rem; color: var(--faint); min-height: 1.1em; font-variant-numeric: tabular-nums; }
  .music { display: flex; align-items: center; gap: .45rem; font-size: .84rem; color: var(--muted); }
  .music select { flex: 1; min-width: 0; width: 100%; }
  /* (one line, whatever the song: a line more under one tile put its row out of step) */
  .credit { margin: 0; font-size: .76rem; color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .acts { display: flex; gap: .4rem; flex-wrap: wrap; margin-top: .15rem; }
  .acts button { min-height: 2.4rem; padding: .4rem .8rem; font-size: .9rem; display: inline-flex; align-items: center; justify-content: center; gap: .35rem; }
  .acts .primary { flex: 1 1 auto; }
  .demos .acts { flex-direction: column; }   /* (side by side "Lights only" fell to a line of its own, half wide) */

  .how { border-top: 1px solid var(--line); padding-top: .8rem; display: flex; flex-direction: column; gap: .5rem; }
  .how ol { margin: 0; padding-left: 1.2rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr)); gap: .3rem 1.4rem; color: var(--muted); font-size: .84rem; }
  .how b { color: var(--text); }
  .end { justify-content: space-between; align-items: center; gap: .6rem; flex-wrap: wrap; }
  .hint { margin: 0; font-size: .8rem; color: var(--faint); flex: 1 1 20rem; }
</style>
