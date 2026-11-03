// The tempo finder against the demo songs, whose tempo, first downbeat and parts were measured
// offline (librosa, aubio, demucs) and checked by hand. Slow (every song decoded with ffmpeg), so
// only with LUXDMX_MEASURE=1; it needs the songs' copies in public/songs/ (npm run songs).
//   LUXDMX_MEASURE=1 npx vitest run src/timeline/analyze.catalog.test.ts
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { analyzeSong, RATE, SURE } from './analyze';
import { CATALOG } from './catalog';

const on = !!process.env.LUXDMX_MEASURE;
describe.skipIf(!on)('against the demo songs', () => {
  it('the tempo of nearly all, the first downbeat of most, the parts to within a bar', () => {
    const rows: string[] = [];
    let tempoOk = 0, offOk = 0, hit = 0, parts = 0, mine = 0, right = 0, n = 0;
    for (const s of CATALOG) {
      const file = `public/${s.mirror}`;
      if (!existsSync(file)) continue;
      const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
      const x = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
      const t0 = performance.now(), a = analyzeSong(x, RATE, { allParts: true }), ms = performance.now() - t0;
      const bar = 240 / s.bpm, err = a.bpm - s.bpm, off = a.offset - s.offset, ratio = a.bpm / s.bpm;
      const octave = Math.abs(ratio - 2) < 0.03 || Math.abs(ratio - 0.5) < 0.02;
      // an octave mistake is only all right when it said it wasn't sure
      if (octave) expect(a.confidence, `${s.id} at ${a.bpm} BPM`).toBeLessThan(SURE);
      const kb = s.sections.filter((p) => p.at > 0.5).map((p) => p.at), mb = a.sections.filter((p) => p.at > 0.5).map((p) => p.at);
      const h = kb.filter((t) => mb.some((m) => Math.abs(m - t) <= bar * 1.001)).length, r = mb.filter((m) => kb.some((t) => Math.abs(m - t) <= bar * 1.001)).length;
      n++; if (Math.abs(err) <= 1) tempoOk++; if (Math.abs(off) <= 0.06) offOk++;
      hit += h; parts += kb.length; mine += mb.length; right += r;
      rows.push(`${s.id.padEnd(20)} ${String(s.bpm).padStart(6)} ${a.bpm.toFixed(2).padStart(7)} ${(octave ? 'octave' : Math.abs(err) <= 1 ? 'ok' : 'wrong').padEnd(6)} sure ${a.confidence.toFixed(2)}`
        + `  first beat ${(off * 1000).toFixed(0).padStart(6)} ms  parts ${h}/${kb.length} (${r}/${mb.length} of its own)  ${ms.toFixed(0)} ms`);
    }
    console.log(`${rows.join('\n')}\ntempo within 1 BPM: ${tempoOk}/${n}; first downbeat within 60 ms: ${offOk}/${n}; part starts within a bar: ${hit}/${parts} (${right}/${mine} of its own)`);
    expect(n).toBeGreaterThan(0);
    expect(tempoOk / n).toBeGreaterThanOrEqual(20 / 24);
    expect(offOk / n).toBeGreaterThan(0.5);
    expect(hit / parts).toBeGreaterThan(0.55);
  }, 600_000);
});
