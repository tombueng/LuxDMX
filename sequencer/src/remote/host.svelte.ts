// A phone as a remote, the laptop's side (GUIDE.md, "A phone as a remote"; the wire format is in
// DESIGN.md). The phone opens the box's own /remote page, no app and no popup. It and this app
// talk through the box, which passes the messages on and never reads them. The phone gets what
// each live control looks like (widgetFace) and sends presses back: the show never leaves here,
// and the phone can only play, like a locked page.
//
// Holding is safe by design: a held button (flash, fog, blinder) stays held only while the phone
// keeps saying so, a few times a second. A phone that goes quiet (locked screen, out of Wi-Fi,
// page closed) lets go of everything within HOLD_MS.
import type { Page, Widget } from '../model/types';
import type { Bridge } from '../output/bridge';
import { levelOf, lookColor, wholeLook } from '../engine/cuelook';
import { cueNum, cueNumber } from '../model/cuenum';
import { EFFECT_MAP, paramsOf, runEffect } from '../engine/effects';
import { SONG_STILL, holdsWhilePressed, widgetFace, type Face } from '../ui/widgetFace';
import type { app as theApp } from '../app.svelte';

type App = typeof theApp;

const SESSION_KEY = 'luxdmx.seq.remote';     // on: survives a reload of this tab (not a copy of it)
const CODE_KEY = 'luxdmx.seq.remote.code';   // the code: survives closing the tab for a while, so phones can come back
const CODE_KEEP_MS = 12 * 3600 * 1000;
// "keep it on": on with the same code after a restart too (the pastor's phone, every Sunday)
const KEEP_KEY = 'luxdmx.seq.remote.keep';
const hasLocks = () => typeof navigator !== 'undefined' && !!(navigator as unknown as { locks?: LockManager }).locks?.request;
const STATE_MS = 200;              // state updates at most this often
const PRESS_MS = 80;               // after a press a bit sooner, but never closer than this
const BEAT_MS = 2000;              // and at least this often (the phone's "still there")
const LAYOUT_CHECK_MS = 1000;      // how often the layout is looked at for changes (it rarely does)
const LAYOUT_MS = 10000;           // the layout again now and then: a phone that missed a part catches up
export const HOLD_MS = 1500;       // a held button without word from its phone lets go after this
const GONE_MS = 5000;              // a phone not heard from for this long is gone
// bytes of JSON per message: one TCP segment (~1.4 KB) with room to spare; the box takes up to 4 KB
// in pieces too, but a small message lost costs less
export const BUDGET = 1200;
const OUT_GAP_MS = 22;             // at most one message this often: a phone's queue on the box is 4 deep (and the box takes 50/s)
const MAX_PAGES = 24;              // pages a phone gets (the layout message stays small)

// remote -> host
const FROM_PHONE = new Set(['hello', 'down', 'up', 'tap', 'alive', 'fader', 'burst', 'go', 'back', 'bo', 'bpm', 'bye']);

// What doesn't change while playing (sent with the layout) and what does (sent as state).
// (No effect parameters: a level fader moving them would redraw the phone's page under the finger;
// an effect gets a few colours of what it does instead.)
export type StaticFace = Pick<Face, 'id' | 'type' | 'label' | 'color' | 'glyph' | 'wide' | 'holds' | 'missing' | 'risk'> & { burst?: number; swatch?: string[]; num?: number; tap?: 1 };
export type DynamicFace = [on: 0 | 1, sub: string, bar: number, fader: number, faderText: string];

export interface PhoneInfo { rid: string; dev: string; since: number; last: string }
interface Phone extends PhoneInfo { at: number; bridge: Bridge; page: string; n: number }
type Out = { m: Record<string, unknown>; via: Bridge[] };

const enc = new TextEncoder();
const bytes = (m: unknown) => enc.encode(JSON.stringify(m)).length;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const newCode = (not = '') => { let c = not; while (c === not) c = String(1000 + Math.floor(Math.random() * 9000)); return c; };

export class RemoteHost {
  on = $state(false);
  code = $state('');
  keep = $state(false);
  private others: BroadcastChannel | undefined;   // other tabs: one remote per code, not two answering it
  phones = $state(0);
  list = $state.raw<PhoneInfo[]>([]);          // who's connected, for the dialog
  waiting = -1e9;                              // when a phone last asked while this was off (ms)
  onJoin: ((p: PhoneInfo, n: number) => void) | null = null;
  onWaiting: (() => void) | null = null;
  private seen = new Map<string, Phone>();
  private removed = new Map<string, number>(); // phones sent away: ignored, and told again now and then (ms)
  private known = new Set<string>();          // phones seen this session (one back from a locked screen isn't new)
  private held = new Map<string, { w: Widget; rid: string; at: number }>();   // `${rid}/${widget id}`
  private out: Out[] = [];
  private layoutKey = '';
  private layoutAt = -1e9;
  private layoutLook = -1e9;
  // starts anywhere: after a reload of this tab a phone must not take a changed page for the one it has
  private v = Math.floor(Math.random() * 1e6);
  private stateKey = '';
  private stateAt = -1e9;
  private last = -1e9;

  constructor(private app: App) {
    try {
      const c = JSON.parse(localStorage.getItem(CODE_KEY) ?? 'null');
      if (c && /^\d{4}$/.test(c.code) && Date.now() - c.at < CODE_KEEP_MS) this.code = c.code;
      const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
      // this tab's own code (another tab may have saved its own since)
      if (s && /^\d{4}$/.test(s.code)) this.code = s.code;
      // on again only after a reload of this tab; a copy of the tab (same session storage) starts off
      const nav = (performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined)?.type;
      // (and takes its code's lock again: a second tab with "keep it on" must not answer the same code)
      // (taken: another tab has that code on; its "keep it on" is its own, left alone)
      if (s?.on && this.code && (!nav || nav === 'reload')) { this.on = true; void this.holdCode().then((got) => { if (!got) { this.on = false; this.keep = false; this.saveSession(); } }); }
      // kept on: the same code, on again, unless another tab has it on already (it's asked)
      const k = JSON.parse(localStorage.getItem(KEEP_KEY) ?? 'null');
      if (k && /^\d{4}$/.test(k.code) && (!this.on || k.code === this.code)) {
        this.keep = true; this.code = k.code;
        if (!this.on) {
          // the tab that has a code on holds a lock named after it; without Web Locks, tabs are asked
          const on = () => { if (this.keep && !this.on) { this.on = true; this.save(); } };
          if (hasLocks()) void this.holdCode().then((got) => { if (got) on(); });
          else {
            this.taken = false;
            this.channel()?.postMessage({ ask: k.code });
            setTimeout(() => { if (!this.taken) on(); }, 300);
          }
        }
      }
    } catch { /* starts off */ }
    this.channel();
  }
  private channel() {
    if (this.others) return this.others;
    try {
      this.others = new BroadcastChannel('luxdmx-remote');
      this.others.onmessage = (e) => {
        if (this.on && e.data?.ask === this.code) this.others?.postMessage({ have: this.code });
        if (e.data?.have === this.code) this.taken = true;
      };
    } catch { /* no BroadcastChannel */ }
    return this.others;
  }
  setKeep(on: boolean) { this.keep = on; this.save(); }
  private taken = false;
  private codeLock?: () => void;
  private codeLocked = '';
  // Holds the lock for the code that's on (another tab coming back with "keep it on" sees it). False: taken.
  private holdCode(): Promise<boolean> {
    // already holding this code's lock: keep it (letting go and asking again in one go finds it
    // still taken, by this very tab)
    if (this.codeLock && this.codeLocked === this.code) return Promise.resolve(true);
    this.codeLock?.(); this.codeLock = undefined;
    if (!hasLocks()) return Promise.resolve(true);
    const code = this.code;
    this.codeLocked = code;
    return new Promise((ok) => {
      (navigator as unknown as { locks: LockManager }).locks.request(`luxdmx.remote.${code}`, { ifAvailable: true }, (lock) => {
        if (!lock) { ok(false); return; }
        ok(true);
        return new Promise<void>((done) => (this.codeLock = done));
      }).catch(() => ok(true));
    });
  }

  start() {
    if (!this.code) this.code = newCode();
    this.on = true;
    this.save();
    // the code is on in another tab: this one takes a new code
    void this.holdCode().then((got) => { if (!got) this.newCode(); });
  }
  stop() {
    this.releaseAll();
    this.sendNow({ k: 'bye' });
    this.on = false;
    this.forgetPhones();
    this.save();
    this.codeLock?.(); this.codeLock = undefined; this.codeLocked = '';
  }
  // A new code: phones that had the old one are out (and let go of what they held).
  newCode() {
    this.releaseAll();
    this.sendNow({ k: 'bye' });
    this.forgetPhones();
    this.code = newCode(this.code);
    this.save();
    if (this.on) void this.holdCode().then((got) => { if (!got && this.on) this.newCode(); });
  }
  // One phone out (a guest who scanned the code): it lets go of what it held, and is ignored from now on.
  remove(rid: string) {
    this.releasePhone(rid);
    this.sendNow({ k: 'bye', to: rid }, false);
    this.removed.set(rid, performance.now());
    this.seen.delete(rid);
    this.count(performance.now());
  }
  private forgetPhones() { this.seen.clear(); this.removed.clear(); this.known.clear(); this.out = []; this.count(performance.now()); }
  private saveSession() { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ on: this.on, code: this.code })); } catch { /* fine */ } }
  private save() {
    this.saveSession();
    try {
      localStorage.setItem(CODE_KEY, JSON.stringify({ code: this.code, at: Date.now() }));
      if (this.keep && this.on) localStorage.setItem(KEEP_KEY, JSON.stringify({ code: this.code }));
      else if (JSON.parse(localStorage.getItem(KEEP_KEY) ?? 'null')?.code === this.code) localStorage.removeItem(KEEP_KEY);   // (only ours: another tab's stays)
    } catch { /* fine */ }
  }

  // A relayed message that came in through box `b`.
  handle(b: Bridge, d: unknown) {
    if (!d || typeof d !== 'object') return;
    const m = d as Record<string, unknown>;
    if (m.host === 1 || m.code !== this.code || typeof m.rid !== 'string' || !FROM_PHONE.has(m.k as string)) return;
    const rid = m.rid, now = performance.now(), prev = this.seen.get(rid);
    if (!this.on) {
      // a phone still has our code (this tab was closed and opened again): say so here
      if (m.k === 'hello' && now - this.waiting > 30000) { this.waiting = now; this.onWaiting?.(); }
      return;
    }
    if (this.removed.has(rid)) {
      // it didn't get the bye (the box dropped it) or came back: tell it again, once a second at most
      if (now - this.removed.get(rid)! > 1000) { this.removed.set(rid, now); b.relay({ k: 'bye', to: rid, code: this.code, host: 1 }); }
      return;
    }
    // the same message twice (one box added to the show twice): once is enough
    if (typeof m.n === 'number' && prev && m.n <= prev.n) return;
    const page = typeof m.p === 'string' ? m.p : prev?.page ?? '';
    if (m.k === 'bye') { this.releasePhone(rid); this.seen.delete(rid); this.count(now); return; }
    const w = typeof m.w === 'string' ? this.widget(m.w) : undefined;
    const dev = typeof m.dev === 'string' ? clip(m.dev, 24) : prev?.dev ?? 'Phone';
    const did = m.k === 'alive' || m.k === 'hello' ? prev?.last ?? '' : `${m.k}${w ? ` ${widgetFace(this.app, w).label}` : ''}`;
    this.seen.set(rid, { rid, dev, since: prev?.since ?? Date.now(), last: did, at: now, bridge: b, page, n: typeof m.n === 'number' ? m.n : prev?.n ?? 0 });
    this.count(now);
    if (!prev && !this.known.has(rid)) { this.known.add(rid); this.onJoin?.(this.seen.get(rid)!, this.seen.size); }
    switch (m.k) {
      case 'hello':
        // a phone (re)joining: what it held before is let go, and it gets everything at once (the
        // same layout version: the other phones already have it and mustn't redraw under a finger)
        this.releasePhone(rid);
        this.layoutAt = -1e9; this.layoutLook = -1e9; this.stateKey = ''; this.last = -1e9;
        break;
      case 'down':
        if (!w) break;
        if (!holdsWhilePressed(w)) { this.app.fireWidget(w, true); this.app.fireWidget(w, false); break; }
        // a copy: the button edited while held still lets go of what it pressed
        if (!this.held.has(`${rid}/${w.id}`)) { this.held.set(`${rid}/${w.id}`, { w: $state.snapshot(w) as Widget, rid, at: now }); this.app.fireWidget(w, true); }
        break;
      case 'up': this.let(`${rid}/${m.w}`); break;
      case 'tap': if (w) { this.app.fireWidget(w, true); this.app.fireWidget(w, false); } break;
      case 'alive': {
        // what it says it holds stays held; what it doesn't (an "up" that got lost) lets go
        const still = new Set(Array.isArray(m.held) ? m.held.filter((x): x is string => typeof x === 'string') : []);
        for (const [k, h] of this.held) if (h.rid === rid) { if (still.has(h.w.id)) h.at = now; else this.let(k); }
        break;
      }
      case 'fader': if (w && typeof m.v === 'number' && Number.isFinite(m.v)) this.app.setFader(w, m.v); break;
      case 'burst': if (w?.type === 'fog') this.app.fogBurst(w); break;
      // (a staff page of looks has no GO, on the phone either: one tap mustn't step into "All off")
      case 'go': { const l = this.app.liveList; if (l && this.stepping()) this.app.go(l.id); break; }
      case 'back': { const l = this.app.liveList; if (l && this.stepping()) this.app.back(l.id); break; }
      // the state the phone wants (a repeat can't undo it); an older phone page just toggles
      case 'bo': this.app.blackout = typeof m.on === 'boolean' ? m.on : !this.app.blackout; break;
      // a tempo the phone tapped out itself (taps timed there, not across the Wi-Fi)
      case 'bpm': if (typeof m.v === 'number' && m.v >= 40 && m.v <= 240) { this.app.show.settings.bpm = Math.round(m.v); this.app.markDirty(); } break;
    }
    // a press: the phone sees the result soon (a fader drag doesn't speed the updates up)
    if (m.k !== 'alive' && m.k !== 'fader') this.last = Math.min(this.last, now - STATE_MS + PRESS_MS);
  }

  // From the app's clock (40 Hz).
  tick(now: number) {
    if (!this.on) return;
    for (const [k, h] of this.held) if (now - h.at > HOLD_MS) this.let(k);
    this.flush(now);
    if (now - this.last < STATE_MS) return;
    this.last = now;
    this.count(now);
    if (!this.phones) return;
    // (a whole cue list on a page stays on the laptop: the phone has the GO bar for that)
    const pages = this.pages().slice(0, MAX_PAGES).map((p) => ({ ...p, widgets: p.widgets.filter((w) => w.type !== 'cuelist') }));

    // the layout: looked at once a second (it changes when the page is edited), sent when it
    // changed, to a phone that just said hello, and every LAYOUT_MS anyway
    if (now - this.layoutLook >= LAYOUT_CHECK_MS) {
      this.layoutLook = now;
      const layout = { show: clip(this.app.show.meta.name, 60), pages: pages.map((p) => ({ id: p.id, name: clip(p.name, 40), n: p.widgets.length })) };
      const tiles = pages.map((p) => p.widgets.map((w) => this.still(w, widgetFace(this.app, w, manyLists(p), now))));
      const lk = JSON.stringify([layout, tiles]);
      if (lk !== this.layoutKey || now - this.layoutAt > LAYOUT_MS) {
        if (lk !== this.layoutKey) this.v++;
        this.layoutKey = lk; this.layoutAt = now;
        this.drop((m) => m.k === 'layout' || m.k === 'tiles');       // an older layout still waiting: this one replaces it
        this.queue({ k: 'layout', v: this.v, ...layout });
        tiles.forEach((list, p) => this.chunks({ k: 'tiles', v: this.v, p }, list, (part, from) => ({ from, tiles: part })));
      }
    }

    // the moving parts, only for the pages the phones are looking at
    const watched = new Set([...this.seen.values()].map((x) => x.page || pages[0]?.id));
    const dyn: [string, DynamicFace][] = [];
    for (const p of pages) if (watched.has(p.id)) for (const w of p.widgets) if (w.type !== 'label') dyn.push([w.id, moving(widgetFace(this.app, w, manyLists(p), now))]);
    // (bl: the laptop is blind, ar: its machines are armed: the phone says so)
    const head = { k: 'state', v: this.v, bo: this.app.blackout, go: this.goState(), ...(this.app.output !== 'live' ? { bl: 1 } : {}), ...(this.app.sfxArmed ? { ar: 1 } : {}) };
    const sk = JSON.stringify([head, dyn]);
    if (sk !== this.stateKey || now - this.stateAt > BEAT_MS) {
      this.stateKey = sk; this.stateAt = now;
      this.drop((m) => m.k === 'state');                               // only the newest state matters
      this.chunks(head, dyn, (part) => ({ d: Object.fromEntries(part) }));
    }
  }

  private still(w: Widget, f: Face): StaticFace {
    const s: StaticFace = { id: f.id, type: f.type, label: clip(f.label, 60), color: f.color, wide: f.wide, holds: f.holds, missing: f.missing || !!f.inert };   // (a phone shows a locked-out master like a missing one)
    if (f.glyph) s.glyph = f.glyph;
    if (f.risk) s.risk = f.risk;
    if (w.type === 'fog') s.burst = Math.min(w.burst, w.max);
    if (w.type === 'cue') {
      s.swatch = this.swatch(w.list, w.cue);
      const i = this.app.show.cueLists.find((l) => l.id === w.list)?.cues.findIndex((c) => c.id === w.cue) ?? -1;
      if (i >= 0) s.num = cueNum(this.app.show.cueLists.find((l) => l.id === w.list)!, i);
    }
    if (w.type === 'effect') { const dots = this.effectDots(w.effect); if (dots.length) s.swatch = dots; }
    if (w.type === 'special' && w.do === 'tap') s.tap = 1;           // the phone times the taps itself
    // the set list's buttons: a name that stays put while the song plays (Play turning into Pause
    // would send the whole layout again); what moves is in the line under it
    if (w.type === 'song') { s.label = clip(w.label || SONG_STILL[w.do].label, 60); s.glyph = SONG_STILL[w.do].glyph; }
    return s;
  }
  // a cue's picture on a phone: its main colours, most used first
  private swatch(list: string, cue: string): string[] {
    const l = this.app.show.cueLists.find((x) => x.id === list);
    const i = l ? l.cues.findIndex((c) => c.id === cue) : -1;
    const look = i >= 0 ? this.app.cueLooksOf.get(list)?.[i] : undefined;
    if (!look) return [];
    const n = new Map<string, number>();
    for (const v of Object.values(look)) {
      if (levelOf(v) < 0.05) continue;                  // (lit by its cells counts as lit)
      // (its colour at full, so a red at 50 % and one at 100 % are one red; a light lit by its cells
      // shows its brightest cell's colour, as on the plan)
      const c = lookColor({ ...(wholeLook(v) ?? v), intensity: 1 }).css;
      n.set(c, (n.get(c) ?? 0) + 1);
    }
    return [...n].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c]) => c);
  }
  // an effect on a phone: the colours six lights would show at one moment (none for a movement)
  private effectDots(id: string): string[] {
    const e = this.app.show.effects.find((x) => x.id === id), def = e && EFFECT_MAP.get(e.kind);
    if (!e || !def) return [];
    const outs = runEffect(def, { ...paramsOf(e.kind, e.params), look: true }, 6, 0.37);
    const dots = outs.map((o) => {
      if (!o.color && o.intensity === undefined) return '';
      const k = o.intensity ?? 1, c = o.color ?? { r: 1, g: 1, b: 1 };
      return `rgb(${Math.round(c.r * k * 255)},${Math.round(c.g * k * 255)},${Math.round(c.b * k * 255)})`;
    });
    return dots.every(Boolean) ? dots : [];
  }
  private goState() {
    const l = this.app.liveList, st = l ? this.app.status[l.id] : undefined;
    if (!l) return null;
    const now = st?.running ? l.cues[st.index] : undefined;
    const ni = !l.cues.length ? -1 : !st?.running ? 0 : st.index + 1 < l.cues.length ? st.index + 1 : l.end === 'loop' ? 0 : -1;
    const next = ni >= 0 ? l.cues[ni] : undefined;
    return {
      list: clip(l.name, 40), now: now ? clip(`${cueNumber(l, st!.index)}. ${now.name}`, 60) : '', next: next ? clip(`${cueNumber(l, ni)}. ${next.name}`, 60) : '',
      note: clip(next?.note ?? '', 80), canGo: this.stepping() && l.cues.length > 0, canBack: this.stepping() && !!st?.running && st.index > 0, bpm: this.app.bpm,
      ...(this.stepping() ? {} : { step: 0 }), ...(this.app.locked ? { locked: 1 } : {}),
    };
  }

  // Greedy packing under BUDGET: each item's size is measured once.
  private chunks<T>(head: Record<string, unknown>, items: T[], wrap: (part: T[], from: number) => Record<string, unknown>) {
    const base = bytes({ relay: { ...head, ...wrap([], 0), code: this.code, host: 1 } });
    const size = items.map((x) => bytes(x) + 1);
    let from = 0;
    do {                                           // at least one message, even with nothing in it
      let to = from, total = base;
      while (to < items.length && (to === from || total + size[to] <= BUDGET)) total += size[to++];
      this.queue({ ...head, ...wrap(items.slice(from, to), from) });
      from = to;
    } while (from < items.length);
  }
  // Out through the boxes the phones are on, a message per tick: a phone's queue on the box is
  // only 4 deep and also carries the box's own status frames.
  private queue(m: Record<string, unknown>) {
    const via = [...new Set([...this.seen.values()].map((x) => x.bridge))];
    if (via.length) this.out.push({ m: { ...m, code: this.code, host: 1 }, via });
  }
  private drop(which: (m: Record<string, unknown>) => boolean) { this.out = this.out.filter((o) => !which(o.m)); }
  private outAt = -1e9;
  private flush(now: number) {
    if (!this.out.length || now - this.outAt < OUT_GAP_MS) return;
    this.outAt = now;
    const o = this.out.shift()!;
    for (const b of o.via) b.relay(o.m);
  }
  // right away (a bye is the last thing that happens); `all` also drops what's waiting to go out
  private sendNow(m: Record<string, unknown>, all = true) {
    if (all) this.out = [];
    for (const b of new Set([...this.seen.values()].map((x) => x.bridge))) b.relay({ ...m, code: this.code, host: 1 });
  }

  private stepping() { return this.app.livePage?.go !== false; }
  // the pages phones get: locked for the service, only the page it was locked on
  private pages() {
    const lp = this.app.locked ? this.app.show.settings.lockPage : undefined, only = lp ? this.app.pages.filter((p) => p.id === lp) : [];
    return only.length ? only : this.app.pages;
  }
  private widget(id: string): Widget | undefined {
    for (const p of this.pages()) { const w = p.widgets.find((x) => x.id === id); if (w) return w; }
    return undefined;
  }
  private let(k: string) {
    const h = this.held.get(k);
    if (!h) return;
    this.held.delete(k);
    this.app.fireWidget(h.w, false);
  }
  private releasePhone(rid: string) { for (const [k, h] of this.held) if (h.rid === rid) this.let(k); }
  releaseAll() { for (const k of [...this.held.keys()]) this.let(k); }
  private count(now: number) {
    for (const [rid, p] of this.seen) if (now - p.at > GONE_MS) { this.releasePhone(rid); this.seen.delete(rid); }
    if (this.seen.size !== this.phones) this.phones = this.seen.size;
    const list = [...this.seen.values()].map(({ rid, dev, since, last }) => ({ rid, dev, since, last }));
    if (JSON.stringify(list) !== JSON.stringify(this.list)) this.list = list;
  }
}

const manyLists = (p: Page) => new Set(p.widgets.filter((x) => x.type === 'cue').map((x) => (x as { list: string }).list)).size > 1;
const moving = (f: Face): DynamicFace => [f.on ? 1 : 0, clip(f.sub, 60), f.bar ?? -1, f.fader?.v ?? -1, f.fader?.text ?? ''];
