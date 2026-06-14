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
# ESP32 DevKitC (WROOM-32, 38-pin) headers
E32L = [36, 39, 34, 35, 32, 33, 25, 26, 27, 14, 12, 13, 9, 10, 11]
E32R = [23, 22, 1, 3, 21, 19, 18, 5, 17, 16, 4, 0, 2, 15, 8, 7, 6]


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
            "id": "esp32-devkitc", "name": "ESP32 DevKitC (WROOM-32)", "mcu": "esp32",
            "cols": cols(E32L, E32R, e32_silk, e32_flags),
            "preset": {"ledType": 1, "ledPin": 2, "dispType": 1, "dispsda": 21, "dispscl": 22,
                       "outputs": [{"en": True, "uni": 0, "port": 1, "tx": 17, "rx": 16, "rts": -1}]},
        },
    ]

    for b in boards:
        path = os.path.join(OUT, b["id"] + ".json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(b, fh, indent=2)
        print("wrote", os.path.relpath(path, ROOT))

    index = {
        "schema": 1,
        "updated": "auto",
        "boards": [{"id": b["id"], "name": b["name"], "mcu": b["mcu"],
                    "builtin": b["id"] in ("lumigate_v3", "esp32s3-devkitc-1", "esp32-devkitc")}
                   for b in boards],
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
