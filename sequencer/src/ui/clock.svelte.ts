// One animation clock for every preview on screen (effect cards, live buttons), so twenty previews
// cost one requestAnimationFrame loop. It only runs while something reads it.
class Clock {
  t = $state(0);                 // seconds
  private users = 0;
  private raf = 0;
  use(): () => void {
    if (this.users++ === 0) {
      const t0 = performance.now() - this.t * 1000;
      const loop = (now: number) => { this.t = (now - t0) / 1000; this.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop);
    }
    return () => { if (--this.users === 0) cancelAnimationFrame(this.raf); };
  }
}
export const clock = new Clock();
