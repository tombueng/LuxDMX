// How big each template and demo is (lights, cues), for the welcome's tiles. Written down here
// rather than worked out on the welcome: that built all thirteen shows to count them, the festival
// alone 50 to 100 ms in one go, while the demo played behind the dialog. sizes.test.ts builds them
// and says when a number here is out of date.
export const SIZES: Record<string, { lights: number; cues: number }> = {
  "t:Band": { lights: 78, cues: 31 },
  "t:DJ / Party": { lights: 48, cues: 23 },
  "t:Theatre": { lights: 89, cues: 29 },
  "t:Church": { lights: 35, cues: 19 },
  "t:Cinema": { lights: 67, cues: 29 },
  "t:Bar": { lights: 43, cues: 25 },
  "t:Wedding": { lights: 67, cues: 28 },
  "t:Ring and matrix": { lights: 4, cues: 21 },
  "d:festival": { lights: 233, cues: 67 },
  "d:band": { lights: 36, cues: 15 },
  "d:club": { lights: 90, cues: 24 },
  "d:party": { lights: 62, cues: 20 },
  "d:truss": { lights: 32, cues: 70 },
};

// "78 lights · 31 cues" for a template (`t:` and its name) or a demo (`d:` and its id)
export function sizeSaid(key: string): string {
  const c = SIZES[key];
  return c ? `${c.lights} light${c.lights === 1 ? '' : 's'} · ${c.cues} cue${c.cues === 1 ? '' : 's'}` : '';
}
