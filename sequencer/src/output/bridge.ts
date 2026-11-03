// Talking to LuxDMX boxes. A browser can't send Art-Net (no UDP), and this page is https while
// the box is plain http, so it can't open the box's WebSocket either. Instead every box gets a
// small popup from its own origin (/bridge) that does the talking; we postMessage to it.
// See DESIGN.md, "Talking to LuxDMX".

import type { RdmReply, RdmRequest } from '../rdm/types';

const HEARTBEAT_MS = 250;
const INFO_KEY = 'luxdmx.seq.box.';
const NAME_KEY = 'luxdmx.seq.boxname.';

function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// silent: the popup opened but nothing answered for a while (wrong address, or a box whose
// firmware has no /bridge yet). It keeps trying.
// reconnecting: the popup is there, its socket to the box dropped (Wi-Fi); it reconnects by itself.
export type BridgeState = 'closed' | 'opening' | 'asking' | 'ready' | 'denied' | 'blocked' | 'silent' | 'reconnecting';

export interface BoxOutput { en: boolean; uni: number }

export class Bridge {
  state: BridgeState = 'closed';
  outputs: BoxOutput[] = [];
  name = '';
  ip = '';             // the box's own address (what a phone can reach when the name doesn't resolve there)
  fps = 0;
  drops = 0;
  lostAt = 0;          // when it stopped getting through, after having been live (0: it hasn't)
  readonly origin: string;
  // messages other pages on this box sent (a phone used as a remote, see remote/host.svelte.ts)
  onRelay: ((d: unknown) => void) | null = null;
  private win: Window | null = null;
  private hello: ReturnType<typeof setInterval> | undefined;
  protected sent = new Map<number, { data: Uint8Array; at: number }>();
  protected usesWindow = true;     // a popup that may be closed (LuxDMX Link isn't one)
  // RDM: asked of the box's own RDM controller through its page, answered by id (rdm/types.ts)
  protected rdmWaiting = new Map<number, { done: (r: RdmReply) => void; timer: ReturnType<typeof setTimeout> }>();
  protected rdmNext = 1;
  rdmSilent = 0;                   // requests nobody answered in a row (an older bridge page: no RDM)

  constructor(readonly host: string, private changed: () => void) {
    this.origin = 'http://' + host;
    // its name from the last time (a tablet switched on again says "the bar's box", not an address)
    try { this.name = localStorage.getItem(NAME_KEY + host) ?? ''; } catch { /* the address then */ }
  }

  // Must run from a click: browsers only allow popups from user gestures.
  open() {
    // Not 'noopener': the bridge needs window.opener to know who is talking to it.
    this.win = window.open(this.origin + '/bridge', 'luxdmx-' + this.host, 'width=440,height=320');
    if (!this.win) { this.set('blocked'); return; }
    this.set('opening');
    const since = performance.now();
    clearInterval(this.hello);
    this.hello = setInterval(() => {   // the popup takes a moment to load: say hello until it answers
      if (!this.win || this.win.closed) { clearInterval(this.hello); this.set('closed'); return; }
      if (this.state === 'ready' || this.state === 'denied') { clearInterval(this.hello); return; }
      if (this.state === 'opening' && performance.now() - since > 8000) this.set('silent');
      this.win.postMessage({ luxdmx: 1, type: 'hello' }, this.origin);
    }, 400);
  }

  close() { this.win?.close(); this.win = null; this.set('closed'); }

  // The output thread's channel to the popup (output/host.svelte.ts), offered once it's ready: frames
  // then go from the thread straight to the box's page, whatever this page is busy with. The popup
  // says it took it; one from older firmware doesn't answer, and this page goes on sending to it.
  portTaken = false;
  offerPort(port: MessagePort): boolean {
    if (!this.usesWindow || this.state !== 'ready' || !this.win || this.win.closed) return false;
    this.portTaken = false;
    try { this.win.postMessage({ luxdmx: 1, type: 'port' }, this.origin, [port]); return true; } catch { return false; }
  }
  // The page is going: the last look (fog and the machines off), and nothing from the thread's
  // channel after it (a frame the thread sent a moment before mustn't come after the safe look).
  sendFinal(frames: Map<number, Uint8Array>, now = performance.now()) {
    if (this.portTaken && this.state === 'ready' && this.win && !this.win.closed) {
      this.win.postMessage({ luxdmx: 1, type: 'bye', frames: [...frames].filter(([u]) => this.wants(u)).map(([uni, data]) => ({ uni, prio: 100, data })) }, this.origin);
      return;
    }
    for (const [uni, data] of frames) this.send(uni, data, now);
  }

  // Messages from our popup only (checked by the caller against source and origin).
  handle(m: any) {
    switch (m.type) {
      case 'asking': this.set('asking'); break;
      case 'ready':
        this.outputs = m.outputs ?? []; this.name = m.name ?? ''; this.ip = typeof m.ip === 'string' ? m.ip : ''; this.sent.clear(); this.adopting = false;
        // kept for this tab: a popup taken back after a reload doesn't say it again
        try { sessionStorage.setItem(INFO_KEY + this.host, JSON.stringify({ outputs: this.outputs, name: this.name, ip: this.ip })); } catch { /* fine */ }
        try { if (this.name) localStorage.setItem(NAME_KEY + this.host, this.name); } catch { /* fine */ }
        this.set('ready'); break;
      case 'denied': this.adopting = false; this.set('denied'); break;
      case 'status':
        if (this.adopting && m.ws === 'open') { this.adopting = false; this.set('ready'); }
        else if (m.ws === 'open' && this.state === 'reconnecting') this.set('ready');
        else if (m.ws === 'closed') this.set(this.win?.closed ? 'closed' : 'reconnecting');
        break;
      case 'stats': this.fps = m.fps; this.drops = m.drops; this.changed(); break;
      case 'relay': this.onRelay?.(m.data); break;
      case 'port': if (m.ok) { this.portTaken = true; this.changed(); } break;
      case 'rdm': this.rdmAnswer(m); break;
    }
  }

  owns(e: MessageEvent) { return e.origin === this.origin && e.source === this.win; }

  // This page was reloaded while the box's popup stayed open: the popup still talks to us (it is
  // live, so the user allowed us) and sends its stats every second. Take it back, no click needed:
  // say hello, and it's ours once it answers like a live bridge does (with its socket's status).
  private adopting = false;
  adopt(src: Window) {
    if (this.adopting || (this.win && !this.win.closed && this.state === 'ready')) return;
    this.win = src;
    this.adopting = true;
    this.sent.clear();
    try {
      const info = JSON.parse(sessionStorage.getItem(INFO_KEY + this.host) ?? 'null');
      if (info) { this.outputs = info.outputs ?? []; this.name = info.name ?? ''; this.ip = info.ip ?? ''; }
    } catch { /* it sends everything until it says otherwise */ }
    this.set('opening');
    src.postMessage({ luxdmx: 1, type: 'hello' }, this.origin);
  }

  // Does this box output `uni`? A box that didn't say (older bridge) gets everything.
  wants(uni: number) { return this.outputs.length === 0 || this.outputs.some((o) => o.en && o.uni === uni); }

  // Only what changed, plus a heartbeat so the box keeps the source (it drops one after 4 s of
  // silence). A static look costs 4 frames a second instead of 40, and a box that stalls for a
  // moment on WiFi doesn't build up seconds of stale frames in the TCP buffer.
  // Its window closed (the popup shut by hand): said at once, whoever sends to it (this page or the
  // output thread), so the red bar comes up. Called every frame.
  watch() { if (this.usesWindow && (this.state === 'ready' || this.state === 'reconnecting') && (!this.win || this.win.closed)) this.set('closed'); }
  send(uni: number, data: Uint8Array, now = performance.now()) {
    if (this.state !== 'ready' || !this.win || this.win.closed) { this.watch(); return; }
    if (!this.wants(uni)) return;
    const last = this.sent.get(uni);
    if (last && now - last.at < HEARTBEAT_MS && sameBytes(last.data, data)) return;
    this.sent.set(uni, { data: data.slice(), at: now });
    this.win.postMessage({ luxdmx: 1, type: 'dmx', uni, prio: 100, data }, this.origin);
  }

  // RDM through the box (rdm/rig.svelte.ts): what the page asks, answered within `wait` ms (a box
  // without RDM in its bridge page never answers: 'timeout')
  rdm(req: RdmRequest, wait = 6000): Promise<RdmReply> {
    if (this.state !== 'ready' || !this.win || this.win.closed) return Promise.resolve({ ok: false, error: 'unreachable' });
    return this.rdmAsk(req, wait, (id) => this.win!.postMessage({ luxdmx: 1, type: 'rdm', id, ...req }, this.origin));
  }
  protected rdmAsk(req: RdmRequest, wait: number, send: (id: number) => void): Promise<RdmReply> {
    const id = this.rdmNext++;
    return new Promise((done) => {
      const timer = setTimeout(() => { this.rdmWaiting.delete(id); this.rdmSilent++; done({ ok: false, error: 'timeout' }); }, wait);
      this.rdmWaiting.set(id, { done, timer });
      try { send(id); } catch { clearTimeout(timer); this.rdmWaiting.delete(id); done({ ok: false, error: 'unreachable' }); }
    });
  }
  protected rdmAnswer(m: { id?: number; ok?: boolean; status?: number; data?: unknown; error?: string }) {
    const w = typeof m.id === 'number' ? this.rdmWaiting.get(m.id) : undefined;
    if (!w) return;
    clearTimeout(w.timer); this.rdmWaiting.delete(m.id!); this.rdmSilent = 0;
    w.done({ ok: !!m.ok, ...(m.status !== undefined ? { status: m.status } : {}), ...(m.data !== undefined ? { data: m.data } : {}), ...(m.error ? { error: m.error } : {}) });
  }

  // A message for the other pages on this box; the box passes it on and never reads it.
  relay(d: unknown) {
    if (this.state === 'ready' && this.win && !this.win.closed) this.win.postMessage({ luxdmx: 1, type: 'relay', data: d }, this.origin);
  }

  protected set(s: BridgeState) {
    if (s !== 'ready') this.portTaken = false;
    if (this.state === 'ready' && s !== 'ready') this.lostAt = Date.now();
    else if (s === 'ready') this.lostAt = 0;
    this.state = s; this.changed();
    // reconnecting: its window may say it's closed only after its socket did; look again
    clearInterval(this.recheck);
    if (s === 'reconnecting' && this.usesWindow) this.recheck = setInterval(() => { if (this.state !== 'reconnecting') clearInterval(this.recheck); else if (!this.win || this.win.closed) this.set('closed'); }, 1000);
  }
  private recheck: ReturnType<typeof setInterval> | undefined;
}

// One listener for all bridges.
// `ready`: the show is loaded (until then the boxes aren't known, and nothing is taken or closed).
export function listen(bridges: () => Bridge[], ready: () => boolean = () => true) {
  const unclaimed = new Map<string, number>();      // origin -> when an unknown live popup first spoke
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.luxdmx !== 1) return;
    for (const b of bridges()) if (b.owns(e)) { b.handle(m); return; }
    if (m.type !== 'stats' || !e.source || !/^http:/.test(e.origin) || !ready()) return;
    const b = bridges().find((x) => e.origin === x.origin);
    if (b) { unclaimed.delete(e.origin); if (b.state !== 'ready') b.adopt(e.source as Window); return; }
    // A live popup of ours for a box that's no longer in the show (removed before it was taken
    // back): close it, so it doesn't keep the box's output for this page. Only once nobody has
    // claimed it for a few seconds.
    const since = unclaimed.get(e.origin) ?? Date.now();
    unclaimed.set(e.origin, since);
    if (Date.now() - since < 4000) return;
    unclaimed.delete(e.origin);
    try { (e.source as Window).close(); } catch { /* not ours to close */ }
  });
}
