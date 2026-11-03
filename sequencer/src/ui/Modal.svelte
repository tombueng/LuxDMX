<script lang="ts">
  // A dialog. Focus goes in when it opens (to whatever has autofocus, else the first control),
  // Tab stays inside, and focus goes back to what opened it when it closes. Escape closes the
  // top one (dialogs can open on top of each other: a question over the show manager).
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  // dock: in the bottom corner without darkening the page (for tools you use while watching the stage)
  let { title, onclose, children, wide = false, dock = false }: { title: string; onclose: () => void; children: Snippet; wide?: boolean; dock?: boolean } = $props();
  const me = Symbol();
  const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;
  let box = $state<HTMLDivElement>();
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const focusables = () => [...(box?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.offsetParent !== null || el === document.activeElement);
  $effect(() => {
    open.push(me);
    const opener = document.activeElement as HTMLElement | null;
    // after the content is there (an autofocus input may already have taken it)
    queueMicrotask(() => {
      if (!box || box.contains(document.activeElement)) return;
      (box.querySelector<HTMLElement>('[autofocus]') ?? focusables().find((el) => !el.classList.contains('x')) ?? focusables()[0])?.focus({ preventScroll: true });
    });
    return () => {
      const i = open.indexOf(me); if (i >= 0) open.splice(i, 1);
      // (an opener that's gone, the Ctrl+K box say: where the focus was before any dialog)
      const back = opener?.isConnected ? opener : outside?.isConnected ? outside : null;
      if (back && (!document.activeElement || document.activeElement === document.body || box?.contains(document.activeElement))) back.focus({ preventScroll: true });
    };
  });
  function keys(e: KeyboardEvent) {
    if (open[open.length - 1] !== me) return;
    if (e.key === 'Escape') { e.stopPropagation(); onclose(); return; }
    if (e.key !== 'Tab' || !box) return;
    const f = focusables();
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1], at = document.activeElement as HTMLElement;
    if (e.shiftKey && (at === first || !box.contains(at))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (at === last || !box.contains(at))) { e.preventDefault(); first.focus(); }
  }
</script>

<script module lang="ts">
  const open: symbol[] = [];
  // the last thing focused outside any dialog
  let outside: HTMLElement | null = null;
  if (typeof window !== 'undefined') window.addEventListener('focusin', (e) => { const t = e.target as HTMLElement; if (t !== document.body && !t.closest?.('[aria-modal="true"], .ctx')) outside = t; });
</script>

<svelte:window onkeydown={keys} />

<div class="backdrop" class:dock role="presentation" onclick={(e) => { if (e.target === e.currentTarget && !dock) onclose(); }}>
  <div class="modal" class:wide role="dialog" aria-modal="true" aria-labelledby={titleId} bind:this={box}>
    <div class="head row">
      <h2 id={titleId}>{title}</h2>
      <span style="flex:1"></span>
      <button class="ghost x" onclick={onclose} aria-label="Close" title="Close (Esc)"><Icon name="close" size={16} /></button>
    </div>
    <div class="body">{@render children()}</div>
  </div>
</div>

<style>
  /* (one column the width of the screen: a dialog is never wider than the screen, whatever a long
     menu or name inside it wants) */
  .backdrop { position: fixed; inset: 0; background: #000a; display: grid; grid-template-columns: minmax(0, 1fr); place-items: center; z-index: 50; padding: 1rem; }
  .modal { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; width: min(640px, 100%); max-height: 92vh; display: flex; flex-direction: column; box-shadow: var(--shadow); }
  .modal.wide { width: min(1000px, 100%); }
  /* bottom left: over the lists, the stage and the programmer stay in view */
  .backdrop.dock { background: none; pointer-events: none; place-items: end start; }
  .backdrop.dock .modal { pointer-events: auto; width: min(420px, 100%); box-shadow: 0 12px 40px #000c, 0 0 0 1px var(--line2); }
  .head { padding: .7rem .9rem .3rem; } .head h2 { margin: 0; font-size: 1.05rem; color: var(--text); text-transform: none; letter-spacing: 0; }
  .body { padding: .3rem .9rem .9rem; overflow: auto; }
  .x { color: var(--muted); }
</style>
