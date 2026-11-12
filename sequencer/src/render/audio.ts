// A render's sound: the song (or the demo beat) from the render's start to its end, mixed in an
// OfflineAudioContext at full volume (as a recording of the stage has it: the speakers' volume and
// a muted laptop don't count). From before the song (the time before it, counting in): silence
// first, then the song. The crowd and the count-in clicks aren't in it (the clicks are for the band;
// the crowd follows the live show's lights).
import { playDemo } from '../timeline/beat';

export const RENDER_RATE = 48000;

export async function mixSong(o: { song?: AudioBuffer; demo?: boolean; from: number; to: number; rate?: number }): Promise<AudioBuffer | undefined> {
  if (!o.song && !o.demo) return undefined;
  const rate = o.rate ?? RENDER_RATE, len = Math.max(1, Math.ceil((o.to - o.from) * rate));
  if (typeof OfflineAudioContext === 'undefined') return undefined;
  const ctx = new OfflineAudioContext(2, len, rate);
  if (o.song) {
    const src = ctx.createBufferSource();
    src.buffer = o.song; src.connect(ctx.destination);
    // (before the song: it comes in at 0 on its clock; from the middle: from there)
    if (o.from < 0) src.start(-o.from, 0); else if (o.from < o.song.duration) src.start(0, o.from);
  } else playDemo(ctx, ctx.destination, o.from, o.to);
  return ctx.startRendering();
}
