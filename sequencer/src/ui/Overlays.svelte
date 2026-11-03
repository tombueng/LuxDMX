<script lang="ts">
  // The context menu and the toast, rendered once at the top of the app. Also: a long press with a
  // finger opens the context menu, like a right-click (some touch browsers never send one).
  import Icon from './Icon.svelte';
  import { ui } from './ui.svelte';

  let press: { x: number; y: number; t: ReturnType<typeof setTimeout>; native: boolean; target: EventTarget | null } | null = null;
  let swallowClick = false;
  function down(e: PointerEvent) {
    swallowClick = false;
    viaKeys = false;
    if (ui.menu && !(e.target as HTMLElement).closest('.ctx')) ui.closeMenu();
    if (e.pointerType !== 'touch' || (e.target as HTMLElement).closest?.('[data-no-longpress]')) return;
    const p = { x: e.clientX, y: e.clientY, native: false, target: e.target, t: setTimeout(() => {
      if (!press || press.native) return;
      press.target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: press.x, clientY: press.y }));
      swallowClick = true;
      press = null;
    }, 550) };
    press = p;
  }
  // The menu from the keyboard (Menu key, Shift+F10, Enter on a ⋯ button): the first item gets the
  // focus, arrows move, Home/End jump, Enter runs, Escape closes and gives the focus back.
  let menuEl = $state<HTMLDivElement>();
  let viaKeys = false;
  let returnTo: HTMLElement | null = null;
  const items = () => [...(menuEl?.querySelectorAll<HTMLButtonElement>('button[role=menuitem]:not(:disabled)') ?? [])];
  $effect(() => {
    if (!ui.menu || !menuEl) return;
    returnTo = document.activeElement as HTMLElement | null;
    if (viaKeys) items()[0]?.focus();
  });
  // Messages go where they cover nothing you'd press: on the stage's floor just under its
  // toolbar (or the top of the Live buttons), and on a phone just above the bottom bar.
  let toastAt = $state('');
  $effect(() => {
    if (!ui.toastText) return;
    if (window.innerWidth <= 760) {
      const bar = document.querySelector('.prog .actionbar, .prog .bottom');
      toastAt = `top:auto;bottom:${bar ? window.innerHeight - bar.getBoundingClientRect().top + 8 : 12}px`;
      return;
    }
    const at = document.querySelector('.stage-wrap svg, .live .body')?.getBoundingClientRect();
    toastAt = at && at.height > 120 ? `top:${Math.round(at.top + 10)}px;left:${Math.round(at.left + at.width / 2)}px` : '';
  });
  // Always inside the window (8 px margin), measured for real: after it's drawn, when the window
  // changes, and when the interface size changes under it. Phones get it as a sheet (CSS).
  let shift = $state({ x: 0, y: 0 });
  function clampMenu() {
    if (!menuEl || !ui.menu) return;
    shift = { x: 0, y: 0 };
    queueMicrotask(() => {
      if (!menuEl) return;
      const r = menuEl.getBoundingClientRect();
      shift = { x: Math.min(0, window.innerWidth - 8 - r.right) + Math.max(0, 8 - r.left), y: Math.min(0, window.innerHeight - 8 - r.bottom) + Math.max(0, 8 - r.top) };
    });
  }
  $effect(() => { void ui.menu; void ui.zoom; clampMenu(); });
  function closeMenu(refocus: boolean) { ui.closeMenu(); if (refocus) returnTo?.focus?.({ preventScroll: true }); returnTo = null; }
  function menuKeys(e: KeyboardEvent) {
    if (!ui.menu) { viaKeys = true; return; }
    const list = items(), i = list.indexOf(document.activeElement as HTMLButtonElement);
    const to = e.key === 'ArrowDown' ? (i + 1) % list.length : e.key === 'ArrowUp' ? (i <= 0 ? list.length - 1 : i - 1)
      : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : -1;
    if (to >= 0) { e.preventDefault(); e.stopPropagation(); list[to]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
    else if (e.key === 'Tab') closeMenu(false);
    else if (i >= 0 && (e.key === 'Enter' || e.key === ' ')) e.stopPropagation();      // the item's own, not GO
    else if (i < 0 && e.key !== 'Enter' && e.key !== ' ') e.stopPropagation();   // keys meant for the menu don't reach the list behind
  }
  function move(e: PointerEvent) { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) { clearTimeout(press.t); press = null; } }
  function up() { if (press) { clearTimeout(press.t); press = null; } }
</script>

<!-- (capture: a light on the stage stops its pointerdown from bubbling, a long press there still counts) -->
<svelte:window onpointerdowncapture={down} onpointermovecapture={move} onpointerupcapture={up} onpointercancelcapture={up}
               oncontextmenu={() => { if (press) press.native = true; }}
               onclickcapture={(e) => { if (swallowClick) { swallowClick = false; e.stopPropagation(); e.preventDefault(); } }}
               onkeydowncapture={menuKeys} onblur={() => ui.closeMenu()} onresize={clampMenu} />

{#if ui.menu}
  <div class="ctx" role="menu" style="left:{ui.menu.x + shift.x}px;top:{ui.menu.y + shift.y}px" bind:this={menuEl}>
    {#each ui.menu.items as it, i (i)}
      {#if it.sep}<hr />
      {:else if it.heading}<div class="mh" role="presentation">{it.heading}</div>
      {:else if it.stepper}
        {@const st = it.stepper}
        <div class="step" role="group" aria-label={it.label}>
          {#if it.icon}<Icon name={it.icon} />{/if}<span class="sl">{it.label}</span>
          <button role="menuitem" class="sb" disabled={st.minusOff?.()} onclick={st.minus} aria-label="{it.label}: smaller">−</button>
          <button role="menuitem" class="sv" onclick={() => st.reset?.()} title="Back to normal" aria-label="{it.label}: {st.value()}, back to normal">{st.value()}</button>
          <button role="menuitem" class="sb" disabled={st.plusOff?.()} onclick={st.plus} aria-label="{it.label}: bigger">+</button>
        </div>
      {:else}
        <button role="menuitem" class:danger={it.danger} disabled={it.disabled} onclick={() => { closeMenu(true); it.run?.(); }}>
          {#if it.icon}<Icon name={it.icon} />{/if}{it.label}
          {#if it.keys}<span class="k">{it.keys}</span>{/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}
{#if ui.toastText}
  <div class="toast" role="status" style={toastAt}>
    <span>{ui.toastText}</span>
    {#if ui.toastAction}<button class="primary sm" onclick={() => { const a = ui.toastAction; ui.toastText = ''; ui.toastAction = null; a?.run(); }}>{ui.toastAction.label}</button>{/if}
  </div>
{/if}
