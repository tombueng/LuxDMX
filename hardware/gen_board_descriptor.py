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
    ]

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
