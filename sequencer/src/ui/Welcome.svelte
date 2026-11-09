<script lang="ts">
  // The welcome: what to do first, a template, or the big demo with the music picked here. A dialog
  // over everything (the plan and the 3D stage alike). It comes up by itself when the app opens on
  // a show with nothing in it (Modals.svelte), once per show; "Get started" on an empty stage brings
  // it back.
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { app } from '../app.svelte';
  import { ui } from './ui.svelte';
  import { ALL_TEMPLATES as TEMPLATES } from '../content/ringMatrix';
  import { CATALOG, GENRES, type CatalogSong } from '../timeline/catalog';
  import { DEMO_SONG, demoSong, startDemo } from './startDemo';
  import { onDestroy } from 'svelte';

  let { onclose }: { onclose: () => void } = $props();

  // the demo's music: a song of the catalog, or 'beat' (the demo beat, made here); the last one
  // picked in this browser
  const SONG_KEY = 'luxdmx.seq.demoSong';
  let song = $state((() => { try { const v = localStorage.getItem(SONG_KEY); if (v === 'beat' || demoSong(v)) return v!; } catch { /* storage blocked */ } return DEMO_SONG; })());
  const picked = $derived(song === 'beat' ? undefined : demoSong(song));
  const byGenre = (() => {
    const m = new Map<string, CatalogSong[]>();
    for (const s of CATALOG) { const g = GENRES[s.genre] ?? s.genre; m.set(g, [...(m.get(g) ?? []), s]); }
    return [...m];
  })();
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  function pick(v: string) { song = v; try { localStorage.setItem(SONG_KEY, v); } catch { /* storage blocked */ } }

  // the demo's stage (content/demos.ts, loaded with the welcome: the shows' code stays out of the
  // page until wanted); picking one picks its own song, another can be picked after
  const STAGE_KEY = 'luxdmx.seq.demoStage';
  type Demo = { id: string; name: string; blurb: string; icon: string; song?: string };
  let demos = $state<Demo[]>([{ id: 'festival', name: 'Festival stage', icon: 'mover', song: DEMO_SONG, blurb: 'A band on a big stage in a hall: over a hundred moving heads hitting the beat, every effect machine, a crowd of hundreds.' }]);
  let stage = $state((() => { try { return localStorage.getItem(STAGE_KEY) ?? 'festival'; } catch { return 'festival'; } })());
  import('../content/demos').then((m) => { demos = m.DEMOS.map(({ id, name, blurb, icon, song }) => ({ id, name, blurb, icon, song })); if (!demos.some((d) => d.id === stage)) stage = 'festival'; }).catch(() => {});
  const cur = $derived(demos.find((d) => d.id === stage) ?? demos[0]);
  // (a demo without a song of its own, the test truss: no music to pick)
  const withMusic = $derived(cur.id === 'festival' || !!cur.song);
  // the arrow keys go round the stages (one tab stop for the group, like any radio group)
  function stageKey(e: KeyboardEvent) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = demos.findIndex((d) => d.id === cur.id), next = demos[(i + step + demos.length) % demos.length];
    pickStage(next);
    (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-stage="${next.id}"]`)?.focus();
  }
  function pickStage(d: Demo) {
    stage = d.id;
    try { localStorage.setItem(STAGE_KEY, d.id); } catch { /* storage blocked */ }
    if (d.song) pick(d.song);
  }

  // the song comes down before the show starts (with its progress here); closing cancels it
  let dl = $state<{ got: number; total: number; ctl: AbortController } | null>(null);
  const pct = (d: { got: number; total: number }) => (d.total ? `${Math.min(99, Math.round((d.got / d.total) * 100))} %` : `${(d.got / 1e6).toFixed(1)} MB`);
  async function demo() {
    if (dl) return;
    const ctl = new AbortController();
    dl = { got: 0, total: 0, ctl };
    try {
      await startDemo(song === 'beat' || !withMusic ? null : song, (got, total) => { if (dl?.ctl === ctl) { dl.got = got; dl.total = total; } }, ctl.signal, () => { dl = null; onclose(); }, cur.id);
    } catch { /* cancelled */ }
    if (dl?.ctl === ctl) dl = null;
  }
  function close() { dl?.ctl.abort(); dl = null; onclose(); }
  onDestroy(() => dl?.ctl.abort());

  function template(build: () => Parameters<typeof app.startShow>[0]) { void app.startShow(build()); onclose(); }
  let showFile = $state<HTMLInputElement>();
  async function open(f: File) {
    try { await app.importShow(f); ui.toast(`Opened "${app.show.meta.name}"`); onclose(); } catch (x) { ui.toast((x as Error).message, 6000); }
  }

  const narrow = typeof window !== 'undefined' && window.innerWidth <= 760;
  const tablet = !narrow && typeof window !== 'undefined' && window.innerWidth <= 1100;
</script>

<Modal title="Let's get some light on stage" onclose={close}>
  <div class="welcome">
    <ol>
      <li><Icon name="plus" /> <b>Add your lights</b> ({narrow ? 'the Lights tab below' : tablet ? 'Fixtures, on the right' : 'on the left'}), or <b>start from a template</b> (below).</li>
      <li><Icon name="palette" /> <b>Select lights and pick a colour</b> in the programmer ({narrow ? 'the Set tab' : tablet ? 'the Set tab on the right' : 'on the right'}).</li>
      <li><Icon name="record" /> <b>Record</b> it as a cue, and press {narrow ? 'GO' : 'Space'} for the next one.</li>
      <li><Icon name="link" /> <b>Connect your LuxDMX</b> ({typeof window !== 'undefined' && window.innerWidth <= 1100 ? 'the dot at the top right' : 'top right, +'}) whenever you want the real lights, then press <b>Blind</b> to send what you do to the stage (every browser starts blind). Everything works without it too.</li>
    </ol>

    <section class="demo" aria-label="The big demo">
      <div class="row go">
        <button class="primary" onclick={demo} disabled={!!dl} aria-busy={!!dl}>
          <Icon name="play" />{dl ? (picked && withMusic ? `Getting the song… ${pct(dl)}` : 'Starting…') : 'Show me a demo'}
        </button>
        {#if dl}<button class="ghost" onclick={() => { dl?.ctl.abort(); dl = null; }}>Cancel</button>{/if}
      </div>
      <div class="stages" role="radiogroup" aria-label="The demo's stage" tabindex="-1" onkeydown={stageKey}>
        {#each demos as d (d.id)}
          <button class="stagechip" class:on={d.id === cur.id} role="radio" aria-checked={d.id === cur.id} tabindex={d.id === cur.id ? 0 : -1} data-stage={d.id} onclick={() => pickStage(d)} disabled={!!dl} title={d.blurb}><Icon name={d.icon} size={16} />{d.name}</button>
        {/each}
      </div>
      <p class="faint">{cur.blurb} No hardware needed.</p>
      {#if withMusic}
      <label class="music">
        <span>Music</span>
        <select value={song} onchange={(e) => pick((e.target as HTMLSelectElement).value)} disabled={!!dl} aria-label="The demo's music">
          {#each byGenre as [g, list] (g)}
            <optgroup label={g}>
              {#each list as s (s.id)}<option value={s.id}>{s.title} · {s.artist}{s.id === DEMO_SONG ? " (the demo's own)" : ''}</option>{/each}
            </optgroup>
          {/each}
          <optgroup label="Made here">
            <option value="beat">The demo beat: ten minutes of club track, nothing to download</option>
          </optgroup>
        </select>
      </label>
      <p class="faint credit">{#if picked}{picked.title} by {picked.artist}: {GENRES[picked.genre]}, {Math.round(picked.bpm)} BPM, {clock(picked.duration)}, {picked.license}. Comes down from the artist's site first (a few MB).{:else}Builds, drops and breaks at 126 BPM, played by this page.{/if}</p>
      {/if}
    </section>

    <div class="tpls">
      <span class="faint">Or start from a rig like yours:</span>
      {#each TEMPLATES as t (t.name)}<button class="tplchip" onclick={() => template(t.build)} title={t.blurb}><Icon name={t.icon} size={16} />{t.name}</button>{/each}
    </div>
    <div class="row more">
      <button class="ghost guide" onclick={() => (ui.modal = 'guide')}><Icon name="help" />How it works, in two minutes</button>
      <!-- made at home, playing at the venue: the show file from the other computer -->
      <button class="ghost guide" onclick={() => showFile?.click()}><Icon name="folder" />Open a show file</button>
      <input type="file" accept=".json,.luxdmx,.qxw,application/json" hidden bind:this={showFile}
             onchange={(e) => { const i = e.target as HTMLInputElement; const f = i.files?.[0]; i.value = ''; if (f) void open(f); }} />
    </div>
    <div class="row end">
      <p class="hint faint">Program builds the show; Live (top) is for playing it with big buttons. This is an alpha: it works, but things change and some are rough, so keep a copy of your show (Shows, Export).</p>
      <button class="ghost" onclick={close}>Start with an empty stage</button>
    </div>
  </div>
</Modal>

<style>
  .welcome { display: flex; flex-direction: column; gap: .7rem; }
  ol { margin: 0; padding-left: 1.2rem; display: flex; flex-direction: column; gap: .45rem; color: var(--muted); }
  b { color: var(--text); }
  .demo { display: flex; flex-direction: column; gap: .35rem; padding: .7rem .8rem; border: 1px solid var(--line2); border-radius: var(--radius); background: var(--panel2); }
  .go { gap: .5rem; }
  .demo p { margin: 0; font-size: .85rem; }
  .music { display: flex; align-items: center; gap: .5rem; font-size: .88rem; color: var(--muted); }
  .music select { flex: 1; min-width: 0; width: 100%; }
  .credit { font-size: .8rem; }
  .stages { display: flex; flex-wrap: wrap; gap: .3rem; }
  .stagechip { display: inline-flex; align-items: center; gap: .3rem; padding: .3rem .65rem; font-size: .86rem; border-radius: 999px; }
  .stagechip.on { border-color: var(--orange); color: var(--text); background: color-mix(in srgb, var(--orange) 16%, transparent); }
  .tpls { display: flex; flex-wrap: wrap; gap: .3rem; align-items: center; }
  .tplchip { padding: .35rem .7rem; font-size: .88rem; border-radius: 999px; }
  .more { gap: 1rem; flex-wrap: wrap; }
  .guide { padding-left: 0; }
  .end { justify-content: space-between; align-items: center; gap: .6rem; flex-wrap: wrap; }
  .hint { margin: 0; font-size: .8rem; }
</style>
