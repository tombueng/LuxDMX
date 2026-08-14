#!/usr/bin/env python3
"""Generate ASSEMBLY.md, the conditional build list, from the board itself.

Almost nothing on this carrier is unconditional. Which parts you fit depends on how many DMX
ports you want, how many pixel ports, where the 5 V comes from, and whether you already have
a fuse in the supply lead. Writing that list by hand goes stale the first time a part moves,
so it is derived from the board.

Port membership comes out of the net names (DMX2_A -> DMX port 2, PIX3_5V -> pixel port 3),
so adding a port does not need a doc edit. Everything else is in RULES below.

The script FAILS if a footprint on the board matches no rule. A part that silently misses the
build list is worse than no list at all.

Run:  python hardware-carrier/gen_assembly.py [--check]
"""
import os
import re
import sys

import pcbnew

def _project_dir():
    """The project directory, whether this script sits in it or in tools/ beside it.

    The tooling is deliberately kept out of the git repo (see .gitignore), so it lives one
    level down in tools/. Everything it reads and writes still belongs next to the board."""
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "luxdmx-carrier.kicad_pcb")) or \
           os.path.exists(os.path.join(d, "modules.json")):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.abspath(__file__))


HERE = _project_dir()
BOARD = os.path.join(HERE, "luxdmx-carrier.kicad_pcb")
OUT = os.path.join(HERE, "ASSEMBLY.md")

# value (exact) -> (group, condition template, note). {n} is filled with the port number
# taken from the nets. A condition of None means the rule needs the net signature to decide.
RULES = {
    "ESP32-S3 N16R8": ("Core", "always", "Nothing works without it."),
    "USR-ES1 W5500": ("Network", "you want wired Ethernet",
                      "Leave it out and everything runs over WiFi."),
    "10k ETH_CS pu": ("Network", "W5500 fitted",
                      "Holds CS high while the GPIOs are still floating out of reset."),
    "10k ETH_RST pu": ("Network", "W5500 fitted",
                       "Same for RST, otherwise the W5500 resets itself during boot."),
    "MAX3485 DMX{n}": ("DMX port {n}", "DMX port {n} is used", ""),
    "XLR{n} 1=shld 2=D- 3=D+": ("DMX port {n}", "DMX port {n} is used",
                                "Header out to the panel XLR."),
    "120R term": ("DMX port {n}", "DMX port {n} sits at the **end** of the bus",
                  "Leave it out mid-chain, and check the RS-485 module: most already "
                  "carry 120 R."),
    "330R bias+": ("DMX port {n}", "DMX port {n} drives the bus (controller role)",
                   "Fail-safe bias. Once per bus, not on every device. With two "
                   "terminators (60 R) 330 R gives 275 mV idle, above the 200 mV needed."),
    "330R bias-": ("DMX port {n}", "DMX port {n} drives the bus (controller role)",
                   "Belongs with 330R bias+, always as a pair."),
    "10k dir": ("DMX port {n}", "DMX port {n} is used",
                "Holds DE/RE defined through reset, otherwise the driver keys the bus "
                "before firmware runs."),
    "TVS bidir": ("DMX port {n}", "DMX port {n} leaves the enclosure",
                  "SMF12CA, bidirectional, 12 V standoff. The land takes SOD-123, "
                  "SOD-123F, SOD-123FL, SMA and 1206, so an SMAJ12CA fits too. Two per "
                  "port, A and B to GND."),
    "74AHCT541 pixel buffer": ("Pixel", "**at least one** pixel port is used",
                               "Not optional: the terminals hang off its outputs. WS281x "
                               "want 0.7 x VDD = 3.5 V and the 3.3 V from the S3 will not "
                               "do it reliably."),
    "PIX{n} V+/DATA/GND": ("Pixel", "pixel port {n} is used", ""),
    "1000uF 35V": ("Pixel", "pixel ports are used",
                   "Buffers the current steps of the strips. 13 mm can, 5.00 mm pitch."),
    "12-24V IN 24A": ("Pixel", "pixel ports are used",
                      "The actual power inlet. **Either** this terminal **or** the DC "
                      "jack, never both."),
    "DC jack, alternativ zu Schraubklemme": (
        "Pixel", "pixel ports are used **and** you want a plug-in supply",
        "Rated 3.5 A. Above about 3 A use the screw terminal."),
    "MF-R": ("Pixel", "pixel ports are used **and** no external fuse",
             "Bourns MF-R, 30 V. Middle hole up to 4 A, right hole up to 9 A. MF-RHT and "
             "MF-RG are 16 V parts and unusable on 24 V."),
    "12-24V -> 5V buck": ("Supply",
                          "supplied from 12/24 V **and** neither 5V-IN nor USB connected",
                          "Set it to 5.0 V **before** soldering it in."),
    "5V in": ("Supply", "5 V comes from outside", "Alternative to USB and the buck."),
    "OLED SDA/SCL/VCC/GND": ("Interface", "you want the display", ""),
    "EC11": ("Interface", "you want the encoder",
                       "EC11 with a push switch, the part inside a KY-040. No pullups "
                       "needed, GPIO42/41/21 have their own."),
    "Tact 6x6 H30": ("Interface", "you want the buttons", "6 x 6 mm tact switch on "
                     "IO3 and IO46. Take a 30 mm plunger if it has to reach the same front "
                     "panel as the 20 mm encoder shaft. Both go to GND, the pins pull up "
                     "internally."),
    "Blade fuse holder, alternative to the polyfuse": ("Supply", "you would rather replace a blown fuse than wait for a polyfuse to "
           "cool", "Alternative to the polyfuse, never both. Its own two holes, same nets."),
    "EXP 3V3/GND/47/48/43/44": ("Other", "optional",
                                "Brings out 3V3, GND, the two UART-bridge pins and the "
                                "**unbuffered** pixel signals 4 and 5."),
    "22uF 3V3 bulk": ("Other", "recommended",
                      "Holds up the 3V3 rail when three transceivers key at once."),
    "100nF": (None, None, None),        # decided by position, see below
}

EXTRA = """
## What is not a part

**The solder bridge.** It is a pad pair on the back inside the polyfuse footprint, between
its two left holes. Not a component, just a blob of solder.

| | Polyfuse | Bridge |
|---|---|---|
| fuse on the board | fit | leave open |
| external fuse in the supply lead | leave out | close |
| no fuse at all | leave out | close |

Exactly one of the two. Both together is a bridged fuse, which is no fuse.
"""

PITFALLS = """
## Watch out

**One 5 V source at a time.** USB, the 5V-IN header and the buck share a rail and back-feed
each other. If the buck is fitted and USB is plugged in, one source fights the other. There
is no reverse or ORing protection on the board.

**Set the buck before soldering it in.** These modules have a trimmer and arrive in any
position. At 12 V out the ESP32, the W5500 and the display all go at once.

**Screw terminal or DC jack, not both.** They sit on the same nets.

**120 R only at the end of the bus.** And check the RS-485 module first, the cheap ones
usually carry 120 R and bias already. A second one puts 60 R on the bus.

**The buffer is not optional.** The pixel terminals hang off its outputs; without it nothing
reaches them.

**All the small parts sit on the back.** The modules cover the front. Do the back first, then
the headers, or you will not get to them.

**The lands take more than one size.** Resistors and capacitors go on a land running 0.30 to
2.30 mm off centre, so 0402, 0603, 0805 and 1206 all sit on copper and you can use whatever
you have. The TVS lands go out to 2.90 mm and take SOD-123 through SMA as well. None of it
reflows, the lands are longer than the parts and nothing self-aligns, but by hand it does not
matter.
"""

STAGES = """
## Build levels

| | DMX | Pixel | Network | What you need |
|---|---|---|---|---|
| **DMX only, USB powered** | 1-3 | - | WiFi | ESP32, one RS-485 module per port, XLR headers, 10k dir, bias and termination as required |
| **DMX + LAN** | 1-3 | - | W5500 | plus the W5500 and its two 10k |
| **Pixel only** | - | 1-5 | WiFi | ESP32, buffer, terminals, 1000uF, power inlet, fuse, buck |
| **Everything** | 3 | 5 | W5500 | all of the above, plus display and encoder |

The buck is only needed where 12/24 V is present **and** neither USB nor 5V-IN. On the bench
with a USB cable: leave it out.
"""


def port_of(nets):
    for n in nets:
        m = re.match(r"(?:DMX|PIX)(\d)", n)
        if m:
            return int(m.group(1))
    return None


def main():
    board = pcbnew.LoadBoard(BOARD)
    rows, unmatched = [], []

    for f in board.GetFootprints():
        val = f.GetValue()
        nets = sorted({p.GetNetname() for p in f.Pads() if p.GetNetname()})
        n = port_of(nets)

        rule = None
        for key, r in RULES.items():
            if key == val or (n and key.format(n=n) == val) or val.startswith(key):
                rule = r
                break
        if rule is None or rule[0] is None:
            if val == "100nF":
                # both sit on +3V3/GND, so the net signature cannot tell them apart
                x = pcbnew.ToMM(f.GetPosition().x)
                rule = (("Network", "W5500 fitted", "Decoupling right at the module.")
                        if x < 120 else
                        ("Other", "recommended", "Decoupling for the 3V3 rail."))
            else:
                unmatched.append((f.GetReference(), val))
                continue

        group, cond, note = rule
        rows.append((group.format(n=n) if n else group,
                     f.GetReference(), val,
                     "back" if f.IsFlipped() else "front",
                     cond.format(n=n) if n else cond, note))

    if unmatched:
        print("No rule for these, the doc would be incomplete:")
        for r, v in unmatched:
            print(f"   {r}  ({v})")
        return 1

    order = ["Core", "Supply", "Pixel", "Network",
             "DMX port 1", "DMX port 2", "DMX port 3", "Interface", "Other"]
    groups = {}
    for g, ref, val, side, cond, note in rows:
        groups.setdefault(g, []).append((ref, val, side, cond, note))

    L = ["# Assembly", "",
         "How many of the 46 positions you actually solder depends on what you are building.",
         "Almost nothing here is mandatory.", "",
         "## Answer these first", "",
         "1. Where does power come from: **USB**, **external 5 V**, or **12/24 V via buck**?",
         "2. Which **DMX ports** (1, 2, 3)?",
         "3. Which **pixel ports** (1 to 5)?",
         "4. **Wired Ethernet** or WiFi only?",
         "5. **Display** and **encoder** connected?",
         "6. Is there already a **fuse in the supply lead**?", ""]

    for g in order + [k for k in groups if k not in order]:
        if g not in groups:
            continue
        L += [f"## {g}", "",
              "| Part | Side | Fit it when | Note |",
              "|---|---|---|---|"]
        for ref, val, side, cond, note in sorted(groups[g]):
            L.append(f"| `{ref}` | {side} | {cond} | {note} |")
        L.append("")

    # shopping list: same parts, counted, so nobody has to tally the table by hand
    def generic(v):
        """MAX3485 DMX1/2/3 are one part bought three times, not three parts."""
        v = re.sub(r"^(MAX3485 DMX)\d$", r"\1n", v)
        v = re.sub(r"^PIX\d (.*)", r"PIXn \1", v)
        v = re.sub(r"^XLR\d (.*)", r"XLRn \1", v)
        return v.split(":")[0].strip()

    counts = {}
    for g, ref, val, side, cond, note in rows:
        key = (generic(val), side)
        counts.setdefault(key, [0, cond])
        counts[key][0] += 1
    L += ["## Shopping list, everything fitted", "",
          "| Qty | Part | Side | only needed when |", "|---:|---|---|---|"]
    for (val, side), (n, cond) in sorted(counts.items(), key=lambda kv: (-kv[1][0], kv[0])):
        # the per-port condition is the same text with a different number, so generalise it
        c = re.sub(r"\b(DMX|pixel) port \d", r"any \1 port", cond)
        L.append(f"| {n} | {val} | {side} | {c} |")
    L.append("")

    L += [EXTRA.strip(), "", PITFALLS.strip(), "", STAGES.strip(), ""]
    open(OUT, "w", encoding="utf-8").write("\n".join(L))
    print(f"{len(rows)} Positionen in {len(groups)} Gruppen -> {os.path.basename(OUT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
