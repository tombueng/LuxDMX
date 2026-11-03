<script lang="ts">
  // The app's own prompt / confirm: a small dialog that looks like the rest, works with Enter / Esc.
  import Modal from './Modal.svelte';
  import { ui } from './ui.svelte';

  const q = $derived(ui.question!);
  let value = $state(ui.question?.value ?? '');
  let input = $state<HTMLInputElement>();
  $effect(() => { input?.focus(); input?.select(); });
  // a held Enter (the one that opened this, say) doesn't answer it: only a fresh press does
  const held = (e: KeyboardEvent) => { if (e.key === 'Enter' && e.repeat) e.preventDefault(); };
  function finish(ok: boolean) {
    const { done, label, value: asked } = q;      // read before the dialog goes away
    ui.question = null;
    done(ok ? (label && asked !== undefined ? value.trim() || (q.empty ? '' : null) : '') : null);
  }
</script>

<Modal title={q.title} onclose={() => finish(false)}>
  <form onsubmit={(e) => { e.preventDefault(); finish(true); }} class="q">
    {#if q.body}<p id="q-body">{q.body}</p>{/if}
    {#if q.label && q.value !== undefined}
      <!-- (the field says the body and the hint too: a dialog asked again after a wrong PIN is heard as such) -->
      <label>{q.label} <input bind:this={input} bind:value aria-label={q.label} type={q.pin ? 'password' : 'text'} inputmode={q.pin || q.digits ? 'numeric' : undefined}
        class:code={q.pin || q.digits} autocomplete={q.pin || q.digits ? 'off' : undefined} maxlength={q.pin || q.digits ? 8 : undefined} onkeydown={held}
        aria-describedby={[q.body && 'q-body', q.hint && 'q-hint'].filter(Boolean).join(' ') || undefined} /></label>
      {#if q.hint}<p class="hint" id="q-hint">{q.hint}</p>{/if}
    {/if}
    <div class="row end">
      <button type="button" onclick={() => finish(false)}>Cancel</button>
      <!-- svelte-ignore a11y_autofocus -->
      <button type="submit" class={q.danger ? 'danger solid' : 'primary'} autofocus={!q.label} onkeydown={held}>{q.ok}</button>
    </div>
  </form>
</Modal>

<style>
  .q { display: flex; flex-direction: column; gap: .8rem; min-width: min(380px, 80vw); }
  .q p { margin: 0; color: var(--muted); line-height: 1.45; }
  label { display: flex; flex-direction: column; gap: .3rem; color: var(--muted); }
  .end { justify-content: flex-end; }
  /* a PIN: big digits in the middle, like the code on the phone page */
  input.code { font: 600 1.6rem ui-monospace, monospace; letter-spacing: .4em; text-align: center; width: 16ch; max-width: 100%; align-self: center; padding: .35rem .2rem .35rem .6rem; }
  .hint { margin: -.4rem 0 0; font-size: .82rem; color: var(--faint); text-align: center; }
  .solid { background: var(--pink); border-color: var(--pink); color: #1a0010; font-weight: 650; }
</style>
