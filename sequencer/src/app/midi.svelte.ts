// A MIDI controller: its notes and controls on the live page's buttons and faders (the ones that
// learned them), and on the console's faders with soft takeover. The app hands its MIDI here.
import type { app as theApp } from '../app.svelte';
import { sameBinding, type MidiBinding, type MidiMsg } from '../input/midi';
import type { Widget } from '../model/types';
import { ui } from '../ui/ui.svelte';

type App = typeof theApp;

export class MidiIn {
  constructor(private app: App) {}
  // What each MIDI control is holding down right now (by the control, not by the button: a button
  // removed or re-learned while held is still released when the pad comes up).
  private pressed = new Map<string, Widget[]>();
  private hintAt = -1e9;
  // A MIDI note or control: the controls on the live page on screen (or the first page) that
  // learned it. Faders follow a knob or fader; buttons press on note on (or CC above half).
  take(m: MidiMsg) {
    const key = `${m.kind}:${m.ch}:${m.num}`;
    // the console's faders on MIDI controls: they move wherever you are (a desk's faders do), not
    // while the show is locked for the service
    const cm = (this.app.show.settings.consoleMidi ?? []).filter((b) => sameBinding(b.midi, m));
    if (cm.length && !this.app.locked) for (const b of cm) this.toConsole(b.to, m);
    if (cm.length) return;
    const down = m.value > 0.5 || (m.kind === 'note' && m.value > 0);
    if (!down) {
      for (const w of this.pressed.get(key) ?? []) this.app.fireWidget(w, false);
      this.pressed.delete(key);
    }
    const page = this.app.pages.find((p) => p.id === this.app.page) ?? this.app.pages[0];
    // a pad nothing listens to: say so once in a while, with how to give it a job
    if (down && !(page?.widgets ?? []).some((w) => sameBinding(w.midi, m)) && performance.now() - this.hintAt > 8000) {
      this.hintAt = performance.now();
      ui.toast(`${m.kind === 'note' ? 'Pad' : 'Control'} ${m.num} isn't on a button of this page yet: Live, Edit, pick a button, Learn, then touch it.`, 5000);
    }
    for (const w of page?.widgets ?? []) {
      if (!sameBinding(w.midi, m)) continue;
      if (w.type === 'fader') { this.app.setFader(w, m.value); continue; }
      if (down && !this.pressed.get(key)?.some((x) => x.id === w.id)) {
        // a copy: a button edited while the pad is down still lets go of what it pressed
        this.pressed.set(key, [...(this.pressed.get(key) ?? []), $state.snapshot(w) as Widget]);
        this.app.fireWidget(w, true);
      }
    }
  }
  // A console fader on a MIDI control. A fader or knob takes over only once it reaches where the
  // fader is (soft takeover: a controller sending its positions when plugged in, or after a bank
  // change, doesn't jump the level or start a list). A pad is a flash: full while held, back to
  // where it was when let go, never longer than a held flash may stay.
  private at = new Map<string, number>();          // (a control's last value, by fader, until it's taken over)
  private held = new Map<string, number>();        // (a pad held: the fader's value before)
  private toConsole(to: string, m: MidiMsg) {
    if (m.kind === 'note') {
      const key = `midi:${to}`;
      if (m.value > 0) { if (!this.held.has(to)) { this.held.set(to, this.app.consoleLevel(to)); this.app.consoleFader(to, 1); this.app.capHold(key, true, () => this.letGo(to)); } }
      else if (this.held.has(to)) { this.letGo(to); this.app.capHold(key, false, () => {}); }
      return;
    }
    const now = this.app.consoleLevel(to), was = this.at.get(to);
    // (taken over: it moves the fader; not yet: only once it's within a step of it, or crosses it)
    if (was !== undefined && Number.isNaN(was)) { this.app.consoleFader(to, m.value); return; }
    const near = Math.abs(m.value - now) <= 0.04, crossed = was !== undefined && (was - now) * (m.value - now) <= 0;
    if (near || crossed) { this.at.set(to, NaN); this.app.consoleFader(to, m.value); }
    else this.at.set(to, m.value);
  }
  private letGo(to: string) { const v = this.held.get(to); this.held.delete(to); if (v !== undefined) this.app.consoleFader(to, v); }
  // a console fader learns a control (one control, one fader: either one's old pairing goes)
  bind(to: string, midi: MidiBinding) {
    this.app.checkpoint();
    this.at.set(to, NaN);                  // (learned by moving it: it's where you put it)
    const keep = (this.app.show.settings.consoleMidi ?? []).filter((b) => b.to !== to && !sameBinding(b.midi, { ...midi, value: 0 }));
    this.app.show.settings.consoleMidi = [...keep, { to, midi: { kind: midi.kind, ch: midi.ch, num: midi.num } }];
  }
  unbind(to: string) {
    const was = this.app.show.settings.consoleMidi ?? [];
    if (!was.some((b) => b.to === to)) return;
    this.app.checkpoint();
    const keep = was.filter((b) => b.to !== to);
    if (keep.length) this.app.show.settings.consoleMidi = keep; else delete this.app.show.settings.consoleMidi;
  }
  // A controller went away: let go of everything it held.
  releaseAll() {
    for (const ws of this.pressed.values()) for (const w of ws) this.app.fireWidget(w, false);
    this.pressed.clear();
    // (pads held on console faders let go too; faders take over again by reaching where they are)
    for (const to of [...this.held.keys()]) { this.letGo(to); this.app.capHold(`midi:${to}`, false, () => {}); }
    this.at.clear();
  }
}
