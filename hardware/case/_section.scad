// section helper: clip the assembly with a half-space to inspect internals.
// render with:  openscad -D part=\"none\" -D SECT=\"ylo\" -D POS=14.6 -o sec.png _section.scad
include <lumigate_case.scad>

SECT = "ylo";     // ylo: keep y<POS | xlo: keep x<POS
POS  = 14.6;

module model() {
    base();
    board_mock();
    color([0.72,0.80,0.90,0.5]) cover();
}
big = 500;
difference() {
    model();
    if (SECT == "ylo") translate([-big/2, POS, -big/2]) cube(big);
    else               translate([POS, -big/2, -big/2]) cube(big);
}
