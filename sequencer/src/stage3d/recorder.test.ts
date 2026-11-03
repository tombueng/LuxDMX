import { describe, expect, it } from 'vitest';
import { clock, extOf, megabytes, pickFormat, stutterNote, tallFov, Take, takeSize, videoBits, videoName, webmDuration, withDuration, type TakeEnv } from './recorder';

describe('recording the 3D stage', () => {
  it('picks MP4 with H.264 and AAC where the browser makes it, else WebM VP9/Opus', () => {
    const safari = new Set(['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4']);
    expect(pickFormat((t) => safari.has(t))).toEqual({ mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' });
    // (Chromium without AAC: MP4 only with Opus, which many players don't take: WebM then)
    const chromium = new Set(['video/mp4;codecs=avc1,opus', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']);
    expect(pickFormat((t) => chromium.has(t))).toEqual({ mime: 'video/webm;codecs=vp9,opus', ext: 'webm' });
    const firefox = new Set(['video/webm;codecs=vp8,opus', 'video/webm']);
    expect(pickFormat((t) => firefox.has(t))?.mime).toBe('video/webm;codecs=vp8,opus');
    expect(pickFormat(() => false)).toBeUndefined();
    // a type the browser throws on is skipped, not the end
    expect(pickFormat((t) => { if (t.includes('mp4')) throw new Error('no'); return true; })?.ext).toBe('webm');
  });
  it('without sound: the same types minus the sound codec', () => {
    const seen: string[] = [];
    const f = pickFormat((t) => { seen.push(t); return t === 'video/webm;codecs=vp9'; }, false);
    expect(f).toEqual({ mime: 'video/webm;codecs=vp9', ext: 'webm' });
    expect(seen[0]).toBe('video/mp4;codecs=avc1.640028');
    expect(seen.every((t) => !/opus|mp4a/.test(t))).toBe(true);
  });
  it('the file ending follows what the browser really made', () => {
    expect(extOf('video/mp4;codecs=avc1.64001f,mp4a.40.2')).toBe('mp4');
    expect(extOf('video/webm;codecs=vp9,opus')).toBe('webm');
    expect(extOf('video/x-matroska;codecs=avc1,opus')).toBe('mkv');
    expect(extOf('', 'mp4')).toBe('mp4');
  });
  it('take size: 1080p is 1920 x 1080; as shown is the drawn size, even, at most 4K', () => {
    expect(takeSize('1080p', 390, 600, 3)).toEqual({ w: 1920, h: 1080 });
    expect(takeSize('shown', 1600, 900, 1)).toEqual({ w: 1600, h: 900 });
    expect(takeSize('shown', 751, 421, 1)).toEqual({ w: 750, h: 420 });
    expect(takeSize('shown', 752.5, 422, 2)).toEqual({ w: 1504, h: 844 });
    const big = takeSize('shown', 2560, 1440, 2);           // 5120 x 2880 drawn
    expect(big.w).toBeLessThanOrEqual(3840); expect(big.h).toBeLessThanOrEqual(2160);
    expect(big.w / big.h).toBeCloseTo(16 / 9, 2);
    const phone = takeSize('shown', 360, 614, 2);            // portrait
    expect(phone).toEqual({ w: 720, h: 1228 });
    for (const s of [big, phone]) { expect(s.w % 2).toBe(0); expect(s.h % 2).toBe(0); }
    expect(takeSize('shown', 0, 0, 1)).toEqual({ w: 2, h: 2 });
  });
  it('9:16 for phones is 1080 x 1920 whatever the window, with the same bit rate as 1080p', () => {
    expect(takeSize('vertical', 1600, 900, 1)).toEqual({ w: 1080, h: 1920 });
    expect(takeSize('vertical', 390, 700, 3)).toEqual({ w: 1080, h: 1920 });
    expect(videoBits(1080, 1920)).toBe(videoBits(1920, 1080));
  });
  it('a tall take\'s lens: wide enough across for what has to be in it, never narrower than the normal one, capped', () => {
    const a = 1080 / 1920, tan = (deg: number) => Math.tan((deg * Math.PI) / 360);
    // nothing wide: the normal lens
    expect(tallFov(a, [{ x: 0, y: 0, z: -20 }], 52)).toBeCloseTo(52, 6);
    // a truss 16 m wide 24 m away: its ends inside the picture, with a little room
    const fov = tallFov(a, [{ x: -8, y: 4, z: -24 }, { x: 8, y: 4, z: -24 }], 52);
    expect(fov).toBeGreaterThan(52);
    const across = tan(fov) * a;            // half the width, as a slope
    expect(across).toBeGreaterThanOrEqual(8 / 24);
    expect(across).toBeLessThan((8 / 24) * 1.1);
    // something high up counts too (the lens is wider top to bottom than across)
    expect(tan(tallFov(a, [{ x: 0, y: 12, z: -24 }], 52))).toBeGreaterThanOrEqual(12 / 24);
    // behind the camera, or right at it: ignored; never past the cap
    expect(tallFov(a, [{ x: 50, y: 0, z: 5 }, { x: 3, y: 0, z: -0.1 }], 52)).toBeCloseTo(52, 6);
    expect(tallFov(a, [{ x: 30, y: 0, z: -2 }], 52)).toBe(75);
    expect(tallFov(a, [{ x: Number.NaN, y: 0, z: -2 }], 52)).toBeCloseTo(52, 6);
  });
  it('a choppy take: under 20 frames a second it says so, with what to try for its size', () => {
    expect(stutterNote(29.6, '1080p')).toBeUndefined();
    expect(stutterNote(20, 'vertical')).toBeUndefined();
    expect(stutterNote(12.4, '1080p')).toBe('The video stutters (12 frames a second): 1080p is heavy for this computer, try As shown, or close other tabs.');
    expect(stutterNote(9, 'vertical')).toMatch(/^The video stutters \(9 frames a second\): 1080 x 1920 is heavy .*As shown/);
    expect(stutterNote(15, 'shown')).toBe('The video stutters (15 frames a second): close other tabs, or make the window smaller.');
    expect(stutterNote(Number.NaN, '1080p')).toBeUndefined();
  });
  it('bit rate: about 9 Mbit/s for 1080p30, bounded', () => {
    expect(videoBits(1920, 1080)).toBe(9331200);
    expect(videoBits(320, 180)).toBe(3e6);
    expect(videoBits(3840, 2160, 60)).toBe(20e6);
  });
  it('names the file after the show and the time, safe on every system', () => {
    const when = new Date(2026, 9, 27, 21, 4);
    expect(videoName('Club night', when, 'mp4')).toBe('Club night 3D 2026-10-27 21.04.mp4');
    expect(videoName('  AC/DC: "Live"  <tour>  ', when, 'webm')).toBe('AC DC Live tour 3D 2026-10-27 21.04.webm');
    expect(videoName('', when, 'webm')).toBe('Show 3D 2026-10-27 21.04.webm');
    expect(videoName('x'.repeat(200), when, 'mp4').length).toBeLessThan(110);
  });
  it('the REC clock and sizes read like a person would say them', () => {
    expect(clock(0)).toBe('0:00'); expect(clock(7.9)).toBe('0:07'); expect(clock(754)).toBe('12:34'); expect(clock(3723)).toBe('1:02:03');
    expect(megabytes(8_345_000)).toBe('8.3'); expect(megabytes(123_400_000)).toBe('123');
  });
});

// A MediaRecorder that hands out a part a second (driven by the test) and the rest on stop
class FakeRecorder {
  static last: FakeRecorder;
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  timeslice = 0;
  constructor(public stream: { tracks: Track[] }, public opts: MediaRecorderOptions) { this.mimeType = opts.mimeType ?? ''; FakeRecorder.last = this; }
  start(t: number) { this.timeslice = t; this.state = 'recording'; }
  part(s: string) { this.ondataavailable?.({ data: new Blob([s]) }); }
  stop() { if (this.state === 'inactive') throw new Error('inactive'); this.state = 'inactive'; queueMicrotask(() => { this.part('end'); this.onstop?.(); }); }
  fail(name: string) { this.onerror?.({ error: { name, message: '' } }); this.state = 'inactive'; queueMicrotask(() => this.onstop?.()); }
}
class Track { stopped = false; readyState = 'live'; constructor(public kind: string) {} stop() { this.stopped = true; this.readyState = 'ended'; } }
class FakeStream { constructor(public tracks: Track[]) {} }

function setup(audio = true) {
  let now = 1000;
  const video = new Track('video'), sound = new Track('audio'), fps: number[] = [];
  const canvas = { captureStream: (f: number) => { fps.push(f); return { getVideoTracks: () => [video] }; } } as unknown as HTMLCanvasElement;
  const song = { getAudioTracks: () => [sound] } as unknown as MediaStream;
  const env = { Recorder: FakeRecorder, Stream: FakeStream, now: () => now } as unknown as TakeEnv;
  const errors: string[] = [];
  const take = new Take({ canvas, audio: audio ? song : undefined, format: { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' }, videoBits: 9e6, onError: (m) => errors.push(m) }, env);
  return { take, video, sound, fps, errors, rec: FakeRecorder.last, tick: (s: number) => { now += s * 1000; } };
}

describe('a take', () => {
  it('records the canvas and the song together, in parts of a second', async () => {
    const { take, rec, fps, video, sound, tick } = setup();
    expect(fps).toEqual([30]);
    expect(rec.stream.tracks).toEqual([video, sound]);
    expect(rec.opts).toMatchObject({ mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: 9e6 });
    expect(rec.timeslice).toBe(1000);
    expect(take.recording).toBe(true);
    rec.part('a'); tick(1); rec.part('b'); tick(1.5);
    expect(take.seconds).toBeCloseTo(2.5, 5);
    const blob = await take.stop();
    expect(await blob.text()).toBe('abend');
    expect(blob.type).toBe('video/webm;codecs=vp9,opus');
    expect(take.recording).toBe(false);
  });
  it('stop ends the canvas stream but never the song (the next take and the speakers still use it)', async () => {
    const { take, video, sound } = setup();
    const p = take.stop();
    expect(video.stopped).toBe(true);
    await p;
    expect(sound.stopped).toBe(false);
  });
  it('a second stop gives the same file, it doesn\'t throw', async () => {
    const { take } = setup();
    const a = take.stop(), b = take.stop();
    expect(await a).toBe(await b);
  });
  it('without a song: only the picture', () => {
    const { rec, video } = setup(false);
    expect(rec.stream.tracks).toEqual([video]);
  });
  it('an encoder that gives up: says so, and what was recorded is kept', async () => {
    const { take, rec, errors } = setup();
    rec.part('a'); rec.part('b');
    rec.fail('EncodingError');
    expect(errors).toEqual(['EncodingError']);
    const blob = await take.stop();
    expect(await blob.text()).toBe('ab');
  });
  it('a recorder that refuses to start leaves no stream running', () => {
    const video = new Track('video');
    const canvas = { captureStream: () => ({ getVideoTracks: () => [video] }) } as unknown as HTMLCanvasElement;
    class Refuses { constructor() { throw new Error('NotSupportedError'); } }
    expect(() => new Take({ canvas, format: { mime: 'video/x', ext: 'webm' }, videoBits: 1 }, { Recorder: Refuses, Stream: FakeStream, now: () => 0 } as unknown as TakeEnv)).toThrow();
    expect(video.stopped).toBe(true);
  });
});

// A WebM head the way Chrome writes one: EBML header, a Segment of unknown size, Info (time scale
// 1 ms, muxing and writing app), Tracks, then the first Cluster
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const INFO = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40, 0x4d, 0x80, 0x86, ...ascii('Chrome'), 0x57, 0x41, 0x86, ...ascii('Chrome')];
function webmHead(o: { segSize?: number[]; info?: number[]; before?: number[] } = {}) {
  const info = o.info ?? INFO;
  return new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x86, 0x81, 0x01,                  // EBML (4 bytes inside)
    0x18, 0x53, 0x80, 0x67, ...(o.segSize ?? [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    ...(o.before ?? []),
    0x15, 0x49, 0xa9, 0x66, 0x80 | info.length, ...info,
    0x16, 0x54, 0xae, 0x6b, 0x82, 0xae, 0x80,                            // Tracks
    0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0x81, 0x00,
  ]);
}
const infoAt = (h: Uint8Array) => h.indexOf(0x15, 9);
// the Duration in a fixed head: where it is and what it says
function durationOf(h: Uint8Array) {
  for (let i = 0; i < h.length - 10; i++) if (h[i] === 0x44 && h[i + 1] === 0x89 && h[i + 2] === 0x88) return new DataView(h.buffer, h.byteOffset).getFloat64(i + 3);
  return undefined;
}

describe('the length in a WebM file', () => {
  it('goes into Info (its size grows by the 11 bytes), everything after it is unchanged', () => {
    const head = webmHead(), out = webmDuration(head, 12345.5)!;
    expect(out.length).toBe(head.length + 11);
    expect(durationOf(out)).toBe(12345.5);
    expect(out[infoAt(out) + 4]).toBe(0x80 | (INFO.length + 11));
    const tracks = head.indexOf(0x16);
    expect([...out.subarray(tracks + 11)]).toEqual([...head.subarray(tracks)]);
    // the unknown Segment size stays unknown
    expect([...out.subarray(13, 21)]).toEqual([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  });
  it('a Segment with a size grows with it; the time scale counts', () => {
    const out = webmDuration(webmHead({ segSize: [0x40, 0x50] }), 2000)!;
    expect([...out.subarray(13, 15)]).toEqual([0x40, 0x50 + 11]);
    // a scale of 10 ms (10 000 000 ns): 2 s is 200 of them
    const scaled = [...INFO]; scaled.splice(3, 4, 0x83, 0x98, 0x96, 0x80);
    expect(durationOf(webmDuration(webmHead({ info: scaled }), 2000)!)).toBe(200);
  });
  it('a zero Duration that is there already gets filled in; a real one is left alone', () => {
    const zero = [...INFO, 0x44, 0x89, 0x88, 0, 0, 0, 0, 0, 0, 0, 0];
    const out = webmDuration(webmHead({ info: zero }), 5000)!;
    expect(out.length).toBe(webmHead({ info: zero }).length);
    expect(durationOf(out)).toBe(5000);
    expect(webmDuration(out, 7000)).toBeUndefined();
  });
  it('anything unexpected: the file stays as it is', () => {
    expect(webmDuration(new Uint8Array([1, 2, 3]), 1000)).toBeUndefined();
    expect(webmDuration(new Uint8Array(0), 1000)).toBeUndefined();
    // a SeekHead points at what's after Info: not moved
    expect(webmDuration(webmHead({ before: [0x11, 0x4d, 0x9b, 0x74, 0x80] }), 1000)).toBeUndefined();
    // Info cut off by the end of the head
    expect(webmDuration(webmHead().subarray(0, 40), 1000)).toBeUndefined();
  });
  it('withDuration: only WebM changes, the rest of the file comes after the new head', async () => {
    const tail = new Uint8Array(70_000).fill(7);
    const webm = new Blob([webmHead(), tail], { type: 'video/webm;codecs=vp9,opus' });
    const fixed = await withDuration(webm, 3000);
    expect(fixed.size).toBe(webm.size + 11);
    expect(fixed.type).toBe(webm.type);
    const bytes = new Uint8Array(await fixed.arrayBuffer());
    expect(durationOf(bytes.subarray(0, 100))).toBe(3000);
    expect(bytes.subarray(bytes.length - 70_000).every((v) => v === 7)).toBe(true);
    const mp4 = new Blob([webmHead()], { type: 'video/mp4' });
    expect(await withDuration(mp4, 3000)).toBe(mp4);
    expect(await withDuration(webm, 0)).toBe(webm);
  });
  it('a take writes its length when it stops (and the clock stops with it)', async () => {
    let now = 0;
    const video = new Track('video');
    const canvas = { captureStream: () => ({ getVideoTracks: () => [video] }) } as unknown as HTMLCanvasElement;
    class HeadRecorder extends FakeRecorder { stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob([webmHead()]) }); this.onstop?.(); }); } }
    const take = new Take({ canvas, format: { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' }, videoBits: 1 }, { Recorder: HeadRecorder, Stream: FakeStream, now: () => now } as unknown as TakeEnv);
    now = 4200;
    const p = take.stop();
    now = 9000;
    expect(take.seconds).toBe(4.2);
    expect(durationOf(new Uint8Array(await (await p).arrayBuffer()))).toBe(4200);
  });
});

describe('frames into the video', () => {
  function take(requestFrame: boolean) {
    const asked: number[] = [], track = Object.assign(new Track('video'), { requests: 0, requestFrame() { this.requests++; } });
    const canvas = { captureStream: (f: number) => { asked.push(f); return { getVideoTracks: () => [track] }; } } as unknown as HTMLCanvasElement;
    const t = new Take({ canvas, format: { mime: 'video/webm', ext: 'webm' }, videoBits: 1 }, { Recorder: FakeRecorder, Stream: FakeStream, now: () => 0, requestFrame } as unknown as TakeEnv);
    return { t, track, asked };
  }
  it('the frame loop hands them over: 30 a second from 60 drawn, even when they come a little uneven', () => {
    const { t, track, asked } = take(true);
    expect(asked).toEqual([0]);                               // (the stream only takes frames when told)
    for (let i = 0, now = 0; i < 60; i++) { now += i % 2 ? 15.5 : 17.8; t.frame(now); }
    expect(track.requests).toBe(30);
    // 144 Hz: every fifth frame, about 29 a second
    const fast = take(true);
    for (let i = 1; i <= 144; i++) fast.t.frame(i * 1000 / 144);
    expect(fast.track.requests).toBeGreaterThanOrEqual(28); expect(fast.track.requests).toBeLessThanOrEqual(30);
  });
  it('counts every frame the stage drew during the take (for the choppy note), not after Stop', () => {
    let now = 0;
    const track = Object.assign(new Track('video'), { requestFrame() {} });
    const canvas = { captureStream: () => ({ getVideoTracks: () => [track] }) } as unknown as HTMLCanvasElement;
    const t = new Take({ canvas, format: { mime: 'video/webm', ext: 'webm' }, videoBits: 1 }, { Recorder: FakeRecorder, Stream: FakeStream, now: () => now, requestFrame: true } as unknown as TakeEnv);
    for (let i = 0; i < 48; i++) { now += 1000 / 16; t.frame(now); }    // 3 s at 16 a second
    void t.stop(); t.frame(now + 10);
    expect(t.drawn).toBe(48);
    expect(t.drawnFps).toBeCloseTo(16, 6);
    expect(stutterNote(t.drawnFps, '1080p')).toMatch(/16 frames a second/);
  });
  it('none after Stop; without requestFrame the browser takes 30 a second by itself', () => {
    const { t, track } = take(true);
    t.frame(0); void t.stop(); t.frame(100);
    expect(track.requests).toBe(1);
    const auto = take(false);
    expect(auto.asked).toEqual([30]);
    auto.t.frame(0); auto.t.frame(100);
    expect(auto.track.requests).toBe(0);
  });
});
