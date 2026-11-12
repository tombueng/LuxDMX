// A moving head's motors: it can't be anywhere at once. Pan and tilt each run towards where the DMX
// says at no more than a real head's top speed, speeding up and braking, so a fast effect looks like
// a real head chasing it (smooth, a little behind, smaller swings when it's too fast to follow)
// instead of a jump to the new angle every frame. Only the 3D stage: what goes out is unchanged.

// degrees a second and degrees a second²: a quick modern spot (540° of pan in about two seconds)
export const PAN_SPEED = 280, TILT_SPEED = 220, ACCEL = 1500;
// a third axis (roll): degrees a second, a little quicker than tilt (less to move)
export const ROLL_SPEED = 240;

export interface Axis { at: number; v: number; spun?: boolean }   // spun: it was turning round and round (endless)

// One axis, `dt` seconds on: where it is now. A slow frame (a busy machine draws the 3D only a
// few times a second) counts all the time that went by, in small steps, as the real head's motors
// ran all along; only a long gap (a hidden tab) or the first frame puts it straight where it
// should be.
export const LONG_GAP = 3, STEP = 1 / 30;
export function slew(a: Axis, target: number, dt: number, speed: number, accel = ACCEL): number {
  if (!(dt > 0)) return a.at;
  if (dt > LONG_GAP || !Number.isFinite(a.at)) { a.at = target; a.v = 0; return a.at; }
  if (dt > STEP) { const n = Math.ceil(dt / STEP); for (let i = 0; i < n; i++) run(a, target, dt / n, speed, accel); return a.at; }
  return run(a, target, dt, speed, accel);
}

function run(a: Axis, target: number, dt: number, speed: number, accel: number): number {
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
