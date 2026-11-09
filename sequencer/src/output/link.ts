// LuxDMX Link: a small program on this computer (link/ in this repo) that sends Art-Net and sACN
// to any node, since a web page can't. The page talks to it on ws://127.0.0.1:47920; it connects by
// itself, no popup and no click, and finds the nodes on the network with ArtPoll. (From a page on
// the internet, like the app on GitHub Pages, Chrome first asks whether the site may reach devices
// on the local network: see `access`.) Frames go out as the LuxDMX bridge takes them ('D' frames).
import { Bridge, portsOf } from './bridge';
import type { PortInfo } from '../model/ledCurve';
import type { RdmReply, RdmRequest } from '../rdm/types';

export const LINK = 'link';
export const LINK_URL = 'ws://127.0.0.1:47920/ws';
// This page, to Link: its own connection and its output thread's say the same id, so Link's status
// page counts one page (Link 1.2.0 on; an older Link ignores it)
export const PAGE_ID = (() => { try { return crypto.randomUUID(); } catch { return Math.random().toString(36).slice(2); } })();
// (pixelPorts: a LuxDMX box's pixel ports, read by Link 1.4 on from its /pixels.json)
export interface LinkNode { ip: string; short: string; long: string; universes: number[]; pixelPorts?: PortInfo[] }

export class LinkOutput extends Bridge {
  nodes: LinkNode[] = [];
  version = '';
  private sentProto: string | undefined;     // what Link was last told
  private ws: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private wanted = true;            // reconnect until closed on purpose
  private universes = new Set<number>();
  // What the browser says about this page reaching this computer (Chrome's Local Network Access:
  // 'granted', 'prompt', 'denied'; '' when it doesn't say). Blocked, Link looks as if it weren't
  // running, so the pill asks. Allowed later in the site settings: it connects at once.
  access: PermissionState | '' = '';
  private watching = false;

  // wantedProto: what the show says to send as (it follows Undo and a show switch)
  constructor(changed: () => void, private wantedProto: () => 'artnet' | 'sacn' | 'both' | undefined = () => undefined) {
    super(LINK, changed);
    this.name = 'This computer (Art-Net / sACN)';
    this.usesWindow = false;
    setTimeout(() => this.open(), 0);
  }
  open() {
    this.wanted = true;
    clearTimeout(this.retry);
    if (this.ws && this.ws.readyState <= 1) return;
    let ws: WebSocket;
    try { ws = new WebSocket(LINK_URL); } catch { this.later(); return; }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    if (this.state !== 'reconnecting') this.set('opening');
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      let m: { type?: string; version?: string; nodes?: LinkNode[]; fps?: Record<string, number> };
      try { m = JSON.parse(e.data); } catch { return; }
      // (a node that answers with no outputs says universes: null)
      const fix = (ns?: LinkNode[]) => (ns ?? []).map((n) => ({ ...n, universes: n.universes ?? [], pixelPorts: portsOf(n.pixelPorts) }));
      if (m.type === 'hello') { this.version = m.version ?? ''; this.nodes = fix(m.nodes); this.sent.clear(); ws.send(JSON.stringify({ type: 'page', id: PAGE_ID })); this.routes(); this.set('ready'); }
      else if (m.type === 'nodes') { this.nodes = fix(m.nodes); this.changedNow(); }
      else if (m.type === 'stats') { this.fps = Math.max(0, ...Object.values(m.fps ?? {}), 0); this.changedNow(); }
      else if (m.type === 'rdm') this.rdmAnswer(m as Parameters<Bridge['rdmAnswer']>[0]);
    };
    ws.onclose = () => { if (this.ws !== ws) return; this.ws = null; this.set(this.state === 'ready' || this.state === 'reconnecting' ? 'reconnecting' : 'silent'); if (this.state === 'silent') void this.askAccess(); this.later(); };
  }
  private async askAccess() {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return;
    // (newer Chrome splits it: this computer is 'loopback-network'; before that one name for both)
    for (const name of ['loopback-network', 'local-network-access']) {
      let s: PermissionStatus;
      try { s = await navigator.permissions.query({ name } as unknown as PermissionDescriptor); } catch { continue; }
      if (!this.watching) { this.watching = true; s.onchange = () => { this.access = s.state; this.changedNow(); if (s.state === 'granted' && this.state !== 'ready') this.open(); }; }
      if (s.state !== this.access) { this.access = s.state; this.changedNow(); }
      return;
    }
  }
  private later() { if (this.wanted) this.retry = setTimeout(() => this.open(), 2500); }
  private changedNow() { this.set(this.state); }
  close() { this.wanted = false; clearTimeout(this.retry); this.ws?.close(); this.ws = null; this.set('closed'); }
  owns() { return false; }
  adopt() { /* nothing to adopt: it isn't a window */ }
  // every universe goes to Link; it knows which nodes play which
  wants() { return true; }
  // what it sends as: always what the show says now
  get proto(): 'artnet' | 'sacn' | 'both' { return this.wantedProto() ?? 'artnet'; }
  setProto(_p?: 'artnet' | 'sacn' | 'both') { this.routes(); }
  // what to send each universe as (Link picks the nodes for Art-Net, the multicast group for sACN)
  private routes() {
    if (this.ws?.readyState !== 1) return;
    this.sentProto = this.proto;
    this.ws.send(JSON.stringify({ type: 'routes', routes: [...this.universes].map((uni) => ({ uni, proto: this.proto, to: 'auto' })) }));
  }
  send(uni: number, data: Uint8Array, now = performance.now()) {
    if (this.state !== 'ready' || this.ws?.readyState !== 1) return;
    if (this.proto !== this.sentProto) this.routes();       // (Undo, another show)
    if (!this.universes.has(uni)) { this.universes.add(uni); this.routes(); }
    const last = this.sent.get(uni);
    if (last && now - last.at < 250 && last.data.length === data.length && last.data.every((v, i) => v === data[i])) return;
    this.sent.set(uni, { data: data.slice(), at: now });
    const f = new Uint8Array(6 + data.length);
    f.set([68, 1, uni & 0xff, (uni >> 8) & 0x7f, 100, 0]);
    f.set(data, 6);
    this.ws.send(f);
  }
  relay() { /* phones come through a LuxDMX box's page, not Link */ }
  // RDM over Art-Net: Link asks the nodes (ArtTodRequest, ArtRdm); a Link without it never answers
  rdm(req: RdmRequest, wait = 8000): Promise<RdmReply> {
    if (this.state !== 'ready' || this.ws?.readyState !== 1) return Promise.resolve({ ok: false, error: 'unreachable' });
    const ws = this.ws;
    return this.rdmAsk(req, wait, (id) => ws.send(JSON.stringify({ type: 'rdm', id, ...req })));
  }
}

// ---- getting Link: the right file for this computer
// public/link/ holds the builds and a manifest.json (scripts/build-link.mjs). The app offers the one
// that fits; double-clicked, it installs itself (for this user, no admin), starts at login, and the
// page above finds it by itself.
export type LinkOS = 'windows' | 'macos' | 'linux';
export interface LinkFile { file: string; os: LinkOS; arch: 'amd64' | 'arm64'; size: number; sha256: string; version: string }
export interface LinkManifest { version: string; files: LinkFile[] }
export interface Computer { os: LinkOS | 'other'; arch?: 'amd64' | 'arm64' }

// What the browser says about this computer. uaPlatform and arch are userAgentData's (Chromium:
// 'Windows', 'macOS', 'Linux', ...; 'x86' or 'arm'); without them the user agent string is all there
// is, which never tells an Apple chip from an Intel Mac (so arch stays unknown there).
export function computerFrom(ua: string, uaPlatform = '', arch = '', touchPoints = 0): Computer {
  const p = uaPlatform.toLowerCase();
  const os: Computer['os'] =
    p === 'windows' || (!p && /Windows NT/.test(ua)) ? 'windows'
    : p === 'macos' || (!p && /Macintosh/.test(ua) && touchPoints < 2) ? 'macos'     // (an iPad says Macintosh too)
    : p === 'linux' || (!p && /Linux|X11/.test(ua) && !/Android|CrOS/.test(ua)) ? 'linux'
    : 'other';
  if (os === 'other') return { os };
  if (arch === 'arm') return { os, arch: 'arm64' };
  if (arch === 'x86') return { os, arch: 'amd64' };
  if (os === 'linux') return /aarch64|arm64/i.test(ua) ? { os, arch: 'arm64' } : /x86_64|amd64|x64/i.test(ua) ? { os, arch: 'amd64' } : { os };
  return { os };
}

interface UAData { platform?: string; getHighEntropyValues?(hints: string[]): Promise<{ architecture?: string; bitness?: string }> }
export async function thisComputer(nav: Navigator = navigator): Promise<Computer> {
  const d = (nav as Navigator & { userAgentData?: UAData }).userAgentData;
  let arch = '';
  try { arch = (await d?.getHighEntropyValues?.(['architecture', 'bitness']))?.architecture ?? ''; } catch { /* it doesn't say */ }
  return computerFrom(nav.userAgent, d?.platform ?? '', arch, nav.maxTouchPoints ?? 0);
}

// The file(s) for this computer, and the rest. An unknown Mac or Linux gets both of its files to
// pick from; a Windows PC that doesn't say is nearly always Intel / AMD (ARM is under the others).
export function downloadsFor(m: LinkManifest, c: Computer): { mine: LinkFile[]; others: LinkFile[] } {
  const fits = (f: LinkFile) => f.os === c.os && (c.arch ? f.arch === c.arch : c.os !== 'windows' || f.arch === 'amd64');
  return { mine: m.files.filter(fits), others: m.files.filter((f) => !fits(f)) };
}

export const OS_NAME: Record<LinkOS, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };
export function archName(f: LinkFile) {
  if (f.os === 'macos') return f.arch === 'arm64' ? 'Apple chip (M1 and newer)' : 'Intel';
  if (f.os === 'linux') return f.arch === 'arm64' ? 'ARM 64-bit, Raspberry Pi 4 / 5' : 'PC, Intel / AMD';
  return f.arch === 'arm64' ? 'ARM' : 'Intel / AMD';
}

// The first time, in two lines: none of the builds is signed yet, so each system asks once.
export const FIRST_RUN: Record<LinkOS, string> = {
  windows: 'Open the file. Windows warns about an unknown app the first time: click More info, then Run anyway. (If the browser asks, keep the file.)',
  macos: 'Open the zip, right-click LuxDMX Link, Open, and Open again (first time only). macOS 15 or newer: try once, then System Settings, Privacy & Security, Open Anyway.',
  linux: 'Make it executable (right-click, Properties, Allow executing as program, or chmod +x in a terminal), then run it.',
};

let manifest: Promise<LinkManifest | null> | null = null;
// (kept for the page's life; a failed fetch is asked again next time)
export function linkManifest(): Promise<LinkManifest | null> {
  manifest ??= fetch('./link/manifest.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() as Promise<LinkManifest> : null))
    .then((m) => (m && Array.isArray(m.files) && m.files.length ? m : null))
    .catch(() => null)
    .then((m) => { if (!m) manifest = null; return m; });
  return manifest;
}
