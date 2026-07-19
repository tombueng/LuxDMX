"""Mis-plug safety gate for the two user headers (J4 display / J6 expansion).

J4 and J6 are the SAME JST SH 1.0mm 9-pin part, so a cable physically plugs into either
one. That is not going to change (both want pre-crimped SH cables), so the pinouts have to
be the thing that makes a swap harmless.

Up to v5.2 they were NOT: J4 was 1=+3V3 2=GND while J6 was 1=+5V 2=+3V3 3=GND. Plugging a
display into J6 therefore put +5V on the module's VCC and +3V3 on its GND, which killed a
real display on the bench. v6 re-pinned J6 to match J4 (see the J6 block in luxdmx.py).

This gate re-checks that invariant on the BOARD (what actually gets fabbed, not just what
the netlist says), position by position:

  FATAL  two DIFFERENT power rails at the same pin position   (+5V vs +3V3, +3V3 vs GND, ...)
         -> the module is powered wrong, or its ground is lifted to a rail. Destroys hardware.
  FATAL  a POSITIVE rail opposite a signal pin                (+5V or +3V3 vs a GPIO net)
         -> pushes a rail into a 3V3 CMOS pin with no current limit. Destroys hardware.
  OK     GND opposite a signal pin
         -> electrically identical to a GPIO driving low against another GPIO: current-limited
            by the driver, which is the contention class this design already accepts. J6 pin 9
            (2nd return) vs J4 pin 9 (DISP_RST) is exactly this, and is deliberate: a
            mis-plugged display sits harmlessly in reset instead of half-booting.
  OK     signal vs signal, or the identical net on both

If the two headers ever get DIFFERENT footprints they can no longer mate, and the gate
passes trivially (physical keying is a stronger fix than pin parity).

Exit 1 on any FATAL. HARD gate -- wired into validate_all.sh. KiCad 10 python (pcbnew)."""
import os
import sys

import pcbnew

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PCB = os.path.join(_HERE, "luxdmx.kicad_pcb")

# The mateable pair. Add here if another user-facing header joins the same connector family.
PAIR = ("J4", "J6")
POWER = {"+5V", "+3V3", "GND"}          # nets that carry current, not signal
POSITIVE = {"+5V", "+3V3"}              # a rail that can destroy a CMOS input


def header(board, ref):
    fp = board.FindFootprintByReference(ref)
    if fp is None:
        print(f"FAIL: {ref} not found on the board")
        sys.exit(1)
    pads = {}
    for pad in fp.Pads():
        pads[pad.GetNumber()] = pad.GetNetname() or "<unconnected>"
    return str(fp.GetFPID().GetLibItemName()), pads


def main():
    board = pcbnew.LoadBoard(PCB)
    a_ref, b_ref = PAIR
    a_fp, a = header(board, a_ref)
    b_fp, b = header(board, b_ref)

    print(f"{a_ref} footprint: {a_fp}")
    print(f"{b_ref} footprint: {b_fp}")
    if a_fp != b_fp:
        print(f"PASS: {a_ref} and {b_ref} use different footprints -- they cannot mate, "
              f"so pin parity is not required.")
        return 0

    fatal = []
    print(f"\n{'pin':>4} | {a_ref:<14} | {b_ref:<14} | verdict")
    print("-" * 60)
    for pin in sorted(set(a) | set(b), key=lambda p: (not p.isdigit(), int(p) if p.isdigit() else p)):
        na, nb = a.get(pin, "<absent>"), b.get(pin, "<absent>")
        if na == nb:
            verdict = "identical"
        elif na in POWER and nb in POWER:
            verdict = "FATAL: different rails"
            fatal.append((pin, na, nb, "two different power rails on the same position"))
        elif na in POSITIVE or nb in POSITIVE:
            verdict = "FATAL: rail vs signal"
            rail = na if na in POSITIVE else nb
            fatal.append((pin, na, nb, f"{rail} lands on a signal pin of the other header"))
        elif na == "GND" or nb == "GND":
            verdict = "ok (GND vs signal, current-limited)"
        else:
            verdict = "ok (signal vs signal)"
        print(f"{pin:>4} | {na:<14} | {nb:<14} | {verdict}")

    print()
    if fatal:
        print(f"FAIL: {len(fatal)} pin position(s) make a {a_ref}/{b_ref} swap destructive:")
        for pin, na, nb, why in fatal:
            print(f"  pin {pin}: {a_ref}={na}  {b_ref}={nb}  -- {why}")
        print("\nFix the pinout in scripts/luxdmx.py, regenerate the netlist, re-sync the board.")
        return 1

    print(f"PASS: swapping a cable between {a_ref} and {b_ref} cannot damage either side.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
