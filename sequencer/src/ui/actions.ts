// Fixture actions shared by the fixture list, the stage and the command palette: each one does
// its thing on the selection and says so (with Undo where something went away).
import { app } from '../app.svelte';
import { ui, type MenuItem } from './ui.svelte';
import { typeLabel } from '../model/library';
import { renumber } from '../model/numbers';

const n = (k: number, what = 'fixture') => `${k} ${what}${k > 1 ? 's' : ''}`;
export const fixtureActions = {
  async copy() { const k = await app.copyFixtures(); if (k) ui.toast(`Copied ${n(k)}`); },
  async cut() { const k = await app.cutFixtures(); if (k) app.toastUndo(`Cut ${n(k)}. Paste puts them back, Undo too.`); },
  async paste() { const k = await app.pasteFixtures(); ui.toast(k ? `Pasted ${n(k)} at free addresses${app.pasteNote}` : 'Nothing to paste'); },
  async duplicate() { if (await app.copyFixtures()) { const k = await app.pasteFixtures(); ui.toast(k ? `Duplicated ${n(k)}${app.pasteNote}` : 'No room for another one'); } },
  remove() {
    const k = app.selected.length;
    if (!k) return;
    const r = app.removeFixtures();
    const also = [r.cues ? `${k > 1 ? 'they were' : 'it was'} in ${r.cues} cue${r.cues > 1 ? 's' : ''}` : '', r.groups ? `${r.groups} empty group${r.groups > 1 ? 's' : ''} went too` : '',
      r.also ? `${r.also} with nothing left to work on went too` : ''].filter(Boolean).join('; ');
    app.toastUndo(`Removed ${n(k)}${also ? ` (${also})` : ''}`);
  },
  async group() {
    const name = await ui.ask('New group', `Group ${app.show.groups.length + 1}`, { ok: 'Make the group' });
    if (name) { app.groupFromSelection(name); ui.toast(`Group "${name}" made`); }
  },
  // numbers for the selection, from one you type on (in list order: 101, 102, ...)
  async number() {
    const ids = app.show.fixtures.map((f) => f.id).filter((id) => app.selected.includes(id));
    if (!ids.length) return;
    const first = app.show.fixtures.find((f) => f.id === ids[0])?.num ?? 1;
    const v = await ui.ask(ids.length > 1 ? `Number the ${ids.length} lights from` : 'Its number', String(first), { ok: 'Number', digits: true, hint: ids.length > 1 ? 'They get this one and the ones after it, in the order of the list.' : 'What the console and typed commands go by.' });
    if (v === null) return;
    app.checkpoint();
    const why = renumber(app.show.fixtures, ids, Math.round(Number(v)));
    if (why) { ui.toast(why, 6000); return; }
    app.markDirty(0);
    app.toastUndo(ids.length > 1 ? `Numbered ${v} to ${Math.round(Number(v)) + ids.length - 1}` : `Number ${v}`);
  },
  selectSameType(id: string) {
    const f = app.show.fixtures.find((x) => x.id === id);
    if (f) app.selected = app.show.fixtures.filter((x) => x.typeId === f.typeId).map((x) => x.id);
  },
};

// The menu for a fixture (right-click in the list or on the stage). `extra` goes on top.
export function fixtureMenu(id: string, extra: MenuItem[] = []): MenuItem[] {
  if (!app.selected.includes(id)) app.select(id, false);
  const f = app.show.fixtures.find((x) => x.id === id)!;
  const t = app.types.get(f.typeId);
  const fog = app.caps(id).fog;
  return [
    app.selected.length > 1
      ? { label: `Patch the ${app.selected.length} selected…`, icon: 'edit', keys: 'Enter', run: () => (ui.patchMany = [...app.selected]) }
      : { label: 'Name, address, mode…', icon: 'edit', keys: 'Enter', run: () => { ui.patchTab = 'patch'; ui.patch = id; } },
    // (how it hangs and points, in 3D with just these lights: for the selection too)
    ...(app.kinds[id] === 'mover' || app.kinds[id] === 'par' || app.kinds[id] === 'strobe' ? [{ label: app.selected.length > 1 ? `Mounting of the ${app.selected.length} selected…` : 'Mounting…', icon: 'position', run: () => { ui.patchTab = 'mounting'; ui.patch = id; } } as MenuItem] : []),
    // (the moving heads in the selection: steered onto marks, where they really hang worked out)
    ...(app.kinds[id] === 'mover' ? [{ label: (() => { const n = app.selected.filter((x) => app.kinds[x] === 'mover').length; return n > 1 ? `Focus and calibrate the ${n} heads…` : 'Focus and calibrate…'; })(), icon: 'position',
      run: () => (ui.focusCal = app.selected.filter((x) => app.kinds[x] === 'mover')) } as MenuItem] : []),
    // (a light that may move but whose profile doesn't say how: channels nobody named)
    // (a plain profile: most of its channels unnamed; not a fog machine or a PAR with a macro channel)
    ...((() => { const c = app.caps(id), chs = app.modeOf(id)?.channels ?? [], raw = chs.filter((x) => x.attr === 'raw').length;
      return !c.position && !c.fog && raw >= 2 && raw * 2 >= chs.length; })()
      ? [{ label: 'Find pan and tilt…', icon: 'position', run: () => (ui.panTiltFind = id) } as MenuItem] : []),
    ...extra,
    ...(fog ? [{ label: 'Make a fog timer for it…', icon: 'fog', run: () => fogTimer([id]) } as MenuItem] : []),
    { label: `Select all ${t ? typeLabel(t) : 'like it'} (${app.show.fixtures.filter((x) => x.typeId === f.typeId).length})`, icon: 'check', run: () => fixtureActions.selectSameType(id) },
    { label: app.selected.length > 1 ? `Number the ${app.selected.length} from…` : `Number (now ${f.num ?? '–'})…`, icon: 'edit', run: () => void fixtureActions.number() },
    { sep: true },
    { label: 'Copy', icon: 'copy', keys: 'Ctrl+C', run: fixtureActions.copy },
    { label: 'Cut', icon: 'cut', keys: 'Ctrl+X', run: fixtureActions.cut },
    { label: 'Paste', icon: 'paste', keys: 'Ctrl+V', run: fixtureActions.paste },
    { label: 'Duplicate', icon: 'duplicate', keys: 'Ctrl+D', run: fixtureActions.duplicate },
    { label: 'Make a group from the selection', icon: 'group', run: fixtureActions.group },
    { sep: true },
    { label: 'Remove', icon: 'trash', keys: 'Del', danger: true, run: fixtureActions.remove },
  ];
}

// A fog timer: one small dialog (how often, how long, which machines).
export function fogTimer(fixtures?: string[]) {
  if (!app.show.fixtures.some((f) => app.caps(f.id).fog)) { ui.toast('There is no fog or haze machine in the patch'); return; }
  ui.fogFor = fixtures;
  ui.modal = 'fogTimer';
}

// Colours from a picture (a poster, an album cover, a photo of the room): pick it, they become
// colour presets; with lights selected the message offers a colour fade through them.
export function colorsFromPicture(file?: File) {
  const run = async (f: File) => {
    if (!f.type.startsWith('image/')) return ui.toast('That is not a picture');
    try {
      const cols = await app.colorsFromPicture(f, f.name);
      if (!cols.length) return ui.toast('No clear colours in that picture');
      const base = f.name.replace(/\.[^.]+$/, '').slice(0, 18) || 'Picture';
      // the lights selected now: by the time the button is pressed the selection may have moved on
      const ids = app.selected.filter((id) => app.caps(id).color);
      ui.toast(`${cols.length} colours from "${f.name}" are colour presets now (Ctrl+Z takes them away)`, 8000,
        ids.length ? { label: 'Fade through them on the selection', run: () => {
          app.selected = ids.filter((id) => app.show.fixtures.some((x) => x.id === id));
          if (app.selected.length) app.colorFadeWith(cols, `${base} colours`);
        } } : undefined);
    } catch { ui.toast("Couldn't read that picture"); }
  };
  if (file) return run(file);
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = () => { const f = input.files?.[0]; if (f) run(f); };
  input.click();
}
