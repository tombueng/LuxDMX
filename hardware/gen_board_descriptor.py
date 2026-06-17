#!/usr/bin/env python
"""Generate the board descriptors served by the /config pin picker (issue #12).

Single source of truth: the LumiGate v3 board descriptor is derived directly from
the PCB netlist source (lumigate.py) so the clickable diagram, the "Apply template"
preset and the Ethernet-reserved-pin rules can never drift from the real board.

The two generic dev-board descriptors (ESP32 DevKitC, ESP32-S3 DevKitC-1) use the
fixed, published header pinouts.

Outputs (committed; GitHub Pages serves web/ -> https://tombueng.github.io/LumiGate/):
    web/boards/index.json              catalog index (lazy-loaded by config.html)
    web/boards/lumigate_v3.json        generated from lumigate.py
    web/boards/esp32s3-devkitc-1.json
    web/boards/esp32-devkitc.json
    web/boards/img/lumigate-v3.png     board photo (online-only overlay)

These mirror the descriptors baked into src/pages/config.html; the baked copies keep
the three core boards working fully offline, the catalog adds the long tail.

Run:  python hardware/gen_board_descriptor.py
"""
import json
import os
import re
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "web", "boards")

# ESP32-S3-WROOM-1 castellation order (ESP32-S3-DevKitC-1 headers / LumiGate v3 module)
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


def fritz_cols(board_id, mcu):
    """Derive board-style columns from a Fritzing fragment's hotspots: split by x into
    two header columns, sort top-to-bottom by y, attach the chip-family flags. Keeps the
    schematic layout consistent with the real board (run gen_fritzing.py first)."""
    p = os.path.join(OUT, "fritzing", board_id + ".json")
    if not os.path.exists(p):
        return [[], []]
    hs = json.load(open(p, encoding="utf-8"))["hotspots"]
    flag = (lambda g: s3_flags(g, set())) if mcu == "esp32s3" else e32_flags
    xs = [h["x"] for h in hs]; midx = (min(xs) + max(xs)) / 2 if xs else 0
    mk = lambda h: {"gpio": h["gpio"], "silk": h["silk"], "flags": flag(h["gpio"])}
    left = [mk(h) for h in sorted((h for h in hs if h["x"] < midx), key=lambda h: h["y"])]
    right = [mk(h) for h in sorted((h for h in hs if h["x"] >= midx), key=lambda h: h["y"])]
    return [left, right]


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
# Fritzing "realistic board" overlays are generated separately by gen_fritzing.py into
# web/boards/fritzing/<id>.{svg,json} and merged into the descriptors below at build time.
# Adafruit QT Py ESP32-S3
QTPY_L = [(18,"A0"),(17,"A1"),(9,"A2"),(8,"A3"),(36,"SCK"),(37,"MISO"),(35,"MOSI")]
QTPY_R = [(5,"TX"),(16,"RX"),(7,"SDA"),(6,"SCL"),(41,"SDA1"),(40,"SCL1"),(39,"NEO")]
# Adafruit Feather ESP32 V2 (ESP32-PICO)
FEAV2_L = [(26,"A0"),(25,"A1"),(34,"A2"),(39,"A3"),(36,"A4"),(4,"A5"),(5,"SCK"),(19,"MOSI"),(21,"MISO"),(7,"RX"),(8,"TX")]
FEAV2_R = [(13,"D13"),(20,"SCL"),(22,"SDA"),(0,"NEO")]
named = lambda gs, silk: [(g, silk(g)) for g in gs]


def own_board_graphic(b):
    """Draw our own license-free (MIT) realistic board SVG for DevKit-class boards that have
    no clean Fritzing part (generic ESP32/-S3 DevKitC, DOIT, NodeMCU): a PCB with a USB jack,
    a WROOM module and two 0.1" header rows of gold pads. Uses the same 0.1"-grid units as the
    Fritzing SVGs so pin size stays consistent across boards. Returns the fritzing-style block;
    hotspot coordinates are exact because we place the pads ourselves."""
    top, bot = b["cols"][0], b["cols"][1]
    PITCH, LM, RM, H, yTop, yBot = 7.2, 17.0, 8.0, 58.0, 9.0, 49.0
    n = max(len(top), len(bot))
    W = LM + (n - 1) * PITCH + RM
    module = "ESP32-S3-WROOM-1" if b.get("mcu") == "esp32s3" else "ESP32-WROOM-32"
    mx1, mx2, my1, my2 = LM - 5, W - RM + 3, yTop + 7, yBot - 7
    s = ['<rect x="1" y="1" width="%.1f" height="%.1f" rx="6" fill="#0e3b2c" stroke="#1f8a63" stroke-width="0.8"/>' % (W - 2, H - 2),
         '<rect x="3" y="3" width="%.1f" height="%.1f" rx="5" fill="none" stroke="#0a2a20" stroke-width="0.5"/>' % (W - 6, H - 6),
         '<rect x="-2" y="%.1f" width="9" height="13" rx="1" fill="#aab2bd" stroke="#6b7480" stroke-width="0.4"/>' % (H / 2 - 6.5),
         '<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="2" fill="#3a4047" stroke="#11151a" stroke-width="0.6"/>' % (mx1, my1, mx2 - mx1, my2 - my1),
         '<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="1.5" fill="none" stroke="#565d66" stroke-width="0.4"/>' % (mx1 + 2, my1 + 2, mx2 - mx1 - 4, my2 - my1 - 4),
         '<text x="%.1f" y="%.1f" fill="#aeb6bf" font-size="4.5" font-weight="600" text-anchor="middle" font-family="sans-serif">%s</text>' % ((mx1 + mx2) / 2, (my1 + my2) / 2 + 1.6, module)]
    hot = []
    for cx, cy in ((6, 6), (W - 6, 6), (6, H - 6), (W - 6, H - 6)):
        s.append('<circle cx="%.1f" cy="%.1f" r="2" fill="#0d1117" stroke="#1f8a63" stroke-width="0.4"/>' % (cx, cy))
    def row(pins, y, below):
        for i, p in enumerate(pins):
            x = LM + i * PITCH
            s.append('<rect x="%.1f" y="%.1f" width="5" height="5" rx="0.8" fill="#d4af37" stroke="#8a6d1a" stroke-width="0.4"/>' % (x - 2.5, y - 2.5))
            s.append('<circle cx="%.1f" cy="%.1f" r="1.3" fill="#0d1117"/>' % (x, y))
            ly = (y + 5) if below else (y - 5)
            anc = "start" if below else "end"
            s.append('<text x="%.1f" y="%.1f" fill="#cdd6df" font-size="3" font-family="sans-serif" text-anchor="%s" transform="rotate(-90 %.1f %.1f)">%s</text>'
                     % (x + 1, ly, anc, x + 1, ly, p["silk"]))
            hot.append({"gpio": p["gpio"], "silk": p["silk"], "x": round(x, 2), "y": y})
    row(top, yTop, True)
    row(bot, yBot, False)
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %.1f %.1f">%s</svg>' % (W, H, "".join(s))
    os.makedirs(os.path.join(OUT, "fritzing"), exist_ok=True)
    with open(os.path.join(OUT, "fritzing", b["id"] + ".svg"), "w", encoding="utf-8") as fh:
        fh.write(svg)
    return {"svg": "fritzing/%s.svg" % b["id"], "viewBox": "0 0 %.1f %.1f" % (W, H),
            "credit": "LumiGate own render (MIT)", "hotspots": hot}


def parse_v3():
    """Read U1['IOxx'] += NET lines from lumigate.py -> {gpio: net}."""
    text = open(os.path.join(HERE, "lumigate.py"), encoding="utf-8").read()
    pin_net = {}
    for g, net in re.findall(r"U1\['IO(\d+)'\]\s*\+=\s*(\w+)", text):
        pin_net[int(g)] = net
    return pin_net


def v3_descriptor():
    pin_net = parse_v3()
    # net -> preset role (lower-case, matching config.html field names)
    net_role = {
        "DMX_TX": ("dmx", "tx"), "DMX_RX": ("dmx", "rx"), "DMX_EN": ("dmx", "rts"),
        "LED_R": ("ledr", None), "LED_G": ("ledg", None), "LED_Y": ("ledy", None),
        "LED_B": ("ledb", None), "LED_W": ("ledw", None),
        "DISP_SDA": ("dispsda", None), "DISP_SCL": ("dispscl", None),
        "DISP_SCK": ("dispsck", None), "DISP_MOSI": ("dispmosi", None),
        "DISP_CS": ("dispcs", None), "DISP_DC": ("dispdc", None), "DISP_RST": ("disprst", None),
    }
    eth_nets = {"SCLK", "MOSI", "MISO", "ETH_CS", "ETH_INT", "ETH_RST"}
    eth_pins = {g for g, net in pin_net.items() if net in eth_nets}

    preset = {"ledType": 3, "dispType": 1}
    dmx = {"en": True, "uni": 0, "port": 1, "tx": -1, "rx": -1, "rts": -1}
    for g, net in pin_net.items():
        if net in net_role:
            role, sub = net_role[net]
            if role == "dmx":
                dmx[sub] = g
            else:
                preset[role] = g
    preset["outputs"] = [dmx]

    return {
        "id": "lumigate_v3",
        "name": "LumiGate v3 (ESP32-S3 + W5500)",
        "mcu": "esp32s3",
        "photo": "img/lumigate-v3.png",
        "cols": cols(S3L, S3R, s3_silk, lambda g: s3_flags(g, eth_pins)),
        "preset": preset,
        "_source": "generated from hardware/lumigate.py",
    }


def main():
    os.makedirs(os.path.join(OUT, "img"), exist_ok=True)

    boards = [
        v3_descriptor(),
        {
            "id": "esp32s3-devkitc-1", "name": "ESP32-S3 DevKitC-1", "mcu": "esp32s3",
            "cols": cols(S3L, S3R, s3_silk, lambda g: s3_flags(g, set())),
            "preset": {"ledType": 2, "ledPin": 48, "dispType": 1, "dispsda": 8, "dispscl": 9,
                       "outputs": [{"en": True, "uni": 0, "port": 1, "tx": 17, "rx": 18, "rts": -1}]},
        },
        {
            "id": "esp32-devkitc", "name": "ESP32 DevKitC (WROOM-32, 38-pin)", "mcu": "esp32",
            "photo": "img/esp32-devkitc.jpg",  # CC0, Wikimedia Commons (see web/boards/CREDITS.md)
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
        {
            "id": "sparkfun-esp32-thing", "name": "SparkFun ESP32 Thing", "mcu": "esp32",
            "cols": fritz_cols("sparkfun-esp32-thing", "esp32"),
            "preset": {"ledType": 1, "ledPin": 5, "dispType": 0,
                       "outputs": [{"en": True, "uni": 0, "port": 1, "tx": 17, "rx": 16, "rts": -1}]},
        },
        {
            "id": "sparkfun-esp32-thing-plus", "name": "SparkFun ESP32 Thing Plus", "mcu": "esp32",
            "cols": fritz_cols("sparkfun-esp32-thing-plus", "esp32"),
            "preset": {"ledType": 1, "ledPin": 13, "dispType": 0,
                       "outputs": [{"en": True, "uni": 0, "port": 1, "tx": 17, "rx": 16, "rts": -1}]},
        },
    ]

    # merge Fritzing "realistic board" overlays produced by gen_fritzing.py (if present)
    for b in boards:
        frag = os.path.join(OUT, "fritzing", b["id"] + ".json")
        if os.path.exists(frag):
            b["fritzing"] = json.load(open(frag, encoding="utf-8"))

    # The most widespread DevKit-class boards (generic ESP32/-S3 DevKitC, DOIT, NodeMCU)
    # have no clean-license Fritzing part. Draw our own MIT realistic board graphic so they
    # still get the interactive "realistic board" view (only if no Fritzing overlay exists).
    OWN_GFX = {"esp32-devkitc", "esp32-devkit-v1", "nodemcu-32s", "esp32s3-devkitc-1"}
    for b in boards:
        if b["id"] in OWN_GFX and "fritzing" not in b:
            b["fritzing"] = own_board_graphic(b)

    # Fixed on-board wiring (the user CAN change these in /config but normally should not,
    # because they are physically wired on the board). Shown as a hint per board.
    HARDWIRED = {
        "lumigate_v3": [(1,"LED Red"),(2,"LED Green"),(6,"LED Yellow"),(7,"LED Blue"),(15,"LED White"),
                        (17,"DMX TX"),(18,"DMX RX"),(8,"DMX DE/RE"),(12,"W5500 SCLK"),(11,"W5500 MOSI"),
                        (13,"W5500 MISO"),(10,"W5500 CS"),(14,"W5500 INT"),(9,"W5500 RST"),
                        (4,"Display SDA (J4)"),(5,"Display SCL (J4)")],
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
        "sparkfun-esp32-thing": [(5,"onboard LED")],
        "sparkfun-esp32-thing-plus": [(13,"onboard LED")],
    }
    for b in boards:
        if b["id"] in HARDWIRED:
            b["hardwired"] = [{"gpio": g, "label": l} for g, l in HARDWIRED[b["id"]]]

    for b in boards:
        path = os.path.join(OUT, b["id"] + ".json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(b, fh, indent=2)
        print("wrote", os.path.relpath(path, ROOT))

    # Boards also baked inline into src/pages/config.html (work fully offline).
    INLINE = {"lumigate_v3", "esp32s3-devkitc-1", "esp32-devkitc", "esp32-devkit-v1", "xiao-esp32s3"}
    index = {
        "schema": 1,
        "updated": "auto",
        # "builtin" = also baked into src/pages/config.html (works fully offline);
        # the rest are catalog-only (fetched on demand from GitHub Pages).
        "boards": [{"id": b["id"], "name": b["name"], "mcu": b["mcu"],
                    "builtin": b["id"] in INLINE} for b in boards],
    }
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, indent=2)
    print("wrote", os.path.relpath(os.path.join(OUT, "index.json"), ROOT))

    src_photo = os.path.join(HERE, "board-pcb-1.png")
    if os.path.exists(src_photo):
        dst = os.path.join(OUT, "img", "lumigate-v3.png")
        shutil.copyfile(src_photo, dst)
        print("copied photo ->", os.path.relpath(dst, ROOT))
    else:
        print("note: hardware/board-pcb-1.png not found, skipped photo copy")


if __name__ == "__main__":
    main()
