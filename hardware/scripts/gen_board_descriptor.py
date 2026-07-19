#!/usr/bin/env python
"""Generate the board descriptors served by the /config pin picker (issue #12).

Run it with no arguments to CHECK the committed catalog for drift; it regenerates every
descriptor in memory and compares the parsed JSON against web/boards/. Formatting is not
drift, content is: the committed files are hand-formatted (compact, column-aligned pin
tables) and that stays, so the comparison is semantic, never byte-wise. --write actually
overwrites, which reformats; check the diff before committing a full regen.

Two things are deliberately NOT derived, because they are read off the real board rather
than computed: the curated physical header layouts (board_phys.json -> the `phys` key) and
the display labels for the LuxDMX board's fixed pins. Every GPIO NUMBER is derived, so the
pin data cannot drift from the hardware even though the cosmetics are hand-kept.

Single source of truth (for the parts it does cover): the LuxDMX board descriptor is
derived directly from the PCB netlist source (luxdmx.py), so the clickable diagram, the
"Apply template" preset and the Ethernet-reserved-pin rules cannot drift from the board.

The hand-tuned dev-board descriptors (ESP32 DevKitC, ESP32-S3 DevKitC-1, the Feather /
QtPy / XIAO / WT32-ETH01 boards) use fixed, published header pinouts. Every other
supported esp32 / esp32s3 board is auto-generated from the arduino-esp32 core's
variants/<dir>/pins_arduino.h (authoritative GPIOs); see auto_board().

Outputs (committed; GitHub Pages serves web/ -> https://tombueng.github.io/LuxDMX/):
    web/boards/index.json              catalog index (lazy-loaded by config.html)
    web/boards/<id>.json               one descriptor per board
    web/boards/luxdmx_v6.json          generated from hardware/scripts/luxdmx.py

Five core boards are also baked into src/pages/config.html so they work fully offline;
the catalog adds the long tail. The /config pin picker draws a generated horizontal
diagram from each descriptor's two pin columns (no board photos / realistic graphics).

Run:  python hardware/scripts/gen_board_descriptor.py            # check for drift
      python hardware/scripts/gen_board_descriptor.py --write    # regenerate
"""
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))          # hardware/scripts
ROOT = os.path.dirname(os.path.dirname(HERE))              # repo root
OUT = os.path.join(ROOT, "web", "boards")


def _find_variants():
    """Locate the arduino-esp32 core `variants/` dir (authoritative GPIO source).
    Override with PIO_VARIANTS; otherwise search the local pioarduino install."""
    env = os.environ.get("PIO_VARIANTS")
    if env and os.path.isdir(env):
        return env
    base = os.path.join(os.path.expanduser("~"), ".platformio", "packages")
    for p in glob.glob(os.path.join(base, "framework-arduinoespressif32*", "variants")):
        if os.path.isdir(p):
            return p
    return None


VARIANTS = _find_variants()

# ESP32-S3-WROOM-1 castellation order (ESP32-S3-DevKitC-1 headers / LuxDMX module)
S3L = [4, 5, 6, 7, 15, 16, 17, 18, 8, 19, 20, 3, 46, 9, 10, 11, 12, 13, 14]
S3R = [21, 47, 48, 45, 0, 35, 36, 37, 38, 39, 40, 41, 42, 44, 43, 2, 1]
# ESP32 DevKitC (WROOM-32, 38-pin) headers — breaks out the flash pins (6-11) too
E32L = [36, 39, 34, 35, 32, 33, 25, 26, 27, 14, 12, 13, 9, 10, 11]
E32R = [23, 22, 1, 3, 21, 19, 18, 5, 17, 16, 4, 0, 2, 15, 8, 7, 6]
# ESP32 DevKit v1 (DOIT, 30-pin) — narrower, does NOT break out the flash pins (6-11)
E32_30L = [36, 39, 34, 35, 32, 33, 25, 26, 27, 14, 12, 13]
E32_30R = [23, 22, 1, 3, 21, 19, 18, 5, 17, 16, 4, 0, 2, 15]
# Seeed XIAO ESP32-S3 — tiny board, silk uses D0..D10 labels (gpio, silk)
XIAO_L = [(1, "D0"), (2, "D1"), (3, "D2"), (4, "D3"), (5, "D4"), (6, "D5"), (43, "D6/TX")]
XIAO_R = [(44, "D7/RX"), (7, "D8"), (8, "D9"), (9, "D10")]


def s3_silk(g):
    return {43: "TX0", 44: "RX0"}.get(g, "IO%d" % g)


def e32_silk(g):
    return {36: "VP", 39: "VN", 1: "TX0", 3: "RX0"}.get(g, "IO%d" % g)


def s3_flags(g, eth_pins):
    f = []
    if g in (0, 3, 45, 46):
        f.append("strapping")
    if g in (43, 44):
        f.append("serial")
    if g in (19, 20):
        f.append("usb-jtag")
    if g in eth_pins:
        f.append("reserved:eth-spi")
    return f


def e32_flags(g):
    f = []
    if g in (6, 7, 8, 9, 10, 11):
        f.append("flash")
    if g in (1, 3):
        f.append("serial")
    if g in (34, 35, 36, 39):
        f.append("input-only")
    if g in (0, 2, 5, 12, 15):
        f.append("strapping")
    return f


def cols(left, right, silk, flag):
    mk = lambda g: {"gpio": g, "silk": silk(g), "flags": flag(g)}
    return [[mk(g) for g in left], [mk(g) for g in right]]


def cols_named(left, right, flag):
    """Columns from explicit (gpio, silk) pairs (boards with custom silk like XIAO)."""
    mk = lambda p: {"gpio": p[0], "silk": p[1], "flags": flag(p[0])}
    return [[mk(p) for p in left], [mk(p) for p in right]]


def e32_flags_eth(g, eth):
    f = e32_flags(g)
    if g in eth:
        f.append("reserved:eth-rmii")
    return f


# ── variant (pins_arduino.h) parsing -> auto descriptors ─────────────────────
# The hand-tuned boards above keep their true physical header order; every other
# supported esp32/esp32s3 board is derived here from the arduino-esp32 core's
# variants/<dir>/pins_arduino.h (authoritative GPIOs). Physical column placement
# is approximate (GPIO order); the GPIO numbers, silk names and flags are real.

def parse_variant(vdir):
    p = os.path.join(VARIANTS, vdir, "pins_arduino.h") if VARIANTS else None
    if not p or not os.path.exists(p):
        return None
    txt = open(p, encoding="utf-8", errors="ignore").read()
    pins = {}  # gpio -> set(alias names)
    for m in re.finditer(r"static\s+const\s+uint8_t\s+(\w+)\s*=\s*(\d+)\s*;", txt):
        pins.setdefault(int(m.group(2)), set()).add(m.group(1))
    skip = {"F_XTAL_MHZ", "NUM_DIGITAL_PINS", "EXTERNAL_NUM_INTERRUPTS"}
    for m in re.finditer(r"#define\s+(\w+)\s+(\d+)\b", txt):
        nm, num = m.group(1), int(m.group(2))
        if num <= 48 and not nm.startswith("USB_") and nm not in skip:
            pins.setdefault(num, set()).add(nm)

    def first(*names):
        want = set(names)
        for g in sorted(pins):
            if pins[g] & want:
                return g
        return None

    return {
        "pins": pins,
        "led": first("LED_BUILTIN", "BUILTIN_LED", "LED"),
        "rgb": first("RGB_BUILTIN", "PIN_NEOPIXEL", "PIN_RGB_LED", "RGB_DATA", "NEOPIXEL"),
        "sda": first("SDA"), "scl": first("SCL"),
        "sda_oled": first("SDA_OLED"), "scl_oled": first("SCL_OLED"),
        "eth": sorted(g for g, ns in pins.items() if any(n.startswith("ETH_PHY") for n in ns)),
    }


def pick_silk(g, names):
    for p in ("SDA", "SCL", "SCK", "MOSI", "MISO", "SS", "TX", "RX"):
        if p in names:
            return p
    for p, lbl in (("PIN_NEOPIXEL", "NEO"), ("RGB_BUILTIN", "RGB"), ("LED_BUILTIN", "LED")):
        if p in names:
            return lbl
    for pat, key in ((r"D\d+", lambda s: int(s[1:])), (r"A\d+", lambda s: int(s[1:])), (r"G\d+", lambda s: int(s[1:]))):
        hit = [n for n in names if re.fullmatch(pat, n)]
        if hit:
            return sorted(hit, key=key)[0]
    return "IO%d" % g


def auto_cols(pv, mcu, eth_set):
    flag = (lambda g: s3_flags(g, eth_set)) if mcu == "esp32s3" else (lambda g: e32_flags_eth(g, eth_set))
    items = [{"gpio": g, "silk": pick_silk(g, pv["pins"][g]), "flags": flag(g)} for g in sorted(pv["pins"])]
    half = (len(items) + 1) // 2
    return [items[:half], items[half:]]


def pick_dmx(avail, mcu, eth_set, preset):
    pref = [17, 16, 4, 5] if mcu == "esp32" else [17, 18, 4, 5, 43, 44]
    used = set(eth_set)
    for k in ("ledPin", "dispsda", "dispscl"):
        if preset.get(k) is not None:
            used.add(preset[k])
    flag = (lambda g: s3_flags(g, eth_set)) if mcu == "esp32s3" else (lambda g: e32_flags_eth(g, eth_set))

    def ok(g):
        return g not in used and not (set(flag(g)) & {"flash", "input-only"}) \
            and not any(x.startswith("reserved:eth") for x in flag(g))

    picks = [g for g in pref if g in avail and ok(g)]
    for g in sorted(avail):
        if len(picks) >= 2:
            break
        if g not in picks and ok(g):
            picks.append(g)
    picks = (picks + [-1, -1])[:2]
    return picks[0], picks[1]


def auto_board(id, name, mcu, variant, dmx=None, oled=None, eth=False, tft=False,
               layout="auto", led_type=None, led_pin=None):
    pv = parse_variant(variant)
    if pv is None:
        print("  SKIP %s: variant %r not found" % (id, variant))
        return None
    eth_set = set(pv["eth"])
    if eth:                       # ESP32 EMAC RMII data pins are fixed in silicon
        eth_set |= {19, 21, 22, 25, 26, 27}
    if layout == "e32":
        cols_data = cols(E32L, E32R, e32_silk, lambda g: e32_flags_eth(g, eth_set))
    elif layout == "e3230":
        cols_data = cols(E32_30L, E32_30R, e32_silk, lambda g: e32_flags_eth(g, eth_set))
    elif layout == "s3":
        cols_data = cols(S3L, S3R, s3_silk, lambda g: s3_flags(g, eth_set))
    else:
        cols_data = auto_cols(pv, mcu, eth_set)
    # LED preset (NeoPixel -> type 2, plain LED -> type 1)
    if led_type is None:
        if pv["rgb"] is not None:
            led_type, led_pin = 2, pv["rgb"]
        elif pv["led"] is not None:
            led_type, led_pin = 1, pv["led"]
        else:
            led_type = 0
    elif led_pin is None:
        led_pin = pv["rgb"] if led_type == 2 else pv["led"]
    preset = {"ledType": led_type}
    if led_type in (1, 2) and led_pin is not None:
        preset["ledPin"] = led_pin
    # Display preset: explicit OLED pins > variant SDA_OLED/SCL_OLED > generic I2C.
    # TFT-only boards leave the display off (mono OLED firmware support only).
    if tft:
        preset["dispType"] = 0
    elif oled:
        preset.update({"dispType": 1, "dispsda": oled[0], "dispscl": oled[1]})
    elif pv["sda_oled"] is not None and pv["scl_oled"] is not None:
        preset.update({"dispType": 1, "dispsda": pv["sda_oled"], "dispscl": pv["scl_oled"]})
    elif pv["sda"] is not None and pv["scl"] is not None:
        preset.update({"dispType": 1, "dispsda": pv["sda"], "dispscl": pv["scl"]})
    else:
        preset["dispType"] = 0
    avail = {p["gpio"] for c in cols_data for p in c}
    tx, rx = dmx if dmx else pick_dmx(avail, mcu, eth_set, preset)
    preset["outputs"] = [{"en": True, "uni": 0, "port": 1, "tx": tx, "rx": rx, "rts": -1}]
    d = {"id": id, "name": name, "mcu": mcu, "cols": cols_data, "preset": preset,
         "_source": "auto from variants/%s/pins_arduino.h" % variant}
    hw = []
    if pv["rgb"] is not None:
        hw.append((pv["rgb"], "NeoPixel"))
    if pv["led"] is not None:
        hw.append((pv["led"], "onboard LED"))
    for g in sorted(eth_set):
        hw.append((g, "Ethernet"))
    if hw:
        d["hardwired"] = [{"gpio": g, "label": l} for g, l in hw]
    return d


def wt32_flags(g):
    f = []
    if g == 0:
        f.append("reserved:eth-rmii")        # GPIO0 = RMII reference clock on WT32-ETH01
    if g in (1, 3):
        f.append("serial")
    if g in (0, 2, 5, 12, 15):
        f.append("strapping")
    if g in (34, 35, 36, 39):
        f.append("input-only")
    return f


def e32pico_flags(g):
    # ESP32-PICO module (Adafruit Feather ESP32 V2): embedded flash uses GPIO16/17,
    # so the usual WROOM flash pins 6-11 are FREE here.
    f = []
    if g in (16, 17):
        f.append("flash")
    if g in (1, 3):
        f.append("serial")
    if g in (34, 35, 36, 39):
        f.append("input-only")
    if g in (0, 2, 5, 12, 15):
        f.append("strapping")
    return f


# WT32-ETH01 header rows (egnor reference); GPIO0 is the Ethernet RMII refclk.
WT32_TOP = [32, 33, 5, 17]
WT32_BOT = [1, 3, 0, 39, 36, 15, 14, 12, 35, 4, 2]
# Adafruit Feather ESP32-S3 (standard Feather layout, GPIOs from pins_arduino.h)
FEAS3_L = [(18,"A0"),(17,"A1"),(16,"A2"),(15,"A3"),(14,"A4"),(8,"A5"),(36,"SCK"),(35,"MOSI"),(37,"MISO"),(38,"RX"),(39,"TX")]
FEAS3_R = [(13,"D13"),(12,"D12"),(11,"D11"),(10,"D10"),(9,"D9"),(6,"D6"),(5,"D5"),(4,"SCL"),(3,"SDA"),(33,"NEO")]
# Adafruit QT Py ESP32-S3
QTPY_L = [(18,"A0"),(17,"A1"),(9,"A2"),(8,"A3"),(36,"SCK"),(37,"MISO"),(35,"MOSI")]
QTPY_R = [(5,"TX"),(16,"RX"),(7,"SDA"),(6,"SCL"),(41,"SDA1"),(40,"SCL1"),(39,"NEO")]
# Adafruit Feather ESP32 V2 (ESP32-PICO)
FEAV2_L = [(26,"A0"),(25,"A1"),(34,"A2"),(39,"A3"),(36,"A4"),(4,"A5"),(5,"SCK"),(19,"MOSI"),(21,"MISO"),(7,"RX"),(8,"TX")]
FEAV2_R = [(13,"D13"),(20,"SCL"),(22,"SDA"),(0,"NEO")]
named = lambda gs, silk: [(g, silk(g)) for g in gs]


def parse_v3():
    """Read the U1 pin assignments from luxdmx.py -> {gpio: net}.

    Most pins are wired by GPIO name (U1['IO17']), but the module symbol also has a few
    FUNCTION-named pins. UART0 is the one that matters: luxdmx.py says U1['TXD0'] += S3_TX,
    and that pair is broken out on the J6 header (IO19/IO20 are the native USB lines).
    Miss these and J6 pins 8/9 come out with no GPIO at all."""
    text = open(os.path.join(HERE, "luxdmx.py"), encoding="utf-8").read()
    pin_net = {}
    for g, net in re.findall(r"U1\['IO(\d+)'\]\s*\+=\s*(\w+)", text):
        pin_net[int(g)] = net
    for name, net in re.findall(r"U1\['(TXD0|RXD0)'\]\s*\+=\s*(\w+)", text):
        pin_net[{"TXD0": 43, "RXD0": 44}[name]] = net     # ESP32-S3 U0TXD/U0RXD
    return pin_net


def luxdmx_headers(pin_net):
    """Build the J4/J6 header pinouts from luxdmx.py: [{ref, name, pins:[{pin, silk, gpio?}]}].

    Pin NUMBERS and GPIOs come from the netlist. The silk names are the board's own: the
    display header is labelled by function (SDA/SCL/...), the expansion header by GPIO."""
    text = open(os.path.join(HERE, "luxdmx.py"), encoding="utf-8").read()
    net_gpio = {net: g for g, net in pin_net.items()}
    FN = {"DISP_SDA": "SDA", "DISP_SCL": "SCL", "DISP_SCK": "SCK", "DISP_MOSI": "MOSI",
          "DISP_CS": "CS", "DISP_DC": "DC", "DISP_RST": "RST"}
    PWR = {"P3V3": "3V3", "P5V": "5V", "P5V_USB": "5V", "GND": "GND"}
    out = []
    for ref, name in (("J4", "Display header"), ("J6", "Expansion header")):
        pins = []
        for pin, net in re.findall(r"%s\[(\d+)\]\s*\+=\s*(\w+)" % ref, text):
            pin = int(pin)
            if net in PWR:
                pins.append({"pin": pin, "silk": PWR[net]})
            else:
                g = net_gpio.get(net)
                # display header is labelled by function, everything else by the module's
                # own silk (so UART0 shows as TX0/RX0, not IO43/IO44)
                silk = FN.get(net) or (s3_silk(g) if g is not None else net)
                d = {"pin": pin, "silk": silk}
                if g is not None:
                    d["gpio"] = g
                pins.append(d)
        pins.sort(key=lambda d: d["pin"])
        out.append({"ref": ref, "name": name, "pins": pins})
    return out


# Everything the PCB wires in copper with NO user header: the W5500 SPI bus, both DMX
# transceivers (U5 = o0_*, U6 = o1_*) and the 5 status LEDs. /config shows these read-only,
# because you cannot reassign them without cutting a trace. Order + labels are what the
# picker displays; the GPIO behind each one comes from the netlist, so it cannot drift.
# The DISP_* pins are deliberately absent: they land on J4, so they stay user-editable.
LUXDMX_HARDWIRED = [
    ("DMX_TX",   "o0_tx",   "DMX A · TX → DI"),
    ("DMX_RX",   "o0_rx",   "DMX A · RX → RO"),
    ("DMX_EN",   "o0_rts",  "DMX A · DE/RE → EN"),
    (None,       "o0_port", "DMX A · UART port", 1),
    ("DMX2_TX",  "o1_tx",   "DMX B · TX → DI"),
    ("DMX2_RX",  "o1_rx",   "DMX B · RX → RO"),
    ("DMX2_EN",  "o1_rts",  "DMX B · DE/RE → EN"),
    (None,       "o1_port", "DMX B · UART port", 2),
    ("SCLK",     "ethsck",  "W5500 · SCLK"),
    ("MOSI",     "ethmosi", "W5500 · MOSI"),
    ("MISO",     "ethmiso", "W5500 · MISO"),
    ("ETH_CS",   "ethcs",   "W5500 · CS"),
    ("ETH_INT",  "ethint",  "W5500 · INT"),
    ("ETH_RST",  "ethrst",  "W5500 · RST"),
    (None,       "ledtype", "5-LED status panel", 3),
    ("LED_R",    "ledr",    "LED · Red"),
    ("LED_G",    "ledg",    "LED · Green"),
    ("LED_Y",    "ledy",    "LED · Yellow"),
    ("LED_B",    "ledb",    "LED · Blue"),
    ("LED_W",    "ledw",    "LED · White"),
]

# Panel brightness tuned by eye on a real board: green + white are far brighter per mA than
# the others, so they run at a low duty. Not derivable from the netlist.
LUXDMX_LEDBRIGHT = {"r": 255, "g": 8, "y": 255, "b": 255, "w": 17}


def luxdmx_descriptor(board_id, name):
    """The LuxDMX board descriptor, derived from the PCB netlist (hardware/scripts/luxdmx.py)."""
    pin_net = parse_v3()
    net_gpio = {net: g for g, net in pin_net.items()}
    eth_nets = {"SCLK", "MOSI", "MISO", "ETH_CS", "ETH_INT", "ETH_RST"}
    eth_pins = {g for g, net in pin_net.items() if net in eth_nets}

    def gp(net):
        g = net_gpio.get(net)
        if g is None:
            raise SystemExit("luxdmx.py no longer assigns net %s - descriptor would be wrong" % net)
        return g

    preset = {"ledType": 3, "dispType": 1}
    for net, field in (("LED_R", "ledr"), ("LED_G", "ledg"), ("LED_Y", "ledy"),
                       ("LED_B", "ledb"), ("LED_W", "ledw")):
        preset[field] = gp(net)
    preset["ledbright"] = dict(LUXDMX_LEDBRIGHT)
    for net, field in (("ETH_CS", "ethcs"), ("SCLK", "ethsck"), ("MOSI", "ethmosi"),
                       ("MISO", "ethmiso"), ("ETH_INT", "ethint"), ("ETH_RST", "ethrst")):
        preset[field] = gp(net)
    for net, field in (("DISP_SDA", "dispsda"), ("DISP_SCL", "dispscl"), ("DISP_SCK", "dispsck"),
                       ("DISP_MOSI", "dispmosi"), ("DISP_CS", "dispcs"), ("DISP_DC", "dispdc"),
                       ("DISP_RST", "disprst")):
        preset[field] = gp(net)
    preset["outputs"] = [
        {"en": True, "uni": 0, "port": 1, "tx": gp("DMX_TX"), "rx": gp("DMX_RX"), "rts": gp("DMX_EN")},
        {"en": True, "uni": 1, "port": 2, "tx": gp("DMX2_TX"), "rx": gp("DMX2_RX"), "rts": gp("DMX2_EN")},
    ]

    hardwired = []
    for entry in LUXDMX_HARDWIRED:
        if entry[0] is None:                       # fixed VALUE, not a pin (UART port, LED type)
            _, field, label, val = entry
            hardwired.append({"field": field, "val": val, "label": label})
        else:
            net, field, label = entry
            hardwired.append({"field": field, "gpio": gp(net), "label": label})

    return {
        "id": board_id,
        "name": name,
        "mcu": "esp32s3",
        "cols": cols(S3L, S3R, s3_silk, lambda g: s3_flags(g, eth_pins)),
        "preset": preset,
        "_source": "generated from hardware/scripts/luxdmx.py",
        "hardwired": hardwired,
        "headers": luxdmx_headers(pin_net),
    }


def main():
    boards = [
        # Our own board, straight off the netlist.
        luxdmx_descriptor("luxdmx_v6", "LuxDMX v6 (ESP32-S3 + W5500)"),
        {
            "id": "esp32s3-devkitc-1", "name": "ESP32-S3 DevKitC-1", "mcu": "esp32s3",
            "cols": cols(S3L, S3R, s3_silk, lambda g: s3_flags(g, set())),
            "preset": {"ledType": 2, "ledPin": 48, "dispType": 1, "dispsda": 8, "dispscl": 9,
                       "outputs": [{"en": True, "uni": 0, "port": 1, "tx": 17, "rx": 18, "rts": -1}]},
        },
        {
            "id": "esp32-devkitc", "name": "ESP32 DevKitC (WROOM-32, 38-pin)", "mcu": "esp32",
            "cols": cols(E32L, E32R, e32_silk, e32_flags),
            "preset": {"ledType": 1, "ledPin": 2, "dispType": 1, "dispsda": 21, "dispscl": 22,
                       "outputs": [{"en": True, "uni": 0, "port": 1, "tx": 17, "rx": 16, "rts": -1}]},
        },
        {
            "id": "esp32-devkit-v1", "name": "ESP32 DevKit v1 (DOIT, 30-pin)", "mcu": "esp32",
            "cols": cols(E32_30L, E32_30R, e32_silk, e32_flags),
            "preset": {"ledType": 1, "ledPin": 2, "dispType": 1, "dispsda": 21, "dispscl": 22,
                       "outputs": [{"en": True, "uni": 0, "port": 1, "tx": 17, "rx": 16, "rts": -1}]},
        },
        {
            "id": "xiao-esp32s3", "name": "Seeed XIAO ESP32-S3", "mcu": "esp32s3",
            "cols": cols_named(XIAO_L, XIAO_R, lambda g: s3_flags(g, set())),
            "preset": {"ledType": 0, "dispType": 1, "dispsda": 5, "dispscl": 6,
                       "outputs": [{"en": True, "uni": 0, "port": 1, "tx": 1, "rx": 2, "rts": -1}]},
        },
        {
            "id": "nodemcu-32s", "name": "NodeMCU-32S (ESP32-WROOM-32, 38-pin)", "mcu": "esp32",
            "cols": cols(E32L, E32R, e32_silk, e32_flags),
            "preset": {"ledType": 1, "ledPin": 2, "dispType": 1, "dispsda": 21, "dispscl": 22,
                       "outputs": [{"en": True, "uni": 0, "port": 1, "tx": 17, "rx": 16, "rts": -1}]},
        },
        {
            "id": "wt32eth01", "name": "WT32-ETH01 (Ethernet, LAN8720)", "mcu": "esp32",
            "cols": cols_named(named(WT32_TOP, e32_silk), named(WT32_BOT, e32_silk), wt32_flags),
            "preset": {"ledType": 1, "ledPin": 2, "dispType": 1, "dispsda": 14, "dispscl": 15,
                       "outputs": [{"en": True, "uni": 0, "port": 1, "tx": 4, "rx": 5, "rts": -1}]},
        },
        {
            "id": "adafruit-feather-esp32s3", "name": "Adafruit Feather ESP32-S3", "mcu": "esp32s3",
            "cols": cols_named(FEAS3_L, FEAS3_R, lambda g: s3_flags(g, set())),
            "preset": {"ledType": 2, "ledPin": 33, "dispType": 1, "dispsda": 3, "dispscl": 4,
                       "outputs": [{"en": True, "uni": 0, "port": 1, "tx": 5, "rx": 6, "rts": -1}]},
        },
        {
            "id": "adafruit-qtpy-esp32s3", "name": "Adafruit QT Py ESP32-S3", "mcu": "esp32s3",
            "cols": cols_named(QTPY_L, QTPY_R, lambda g: s3_flags(g, set())),
            "preset": {"ledType": 2, "ledPin": 39, "dispType": 1, "dispsda": 7, "dispscl": 6,
                       "outputs": [{"en": True, "uni": 0, "port": 1, "tx": 5, "rx": 16, "rts": -1}]},
        },
        {
            "id": "adafruit-feather-esp32-v2", "name": "Adafruit Feather ESP32 V2 (PICO)", "mcu": "esp32",
            "cols": cols_named(FEAV2_L, FEAV2_R, e32pico_flags),
            "preset": {"ledType": 2, "ledPin": 0, "dispType": 1, "dispsda": 22, "dispscl": 20,
                       "outputs": [{"en": True, "uni": 0, "port": 1, "tx": 8, "rx": 7, "rts": -1}]},
        },
    ]

    # SparkFun + the long tail of supported esp32 / esp32s3 boards, generated straight
    # from the arduino-esp32 core variants (authoritative GPIOs). Physical column
    # placement is approximate; GPIO numbers, silk names and flags are real.
    auto = [
        auto_board("sparkfun-esp32-thing", "SparkFun ESP32 Thing", "esp32", "esp32thing", led_type=1, led_pin=5),
        auto_board("sparkfun-esp32-thing-plus", "SparkFun ESP32 Thing Plus", "esp32", "esp32thing_plus", led_type=1, led_pin=13),
        auto_board("adafruit-huzzah32", "Adafruit HUZZAH32 Feather", "esp32", "feather_esp32"),
        auto_board("wemos-lolin-d32", "WEMOS LOLIN D32", "esp32", "d32", layout="e3230"),
        auto_board("wemos-lolin32", "WEMOS LOLIN32", "esp32", "lolin32", layout="e3230"),
        auto_board("wemos-lolin32-lite", "WEMOS LOLIN32 Lite", "esp32", "lolin32-lite", layout="e3230"),
        auto_board("heltec-wifi-kit-32", "Heltec WiFi Kit 32 (OLED)", "esp32", "heltec_wifi_kit_32", oled=(4, 15)),
        auto_board("olimex-esp32-poe", "Olimex ESP32-PoE", "esp32", "esp32-poe", eth=True),
        auto_board("olimex-esp32-poe-iso", "Olimex ESP32-PoE-ISO", "esp32", "esp32-poe-iso", eth=True),
        auto_board("olimex-esp32-gateway", "Olimex ESP32-Gateway", "esp32", "esp32-gateway", eth=True),
        auto_board("wesp32", "wESP32 (PoE)", "esp32", "wesp32", eth=True),
        auto_board("esp32s3-devkitm-1", "ESP32-S3 DevKitM-1", "esp32s3", "esp32s3", layout="s3", led_type=2, led_pin=48),
        auto_board("adafruit-metro-esp32s3", "Adafruit Metro ESP32-S3", "esp32s3", "adafruit_metro_esp32s3"),
        auto_board("wemos-lolin-s3", "WEMOS LOLIN S3", "esp32s3", "lolin_s3"),
        auto_board("wemos-lolin-s3-mini", "WEMOS LOLIN S3 Mini", "esp32s3", "lolin_s3_mini"),
        auto_board("um-feathers3", "Unexpected Maker FeatherS3", "esp32s3", "um_feathers3"),
        auto_board("um-pros3", "Unexpected Maker ProS3", "esp32s3", "um_pros3"),
        auto_board("um-tinys3", "Unexpected Maker TinyS3", "esp32s3", "um_tinys3"),
        auto_board("sparkfun-esp32s3-thing-plus", "SparkFun ESP32-S3 Thing Plus", "esp32s3", "sparkfun_esp32s3_thing_plus"),
        auto_board("heltec-wifi-lora-32-v3", "Heltec WiFi LoRa 32 V3 (OLED)", "esp32s3", "heltec_wifi_lora_32_V3", oled=(17, 18)),
        auto_board("lilygo-t-display-s3", "LilyGO T-Display-S3 (TFT)", "esp32s3", "lilygo_t_display_s3", tft=True),
        auto_board("m5stack-atoms3", "M5Stack AtomS3 (TFT)", "esp32s3", "m5stack_atoms3", tft=True),
        auto_board("m5stack-cores3", "M5Stack CoreS3 (TFT)", "esp32s3", "m5stack_cores3", tft=True),
    ]
    boards += [b for b in auto if b]

    # Fixed on-board wiring (changeable in /config but physically wired). Hand-tuned boards
    # get curated labels here; auto boards already carry their own hardwired list.
    HARDWIRED = {
        "esp32-devkitc": [(2,"onboard LED")],
        "esp32-devkit-v1": [(2,"onboard LED")],
        "nodemcu-32s": [(2,"onboard LED")],
        "esp32s3-devkitc-1": [(48,"onboard RGB LED")],
        "xiao-esp32s3": [(21,"user LED (active-low)")],
        "wt32eth01": [(0,"ETH ref-clock"),(16,"ETH PHY power"),(18,"ETH MDIO"),(23,"ETH MDC"),
                      (19,"ETH TXD0"),(22,"ETH TXD1"),(21,"ETH TX_EN"),(25,"ETH RXD0"),
                      (26,"ETH RXD1"),(27,"ETH CRS_DV")],
        "adafruit-feather-esp32s3": [(33,"NeoPixel"),(13,"red LED")],
        "adafruit-feather-esp32-v2": [(0,"NeoPixel"),(13,"red LED")],
        "adafruit-qtpy-esp32s3": [(39,"NeoPixel")],
    }
    for b in boards:
        if b["id"] in HARDWIRED:
            b["hardwired"] = [{"gpio": g, "label": l} for g, l in HARDWIRED[b["id"]]]

    # Curated physical header layouts (board_phys.json). Which row + silk label a pad sits on
    # is read off the real board, so it is data, not derived -- but it must survive a regen,
    # otherwise the picker loses the faithful header diagrams for these boards.
    phys_path = os.path.join(HERE, "board_phys.json")
    with open(phys_path, encoding="utf-8") as fh:
        PHYS = json.load(fh)["boards"]
    for b in boards:
        if b["id"] in PHYS:
            b["phys"] = PHYS[b["id"]]        # last key, matching the committed descriptors

    write = "--write" in sys.argv

    # Boards also baked inline into src/pages/config.html (work fully offline).
    INLINE = {"luxdmx_v6", "esp32s3-devkitc-1", "esp32-devkitc",
              "esp32-devkit-v1", "xiao-esp32s3"}
    entries = [{"id": b["id"], "name": b["name"], "mcu": b["mcu"]} for b in boards]
    index = {
        "schema": 1,
        "updated": "auto",
        # "builtin" = also baked into src/pages/config.html (works fully offline);
        # the rest are catalog-only (fetched on demand from GitHub Pages).
        "boards": [{"id": e["id"], "name": e["name"], "mcu": e["mcu"],
                    "builtin": e["id"] in INLINE} for e in entries],
    }
    targets = [(b["id"] + ".json", b) for b in boards] + [("index.json", index)]

    if not write:
        # DEFAULT = check, not write. The committed JSON is hand-formatted (compact, column
        # aligned pin tables) and that formatting is worth keeping, so we compare PARSED data,
        # not bytes: formatting is not drift, content is. This is the gate that makes the
        # "descriptors cannot drift from the hardware" claim actually true and runnable.
        bad = 0
        for fname, want in targets:
            path = os.path.join(OUT, fname)
            if not os.path.exists(path):
                print("MISSING   %s (run with --write to create it)" % fname); bad += 1; continue
            with open(path, encoding="utf-8") as fh:
                have = json.load(fh)
            if have == want:
                continue
            bad += 1
            keys = sorted(set(have) | set(want)) if isinstance(have, dict) else []
            diffs = [k for k in keys if have.get(k) != want.get(k)]
            print("DRIFTED   %s  keys: %s" % (fname, ", ".join(diffs) or "(structure)"))
        extra = sorted(f for f in os.listdir(OUT)
                       if f.endswith(".json") and f not in {t[0] for t in targets}
                       )
        for f in extra:
            print("UNTRACKED %s (in the catalog, not produced by this script)" % f)
        if bad:
            print("\n%d descriptor(s) drifted from the hardware sources. "
                  "Re-run with --write to regenerate, then review the diff." % bad)
            return 1
        print("OK: %d generated descriptors + index match the committed catalog "
              "(%d curated phys layouts)." % (len(boards), len(PHYS)))
        return 0

    for fname, data in targets:
        path = os.path.join(OUT, fname)
        with open(path, "w", encoding="utf-8", newline="") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        print("wrote", os.path.relpath(path, ROOT))
    print("\nNOTE: --write uses plain json formatting. The committed catalog is hand-formatted "
          "(compact pin tables); re-check the diff before committing a full regen.")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
