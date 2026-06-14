#!/usr/bin/env python3
"""Render docs/display-preview.png from the firmware's own display layout.

This re-implements the layout math in src/main.cpp's dispDrawStatus() /
dispDrawBanner() and draws it with the *real* Adafruit GFX 5x7 "classic" font
(parsed straight from the GFX library's glcdfont.c), so the preview matches what
the panels actually show. Re-run after changing the on-device layout:

    python docs/make_display_preview.py

Panels rendered (mirrors the physical hardware we support):
  - 0.96" / 1.3" SSD1306 / SH1106  128x64 mono  (status + conflict/identify/manual)
  - the same 128x64 in blue and yellow/blue-split emitter colours, + 0.91" 128x32
  - 1.5" SSD1351 128x128 full colour (status + the three alert banners)

No em dashes in captions by request; uses plain hyphens.
"""

import os
import re
import glob
from PIL import Image, ImageDraw, ImageFont

# --- representative live state shown on the panels --------------------------
VERSION = "1.0.42"
IP      = "10.13.37.2"
RSSI    = -47
FPS     = 40.0           # single-output aggregate rate
SOURCES = 1
# Two outputs enabled -> the universe label becomes "0+5" and the display shows a
# frame rate per universe. With a single output it reads "0" + one FPS value.
UNI0, UNI1 = 0, 5
FPS_A, FPS_B = 44.0, 43.8
TWO_OUTPUTS = True
PROTO = "Both"            # Art-Net / sACN / Both

SCALE = 3                 # native panel pixel -> screen pixels (nearest-neighbour)

# --- palette (RGB888), mirroring main.cpp's RGB565 constants ----------------
WHITE = (255, 255, 255)
GREEN = (0,   255, 0)
AMBER = (255, 176, 0)
RED   = (255, 0,   0)
BLUE  = (48,  150, 255)
GREY  = (130, 130, 130)
BLACK = (0,   0,   0)

# emitter colours for the mono variants
MONO_WHITE = (235, 235, 235)
MONO_BLUE  = (60,  170, 255)
SPLIT_YELLOW = (255, 213, 0)
SPLIT_BLUE   = (60,  170, 255)


# --- the real Adafruit GFX classic font (5x7 in a 6x8 cell) -----------------
def load_glcdfont():
    cands = glob.glob(os.path.join(
        os.path.dirname(__file__), "..", ".pio", "libdeps", "*",
        "Adafruit GFX Library", "glcdfont.c"))
    if not cands:
        raise SystemExit("glcdfont.c not found under .pio/libdeps - build once first")
    txt = open(cands[0], "r", encoding="utf-8", errors="ignore").read()
    bytes_ = [int(h, 16) for h in re.findall(r"0[xX][0-9a-fA-F]{1,2}", txt)]
    if len(bytes_) < 256 * 5:
        raise SystemExit("glcdfont.c parse: expected >=1280 bytes, got %d" % len(bytes_))
    return bytes_[:256 * 5]

FONT = load_glcdfont()


class Panel:
    """A tiny Adafruit_GFX work-alike over a native-resolution PIL canvas."""

    def __init__(self, w, h, color_mode):
        self.w, self.h = w, h
        self.color_mode = color_mode          # True = SSD1351 (real colour)
        self.img = Image.new("RGB", (w, h), BLACK)
        self.px = self.img.load()
        self.cx = self.cy = 0
        self.ts = 1
        self.fg = WHITE

    # col(): mono panels collapse any non-black colour to "on" (white-ish);
    # the colour panel keeps the real colour. Mirrors main.cpp col().
    def _col(self, rgb):
        if self.color_mode:
            return rgb
        return MONO_WHITE if rgb != BLACK else BLACK

    def fill_screen(self, rgb=BLACK):
        self.img.paste(self._col(rgb) if rgb != BLACK else BLACK, [0, 0, self.w, self.h])
        self.px = self.img.load()

    def set_text_size(self, ts):  self.ts = ts
    def set_text_color(self, rgb): self.fg = rgb
    def set_cursor(self, x, y):   self.cx, self.cy = x, y

    def _plot(self, x, y, rgb):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[x, y] = rgb

    def draw_fast_hline(self, x, y, length, rgb):
        c = self._col(rgb)
        for i in range(length):
            self._plot(x + i, y, c)

    def _draw_char(self, x, y, ch, rgb):
        c = self._col(rgb)
        if c == BLACK:
            return
        o = ord(ch) * 5
        for i in range(5):                     # 5 columns + 1 blank spacer
            line = FONT[o + i]
            for j in range(8):                 # bit j = row j from top (LSB top)
                if (line >> j) & 1:
                    if self.ts == 1:
                        self._plot(x + i, y + j, c)
                    else:
                        for dx in range(self.ts):
                            for dy in range(self.ts):
                                self._plot(x + i * self.ts + dx, y + j * self.ts + dy, c)

    def print(self, s):
        s = str(s)
        for ch in s:
            self._draw_char(self.cx, self.cy, ch, self.fg)
            self.cx += 6 * self.ts


def universe_label():
    if TWO_OUTPUTS:
        return "%d+%d" % (UNI0, UNI1)
    return "%d" % UNI0


# --- ports of the firmware layout (src/main.cpp) ----------------------------
def print_right(p, s, y):
    p.set_cursor(p.w - len(s) * 6, y); p.print(s)


def draw_status(p):
    W, H = p.w, p.h
    live = True
    up = True
    dual = TWO_OUTPUTS                         # show a frame rate per universe
    accent = GREEN if live else AMBER          # up == True here
    p.fill_screen(BLACK)
    p.set_text_size(1)

    if H <= 32:                                # compact 3-row strip (128x32)
        p.set_text_color(WHITE); p.set_cursor(0, 0);   p.print(IP)
        p.set_text_color(accent); p.set_cursor(W - 24, 0); p.print("LIVE")
        p.set_text_color(WHITE); p.set_cursor(0, 11)
        p.print("U"); p.print(universe_label()); p.print(" "); p.print(PROTO)
        if dual:
            p.set_cursor(0, 22)
            p.print("%.1f/%.1f Sources %u" % (FPS_A, FPS_B, SOURCES))
        else:
            p.set_cursor(0, 22); p.print("%.1ffps Sources %u" % (FPS, SOURCES))
        return

    if H >= 96:                                # tall colour panel (128x128)
        p.set_text_size(2); p.set_text_color(accent)
        p.set_cursor(0, 0);  p.print("LumiGate")
        p.set_text_size(1); p.set_text_color(GREY)
        p.set_cursor(0, 18); p.print("v"); p.print(VERSION)
        p.set_text_color(WHITE); p.set_cursor(0, 30); p.print(IP)
        p.draw_fast_hline(0, 42, W, GREY)
        if dual:
            p.set_text_color(WHITE); p.set_cursor(0, 50); p.print("A Uni %d" % UNI0)
            p.set_text_color(accent); p.set_cursor(0, 62); p.print("%.1f fps" % FPS_A)
            p.set_text_color(WHITE); p.set_cursor(0, 78); p.print("B Uni %d" % UNI1)
            p.set_text_color(accent); p.set_cursor(0, 90); p.print("%.1f fps" % FPS_B)
            p.set_text_color(GREY); p.set_cursor(0, 102)
            p.print(PROTO); p.print("  Sources "); p.print(SOURCES)
        else:
            p.set_text_color(GREY); p.set_cursor(0, 48); p.print("FPS")
            p.set_text_size(3); p.set_text_color(accent)
            p.set_cursor(0, 58); p.print("%.1f" % FPS)
            p.set_text_size(1); p.set_text_color(WHITE)
            p.set_cursor(0, 88);  p.print("Uni "); p.print(universe_label())
            p.print("  "); p.print(PROTO)
            p.set_cursor(0, 100); p.print("Sources "); p.print(SOURCES)
        p.set_cursor(0, 114); p.set_text_color(WHITE); p.print("WiFi %ddBm" % RSSI)
        p.set_text_color(accent); print_right(p, "LIVE", 114)
        return

    # Full layout (128x64)
    rp = (H - 8) // 5
    if rp > 20:
        rp = 20
    y = 0
    p.set_text_color(accent); p.set_cursor(0, y); p.print("LumiGate")
    p.set_text_color(GREY); p.set_cursor(W - len(VERSION) * 6, y); p.print(VERSION)
    y += rp
    p.set_text_color(WHITE); p.set_cursor(0, y); p.print(IP)
    y += rp
    if dual:
        p.set_cursor(0, y); p.print("A U%d %.1ffps" % (UNI0, FPS_A))
        y += rp
        p.set_cursor(0, y); p.print("B U%d %.1ffps" % (UNI1, FPS_B))
        print_right(p, "Src %u" % SOURCES, y)
        y += rp
    else:
        p.set_cursor(0, y); p.print("Uni "); p.print(universe_label())
        p.print("  "); p.print(PROTO)
        y += rp
        p.set_cursor(0, y); p.print("FPS %.1f  Sources %u" % (FPS, SOURCES))
        y += rp
    p.set_cursor(0, y); p.print("WiFi %ddBm" % RSSI)
    p.set_text_color(accent)
    p.set_cursor(W - 4 * 6, y); p.print("LIVE")


def draw_center(p, s, ts, y):
    w = len(s) * 6 * ts
    x = (p.w - w) // 2
    if x < 0:
        x = 0
    p.set_text_size(ts); p.set_cursor(x, y); p.print(s)


def draw_banner(p, l1, l2, accent):
    H = p.h
    ts = 2 if H >= 64 else 1
    p.fill_screen(BLACK)
    p.set_text_color(accent)
    draw_center(p, l1, ts, (H // 2 - 8 * ts) if H >= 64 else 0)
    p.set_text_color(WHITE)
    draw_center(p, l2, 1, (H // 2 + 4) if H >= 64 else 16)


# --- mono recolouring (the physical emitter colour) -------------------------
def recolour(img, mode):
    out = Image.new("RGB", img.size, BLACK)
    src, dst = img.load(), out.load()
    for y in range(img.height):
        for x in range(img.width):
            if src[x, y] == BLACK:
                continue
            if mode == "white":
                dst[x, y] = MONO_WHITE
            elif mode == "blue":
                dst[x, y] = MONO_BLUE
            elif mode == "split":            # top 16 native rows yellow, rest blue
                dst[x, y] = SPLIT_YELLOW if y < 16 else SPLIT_BLUE
    return out


def mono_panel(w, h, render, mode):
    p = Panel(w, h, color_mode=False)
    render(p)
    return recolour(p.img, mode)


def colour_panel(w, h, render):
    p = Panel(w, h, color_mode=True)
    render(p)
    return p.img


def up(img):
    return img.resize((img.width * SCALE, img.height * SCALE), Image.NEAREST)


# --- composite --------------------------------------------------------------
BG = (21, 23, 28)
FRAME = (70, 74, 82)

def main():
    cap_font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 17)
    sub_font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 13)

    # build the panels
    statusf  = draw_status
    conflict = lambda p: draw_banner(p, "CONFLICT", "2+ sources", RED)
    identify = lambda p: draw_banner(p, "IDENTIFY", "ch 12", AMBER)
    manual   = lambda p: draw_banner(p, "MANUAL", "override", BLUE)

    rowA = [  # 128x64 mono white: status + 3 banners
        (up(mono_panel(128, 64, statusf,  "white")), "status"),
        (up(mono_panel(128, 64, conflict, "white")), "CONFLICT alert"),
        (up(mono_panel(128, 64, identify, "white")), "IDENTIFY alert"),
        (up(mono_panel(128, 64, manual,   "white")), "MANUAL alert"),
    ]
    rowB = [  # other emitter colours + the compact strip
        (up(mono_panel(128, 64, statusf, "blue")),  "blue panel"),
        (up(mono_panel(128, 64, statusf, "split")), "yellow/blue split (title in yellow band)"),
        (up(mono_panel(128, 32, statusf, "white")), '0.91" 128x32 (compact)'),
    ]
    rowC = [  # 128x128 full colour: status + 3 banners
        (up(colour_panel(128, 128, statusf)),  "status (green=live)"),
        (up(colour_panel(128, 128, conflict)), "CONFLICT (red)"),
        (up(colour_panel(128, 128, identify)), "IDENTIFY (amber)"),
        (up(colour_panel(128, 128, manual)),   "MANUAL (blue)"),
    ]

    titleA = '0.96" SSD1306 / SH1106  -  128x64 monochrome (white)'
    titleB = "Same panel, other emitter colours  (colour is physical, not addressable)"
    titleC = '1.5" SSD1351  -  128x128 full colour  (mirrors the RGB status LED)'

    MARGIN, GAP, SUBH, TITLEH, GROUPGAP = 20, 24, 22, 30, 18

    # canvas width from the widest row
    def row_w(row):
        return sum(im.width for im, _ in row) + GAP * (len(row) - 1)
    width = MARGIN * 2 + max(row_w(rowA), row_w(rowB), row_w(rowC))

    # height: title + panels + subcaption per group
    def group_h(row):
        return TITLEH + max(im.height for im, _ in row) + SUBH
    height = MARGIN * 2 + group_h(rowA) + group_h(rowB) + group_h(rowC) + GROUPGAP * 2

    canvas = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(canvas)

    def place(row, title, y):
        d.text((MARGIN, y), title, font=cap_font, fill=(205, 210, 218))
        y += TITLEH
        x = MARGIN
        ph = max(im.height for im, _ in row)
        for im, sub in row:
            canvas.paste(im, (x, y))
            d.rectangle([x, y, x + im.width - 1, y + im.height - 1], outline=FRAME)
            d.text((x, y + ph + 4), sub, font=sub_font, fill=(150, 155, 162))
            x += im.width + GAP
        return y + ph + SUBH

    y = MARGIN
    y = place(rowA, titleA, y) + GROUPGAP
    y = place(rowB, titleB, y) + GROUPGAP
    y = place(rowC, titleC, y)

    out = os.path.join(os.path.dirname(__file__), "display-preview.png")
    canvas.save(out)
    print("wrote", out, canvas.size)


if __name__ == "__main__":
    main()
