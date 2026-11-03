// Small shared UI state: the context menu, toasts, help mode.
export interface MenuItem {
  label?: string;
  icon?: string;
  keys?: string;          // shortcut shown on the right
  disabled?: boolean;
  danger?: boolean;
  sep?: boolean;          // a divider instead of an item
  heading?: string;       // a small section title instead of an item
  // a "− value +" row (the interface size): the menu stays open while it's used
  stepper?: { value: () => string; minus: () => void; plus: () => void; minusOff?: () => boolean; plusOff?: () => boolean; reset?: () => void };
  run?: () => unknown;
}

export type ModalName = 'welcome' | 'shows' | 'addFixtures' | 'effects' | 'shortcuts' | 'palette' | 'guide' | 'monitor' | 'fogTimer' | 'patchCheck' | 'remote' | 'schedule' | 'rig';
const ZOOM_KEY = 'luxdmx.seq.zoom';
const HINTS_KEY = 'luxdmx.seq.hints';

class Ui {
  menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);
  modal = $state<ModalName | null>(null);   // the one big dialog that's open
  monitorUni = 0;                            // the universe the DMX monitor opens on
  fogFor: string[] | undefined;              // the machines a fog timer starts with (all when unset)
  patch = $state<string | null>(null);       // the fixture whose patch dialog is open
  patchTab = $state<'patch' | 'channels' | 'mounting'>('patch');   // the tab it opens on
  patchMany = $state<string[] | null>(null); // ...or the lights patched together
  fxSel = $state<string[]>([]);              // selected effects (Effects panel)
  zoom = $state(1);                          // UI size, saved per browser
  // the stage in 3D instead of the plan (saved per browser)
  private s3 = $state((() => { try { return localStorage.getItem('luxdmx.seq.stage3d') === '1'; } catch { return false; } })());
  get stage3d() { return this.s3; }
  set stage3d(v: boolean) { this.s3 = v; this.s3now = v; try { localStorage.setItem('luxdmx.seq.stage3d', v ? '1' : '0'); } catch { /* not remembered */ } }
  // the same, plain: what it is now even in a teardown (Svelte gives a teardown the value from before
  // the change that's tearing it down: the 3D stage closing because 2D was picked would read "3D")
  private s3now = this.s3;
  get stage3dNow() { return this.s3now; }
  // a video of the 3D stage is being taken (Stage3D.svelte): the layout stays as it is meanwhile, so
  // a window that gets narrower or wider doesn't swap the stage out and end the take
  recording = $state(false);
  // The question dialog (instead of the browser's prompt / confirm).
  // pin: digits, hidden, the number pad on a tablet; empty: an empty answer counts (not a Cancel)
  // digits: the number pad and big digits, shown (setting a PIN: a typo mustn't lock you out); hint: a line under the field
  question = $state<{ title: string; body?: string; label?: string; value?: string; ok: string; danger?: boolean; pin?: boolean; digits?: boolean; empty?: boolean; hint?: string; done: (v: string | null) => void } | null>(null);
  toastText = $state('');
  toastAction = $state<{ label: string; run: () => unknown } | null>(null);
  // The one-line hints at the top of the panels: on until someone hides them (remembered).
  private hintsOn = $state(true);
  get help() { return this.hintsOn; }
  set help(v: boolean) { this.hintsOn = v; try { localStorage.setItem(HINTS_KEY, v ? '1' : '0'); } catch { /* not remembered */ } }
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  // A context menu at the pointer, or under the button that opened it (so it never covers it).
  openMenu(e: MouseEvent | { clientX: number; clientY: number }, items: MenuItem[]) {
    if ('preventDefault' in e) e.preventDefault();
    let px = e.clientX, py = e.clientY;
    const el = 'currentTarget' in e ? (e.currentTarget as HTMLElement | null) : null;
    if (el && el.tagName === 'BUTTON' && (e as MouseEvent).type === 'click') { const r = el.getBoundingClientRect(); px = r.right - 240; py = r.bottom + 4; }
    const rowH = matchMedia('(pointer: coarse)').matches ? 44 : 32;
    const x = Math.max(8, Math.min(px, window.innerWidth - 290)), y = Math.max(8, Math.min(py, window.innerHeight - rowH * items.length - 20));
    this.menu = { x, y, items };
  }
  closeMenu() { this.menu = null; }
  // Ask for a name. Resolves to the text, or null when cancelled.
  ask(title: string, value = '', o: { label?: string; ok?: string; body?: string; pin?: boolean; digits?: boolean; empty?: boolean; hint?: string } = {}): Promise<string | null> {
    this.question?.done(null);                // a question still open counts as cancelled
    return new Promise((done) => (this.question = { title, value, label: o.label ?? 'Name', ok: o.ok ?? 'OK', body: o.body, pin: o.pin, digits: o.digits, empty: o.empty, hint: o.hint, done }));
  }
  // Ask yes or no. Resolves to true for yes.
  confirm(title: string, body: string, ok = 'Delete', danger = true): Promise<boolean> {
    this.question?.done(null);
    return new Promise((done) => (this.question = { title, body, ok, danger, done: (v) => done(v !== null) }));
  }

  constructor() {
    try { this.zoom = Math.max(0.7, Math.min(1.6, +(localStorage.getItem(ZOOM_KEY) ?? 1) || 1)); } catch { /* storage blocked */ }
    try { this.hintsOn = localStorage.getItem(HINTS_KEY) !== '0'; } catch { /* shown */ }
    this.applyZoom();
  }
  setZoom(z: number) {
    this.zoom = Math.round(Math.max(0.7, Math.min(1.6, z)) * 100) / 100;
    try { localStorage.setItem(ZOOM_KEY, String(this.zoom)); } catch { /* not saved, still applied */ }
    this.applyZoom();
  }
  private applyZoom() { if (typeof document !== 'undefined') document.documentElement.style.fontSize = `${87.5 * this.zoom}%`; }
  // A short message at the bottom; with an action (Undo) it stays a little longer.
  toast(text: string, ms = 2200, action?: { label: string; run: () => unknown }) {
    this.toastText = text;
    this.toastAction = action ?? null;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toastText = ''; this.toastAction = null; }, action ? Math.max(ms, 6000) : ms);
  }
}
export const ui = new Ui();

const mod = (e: KeyboardEvent) => e.ctrlKey || e.metaKey;
// A dialog is open: page-wide keys (GO, intensity, live buttons) leave it alone, its keys are its own.
export const dialogOpen = () => typeof document !== 'undefined' && !!document.querySelector('[aria-modal="true"]');
// Space is GO everywhere, except on the few controls that need it themselves (a menu item, the
// padlock being held, a DIP switch, a group button), and never as a held key's repeat (holding
// Space must not play through a list). Someone getting around with Tab gets the usual too: Space
// presses the button, tab or switch they tabbed to. A click or a tap puts it back to GO (a mouse
// on Blackout, then Space, is GO, not Blackout again).
let tabbing = false;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => { if (e.key === 'Tab') tabbing = true; }, true);
  window.addEventListener('pointerdown', () => { tabbing = false; }, true);
}
const PRESSABLE = 'button, summary, a[href], [role="tab"], [role="button"], [role="switch"], [role="checkbox"], [role="menuitem"]';
export const spaceIsGo = (e: KeyboardEvent) => e.code === 'Space' && !e.repeat
  && !(e.target as HTMLElement).closest?.('.ctx, .lockbtn, .dip, .gp .main, [data-own-space]')
  && !(tabbing && (e.target as HTMLElement).matches?.(PRESSABLE));
// A key aimed at a control inside a list row (a DIP switch, a "DIP switches" toggle, a button in
// an edit row) is that control's, not the list's: Backspace on a switch mustn't delete the light.
const insideControl = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  return t !== e.currentTarget && !!t.closest?.('button, summary, a, [contenteditable]');
};
// Keyboard shortcuts for a list of objects, bound on the list itself (so they only act while
// that list has focus): copy, cut, paste, duplicate, delete, select all.
export function listKeys(h: { copy?: () => unknown; cut?: () => unknown; paste?: () => unknown; duplicate?: () => unknown; del?: () => unknown; all?: () => unknown }) {
  return (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || insideControl(e)) return;
    const k = e.key.toLowerCase();
    let f: (() => unknown) | undefined;
    if (mod(e) && k === 'c') f = h.copy;
    else if (mod(e) && k === 'x') f = h.cut;
    else if (mod(e) && k === 'v') f = h.paste;
    else if (mod(e) && k === 'd') f = h.duplicate;
    else if (mod(e) && k === 'a') f = h.all;
    else if (k === 'delete' || k === 'backspace') f = h.del;
    if (f) { e.preventDefault(); e.stopPropagation(); f(); }
  };
}

// Arrow keys in a list of objects: Up/Down (or Left/Right) move the selection, Shift extends it,
// Alt moves the selected items themselves, Home/End jump, Enter opens, Escape clears. Returns true
// when it used the key.
export function navKeys(o: {
  ids: () => string[]; sel: () => string[]; set: (ids: string[]) => void;
  open?: (id: string) => void; horizontal?: boolean; scope?: () => HTMLElement | undefined;
  move?: (ids: string[], to: number) => void;
}) {
  let anchor: string | null = null;
  return (e: KeyboardEvent): boolean => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.ctrlKey || e.metaKey || insideControl(e)) return false;
    const ids = o.ids(), sel = o.sel();
    if (!ids.length) return false;
    const cur = sel.length ? ids.indexOf(sel[sel.length - 1]) : -1;
    const prev = o.horizontal ? 'ArrowLeft' : 'ArrowUp', next = o.horizontal ? 'ArrowRight' : 'ArrowDown';
    if (e.altKey) {
      if (!o.move || !sel.length || (e.key !== prev && e.key !== next)) return false;
      e.preventDefault();
      const idx = sel.map((id) => ids.indexOf(id)).filter((i) => i >= 0);
      const lo = Math.min(...idx), hi = Math.max(...idx);
      if (e.key === prev && lo > 0) o.move(sel, lo - 1);
      else if (e.key === next && hi < ids.length - 1) o.move(sel, hi + 2);
      return true;
    }
    let to = -1;
    if (e.key === prev) to = Math.max(0, cur - 1);
    else if (e.key === next) to = Math.min(ids.length - 1, cur + 1);
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = ids.length - 1;
    else if (e.key === 'Enter' && cur >= 0 && o.open) { e.preventDefault(); o.open(ids[cur]); return true; }
    else if (e.key === 'Escape' && sel.length) { e.preventDefault(); o.set([]); return true; }
    else return false;
    e.preventDefault();
    if (e.shiftKey) {
      if (!anchor || !ids.includes(anchor)) anchor = cur >= 0 ? ids[cur] : ids[to];
      const a = ids.indexOf(anchor);
      // The range from the anchor, with the cursor last (the last selected item is the cursor).
      o.set([...ids.slice(Math.min(a, to), Math.max(a, to) + 1).filter((x) => x !== ids[to]), ids[to]]);
    } else { anchor = ids[to]; o.set([ids[to]]); }
    // Keep the new item in view.
    queueMicrotask(() => o.scope?.()?.querySelector(`[data-id="${CSS.escape(ids[to])}"]`)?.scrollIntoView({ block: 'nearest' }));
    return true;
  };
}

// Close a popover with Esc or a click (or tap) outside it. Use: <div use:dismiss={() => (open = false)}>
export function dismiss(node: HTMLElement, close: () => void) {
  let fn = close;
  const down = (e: PointerEvent) => { if (!node.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-popover-toggle]')) fn(); };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); fn(); } };
  setTimeout(() => window.addEventListener('pointerdown', down, true));
  window.addEventListener('keydown', key, true);
  return {
    update(c: () => void) { fn = c; },
    destroy() { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); },
  };
}

// Reorder a list by dragging an item's grip with a finger or a pen (the browser's drag and drop
// only works with a mouse). Call from the grip's pointerdown; reports where it would land.
export function gripDrag(e: PointerEvent, o: { list: () => HTMLElement | undefined; over: (index: number, after: boolean) => void; drop: () => void; cancel: () => void }) {
  if (e.pointerType === 'mouse') return false;          // the mouse uses normal drag and drop
  e.preventDefault(); e.stopPropagation();
  const grip = e.currentTarget as HTMLElement;
  grip.setPointerCapture(e.pointerId);
  const items = () => [...(o.list()?.querySelectorAll<HTMLElement>('[data-id]') ?? [])];
  const move = (ev: PointerEvent) => {
    const list = items();
    let best = -1, after = false;
    for (let i = 0; i < list.length; i++) {
      const r = list[i].getBoundingClientRect();
      if (ev.clientY >= r.top && ev.clientY <= r.bottom) { best = i; after = ev.clientY > r.top + r.height / 2; break; }
      if (ev.clientY > r.bottom) { best = i; after = true; }
    }
    if (best >= 0) o.over(best, after);
  };
  const up = () => { cleanup(); o.drop(); };
  const cancel = () => { cleanup(); o.cancel(); };
  const cleanup = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', cancel); };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', cancel);
  return true;
}

// Inline rename fields: focused with the text selected, so typing replaces the name.
export function focusSelect(node: HTMLInputElement) { queueMicrotask(() => { node.focus(); node.select(); }); }

// The context menu from the keyboard: the Menu key or Shift+F10 on a list opens the menu of its
// current item, placed at that item.
export function menuKey(e: KeyboardEvent, scope: HTMLElement | undefined, id: string | undefined, open: (ev: { clientX: number; clientY: number }, id: string) => void) {
  if (!(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) || !id) return false;
  e.preventDefault();
  const el = scope?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
  const r = el?.getBoundingClientRect();
  open({ clientX: r ? r.left + 24 : 100, clientY: r ? r.bottom - 4 : 100 }, id);
  return true;
}

// A row of tabs the way the pattern goes: one Tab stop (the tab that's on), the arrows (and Home,
// End) go to the next one and open it.
export function tablist(node: HTMLElement) {
  const tabs = () => [...node.querySelectorAll<HTMLElement>('[role="tab"]')].filter((t) => !t.hasAttribute('disabled'));
  const sync = () => { const ts = tabs(), cur = ts.find((t) => t.getAttribute('aria-selected') === 'true') ?? ts[0]; for (const t of ts) t.tabIndex = t === cur ? 0 : -1; };
  const key = (e: KeyboardEvent) => {
    const ts = tabs(), i = ts.indexOf(document.activeElement as HTMLElement);
    if (i < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const j = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % ts.length : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + ts.length) % ts.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? ts.length - 1 : -1;
    if (j < 0) return;
    e.preventDefault(); e.stopPropagation();
    ts[j].focus(); ts[j].click();
  };
  const mo = new MutationObserver(sync);
  mo.observe(node, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected', 'disabled'] });
  sync();
  node.addEventListener('keydown', key);
  return { destroy() { mo.disconnect(); node.removeEventListener('keydown', key); } };
}
