// A moving head's motors: it can't be anywhere at once. Pan and tilt each run towards where the DMX
// says at no more than a real head's top speed, speeding up and braking, so a fast effect looks like
// a real head chasing it (smooth, a little behind, smaller swings when it's too fast to follow)
// instead of a jump to the new angle every frame. Only the 3D stage: what goes out is unchanged.

// degrees a second and degrees a second²: a quick modern spot (540° of pan in about two seconds)
export const PAN_SPEED = 280, TILT_SPEED = 220, ACCEL = 1500;

export interface Axis { at: number; v: number }

// One axis, `dt` seconds on: where it is now. A long gap (a hidden tab, the first frame) puts it
// straight where it should be.
export function slew(a: Axis, target: number, dt: number, speed: number, accel = ACCEL): number {
  if (!(dt > 0)) return a.at;
  if (dt > 0.5 || !Number.isFinite(a.at)) { a.at = target; a.v = 0; return a.at; }
  const err = target - a.at;
  // there already (and nearly still): stop there
  if (Math.abs(err) < 0.02 && Math.abs(a.v) < accel * dt) { a.at = target; a.v = 0; return a.at; }
  // the speed that still stops on the target braking at `accel`, never past the top speed
  const want = Math.sign(err) * Math.min(speed, Math.sqrt(2 * accel * Math.abs(err)));
  a.v += Math.max(-accel * dt, Math.min(accel * dt, want - a.v));
  const step = a.v * dt;
  // (the last bit in one go rather than past it and back)
  if (Math.sign(step) === Math.sign(err) && Math.abs(step) >= Math.abs(err)) { a.at = target; a.v = 0; }
  else a.at += step;
  return a.at;
}
