<script lang="ts">
  // The Formula and Picture effects' own fields (their expression, their picture), in the effect
  // editor above the general knobs. Nothing for the other effects.
  import type { Effect } from '../model/types';
  import type { EffectParams } from '../engine/effects';
  import { COLOR_FUNCTIONS, EXAMPLES, FUNCTIONS, VARIABLES, check } from '../engine/formula';
  import { pictureOf, PICTURE_LIMITS, type Picture } from '../engine/custom';
  import Icon from './Icon.svelte';
  import { clock } from './clock.svelte';
  import { TEXT_MAX } from '../engine/fxkit';
  import { ui } from './ui.svelte';

  let { fx, p, set }: { fx: Effect; p: EffectParams; set: (k: string, v: unknown) => void } = $props();
  const uid = $props.id();

  // ---- the formula
  // What's typed stays here until it reads well; only then do the lights get it (a half-typed
  // formula never blacks them out).
  let draft = $state<{ id: string; text: string } | null>(null);
  const shown = $derived(draft && draft.id === fx.id ? draft.text : p.formula);
  const err = $derived(fx.kind === 'formula' ? check(shown) : null);
  const pending = $derived(shown !== p.formula);
  function typed(text: string) {
    if (check(text)) draft = { id: fx.id, text };
    else { set('formula', text); draft = null; }
  }
  // the text around the error, with the spot marked
  const near = $derived(err ? {
    before: (err.pos > 28 ? '…' : '') + shown.slice(Math.max(0, err.pos - 28), err.pos),
    at: shown[err.pos] ?? ' ',
    after: shown.slice(err.pos + 1, err.pos + 18) + (shown.length > err.pos + 18 ? '…' : ''),
  } : null);

  // ---- the picture
  const pic = $derived(fx.kind === 'picture' ? pictureOf(p) : null);
  const anim = $derived(!!pic && pic.frames.length > 1);
  const own = $derived(pic ? Math.round(pic.total / 100) / 10 : 0);    // an animation's own length, s
  let input = $state<HTMLInputElement>();
  let canvas = $state<HTMLCanvasElement>();
  let busy = $state(false);
  let loadErr = $state('');
  let from = $state<{ id: string; name: string; w: number; h: number; frames: number } | null>(null);
  const kb = (n: number) => (n < 1000 ? `${n} bytes` : n < 10_000 ? `${(n / 1000).toFixed(1)} KB` : `${Math.round(n / 1000)} KB`);
  // "48 × 32 px · 24 frames · 2.4 s · 210 KB in the show (from 480 × 320, 120 frames)"
  const size = $derived.by(() => {
    if (!pic) return '';
    const parts = [`${pic.w} × ${pic.h} px`];
    if (anim) parts.push(`${pic.frames.length} frames`, `${own} s`);
    parts.push(`${kb(p.picture.length)} in the show`);
    const f = from && from.id === fx.id && (from.w !== pic.w || from.frames !== pic.frames.length) ? from : null;
    return parts.join(' · ') + (f ? ` (from ${f.w} × ${f.h}${f.frames > 1 ? `, ${f.frames} frames` : ''})` : '');
  });

  async function load(file: File) {
    busy = true; loadErr = '';
    const id = fx.id;
    try {
      const gif = await import('../engine/gif');
      try {
        const r = await gif.loadPicture(file);
        if (fx.id !== id) return;                // another effect is open by now: not for that one
        set('picture', r.packed);
        // an animation plays at its own pace to start with (Speed then stretches or squeezes it)
        if (r.frames > 1) { set('speed', Math.max(0.1, Math.round(r.ms / 100) / 10)); set('tempo', false); }
        else { set('speed', undefined); set('tempo', undefined); }
        from = { id: fx.id, name: file.name, ...r.from };
      } catch (e) {
        loadErr = e instanceof gif.PictureError ? e.message : 'That picture could not be read (PNG, JPG, WebP or GIF)';
        ui.toast(loadErr);
      }
    } catch {
      loadErr = 'The picture reader didn\'t load. Check the connection and try again.';
      ui.toast(loadErr);
    } finally { busy = false; }
  }

  // The little preview: the picture itself (an animation plays at its own pace).
  $effect(() => { if (anim) return clock.use(); });
  const images = new WeakMap<Picture, ImageData[]>();
  $effect(() => {
    const ctx = canvas?.getContext('2d');
    if (!ctx || !pic) return;
    let f = 0;
    if (anim) { const ms = (clock.t * 1000) % pic.total; while (f < pic.ends.length - 1 && pic.ends[f] <= ms) f++; }
    if (canvas!.width !== pic.w || canvas!.height !== pic.h) { canvas!.width = pic.w; canvas!.height = pic.h; }
    let list = images.get(pic);
    if (!list) images.set(pic, (list = []));
    let img = list[f];
    if (!img) {
      img = list[f] = ctx.createImageData(pic.w, pic.h);
      const src = pic.frames[f], d = img.data;
      for (let i = 0, o = 0; i < src.length; i += 3, o += 4) { d[o] = src[i]; d[o + 1] = src[i + 1]; d[o + 2] = src[i + 2]; d[o + 3] = 255; }
    }
    ctx.putImageData(img, 0, 0);
  });

  const MAPS: [string, string, string][] = [
    ['auto', 'Auto', 'A wall on several pixel bars, a line otherwise'],
    ['line', 'Line', 'The lights are one line: the picture scrolls through them (a GIF plays)'],
    ['wall', 'Wall', 'One row of the picture per light, its columns along each light'],
  ];
</script>

{#if fx.kind === 'scrollText'}
  <label class="knob"><span class="lab">Words</span>
    <input value={p.text} maxlength={TEXT_MAX} aria-label="Words" oninput={(e) => set('text', (e.target as HTMLInputElement).value)} /></label>
{/if}
{#if fx.kind === 'formula'}
  <div class="cf">
    <div class="head">
      <label class="lab" for="{uid}-f">Formula</label>
      <select aria-label="Formula examples" onchange={(e) => {
        const s = e.target as HTMLSelectElement, ex = EXAMPLES.find((x) => x.name === s.value);
        if (ex) { set('formula', ex.formula); draft = null; }
        s.value = '';
      }}>
        <option value="">Examples…</option>
        {#each EXAMPLES as ex (ex.name)}<option value={ex.name}>{ex.name}</option>{/each}
      </select>
    </div>
    <textarea id="{uid}-f" class="code" rows="3" spellcheck="false" autocomplete="off" autocapitalize="off"
      value={shown} oninput={(e) => typed((e.target as HTMLTextAreaElement).value)}
      aria-invalid={!!err} aria-describedby="{uid}-e"></textarea>
    <div id="{uid}-e" class="msg" aria-live="polite">
      {#if err && near}
        <p class="err">{err.message}{#if pending}. The lights keep the last formula that worked.{/if}</p>
        <code class="where" aria-hidden="true">{near.before}<mark>{near.at}</mark>{near.after}</code>
      {:else}
        <p class="faint">A number is a brightness in the palette's colour; hsv(), rgb() or pal() give a colour.</p>
      {/if}
    </div>
    <details>
      <summary>What can I write?</summary>
      <p class="faint">Operators <code>+ - * / % ^</code>, <code>&lt; &lt;= &gt; &gt;= == !=</code> (1 or 0), <code>&amp;&amp; || !</code>, <code>a ? b : c</code>. Turns: 1.0 is once round, so <code>wave(x - c)</code> rolls along.</p>
      <dl>
        {#each Object.entries(VARIABLES) as [name, what] (name)}<dt><code>{name}</code></dt><dd>{what}</dd>{/each}
        <dt><code>pi</code>, <code>tau</code></dt><dd>3.14…, 6.28…</dd>
        {#each Object.entries(COLOR_FUNCTIONS) as [name, f] (name)}<dt><code>{name}()</code></dt><dd>{f.help}</dd>{/each}
        {#each Object.entries(FUNCTIONS) as [name, f] (name)}<dt><code>{name}()</code></dt><dd>{f.help}</dd>{/each}
      </dl>
    </details>
  </div>
{:else if fx.kind === 'picture'}
  <div class="cf">
    <div class="pic">
      <canvas bind:this={canvas} aria-hidden="true"></canvas>
      <div class="about">
        {#if !p.picture}
          <b>The sample sunset</b>
          <span class="faint">Load your own: a PNG, JPG, WebP or an animated GIF.</span>
        {:else if pic}
          <b>{from && from.id === fx.id ? from.name : anim ? 'Your GIF' : 'Your picture'}</b>
          <span class="faint" data-testid="picture-size">{size}</span>
        {:else}
          <b class="err">This picture can't be read</b>
          <span class="faint">Load it again, or another one.</span>
        {/if}
        <div class="row">
          <button onclick={() => input?.click()} disabled={busy}><Icon name="image" />{busy ? 'Reading…' : p.picture ? 'Another picture…' : 'Load a picture or GIF…'}</button>
          {#if p.picture}<button class="ghost" onclick={() => { set('picture', undefined); set('speed', undefined); set('tempo', undefined); }}>Remove</button>{/if}
        </div>
      </div>
    </div>
    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden bind:this={input} aria-label="Picture or GIF file"
      onchange={(e) => { const i = e.target as HTMLInputElement, f = i.files?.[0]; i.value = ''; if (f) void load(f); }} />
    {#if loadErr}<p class="err" role="alert">{loadErr}</p>{/if}
    <div class="knob"><span class="lab">On the lights</span>
      <div class="seg" role="radiogroup" aria-label="How the picture lies on the lights">
        {#each MAPS as [m, label, title] (m)}<button role="radio" aria-checked={p.mapping === m} class:on={p.mapping === m} {title} onclick={() => set('mapping', m)}>{label}</button>{/each}
      </div>
    </div>
    <p class="faint">
      {#if anim}
        <span>Plays once every {p.speed} {p.tempo ? 'beats' : 's'}</span>{#if p.tempo || Math.abs(p.speed - own) > 0.05}<span>&nbsp;(its own pace: {own} s,&nbsp;<button class="link" onclick={() => { set('speed', own); set('tempo', false); }}>back to it</button>)</span>{/if}.
      {:else}
        <span>On a line it scrolls through once every {p.speed} {p.tempo ? 'beats' : 's'}; on a wall it stands still.</span>
      {/if}
      <span>Pictures are kept at {PICTURE_LIMITS.w} × {PICTURE_LIMITS.h} px and {PICTURE_LIMITS.frames} frames at most.</span>
    </p>
  </div>
{/if}

<style>
  .cf { display: flex; flex-direction: column; gap: .3rem; }
  .head { display: flex; align-items: center; gap: .4rem; justify-content: space-between; }
  .lab { color: var(--muted); }
  .code { width: 100%; box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .82rem; resize: vertical; min-height: 3.6em; }
  .code[aria-invalid='true'] { border-color: var(--pink); }
  .msg p { margin: 0; }
  .where { display: block; margin-top: .15rem; white-space: pre; overflow: hidden; text-overflow: ellipsis; font-size: .8rem; color: var(--muted); }
  .where mark { background: var(--pink); color: #fff; border-radius: 2px; padding: 0 1px; }
  details { font-size: .8rem; }
  summary { cursor: pointer; color: var(--muted); }
  details p { margin: .3rem 0; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: .1rem .5rem; margin: .2rem 0 0; }
  dt { white-space: nowrap; } dd { margin: 0; color: var(--muted); }
  code { color: var(--text); }
  .pic { display: flex; gap: .5rem; align-items: flex-start; }
  canvas { width: 96px; height: 72px; object-fit: contain; image-rendering: pixelated; background: #000; border-radius: 6px; border: 1px solid var(--line); flex: none; }
  .about { display: flex; flex-direction: column; gap: .2rem; min-width: 0; }
  .about b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row { display: flex; gap: .3rem; flex-wrap: wrap; }
  .knob { display: grid; grid-template-columns: 4.6rem 1fr; align-items: center; gap: .35rem; }
  .seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; }
  .seg button { padding: .15rem 0; font-size: .76rem; }
  p.faint { margin: 0; font-size: .8rem; }
  .link { display: inline; padding: 0; border: 0; background: none; color: var(--accent); text-decoration: underline; font-size: inherit; min-height: 0; }
</style>
