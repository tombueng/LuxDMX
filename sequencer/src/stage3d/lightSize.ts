// A light's size on the 3D stage as it comes (metres), for one drawn its own size (Fixture.dims: w
// across, h its lit face's other side, d front to back). No three.js here, so the light's setup can
// show them as the defaults; dims.test.ts checks them against the models.
//
// A bar or a strip: its body's cross-section, and its length from its cells. Its own w is its
// length, h its face across (a wide LED column, a slim pixel batten), d how deep it is.
export const BAR_FACE = 0.1, BAR_DEPTH = 0.08;
// as long as it's drawn without a size of its own: a strip at 30 pixels a metre, a short bar 1 m
export const barLength = (cells: number) => (cells > 24 ? cells / 30 : 1);

// The fixed lights: w across (as lookWidth has it), h the face's other side, d the body front to
// back (the lens to the back). A light's own w draws all of it that much bigger; its own h or d
// stretches just that way (a flat LED PAR, a 4-lite blinder, a long fresnel).
export type FixedLook = 'par' | 'fresnel' | 'blinder' | 'strobe';
export const FIXED_SIZE: Record<FixedLook, { w: number; h: number; d: number }> = {
  par: { w: 0.28, h: 0.28, d: 0.3 }, fresnel: { w: 0.22, h: 0.22, d: 0.34 },
  blinder: { w: 0.62, h: 0.3, d: 0.12 }, strobe: { w: 0.6, h: 0.24, d: 0.1 },
};
export const isFixedLook = (look: string): look is FixedLook => look in FIXED_SIZE;
// what a fixed light is drawn as, by its kind (and a blinder by its name), as rigOf.ts decides it
export function fixedLookOf(kind: string, model = ''): FixedLook | undefined {
  return kind === 'par' ? 'par' : kind === 'strobe' ? 'strobe' : kind === 'dimmer' ? (/blinder/i.test(model) ? 'blinder' : 'fresnel') : undefined;
}
