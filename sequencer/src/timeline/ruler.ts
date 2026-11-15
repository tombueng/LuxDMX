// What the timeline's ruler draws: the beat grid over the song (a line per beat, or per bar, or per
// few bars, as close as the zoom allows; the bar numbers only as often as they fit), and the song's
// waveform as one closed path, its loudest bits 20 px either side of the middle.

export interface Tick { t: number; bar: boolean; n: number; label: boolean }

// `scale`: pixels a second; `offset`: where the first downbeat is (seconds)
export function gridOf(bpmIn: number | undefined, length: number, scale: number, offset = 0): Tick[] {
  // (a tempo that isn't a sane number would loop for ever here: 120)
  const bpm = bpmIn !== undefined && Number.isFinite(bpmIn) && bpmIn >= 20 && bpmIn <= 300 ? bpmIn : 120;
  const beat = 60 / bpm, d = length || 240, out: Tick[] = [];
  const every = scale * beat < 6 ? (scale * beat * 4 < 14 ? 4 * Math.ceil(14 / (scale * beat * 4)) : 4) : 1;
  // (the bar numbers as far apart as they need: "121" is wider than "9", so past bar 99 only
  // every second or fourth bar is numbered where they'd run into each other)
  const barStep = Math.max(1, every / 4), barPx = scale * beat * 4 * barStep;
  const need = String(Math.max(1, Math.ceil(d / (beat * 4)))).length * 6.6 + 6;
  const lab = barStep * ([1, 2, 4, 8, 16, 32].find((k) => barPx * k >= need) ?? 64);
  for (let i = 0, t = offset; t <= d; i += every, t = offset + i * beat) {
    const n = i / 4 + 1;
    out.push({ t, bar: i % 4 === 0, n, label: i % 4 === 0 && (n - 1) % lab === 0 });
  }
  return out;
}

// the waveform `peaks` (0..1 each, evenly over the song) drawn `width` px wide
export function peaksPath(peaks: readonly number[], width: number): string {
  if (!peaks.length) return '';
  let s = 'M0 22';
  peaks.forEach((v, i) => { s += `L${((i + 0.5) / peaks.length * width).toFixed(1)} ${(22 - v * 20).toFixed(1)}`; });
  for (let i = peaks.length - 1; i >= 0; i--) s += `L${((i + 0.5) / peaks.length * width).toFixed(1)} ${(22 + peaks[i] * 20).toFixed(1)}`;
  return s + 'Z';
}
