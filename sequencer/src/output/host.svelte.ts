// The page's side of the output thread (output/thread.ts). It starts the thread, wraps the page's
// engine so every command goes there too (with the moment it was given), sends what's set by hand
// and the show when they change, gives the thread a channel to each box's bridge page, and tells it
// about LuxDMX Link. A box whose page takes no channel (older firmware) gets its frames from the
// page, as before.
//
// The thread only takes over the sending once it has said it's running; if it goes quiet, the page
// sends again by itself. Without workers (unit tests, an old browser) nothing changes: the page sends.
import type { Engine } from '../engine/engine';
import type { Bridge } from './bridge';
import { LINK, LINK_URL, PAGE_ID } from './link';
import type { FromThread, Inputs, ToThread } from './thread';
import type { Show } from '../model/types';

const COMMANDS = ['go', 'back', 'jumpTo', 'start', 'refresh', 'toggle', 'release', 'stop', 'releaseAll', 'flash', 'alignBeat', 'syncBeats', 'releaseFlashes',
  'setMaster', 'backdate', 'forget', 'startEffect', 'stopEffect', 'toggleEffect', 'flashEffect', 'takeLiveEffects', 'stopAllEffects', 'act'];
const ASK_MS = 1500;          // a box's page that doesn't take a channel by then: the page sends to it
const QUIET_MS = 1500;        // the thread not heard from for this long: the page sends again

export class OutputThread {
  private w: Worker | null = null;
  private heardAt = 0;
  private depth = 0;
  private prev: Record<string, unknown> = {};
  private showJson = '';
  private showDirty = true;
  private policyKey = '';
  private boxes = new Map<Bridge, { mode: 'asking' | 'port' | 'page'; since: number; outputs: string; port?: MessagePort }>();
  private linkKey = '';
  // the thread's own timing (shown by the load display)
  stats = $state({ rate: 0, worst: 0, late: 0, ms: 0, sent: 0, to: 0, quiet: true, unis: 0 });
  onBroken?: (why: string) => void;

  // it sends (it's running and was heard from lately)
  get running() { return !!this.w && performance.now() - this.heardAt < QUIET_MS; }

  private getShow: () => Show = () => ({}) as Show;
  start(engine: Engine, getShow: () => Show): boolean {
    this.getShow = getShow;
    if (typeof Worker === 'undefined') return false;
    try { this.w = new Worker(new URL('./thread.ts', import.meta.url), { type: 'module' }); } catch { this.w = null; return false; }
    this.w.onmessage = (e: MessageEvent<FromThread>) => this.heard(e.data);
    this.w.onerror = () => { this.w?.terminate(); this.w = null; };      // (the page goes on sending)
    this.post({ t: 'init', origin: performance.timeOrigin, page: PAGE_ID });
    this.wrap(engine);
    return true;
  }
  postError = '';
  private post(m: ToThread, transfer: Transferable[] = []) { try { this.w?.postMessage(m, transfer); } catch (e) { this.postError = `${m.t}: ${(e as Error).message}`; } }
  private heard(m: FromThread) {
    this.heardAt = performance.now();
    if (m.t === 'stats') this.stats = { rate: m.rate, worst: m.worst, late: m.late, ms: m.ms, sent: m.sent, to: m.to, quiet: m.quiet, unis: m.unis };
    else if (m.t === 'broken') this.onBroken?.(m.why);
  }

  // Every command to the page's engine goes to the thread's too, once (not the ones a command makes
  // itself), with the moment it was given: a fade starts at the same time in both.
  private wrap(engine: Engine) {
    const e = engine as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const m of COMMANDS) {
      const orig = e[m].bind(engine);
      e[m] = (...a: unknown[]) => {
        const at = engine.now();
        this.depth++;
        try { return orig(...a); } finally {
          this.depth--;
          if (this.depth === 0) {
            // the show first, as it is now: a command about a list just made (a fog timer started
            // as it's made) must find that list there (not the beat's sync, every frame)
            // (without settling it: the command may come in the middle of a change, a new show
            // stopping the old one's lists before it's there; the next frame sends it as it ends up)
            if (m !== 'syncBeats') { this.beforeCommand?.(); this.flushShow(undefined, false); }
            this.post({ t: 'call', m, a: $state.snapshot(a) as unknown[], at });
          }
        }
      };
    }
    // the lists a jump put on a cue (they keep their machines quiet): a set that tells
    const j = engine.jumped, add = j.add.bind(j), del = j.delete.bind(j), clear = j.clear.bind(j);
    j.add = (id: string) => { add(id); if (!this.depth) this.post({ t: 'jumped', op: 'add', id }); return j; };
    j.delete = (id: string) => { const r = del(id); if (!this.depth) this.post({ t: 'jumped', op: 'delete', id }); return r; };
    j.clear = () => { clear(); if (!this.depth) this.post({ t: 'jumped', op: 'clear' }); };
  }

  // The show changed (an edit, Undo, another show): sent at the next frame, and before any command
  // that follows. (Not compared on a timer: turning a big show into text takes a tenth of a second
  // or more on the page. An edit that didn't say so comes with the next save, see showJson.)
  showChanged() { this.showDirty = true; }
  // the page's own: before a command goes to the thread (app.svelte.ts runs a save that's due)
  beforeCommand?: () => void;
  private flushShow(show = this.getShow(), settle = true) {
    if (!this.showDirty && this.showJson) return;
    if (settle) this.showDirty = false;
    this.showJsonIs(JSON.stringify(show));
  }
  // the show as the save wrote it (app.checkpoint): sent when it isn't what the thread has
  // `current`: it's the show as it is right now (nothing changed since): no need to send it again
  showJsonIs(json: string, current = false) {
    if (current) this.showDirty = false;
    if (json !== this.showJson) { this.showJson = json; this.post({ t: 'show', json }); }
  }

  // Arming, Blackout, the master: at once, not with the next frame (disarming must reach the output
  // the moment it's pressed).
  inputsNow(engine: Engine) {
    const v: Partial<Inputs> = {};
    for (const k of ['grandMaster', 'blackout', 'armed'] as const) if (engine[k] !== this.prev[k]) { (v as Record<string, unknown>)[k] = engine[k]; this.prev[k] = engine[k]; }
    if (Object.keys(v).length) this.post({ t: 'inputs', v });
  }

  // Each of the page's frames: what's set by hand, the show, what goes out at all, the boxes.
  sync(engine: Engine, show: Show, quiet: boolean, blind: Map<number, Uint8Array> | null, bridges: Bridge[], linkProto: 'artnet' | 'sacn' | 'both') {
    if (!this.w) return;
    const t = performance.now();
    const v: Partial<Inputs> = {};
    for (const k of ['grandMaster', 'blackout', 'bpm', 'sound', 'armed'] as const) if (engine[k] !== this.prev[k]) { (v as Record<string, unknown>)[k] = engine[k]; this.prev[k] = engine[k]; }
    for (const k of ['programmer', 'live', 'overlay'] as const) {
      const s = JSON.stringify(engine[k] ?? null);
      if (s !== this.prev[k]) { this.prev[k] = s; (v as Record<string, unknown>)[k] = engine[k] ? JSON.parse(s) : engine[k]; }
    }
    if (Object.keys(v).length) this.post({ t: 'inputs', v });
    if (this.showDirty) this.flushShow(show);
    const pk = `${quiet}`;
    if (pk !== this.policyKey || blind !== this.blindSent) { this.policyKey = pk; this.blindSent = blind; this.post({ t: 'policy', quiet, blind: blind ? [...blind].map(([u, d]) => [u, d.slice()]) : null }); }
    this.boxesNow(bridges, t);
    const lk = bridges.some((b) => b.host === LINK) ? `on:${linkProto}` : 'off';
    if (lk !== this.linkKey) { this.linkKey = lk; this.post({ t: 'link', on: lk !== 'off', url: LINK_URL, proto: linkProto }); }
  }
  private blindSent: Map<number, Uint8Array> | null = null;

  // Each box's page: a channel to it from the thread, if it takes one (it says so); else the page
  // sends to it. A box that goes away, or comes back, is asked again.
  private boxesNow(bridges: Bridge[], t: number) {
    for (const [b, s] of this.boxes) if (!bridges.includes(b) || b.state !== 'ready') { this.post({ t: 'drop', key: b.host }); s.port?.close(); this.boxes.delete(b); b.portTaken = false; }
    for (const b of bridges) {
      if (b.host === LINK || b.state !== 'ready') continue;
      const outputs = JSON.stringify(b.outputs.map((o) => ({ en: o.en, uni: o.uni })));
      let s = this.boxes.get(b);
      if (!s) {
        const ch = new MessageChannel();
        s = b.offerPort?.(ch.port2) ? { mode: 'asking', since: t, outputs, port: ch.port1 } : { mode: 'page', since: t, outputs };
        this.boxes.set(b, s);
        continue;
      }
      if (s.mode === 'asking') {
        if (b.portTaken && s.port) { s.mode = 'port'; this.post({ t: 'port', key: b.host, port: s.port, outputs: JSON.parse(outputs) }, [s.port]); s.port = undefined; }
        else if (t - s.since > ASK_MS) { s.mode = 'page'; s.port?.close(); s.port = undefined; }
      } else if (s.mode === 'port' && s.outputs !== outputs) { s.outputs = outputs; this.post({ t: 'outputs', key: b.host, outputs: JSON.parse(outputs) }); }
    }
  }
  // Does the thread send to this one (so the page mustn't: a late frame from the page would put an
  // older look back for a moment)? Link and the boxes with a channel, while the thread runs.
  serves(b: Bridge) { return this.running && (b.host === LINK || this.boxes.get(b)?.mode === 'port'); }

  // The page is going: the thread stops sending at once (the page sends the safe look itself).
  final() { this.post({ t: 'final' }); this.w?.terminate(); this.w = null; }
}
