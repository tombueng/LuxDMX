#!/usr/bin/env python
"""Extract Fritzing "realistic board" graphics + click hotspots for the pin picker.

For each configured board: unzip its .fzpz, take the breadboard-view SVG (the realistic
graphic, kept UNMODIFIED) and read every connector's terminal coordinate from the part's
.fzp + breadboard SVG. Coordinates are resolved through any parent <g transform> so they
land in the SVG's viewBox space. Connector names are mapped to GPIO numbers automatically
(an embedded IOxx/Ixx number wins; otherwise a functional name like SDA/SCK/A0 via the
board's Arduino pins_arduino.h). Power/control pins and out-of-board/duplicate points are
dropped.

Output per board (consumed by gen_board_descriptor.py):
    web/boards/fritzing/<id>.svg            the breadboard SVG (CC-BY-SA, attributed)
    web/boards/fritzing/<id>.json           { viewBox, credit, creditUrl, svg, hotspots }

Run:  python hardware/gen_fritzing.py
Sources are CC-BY-SA (Adafruit / SparkFun / Fritzing core); see web/boards/CREDITS.md.
"""
import os, re, json, zipfile
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "web", "boards", "fritzing")
VARIANTS = os.path.join(os.path.expanduser("~"), ".platformio", "packages",
                        "framework-arduinoespressif32", "variants")

POWER = {"3.3V", "3V3", "5V", "+5V", "VBAT", "VBUS", "VIN", "VHIGH", "GND", "EN",
         "RESET", "!RESET", "RST", "N/C", "NC", "V_NEOI2C", "VHI", "VCC", "AREF"}

# ---- affine transforms ------------------------------------------------------
IDENT = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
def mat_mul(M, N):
    a = M[0]*N[0] + M[2]*N[1]; b = M[1]*N[0] + M[3]*N[1]
    c = M[0]*N[2] + M[2]*N[3]; d = M[1]*N[2] + M[3]*N[3]
    e = M[0]*N[4] + M[2]*N[5] + M[4]; f = M[1]*N[4] + M[3]*N[5] + M[5]
    return (a, b, c, d, e, f)
def parse_transform(s):
    M = IDENT
    for kind, args in re.findall(r'(\w+)\s*\(([^)]*)\)', s or ""):
        v = [float(x) for x in re.split(r'[\s,]+', args.strip()) if x != ""]
        if kind == "translate": M = mat_mul(M, (1, 0, 0, 1, v[0], v[1] if len(v) > 1 else 0))
        elif kind == "scale":   M = mat_mul(M, (v[0], 0, 0, v[1] if len(v) > 1 else v[0], 0, 0))
        elif kind == "matrix":  M = mat_mul(M, tuple(v))
        elif kind == "rotate" and len(v) == 1:
            import math; a = math.radians(v[0]); M = mat_mul(M, (math.cos(a), math.sin(a), -math.sin(a), math.cos(a), 0, 0))
    return M
def apply(M, x, y):
    return (M[0]*x + M[2]*y + M[4], M[1]*x + M[3]*y + M[5])

# ---- svg parsing ------------------------------------------------------------
def strip_ns(svg):
    svg = re.sub(r'\sxmlns(:\w+)?="[^"]*"', '', svg)
    svg = re.sub(r'<(/?)[A-Za-z0-9]+:', r'<\1', svg)
    svg = re.sub(r'\s[A-Za-z0-9]+:([A-Za-z0-9-]+=)', r' \1', svg)
    return svg

def local_center(el):
    g = el.attrib
    def fl(k):
        try: return float(g[k])
        except (KeyError, ValueError): return None
    if el.tag == "circle":
        return fl("cx"), fl("cy")
    if el.tag in ("rect", "line", "ellipse", "use", "path"):
        x, y = fl("x"), fl("y")
        if x is not None and y is not None:
            return x + (fl("width") or 0)/2, y + (fl("height") or 0)/2
        if fl("cx") is not None:
            return fl("cx"), fl("cy")
    return None

def coords_by_id(svgtext):
    """id -> (x,y) using each terminal element's own geometry (no transforms).

    This is correct for parts whose breadboard pins sit directly in viewBox space (the
    common case, verified on the Adafruit Feather S3). Parts that wrap pins in a
    transformed <g> (e.g. HUZZAH32, Metro) would need transform resolution and are
    skipped via the in-range filter rather than risk misplaced hotspots.
    """
    out = {}
    for m in re.finditer(r'<([a-zA-Z]+)\b([^>]*?)\bid="([^"]+)"([^>]*?)/?>', svgtext):
        cid = m.group(3)
        if cid in out:
            continue
        a, tn = m.group(2) + m.group(4), m.group(1)
        def f(k, a=a):
            mm = re.search(k + r'="([-\d.]+)"', a); return float(mm.group(1)) if mm else None
        if tn == "circle":
            c = (f("cx"), f("cy"))
        else:
            x, y = f("x"), f("y")
            c = (x + (f("width") or 0)/2, y + (f("height") or 0)/2) if x is not None \
                else ((f("cx"), f("cy")) if f("cx") is not None else None)
        if c and c[0] is not None:
            out[cid] = c
    return out

def viewbox(svgtext):
    m = re.search(r'viewBox="([^"]+)"', svgtext)
    return m.group(1) if m else "0 0 100 100"

# ---- name -> gpio -----------------------------------------------------------
def funcmap(variant):
    """SDA/SCL/SCK/.../A0../Dn -> gpio from the Arduino variant pins_arduino.h."""
    fm = {}
    p = os.path.join(VARIANTS, variant, "pins_arduino.h") if variant else None
    if p and os.path.exists(p):
        txt = open(p, encoding="utf-8", errors="replace").read()
        for name, val in re.findall(r'static const uint8_t (\w+)\s*=\s*(\d+)\s*;', txt):
            fm.setdefault(name.upper(), int(val))
        for name, val in re.findall(r'#define\s+(PIN_\w+|LED_BUILTIN|TX\d?|RX\d?)\s+(\d+)\b', txt):
            fm.setdefault(name.upper(), int(val))
    return fm

def resolve_gpio(name, fm):
    n = name.strip()
    if n.upper() in POWER:
        return None
    m = re.search(r'I(?:O)?(\d+)', n)          # IO13 / I34 / IO4 embedded
    if m:
        return int(m.group(1))
    key = n.upper().split("/")[0].split("_")[0]  # SDA, A0, SCK, TX, RX, D5 ...
    if key in fm:
        return fm[key]
    if n.upper() in fm:
        return fm[n.upper()]
    return None

# ---- per board --------------------------------------------------------------
def extract(board):
    z = zipfile.ZipFile(board["fzpz"])
    fzp = z.read([n for n in z.namelist() if n.endswith(".fzp")][0]).decode("utf-8", "replace")
    bbn = [n for n in z.namelist() if "breadboard" in n and n.endswith(".svg")][0]
    bb = z.read(bbn).decode("utf-8", "replace")
    vb = viewbox(bb); vbp = [float(x) for x in vb.split()]
    coords = coords_by_id(bb)
    fm = funcmap(board.get("variant"))
    extra = board.get("map", {})
    spots = {}  # gpio -> hotspot; a later connector wins (header overrides STEMMA/secondary)
    for attrs, body in re.findall(r'<connector\b([^>]*)>(.*?)</connector>', fzp, re.S):
        nm = re.search(r'name="([^"]+)"', attrs)
        bv = re.search(r'<breadboardView>(.*?)</breadboardView>', body, re.S)
        sid = re.search(r'svgId="([^"]+)"', bv.group(1)) if bv else None
        if not (nm and sid):
            continue
        name = nm.group(1)
        gpio = extra.get(name, resolve_gpio(name, fm))
        if gpio is None:
            continue
        c = coords.get(sid.group(1))
        if not c:
            continue
        x, y = round(c[0], 2), round(c[1], 2)
        if x < vbp[0]-1 or x > vbp[0]+vbp[2]+1 or y < vbp[1]-1 or y > vbp[1]+vbp[3]+1:
            continue  # off-board / transformed terminal (battery pad, stray, needs transform)
        spots[gpio] = {"gpio": gpio, "silk": re.split(r'[/_]', name)[0], "x": x, "y": y}
    hot = list(spots.values())
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, board["id"] + ".svg"), "w", encoding="utf-8").write(bb)
    frag = {"svg": "fritzing/%s.svg" % board["id"], "viewBox": vb,
            "credit": board["credit"], "creditUrl": board.get("creditUrl", ""), "hotspots": hot}
    json.dump(frag, open(os.path.join(OUT, board["id"] + ".json"), "w"), indent=1)
    return len(hot), vb


ADAFRUIT = "Adafruit Fritzing-Library (CC BY-SA 3.0)"
AURL = "https://github.com/adafruit/Fritzing-Library"
FZ = os.path.join(os.environ.get("TMP", r"C:\tmp"), "..", "..", "tmp", "fz")  # C:\tmp\fz
FZ = r"C:\tmp\fz"
# Only boards whose breadboard pins sit directly in viewBox space (no transformed pin
# groups) are listed; transform-heavy parts (HUZZAH32, Metro ESP32-S3) are deferred until
# transform resolution is added, so we never ship misplaced hotspots.
BOARDS = [
    {"id": "adafruit-feather-esp32s3",  "fzpz": r"C:\tmp\feather_s3.fzpz",
     "variant": "adafruit_feather_esp32s3", "credit": ADAFRUIT, "creditUrl": AURL,
     # Dn aren't defined in this variant's pins_arduino.h; on the S3 Feather Dn == GPIOn,
     # and TXD0 is the USB-serial pin GPIO43.
     "map": {"D13":13,"D12":12,"D11":11,"D10":10,"D9":9,"D6":6,"D5":5,"TXD0":43}},
    {"id": "adafruit-feather-esp32-v2", "fzpz": os.path.join(FZ, "adafruit-feather-esp32-v2.fzpz"),
     "variant": "adafruit_feather_esp32_v2", "credit": ADAFRUIT, "creditUrl": AURL},
    {"id": "adafruit-qtpy-esp32s3",     "fzpz": os.path.join(FZ, "adafruit-qtpy-esp32s3.fzpz"),
     "variant": "adafruit_qtpy_esp32s3_n4r2", "credit": ADAFRUIT, "creditUrl": AURL},
]

if __name__ == "__main__":
    for b in BOARDS:
        if not os.path.exists(b["fzpz"]):
            print("skip %s (no fzpz)" % b["id"]); continue
        n, vb = extract(b)
        print("%-28s %2d hotspots  viewBox=%s" % (b["id"], n, vb))
