#!/usr/bin/env python3
"""Route the supply rails as real wide tracks, sized so the number means something.

A pour is not a conductor of a known width. The current crowds along the shortest path and
most of the copper carries almost nothing, so measuring the narrowest cross-section of a pour
flatters it badly. A track's width IS its cross-section, and IPC-2221 applies to it directly.

So the rails go down as tracks, locked, before the router sees the board:

    IPC-2221, outer layer, 20 K rise, 1 oz
    5.0 mm -> 10.6 A     7.0 mm -> 13.2 A     4.8 mm -> 10.0 A

Every branch gets the full width, not a taper, because any one pixel output has to be able to
take the whole current on its own. The bulk cap and the buck are the exceptions: the cap sees
ripple rather than load current and the buck draws about an amp, so those spurs are thin.

Nothing here is guessed. Each run is measured against the pads of other nets first, every
0.5 mm along it, and laid at the widest that actually fits. Where the wanted width does not
fit, it says so and lays what does.

Clearing the old runs and laying the new ones happen in separate processes: doing both to one
board in one pcbnew takes it down with SIGSEGV, the same trap as everywhere else in this
toolchain. One board per process, one kind of mutation each.

Run before autoroute:  python tools/power_tree.py [--width 7.0] [--min 5.0] [--remove]
"""
import math
import os
import re
import subprocess
import sys

import pcbnew

CLEAR = 0.30
SPUR = 2.0              # cap and buck: ripple and about an amp, not load current
MARK = 3.0              # anything at least this wide is ours, for a clean re-run


def _project_dir():
    d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "luxdmx-carrier.kicad_pcb")):
            return d
        d = os.path.dirname(d)
    return os.path.dirname(os.path.abspath(__file__))


BOARD = os.path.join(_project_dir(), "luxdmx-carrier.kicad_pcb")


def amps(mm, dT=20, oz=1):
    a = mm / 0.0254 * 1.37 * oz
    return 0.048 * dT ** 0.44 * a ** 0.725


def pads_of(b):
    """Every pad as its true axis-aligned box, not a circle round its diagonal.

    Treating a pad as a circle of its half-diagonal is fine for a square one and badly wrong
    for a long thin one: a 2.0 x 6.15 DATA pad looks 3.2 mm across in every direction that
    way, and it is 1.0. That alone reported a 3.1 mm entry where 4.8 fits.
    """
    out = []
    for f in b.GetFootprints():
        for p in f.Pads():
            bb = p.GetBoundingBox()
            out.append((p.GetNetname(), pcbnew.ToMM(bb.GetLeft()), pcbnew.ToMM(bb.GetRight()),
                        pcbnew.ToMM(bb.GetTop()), pcbnew.ToMM(bb.GetBottom())))
    return out


def span(pads, edge, net, a0, a1, c, horizontal):
    """Widest band of `net` centred on c along the run, clear of other nets' pads."""
    lo, hi = edge[0], edge[1]
    n = max(int(abs(a1 - a0) / 0.5), 1)
    w = 99.0
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        l, h = lo, hi
        for nm, x0, x1, y0, y1 in pads:
            if nm == net:
                continue
            if horizontal:
                a_lo, a_hi, c_lo, c_hi = x0, x1, y0, y1
            else:
                a_lo, a_hi, c_lo, c_hi = y0, y1, x0, x1
            if a < a_lo - CLEAR or a > a_hi + CLEAR:
                continue                       # the run does not pass this pad at all
            if c_hi + CLEAR <= c:
                l = max(l, c_hi + CLEAR)
            elif c_lo - CLEAR >= c:
                h = min(h, c_lo - CLEAR)
            else:
                l, h = c, c                    # the run goes straight through it
        w = min(w, 2 * min(c - l, h - c))
    return max(w, 0.0)


def best_line(pads, edge, net, a0, a1, c_lo, c_hi, want):
    """Where to put a run: the line across [c_lo, c_hi] with the most room."""
    best = (0.0, (c_lo + c_hi) / 2)
    c = c_lo
    while c <= c_hi:
        w = span(pads, edge, net, a0, a1, c, True)
        if w > best[0]:
            best = (w, c)
        if w >= want:
            break
        c += 0.25
    return best


def stage_clear():
    b = pcbnew.LoadBoard(BOARD)
    gone = 0
    for t in list(b.GetTracks()):
        if t.GetClass() != "PCB_TRACK" or not t.IsLocked():
            continue
        w = pcbnew.ToMM(t.GetWidth())
        # ours, or a leftover stub from finish_stubs.py. Those hung off the supply pours to
        # reach the fuse; with the rails as tracks there is no pour to catch them and they
        # are just floating copper that DRC counts as unconnected.
        if w >= MARK or (t.GetNetname() in ("V_PIX", "V_PIX_IN") and w < MARK):
            b.Remove(t)
            gone += 1
    pcbnew.SaveBoard(BOARD, b)
    print(f"\n@@RESULT {gone}", flush=True)


def stage_lay(want, floor):
    b = pcbnew.LoadBoard(BOARD)
    pads = pads_of(b)
    e = [s for s in b.GetDrawings() if s.GetLayer() == pcbnew.Edge_Cuts]
    ex = [pcbnew.ToMM(v) for s in e for v in (s.GetStart().x, s.GetEnd().x)]
    ey = [pcbnew.ToMM(v) for s in e for v in (s.GetStart().y, s.GetEnd().y)]
    edge_y = (min(ey) + 0.5, max(ey) - 0.5)

    def by_net(net):
        return [((x0 + x1) / 2, (y0 + y1) / 2)
                for n, x0, x1, y0, y1 in pads if n == net]

    vin, vp = by_net("V_PIX_IN"), by_net("V_PIX")
    if not vin or not vp:
        sys.exit("Versorgungsnetze nicht gefunden")

    # the pixel outputs are the row of V_PIX pads furthest from the fuse, all at one y
    ymax = max(y for _x, y in vp)
    row = sorted((x, y) for x, y in vp if abs(y - ymax) < 1.0)
    if len(row) < 2:
        sys.exit("Pixel-Reihe nicht erkannt")
    rx0, rx1 = row[0][0], row[-1][0]

    laid, segs, obst = [], [], {}

    # V_PIX goes on the BACK. The whole tree sat on the front and walled off the route from
    # the ESP32 to the right-hand headers, which is why ENC_SW and PIX5_5V would not route and
    # why the router went from 16 s to 87 s. Every load on it is through-hole, so the layer
    # costs nothing. V_PIX_IN stays on the front, it is short and out of the way on the left.
    LAYER = {"V_PIX": pcbnew.B_Cu, "V_PIX_IN": pcbnew.F_Cu, "GND": pcbnew.F_Cu}

    def lay(net, x0, y0, x1, y1, w, what):
        t = pcbnew.PCB_TRACK(b)
        t.SetStart(pcbnew.VECTOR2I(pcbnew.FromMM(x0), pcbnew.FromMM(y0)))
        t.SetEnd(pcbnew.VECTOR2I(pcbnew.FromMM(x1), pcbnew.FromMM(y1)))
        t.SetWidth(pcbnew.FromMM(w))
        t.SetLayer(LAYER.get(net, pcbnew.F_Cu))
        t.SetNet(b.FindNet(net))
        t.SetLocked(True)
        b.Add(t)
        laid.append((what, w))
        segs.append((net, x0, y0, x1, y1, w))
        # Every run laid becomes an obstacle for the next one ON ITS OWN LAYER. span() only
        # ever looked at pads, so a later branch measured straight through an earlier one and
        # the GND escape at x=99 came down on top of the V_PIX_IN trunk. Per layer, because
        # the first fix threw them all in with the pads and then the supply bus, which is on
        # the back, blocked all six escapes on the front.
        obst.setdefault(LAYER.get(net, pcbnew.F_Cu), []).append(
            (net, min(x0, x1) - w / 2, max(x0, x1) + w / 2,
             min(y0, y1) - w / 2, max(y0, y1) + w / 2))
        print(f"  {what:28s} {w:4.1f} mm  = {amps(w):5.1f} A")

    # the bus along the pixel row, the piece every output hangs off
    got, ybus = best_line(pads, edge_y, "V_PIX", rx0, rx1, ymax - 12.0, ymax - 4.0, want)
    wbus = min(want, math.floor(got * 10) / 10)
    if wbus < floor:
        print(f"  Bus laengs der Pixelreihe: nur {got:.1f} mm frei, unter dem Minimum "
              f"{floor:.1f} - Reihe ist zu dicht an ihren Nachbarn")
    else:
        lay("V_PIX", rx0, ybus, rx1, ybus, wbus, "Bus an der Pixelreihe")
        for x, y in row:
            wst = min(wbus, span(pads, (min(ex) + 0.5, max(ex) - 0.5), "V_PIX",
                                 ybus, y, x, False))
            wst = math.floor(wst * 10) / 10
            if wst >= 1.0:
                lay("V_PIX", x, ybus, x, y, min(wst, wbus), f"Stich zu x={x:.0f}")

    # A return for the pixel row, laid rather than left to the pour.
    #
    # The pour was the return path and it is not a reliable one: the router walls the row in,
    # and on one build Pixel1's GND pad ended up on a 17 mm2 pocket of fill with no way out on
    # either layer - the maze router could not get a 0.4 mm track out of it, let alone the
    # 1.5 mm the class asks for. That is the return of an output whose V+ is sized for 10 A.
    #
    # It goes BELOW the row, between the pads and the board edge, not above it. Above is where
    # the data lines come down from the buffer, and a spine across them would have to be
    # crossed by every one of them. Below there is about 1.4 mm of board left, so this is not
    # a 10 A path on its own; it is a guaranteed one, and the pour still adds what it can on
    # top of it.
    # trunk: inlet -> fuse in, fuse out -> bus. Two axis-aligned legs each, every leg
    # measured on its own, because a corner is where the room usually runs out.
    def leg(net, x0, y0, x1, y1, what, floor_w=1.0, cap=None):
        if abs(x1 - x0) < 0.01:
            w = span(pads, (min(ex) + 0.5, max(ex) - 0.5), net, y0, y1, x0, False)
        else:
            w = span(pads, edge_y, net, x0, x1, y0, True)
        w = min(cap or want, math.floor(w * 10) / 10)
        if w >= floor_w:
            lay(net, x0, y0, x1, y1, w, what)
        else:
            print(f"  {what:28s} kein Platz ({w:.1f} mm)")

    # The polyfuse and the blade holder are alternatives, so whichever is fitted carries
    # everything: both need the full width, not just whichever one the trunk happened to
    # reach first.
    src = max(vin, key=lambda p: p[1])          # the inlet, lowest down
    fuse_in = sorted((p for p in vin if p is not src), key=lambda p: p[1])
    seen = []
    for fin in fuse_in:
        if any(abs(fin[1] - s) < 2.0 for s in seen):
            continue                            # one leg per fuse, not per pad
        seen.append(fin[1])
        leg("V_PIX_IN", src[0], src[1], src[0], fin[1], f"Stamm -> Sicherung y={fin[1]:.0f}")
        leg("V_PIX_IN", src[0], fin[1], fin[0], fin[1], f"Stamm quer y={fin[1]:.0f}")

    if wbus >= floor:
        # One full-width feed from the output of EVERY fuse, and a fuse is any part with pads
        # on both rails - that is what a fuse is, the thing that bridges them, and it beats
        # naming references that change.
        #
        # This used to take the two widest candidates among all V_PIX pads above the row. Two,
        # because there are two fuse options fitted one at a time, and widest, because a fixed
        # choice once landed on a pad with 0.9 mm of room. It picked the 1000 uF and the blade
        # holder, and left the polyfuse to the router, which linked it to the bus with 1.0 mm.
        # Fit the 9 A polyfuse on the 10.2 mm pitch and the whole load goes through 3.2 A of
        # copper. Whichever fuse is fitted has to carry everything on its own.
        fuses = []
        for f in b.GetFootprints():
            nets = {p.GetNetname() for p in f.Pads()}
            if "V_PIX" in nets and "V_PIX_IN" in nets:
                out = [(pcbnew.ToMM(p.GetPosition().x), pcbnew.ToMM(p.GetPosition().y))
                       for p in f.Pads() if p.GetNetname() == "V_PIX"]
                if out:
                    fuses.append((f.GetReference(), out))
        # One run down to the bus, from whichever fuse output has the most room; the others
        # join THAT, not the bus. A second full-width run the length of the board is the
        # obvious way to give every fuse its own path and it is the expensive one: it lands
        # across the corridor PIX5_5V and DMX3_A need and costs two connections. The two fuse
        # outputs here sit 4.5 mm apart at the same x, so linking them is a stub, and current
        # out of either one still sees 5 mm the whole way.
        ranked = []
        for ref, out in fuses:
            best = max(((span(pads, (min(ex) + 0.5, max(ex) - 0.5), "V_PIX",
                              p[1], ybus, p[0], False), p) for p in out), key=lambda s: s[0])
            ranked.append((best[0], ref, best[1], out))
        ranked.sort(key=lambda t: -t[0])
        fed = []
        for w, ref, p, out in ranked:
            if not fed:
                if w < 1.0:
                    print(f"  {ref[:16]:16s} -> Bus       bestenfalls {w:.1f} mm, Ausgang "
                          f"steht zu dicht an fremden Pads")
                    continue
                leg("V_PIX", p[0], p[1], p[0], ybus, f"{ref[:14]} -> Bus")
                fed.append(p)
                continue
            # nearest pair between this fuse's outputs and anything already fed
            a, t = min((( (q[0] - r[0]) ** 2 + (q[1] - r[1]) ** 2, q, r)
                        for q in out for r in fed), key=lambda s: s[0])[1:]
            if abs(a[0] - t[0]) < 0.01 or abs(a[1] - t[1]) < 0.01:
                leg("V_PIX", a[0], a[1], t[0], t[1], f"{ref[:14]} -> Sicherung")
            else:
                leg("V_PIX", a[0], a[1], a[0], t[1], f"{ref[:12]} -> Sich. senkr.")
                leg("V_PIX", a[0], t[1], t[0], t[1], f"{ref[:12]} -> Sich. waagr.")
            fed.append(a)
        if not fuses:
            print("  keine Sicherung gefunden (kein Bauteil mit Pads auf beiden Schienen)")

    # A land can carry several holes for the same net - the polyfuse has two lead pitches,
    # 5.1 and 10.2 mm - and the trunk only ever reaches one of them. The rest hang off the
    # net unconnected unless they are tied together here.
    byfp = {}
    for f in b.GetFootprints():
        for p in f.Pads():
            # drilled holes only. The polyfuse land also carries two SMD pads 1.2 mm apart,
            # which are the solder-bridge option that replaces the fuse, not further holes of
            # the same lead. Bridging to those with 5 mm of copper shorted V_PIX to V_PIX_IN.
            # The router connects them at signal width, which is all a bypass option needs.
            if pcbnew.ToMM(p.GetDrillSizeX()) < 0.05:
                continue
            if p.GetNetname() in ("V_PIX", "V_PIX_IN"):
                q = p.GetPosition()
                byfp.setdefault((f.GetReference(), p.GetNetname()), []).append(
                    (pcbnew.ToMM(q.x), pcbnew.ToMM(q.y)))
    for (ref, net), pts in sorted(byfp.items()):
        if len(pts) < 2:
            continue
        pts = sorted(pts)
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            # As two axis-aligned legs, each measured on its own. A single wide diagonal
            # between holes 2 mm apart is a blob, and on a dual-pitch land the two nets
            # alternate along that line, so it shorted V_PIX to V_PIX_IN twice.
            if abs(by - ay) < 0.01 or abs(bx - ax) < 0.01:
                leg(net, ax, ay, bx, by, f"{ref[:12]} {net[-3:]} Bruecke", 0.5)
                continue
            # an L can be bent either way round, and on a crowded land one corner has room
            # where the other has 0.9 mm. Measure both, take the better.
            vx = span(pads, (min(ex) + 0.5, max(ex) - 0.5), net, ay, by, ax, False)
            hy = span(pads, edge_y, net, ax, bx, by, True)
            hy2 = span(pads, edge_y, net, ax, bx, ay, True)
            vx2 = span(pads, (min(ex) + 0.5, max(ex) - 0.5), net, ay, by, bx, False)
            if min(vx, hy) >= min(hy2, vx2):
                leg(net, ax, ay, ax, by, f"{ref[:12]} {net[-3:]} Bruecke senkr.", 0.5)
                leg(net, ax, by, bx, by, f"{ref[:12]} {net[-3:]} Bruecke waagr.", 0.5)
            else:
                leg(net, ax, ay, bx, ay, f"{ref[:12]} {net[-3:]} Bruecke waagr.", 0.5)
                leg(net, bx, ay, bx, by, f"{ref[:12]} {net[-3:]} Bruecke senkr.", 0.5)

    # Everything on the rail that the tree has not touched yet. The tree feeds the pixel row
    # and the fuse, because those carry the load current; the rest of the rail - the buck's
    # input, the bulk cap - was left to the router on the grounds that an amp needs no 5 mm.
    # It is left to a router that cannot get there: the finished tree is 5 mm of locked copper
    # lying across the back, and the buck sits on the far side of it, so V_PIX at the buck came
    # out unconnected on every single run. Whatever the tree walls off, the tree connects.
    #
    # Narrow on purpose, SPUR wide, and measured like every other leg. These are not load paths.
    def served(net, box):
        x0, x1, y0, y1 = box
        for n, ax, ay, bx, by, w in segs:
            if n != net:
                continue
            if (min(ax, bx) - w / 2 <= x1 and max(ax, bx) + w / 2 >= x0 and
                    min(ay, by) - w / 2 <= y1 and max(ay, by) + w / 2 >= y0):
                return True
        return False

    for net in ("V_PIX", "V_PIX_IN"):
        for f in b.GetFootprints():
            for p in f.Pads():
                if p.GetNetname() != net:
                    continue
                bb = p.GetBoundingBox()
                box = (pcbnew.ToMM(bb.GetLeft()), pcbnew.ToMM(bb.GetRight()),
                       pcbnew.ToMM(bb.GetTop()), pcbnew.ToMM(bb.GetBottom()))
                if served(net, box):
                    continue
                px, py = (box[0] + box[1]) / 2, (box[2] + box[3]) / 2
                # nearest point on any segment's centre line, and how far that is
                best = None
                for n, ax, ay, bx, by, _w in segs:
                    if n != net:
                        continue
                    dx, dy = bx - ax, by - ay
                    ln = dx * dx + dy * dy
                    t = 0.0 if ln < 1e-9 else \
                        max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / ln))
                    qx, qy = ax + t * dx, ay + t * dy
                    d = math.hypot(px - qx, py - qy)
                    if best is None or d < best[0]:
                        best = (d, qx, qy)
                if best is None:
                    continue
                _d, qx, qy = best
                what = f"{f.GetReference()[:14]} {net[-3:]} Anschluss"
                if abs(qx - px) < 0.2 or abs(qy - py) < 0.2:
                    leg(net, px, py, qx, qy, what, 0.5, SPUR)
                    continue
                # an L, bent whichever way has room, exactly as the bridges are
                vx = span(pads, (min(ex) + 0.5, max(ex) - 0.5), net, py, qy, px, False)
                hy = span(pads, edge_y, net, px, qx, qy, True)
                hy2 = span(pads, edge_y, net, px, qx, py, True)
                vx2 = span(pads, (min(ex) + 0.5, max(ex) - 0.5), net, py, qy, qx, False)
                # Both legs or neither. Laying whichever one fits leaves the other end of
                # the L hanging in mid air: the buck spur's vertical leg had no room, the
                # horizontal one went down anyway, and 2.8 mm of it ran out into nothing.
                # DRC calls that a dangling track and the gerber gate refuses the board over
                # it - rightly, it is copper that goes nowhere.
                one, two = min(vx, hy), min(hy2, vx2)
                if max(one, two) < 0.5:
                    print(f"  {what:28s} kein Platz ({max(one, two):.1f} mm), "
                          f"das legt der Router")
                elif one >= two:
                    leg(net, px, py, px, qy, what + " senkr.", 0.5, SPUR)
                    leg(net, px, qy, qx, qy, what + " waagr.", 0.5, SPUR)
                else:
                    leg(net, px, py, qx, py, what + " waagr.", 0.5, SPUR)
                    leg(net, qx, py, qx, qy, what + " senkr.", 0.5, SPUR)

    # There is no room for a spine BELOW the row: the terminal pads run to within 0.53 mm of
    # the board edge, which is the whole point of them - you lay the wire flat on the pad
    # instead of threading it through a hole. So each GND pad gets a way OUT instead, straight
    # up on the front, laid before the router so the corridor is spoken for. The supply bus is
    # on the back at the same height, so the two never meet.
    gp = sorted((x, y) for n, x0, x1, y0, y1 in pads if n == "GND"
                for x, y in [((x0 + x1) / 2, (y0 + y1) / 2)] if abs(y - ymax) < 1.0)
    if gp:
        top = min(y0 for n, _x0, _x1, y0, _y1 in pads if n == "GND"
                  and abs((y0 + _y1) / 2 - ymax) < 1.0)
        here = pads + obst.get(LAYER["GND"], [])
        for x, y in gp:
            up = ybus - 3.0 if wbus >= floor else top - 6.0
            w = span(here, (min(ex) + 0.5, max(ex) - 0.5), "GND", up, y, x, False)
            # As wide as the feed, not as wide as a spur. These were capped at SPUR, which is
            # the 2.0 mm the bulk cap and the buck get, and that was thoughtless: the return of
            # a pixel output carries exactly what its V+ carries. It made the ground the limit
            # of the whole rail, 5.3 A against 9.8 on the plus side, and it was not even a
            # geometric limit - measuring here says 6.8 mm fits.
            w = math.floor(min(w, want) * 10) / 10
            if w >= 0.5:
                lay("GND", x, y, x, up, w, f"GND-Ausgang x={x:.0f}")
            else:
                print(f"  GND-Ausgang x={x:.0f}          kein Platz ({w:.1f} mm)")

    print(f"\n{len(laid)} Segmente gelegt"
          + (f", schmalstes {min(w for _n, w in laid):.1f} mm = "
             f"{amps(min(w for _n, w in laid)):.1f} A" if laid else ""))
    pcbnew.SaveBoard(BOARD, b)
    print(f"\n@@RESULT {len(laid)}", flush=True)


def sub(*a):
    r = subprocess.run([sys.executable, os.path.abspath(__file__), "--stage", *a],
                       capture_output=True, text=True)
    m = re.search(r"@@RESULT ([^\n]*)", r.stdout)
    if not m:
        raise RuntimeError(f"Stage {a[0]}:\n{r.stdout[-900:]}\n{r.stderr[-500:]}")
    print("\n".join(l for l in r.stdout.splitlines() if l.startswith("  ")))
    return m.group(1)


def main():
    if "--stage" in sys.argv:
        i = sys.argv.index("--stage")
        if sys.argv[i + 1] == "clear":
            return stage_clear()
        return stage_lay(float(sys.argv[i + 2]), float(sys.argv[i + 3]))

    want = float(sys.argv[sys.argv.index("--width") + 1]) if "--width" in sys.argv else 7.0
    floor = float(sys.argv[sys.argv.index("--min") + 1]) if "--min" in sys.argv else 5.0
    print(f"{sub('clear')} alte Stammleitungen entfernt")
    if "--remove" in sys.argv:
        return 0
    print(f"{sub('lay', str(want), str(floor))} Segmente gelegt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
