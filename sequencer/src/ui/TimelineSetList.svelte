<script lang="ts">
  // The timeline's set list: the songs of the gig in one show, in order. The one picked is on the
  // tracks (and up next in Live); the patch, the cues, the effects and the pages are the whole set's.
  // Its own settings: a count-in, the look between songs. `onswitch`: another song is on the tracks
  // (the view fits it and lets go of what was picked); `onstop`: a listen or a download stops.
  import { app } from '../app.svelte';
  import { ui } from './ui.svelte';
  import Icon from './Icon.svelte';
  import { cueNumber } from '../model/cuenum';
  import type { CueList } from '../model/types';
  import { addSong, clockOf, moveSong, removeSong, setOptions, songIndex, songName, songsOf } from '../model/timeline';

  let { lists, onswitch, onstop }: { lists: CueList[]; onswitch: () => void; onstop: () => void } = $props();

  const songs = $derived(songsOf(app.show));
  const cur = $derived(songIndex(app.show));
  // picking one: stopped at its start, its first look on the stage (never dark, see app.pickSong)
  function pickSong(i: number) { if (i === cur) return; onstop(); app.pickSong(i); onswitch(); }
  function newSong() {
    onstop();
    app.checkpoint();
    addSong(app.show, { duration: 240, bpm: app.show.settings.bpm, items: [] });
    app.pickSong(songsOf(app.show).length - 1);
    app.markDirty(0); onswitch();
    ui.toast('A new song at the end of the set: load its file or pick a demo song, then put cues on it', 4500);
  }
  function moveTo(from: number, to: number) {
    if (to < 0 || to >= songs.length) return;
    app.checkpoint(); moveSong(app.show, from, to); app.markDirty(0);
    queueMicrotask(() => document.querySelectorAll<HTMLElement>('.tlv .setlist .pick')[to]?.focus());
  }
  async function renameSong(i: number) {
    const n = await ui.ask('Rename the song', songName(songs[i], i));
    if (n === null) return;
    const t = songsOf(app.show)[i];
    if (!t) return;
    app.checkpoint();
    if (n.trim()) t.name = n.trim().slice(0, 80); else delete t.name;
    app.markDirty(0);
  }
  async function dropSong(i: number) {
    const t = songs[i], name = songName(t, i);
    if (!t || songs.length < 2) return;
    if (t.items.length && !(await ui.confirm(`Remove "${name}" from the set?`, `Its ${t.items.length === 1 ? 'one cue or moment goes' : `${t.items.length} cues and moments go`} with it. Undo brings it back.`, 'Remove'))) return;
    const up = i === songIndex(app.show);
    app.checkpoint();
    removeSong(app.show, i);
    app.markDirty(0);
    if (up) { app.pickSong(songIndex(app.show)); onswitch(); }
    app.toastUndo(`"${name}" is out of the set`);
  }
  function songMenu(e: MouseEvent, i: number) {
    ui.openMenu(e, [
      { label: 'Rename…', icon: 'edit', run: () => renameSong(i) },
      { label: 'Earlier in the set', icon: 'up', keys: 'Alt+↑', disabled: i === 0, run: () => moveTo(i, i - 1) },
      { label: 'Later in the set', icon: 'down', keys: 'Alt+↓', disabled: i >= songs.length - 1, run: () => moveTo(i, i + 1) },
      { sep: true },
      { label: 'Remove from the set', icon: 'trash', danger: true, disabled: songs.length < 2, run: () => dropSong(i) },
    ]);
  }
  // the set's own settings: a count-in, the look between songs
  const between = $derived(app.show.setlist?.between ? JSON.stringify([app.show.setlist.between.list, app.show.setlist.between.cue]) : '');
  function setBetween(v: string) {
    app.checkpoint();
    const [list, cue] = v ? (JSON.parse(v) as [string, string]) : ['', ''];
    setOptions(app.show, { between: v ? { list, cue } : null });
    app.markDirty(0);
  }
  function setCountIn(v: number) { app.checkpoint(); setOptions(app.show, { countIn: v || null }); app.markDirty(0); }
</script>

<section class="set" aria-label="Set list">
  <h3>Set list</h3>
  {#if songs.length}
    <ol class="setlist">
      {#each songs as s, i (s)}
        <li class:cur={i === cur}>
          <button class="pick" aria-current={i === cur ? 'true' : undefined} onclick={() => pickSong(i)} oncontextmenu={(e) => songMenu(e, i)} ondblclick={() => renameSong(i)}
            onkeydown={(e) => { if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); moveTo(i, i + (e.key === 'ArrowUp' ? -1 : 1)); } }}
            title={i === cur ? 'On the tracks now. Double-click to rename, right-click for more' : 'Show this one (it is up next in Live). Double-click to rename, right-click for more'}>
            <span class="n">{i + 1}</span><span class="nm">{songName(s, i)}</span>{#if s.duration}<span class="faint len">{clockOf(s.duration, false)}</span>{/if}</button>
          <button class="ghost more" onclick={(e) => songMenu(e, i)} aria-label="More for {songName(s, i)}" title="Rename, move, remove"><Icon name="more" size={14} /></button>
        </li>
      {/each}
    </ol>
  {/if}
  <button class="ghost add" onclick={newSong} title="A song at the end of the set, with its own file and cues"><Icon name="plus" size={14} />Add a song</button>
  {#if songs.length}
    <label class="opt">Count-in <select value={app.show.setlist?.countIn ?? 0} aria-label="Count-in" onchange={(e) => setCountIn(+(e.target as HTMLSelectElement).value)}>
      <option value={0}>none</option><option value={1}>1 bar of clicks</option></select></label>
    <label class="opt">Between songs <select value={between} aria-label="Between songs" onchange={(e) => setBetween((e.target as HTMLSelectElement).value)}>
      <option value="">the last look stays</option>
      {#each lists as l (l.id)}<optgroup label={l.name}>{#each l.cues as c, k (c.id)}<option value={JSON.stringify([l.id, c.id])}>{cueNumber(l, k)}. {c.name}</option>{/each}</optgroup>{/each}
    </select></label>
  {/if}
</section>

<style>
  .set { display: flex; flex-direction: column; gap: .25rem; }
  h3 { margin: .2rem 0 0; font-size: .74rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
  .setlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .2rem; }
  .setlist li { display: flex; align-items: stretch; gap: .15rem; }
  .setlist .pick { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: .4rem; justify-content: flex-start; padding: .25rem .45rem; border-radius: var(--radius-s);
    border: 1px solid var(--line); background: var(--panel2); color: var(--text); text-align: left; font-size: .84rem; }
  .setlist .cur .pick { border-color: var(--green); background: #45d85c14; }
  .setlist .n { color: var(--muted); font-variant-numeric: tabular-nums; min-width: 1.1em; }
  .setlist .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .setlist .len { font-size: .74rem; font-variant-numeric: tabular-nums; }
  .setlist .more { padding: 0 .3rem; min-height: 0; }
  .set .add { align-self: flex-start; font-size: .82rem; }
  .set .opt { display: flex; align-items: center; gap: .4rem; font-size: .8rem; color: var(--muted); }
  .set .opt select { flex: 1; min-width: 0; font-size: .8rem; }
</style>
