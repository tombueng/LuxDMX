// Ctrl+Z (and Ctrl+Y, Ctrl+Shift+Z) in a number field, a slider or a checkbox: the show's undo, as
// anywhere else on the page, while the field shows what's committed. The browser's own undo only put
// the field's text back: a light stayed where it was until the field lost focus, and that was then a
// new change, not an undo. While a number is being typed (not committed yet), the field's own undo.
import { app } from '../app.svelte';

const OURS = new Set(['number', 'range', 'checkbox', 'radio']);
const shown = new WeakMap<HTMLInputElement, string>();
const field = (t: EventTarget | null) => { const el = t as HTMLInputElement | null; return el?.tagName === 'INPUT' && OURS.has(el.type) ? el : null; };
// (what it showed when focused, and after each commit: its value once the page has drawn it again)
const remember = (el: HTMLInputElement) => setTimeout(() => shown.set(el, el.value), 0);

function onKey(e: KeyboardEvent) {
  const el = field(e.target);
  if (!el || app.locked || !(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k !== 'z' && k !== 'y') return;
  const was = shown.get(el);
  if (el.type === 'number' && was !== undefined && was !== el.value) return;   // (being typed: its own)
  e.preventDefault(); e.stopPropagation();
  if (k === 'y' || e.shiftKey) app.redo(); else app.undo();
  remember(el);
}

// listening first (capture): the fields stop their keys from reaching the page's own shortcuts
export function fieldUndo(win: Window = window) {
  const focus = (e: Event) => { const el = field(e.target); if (el) shown.set(el, el.value); };
  const change = (e: Event) => { const el = field(e.target); if (el) remember(el); };
  win.addEventListener('keydown', onKey, true);
  win.addEventListener('focusin', focus, true);
  win.addEventListener('change', change, true);
  return () => { win.removeEventListener('keydown', onKey, true); win.removeEventListener('focusin', focus, true); win.removeEventListener('change', change, true); };
}
