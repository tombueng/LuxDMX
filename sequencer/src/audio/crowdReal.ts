// The crowd from real recordings (public/sounds/crowd, credits in SONGS.md "The crowd"): people
// chatting in a hall before the show, a crowd cheering, and cheers that swell up and die away. No
// applause and no clapping (they sounded ugly). The loops are made seamless here (their end
// crossfaded into their start), so an MP3's padding never clicks where they go round. Made into the
// same kit as the sounds made by hand (crowdKit.ts), which stay the fallback when the files can't be
// had.
import type { Kit } from './crowdKit';

export const CROWD_DIR = 'sounds/crowd/';
export const CROWD_FILES = { chatter: 'chatter.mp3', roar: 'cheering.mp3', cheers: ['cheer-1.mp3', 'cheer-2.mp3'] };

// a loop that goes round without a seam: the last `fade` seconds crossfaded (equal power) into the
// first, after `trim` seconds off both ends (an MP3's padding)
export function seamless(chs: Float32Array[], rate: number, fade = 1.5, trim = 0.06): Float32Array[] {
  const t = Math.round(trim * rate), n0 = chs[0].length - 2 * t, f = Math.min(Math.round(fade * rate), Math.floor(n0 / 3));
  return chs.map((c) => {
    const x = c.subarray(t, t + n0), out = new Float32Array(n0 - f);
    out.set(x.subarray(f, n0 - f + f), 0);
    // (the end of the loop: its own end fading out while its start fades in)
    for (let i = 0; i < f; i++) {
      const u = (i + 0.5) / f, a = Math.cos(u * Math.PI / 2), b = Math.sin(u * Math.PI / 2);
      out[n0 - 2 * f + i] = x[n0 - f + i] * a + x[i] * b;
    }
    return out;
  });
}

// the files, decoded (at 44.1 kHz) and made into the kit; undefined when they can't be had
export async function loadRecorded(base: string): Promise<Kit | undefined> {
  if (typeof OfflineAudioContext === 'undefined' || typeof fetch === 'undefined') return undefined;
  const rate = 44100, ctx = new OfflineAudioContext(2, 1, rate);
  const get = async (f: string) => {
    const r = await fetch(base + CROWD_DIR + f);
    if (!r.ok) throw new Error(`${f}: ${r.status}`);
    const b = await ctx.decodeAudioData(await r.arrayBuffer());
    return Array.from({ length: Math.min(2, b.numberOfChannels) }, (_, i) => b.getChannelData(i).slice());
  };
  try {
    const [chatter, roar, ...cheers] = await Promise.all([CROWD_FILES.chatter, CROWD_FILES.roar, ...CROWD_FILES.cheers].map(get));
    const two = (chs: Float32Array[]) => (chs.length > 1 ? chs : [chs[0], chs[0]]);
    return { rate, chatter: seamless(two(chatter), rate), roar: seamless(two(roar), rate), woos: [], whistles: [], cheers: cheers.map(two) };
  } catch { return undefined; }
}
