#!/usr/bin/env python3
"""Put two push buttons on the carrier, next to the display.

The firmware already takes four (INPUT_MAX_BTN, pins out of the config), so this is two of a
possible four; the rest can still come off the expansion header.

Which pins: nine are unused on the module header and only two of them are actually free.

    IO35 IO36 IO37   taken by the octal PSRAM on any R8 part, header or not
    IO45             strapping for the flash voltage. A pull-up here means 1.8 V and no boot
    IO0              the BOOT pin. Usable, but held at power-up it means download mode
    IO19 IO20        USB D- and D+. Taking them kills the native USB port
    IO3  IO46        both strapping pins, both harmless: JTAG source select and ROM message
                     printing. Neither stops the chip booting whichever way it is left

Both do internal pull-ups, so the buttons go straight to GND with no resistors. That is not
an assumption: this SoC has SOC_GPIO_VALID_OUTPUT_GPIO_MASK equal to its VALID_GPIO_MASK, so
there are no input-only pins, and IO46 has an ordinary IO_MUX register with the pull bits.

The footprint is KiCad's SW_PUSH_6mm, the 6 x 6 mm through-hole tact switch, because it is
the one everybody has a bag of and it takes caps from 5 to 13 mm. The board is 20 mm deep at
the encoder, so a tall cap is what reaches a front panel.

Placement is a starting point. They go in clear space as near the display as will fit, and
are meant to be dragged where the fingers should actually be.

Run:  python tools/add_buttons.py [--pins 3,46] [--at X,Y:X,Y] [--remove]
"""
import os
import sys

import pcbnew

LIB = "/usr/share/kicad/footprints/Button_Switch_THT.pretty"
FP = "SW_PUSH_6mm"
BUTTONS = [("Button 1", "BTN1", 3), ("Button 2", "BTN2", 46)]
SIZE = (8.0, 8.0)
KEEP = 0.6


def _project_dir():
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "luxdmx-carrier.kicad_pcb")):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.abspath(__file__))


HERE = _project_dir()
BOARD = os.path.join(HERE, "luxdmx-carrier.kicad_pcb")


def esp_pad(b, gpio):
    """The module pad carrying that GPIO, from modules.json's header listing."""
    import json
    d = json.load(open(os.path.join(HERE, "modules.json")))
    n, want = 0, f"IO{gpio}"
    num = None
    for h in d["modules"]["esp32-s3-devkitc-1"]["headers"]:
        for name in h["names"]:
            n += 1
            if name == want:
                num = str(n)
    if num is None:
        sys.exit(f"IO{gpio} steht auf keinem Header des Moduls")
    for f in b.GetFootprints():
        if "ESP32" not in f.GetReference().upper():
            continue
        for p in f.Pads():
            if p.GetNumber() == num:
                return p, num
    sys.exit(f"Modul-Pin {num} nicht gefunden")


def boxes(b):
    out = []
    for f in b.GetFootprints():
        s = f.GetCourtyard(pcbnew.F_CrtYd)
        if s.OutlineCount() == 0:
            s = f.GetCourtyard(pcbnew.B_CrtYd)
        if s.OutlineCount() == 0:
            continue
        bb = s.BBox()
        out.append([pcbnew.ToMM(v) for v in
                    (bb.GetLeft(), bb.GetRight(), bb.GetTop(), bb.GetBottom())])
    return out


def free_near(b, taken, target):
    """Clear spot closest to `target`, counting what has already been placed."""
    e = [s for s in b.GetDrawings() if s.GetLayer() == pcbnew.Edge_Cuts]
    xs = [pcbnew.ToMM(v) for s in e for v in (s.GetStart().x, s.GetEnd().x)]
    ys = [pcbnew.ToMM(v) for s in e for v in (s.GetStart().y, s.GetEnd().y)]
    w, h = SIZE[0] + 2 * KEEP, SIZE[1] + 2 * KEEP
    best = None
    y = min(ys) + 1.0
    while y + h <= max(ys) - 1.0:
        x = min(xs) + 1.0
        while x + w <= max(xs) - 1.0:
            if not any(x < t[1] and x + w > t[0] and y < t[3] and y + h > t[2]
                       for t in taken):
                d = (x + w / 2 - target[0]) ** 2 + (y + h / 2 - target[1]) ** 2
                if best is None or d < best[0]:
                    best = (d, x + KEEP, y + KEEP)
            x += 0.5
        y += 0.5
    return best


def main():
    if "--remove" in sys.argv:
        b = pcbnew.LoadBoard(BOARD)
        gone = 0
        for f in list(b.GetFootprints()):
            if f.GetReference().startswith("Button"):
                b.Remove(f)
                gone += 1
        pcbnew.SaveBoard(BOARD, b)
        print(f"{gone} Taster entfernt")
        return 0

    b = pcbnew.LoadBoard(BOARD)
    disp = next((f for f in b.GetFootprints()
                 if f.GetReference().startswith("Display")), None)
    target = (pcbnew.ToMM(disp.GetPosition().x), pcbnew.ToMM(disp.GetPosition().y)) \
        if disp else (150.0, 115.0)

    gnd = b.FindNet("GND")
    if gnd is None:
        sys.exit("GND nicht gefunden")
    taken = boxes(b)
    at = sys.argv[sys.argv.index("--at") + 1].split(":") if "--at" in sys.argv else []

    for i, (ref, netname, gpio) in enumerate(BUTTONS):
        pad, num = esp_pad(b, gpio)
        net = b.FindNet(netname)
        if net is None:
            net = pcbnew.NETINFO_ITEM(b, netname)
            b.Add(net)
        pad.SetNet(net)

        fp = pcbnew.FootprintLoad(LIB, FP)
        if fp is None:
            sys.exit(f"{FP} nicht in {LIB}")
        if i < len(at):
            x, y = [float(v) for v in at[i].split(",")]
        else:
            spot = free_near(b, taken, target)
            if spot is None:
                sys.exit(f"kein freier Platz von {SIZE[0]} x {SIZE[1]} mm fuer {ref}")
            _d, x, y = spot
        b.Add(fp)
        fp.SetReference(ref)
        fp.SetValue(f"IO{gpio}")
        fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y)))
        for p in fp.Pads():
            p.SetNet(net if p.GetNumber() == "1" else gnd)
        taken.append([x - KEEP, x + SIZE[0] + KEEP, y - KEEP, y + SIZE[1] + KEEP])
        print(f"  {ref}: IO{gpio} (Modul-Pin {num}) -> {netname}, GND auf Pad 2, "
              f"bei ({x:.2f}, {y:.2f})")

    pcbnew.SaveBoard(BOARD, b)
    print(f"{len(BUTTONS)} Taster gesetzt - Routing daneben ist hinfaellig, neu routen")
    return 0


if __name__ == "__main__":
    sys.exit(main())
