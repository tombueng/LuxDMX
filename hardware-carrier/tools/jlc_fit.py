#!/usr/bin/env python3
"""Fit JLCPCB's own footprint of a part onto the board's footprint, for the CPL.

JLCPCB places the footprint from their library (EasyEDA), not ours. Its origin and its
zero rotation are their own: their EC11 has the pin rows across where KiCad has them up and
down, their SOIC is a quarter turn off KiCad's, their MF-R500 has the leads already staggered
2 mm. Guessing a correction per footprint went wrong part by part in their viewer, so this
reads their footprint and works it out:

    every pad of theirs is paired with a pad of ours with the same number (pads whose number
    we don't have, like the encoder's switch and mounting pins, pair with any pad of ours
    whose number they don't have), every pairing is tried, and the one that lines up best
    gives the rotation and where their origin lands on our board.

The footprints are fetched once per LCSC number from EasyEDA's part API and cached in
tools/jlc-footprints/ (not in git, it's their data). Without the cache and without network
gen_bom.py falls back to the plain centre-and-KiCad-rotation placement and says so.

Bottom side: JLCPCB shows a bottom part mirrored, the way you see it through the board.
Their footprint is mirrored left to right before fitting, and the rotation is written in
the sense KiCad uses for bottom parts (the opposite sense), which is what put the pixel
buffer the right way round in their viewer.
"""
import itertools
import json
import math
import os
import time
import urllib.request

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "jlc-footprints")
URL = "https://easyeda.com/api/products/{}/components?version=6.4.19.5"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/124.0 Safari/537.36",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Referer": "https://easyeda.com/editor",
    "X-Requested-With": "XMLHttpRequest",
}
EASYEDA_UNIT = 0.254          # their coordinates are in 10 mil
SNAP_DEG = 2.0                # closer than this to a quarter turn counts as the quarter turn


def jlc_pads(lcsc):
    """Their pads for an LCSC number: [(number, x, y, through_hole)] in mm, Y up, relative to
    their origin. None if the footprint can't be had."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, lcsc + ".json")
    if not os.path.exists(path):
        try:
            req = urllib.request.Request(URL.format(lcsc), headers=HEADERS)
            raw = urllib.request.urlopen(req, timeout=30).read()
            json.loads(raw)["result"]["packageDetail"]
        except Exception:
            return None
        open(path, "wb").write(raw)
        time.sleep(2)                       # they throttle quick successive requests
    try:
        ds = json.load(open(path))["result"]["packageDetail"]["dataStr"]
    except Exception:
        return None
    ox, oy = float(ds["head"]["x"]), float(ds["head"]["y"])
    pads = []
    for s in ds["shape"]:
        if not s.startswith("PAD~"):
            continue
        f = s.split("~")
        hole = float(f[9]) if f[9] else 0.0
        pads.append((f[8], (float(f[2]) - ox) * EASYEDA_UNIT,
                     -(float(f[3]) - oy) * EASYEDA_UNIT, hole > 0))
    return pads or None


def _procrustes(a, b):
    """Rotation (deg, CCW) and translation taking points a onto b, plus the RMS error."""
    n = len(a)
    ax, ay = sum(p[0] for p in a) / n, sum(p[1] for p in a) / n
    bx, by = sum(p[0] for p in b) / n, sum(p[1] for p in b) / n
    s = c = 0.0
    for (x1, y1), (x2, y2) in zip(a, b):
        x1, y1, x2, y2 = x1 - ax, y1 - ay, x2 - bx, y2 - by
        c += x1 * x2 + y1 * y2
        s += x1 * y2 - y1 * x2
    return math.degrees(math.atan2(s, c)), (ax, ay), (bx, by)


def _place(a, b, deg, ac, bc):
    """Where a's origin lands with rotation deg, and the RMS of the fit."""
    r = math.radians(deg)
    cs, sn = math.cos(r), math.sin(r)
    tx = bc[0] - (ac[0] * cs - ac[1] * sn)
    ty = bc[1] - (ac[0] * sn + ac[1] * cs)
    err = 0.0
    for (x1, y1), (x2, y2) in zip(a, b):
        err += (x1 * cs - y1 * sn + tx - x2) ** 2 + (x1 * sn + y1 * cs + ty - y2) ** 2
    return tx, ty, math.sqrt(err / len(a))


def fit(theirs, ours, bottom):
    """theirs: jlc_pads(); ours: [(number, x, y, through_hole)] in board mm, Y up.
    Returns (x, y, rotation, rms) for the CPL, or None if nothing pairs up."""
    tht = any(p[3] for p in theirs)
    if tht:
        # a through-hole part sits in holes; our SMD pads (the polyfuse's solder bridge)
        # are not where its leads go
        theirs = [p for p in theirs if p[3]]
        ours = [p for p in ours if p[3]]
    if bottom:
        theirs = [(n, -x, y, h) for n, x, y, h in theirs]
    their_nums = {p[0] for p in theirs}
    # By number: their pad pairs with ours of the same number; one we don't have pairs with
    # any of ours they don't have (the encoder's switch and mounting pins).
    by_number = []
    for n, x, y, h in theirs:
        same = [p for p in ours if p[0] == n]
        by_number.append(same or [p for p in ours if p[0] not in their_nums])
    tries = [by_number] if all(by_number) else []
    # By position alone, for small parts whose numbers mean different things on the two
    # sides (a tact switch is 1,1,2,2 here and 1-4 there).
    if len(theirs) <= 5 and len(ours) == len(theirs):
        tries.append([ours] * len(theirs))
    best = None
    for cands in tries:
        for combo in itertools.islice(itertools.product(*cands), 20000):
            if len({id(p) for p in combo}) < len(combo):
                continue
            a = [(x, y) for _, x, y, _ in theirs]
            b = [(p[1], p[2]) for p in combo]
            deg, ac, bc = _procrustes(a, b)
            q = round(deg / 90) * 90
            if abs(deg - q) < SNAP_DEG:
                deg = q
            tx, ty, rms = _place(a, b, deg, ac, bc)
            if best is None or rms < best[3] - 1e-9:
                best = (tx, ty, deg, rms)
    if best is None:
        return None
    tx, ty, deg, rms = best
    if bottom:
        deg = -deg
    return tx, ty, round(deg, 1) % 360, rms
