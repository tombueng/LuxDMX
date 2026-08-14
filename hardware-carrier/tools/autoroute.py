#!/usr/bin/env python3
"""Autoroute the carrier with Freerouting.

Four things this has to work around, all of them found the hard way.

**Duplicate references.** Every reference on this board was renamed to a silk label, so six
of them repeat ("TVS bidir" x6, "120R term" x3, ...). Specctra DSN needs unique component
names and KiCad's exporter just returns False, with no message. The refs are swapped for
X1..Xn for the export and put back before the save.

**Ratsnest on a mutated board segfaults.** Deleting tracks from a board that has filled
zones leaves the connectivity engine on stale fill data, and GetUnconnectedCount() takes the
process down with SIGSEGV. Refilling first does not help.

**Two board objects in one process segfault too.** So every pcbnew step runs in its own
subprocess, one board per process, and they talk through files. That is why this script
re-invokes itself with --stage.

**Power is not a track.** 20 A needs 9.4 mm of 2 oz copper. GND / V_PIX / V_PIX_IN carry
their current in the zones from build_zones.py, so only the remainder reaches the router.

Run:
    python hardware-carrier/autoroute.py [--passes N] [--layers N] [--tag NAME]
    python hardware-carrier/autoroute.py --sweep "5,10,20,30,50,80" [--layers N]
"""
import glob
import json
import re
import os
import shutil
import subprocess
import sys
import tempfile
import time

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
TOOLS = os.path.abspath(os.path.join(HERE, "..", "hardware", "tools"))
JAR = os.environ.get("FR2_JAR", os.path.join(TOOLS, "freerouting2.jar"))
WORK = os.path.join(tempfile.gettempdir(), "carrier-route")
STRIPPED = os.path.join(WORK, "stripped.kicad_pcb")
PROJECT = os.path.join(HERE, "luxdmx-carrier.kicad_pro")
REFMAP = os.path.join(WORK, "refs.json")
TIMEOUT = int(os.environ.get("FR2_TIMEOUT", "2400"))


# ---------------------------------------------------------------- stages (one board each)
def stage_strip(src, dst, layers=None, mode="tracks"):
    """Copy src to dst without its unlocked tracks, or without its zones. One, never both.

    Routing with the pours already in place makes Freerouting WORSE, not better: KiCad
    exports a zone as a plane and FR treats it as an obstacle rather than as a source of
    connections. Measured on this board, 2 layers, 20 passes: 11 open with the zones
    present, 7 without. So the pipeline routes bare copper first and pours afterwards.

    Why one at a time: removing zones and removing tracks in the same process takes pcbnew
    down with SIGSEGV, in either order. Each on its own is fine. Same family as the two-
    boards-per-process crash, and the answer is the same, one board per process.
    """
    import pcbnew
    b = pcbnew.LoadBoard(src)
    if layers:
        b.SetCopperLayerCount(int(layers))
    n = 0
    if mode == "zones":
        for z in list(b.Zones()):
            # rule areas are not pours, they are instructions to the router. The power
            # backbone is one of them and has to survive into the DSN.
            if z.GetIsRuleArea():
                continue
            b.Remove(z)
            n += 1
    else:
        for t in list(b.GetTracks()):
            if not t.IsLocked():
                b.Remove(t)
                n += 1
        if b.Zones():
            pcbnew.ZONE_FILLER(b).Fill(b.Zones())
    pcbnew.SaveBoard(dst, b)
    print(f"\n@@RESULT {n}", flush=True)


def stage_count(path):
    import pcbnew
    b = pcbnew.LoadBoard(path)
    b.BuildConnectivity()
    print(f"\n@@RESULT {b.GetConnectivity().GetUnconnectedCount(True)} "
          f"{len(list(b.GetTracks()))} {b.GetCopperLayerCount()}", flush=True)


def stage_export(src, dsn):
    import pcbnew
    b = pcbnew.LoadBoard(src)
    # kept by POSITION: pcbnew.KIID is unhashable so it cannot key a dict, and the iteration
    # order of GetFootprints() is stable within one board object
    refs = [f.GetReference() for f in b.GetFootprints()]
    for i, f in enumerate(b.GetFootprints(), 1):
        f.SetReference(f"X{i}")
    ok = pcbnew.ExportSpecctraDSN(b, dsn)
    json.dump(refs, open(REFMAP, "w"))
    print(f"\n@@RESULT {int(bool(ok))}", flush=True)


def stage_import(src, ses, dst):
    import pcbnew
    b = pcbnew.LoadBoard(src)
    refs = json.load(open(REFMAP))
    for i, f in enumerate(b.GetFootprints(), 1):
        f.SetReference(f"X{i}")
    pcbnew.ImportSpecctraSES(b, ses)
    for f, r in zip(b.GetFootprints(), refs):
        f.SetReference(r)
    if b.Zones():
        pcbnew.ZONE_FILLER(b).Fill(b.Zones())
    pcbnew.SaveBoard(dst, b)
    print("\n@@RESULT ok", flush=True)


# ---------------------------------------------------------------- driver
def with_project(board_path):
    """Net classes live in the .kicad_pro, NOT in the .kicad_pcb. A board loaded on its own
    in /tmp silently falls back to Default 0.2 mm, which is how a first run produced 199
    track_width violations. So every working copy gets the project file beside it."""
    pro = os.path.splitext(board_path)[0] + ".kicad_pro"
    if os.path.exists(PROJECT):
        shutil.copy(PROJECT, pro)
    return board_path


def sub(*a):
    """Run one stage in a fresh interpreter and hand back its OK line.

    The return code is ignored on purpose: KiCad's swig leak tracker regularly takes the
    interpreter down with SIGSEGV *after* the work is done and saved, so the OK line is the
    only reliable signal that the stage completed."""
    r = subprocess.run([sys.executable, os.path.abspath(__file__), "--stage", *a],
                       capture_output=True, text=True)
    # KiCad's swig leak tracker writes without a trailing newline, so its message glues
    # itself onto the front of ours ("swig/pyOK 532"). Search, do not match line starts.
    m = re.search(r"@@RESULT ([^\n]*)", r.stdout)
    if m:
        return m.group(1).split()
    raise RuntimeError(f"Stage {a[0]} fehlgeschlagen:\n{r.stdout[-800:]}\n{r.stderr[-800:]}")


def java():
    """The bundled tools/jdk* is a WINDOWS build (its bin/ is full of .dll), so a bare glob
    finds a path that exists and cannot run. Take the first that reports a version."""
    for c in [os.environ.get("FR2_JAVA")] + \
             glob.glob(os.path.join(TOOLS, "jdk*", "*", "bin", "java")) + \
             [shutil.which("java")]:
        if c and os.path.exists(c):
            try:
                if subprocess.run([c, "-version"], capture_output=True,
                                  timeout=30).returncode == 0:
                    return c
            except OSError:
                pass
    return None


# net -> (track width, clearance, via) in DSN units (um). The pours carry the current, so
# these are the stubs between a pad and its pour; wide enough to be robust, narrow enough
# that the router can still find a way through.
# Freerouting places the 1000 um via padstack but does its clearance arithmetic on the stock
# 600 um one, so a via it thinks is clear of a pad can land 200 um tighter in KiCad. Padding
# these clearances to compensate was tried and made routing strictly worse (6 open instead of
# 1) without fixing it. tools/drop_tight_vias.py cleans up afterwards instead.
DSN_CLASSES = [
    ("power",   ["GND", "V_PIX", "V_PIX_IN"], 1000, 300, "ViaP[0-1]_1000:500_um"),
    ("rail5v",  ["+5V"],                       800, 250, "ViaP[0-1]_1000:500_um"),
    ("rail3v3", ["+3V3"],                      600, 250, None),
]
BIG_VIA = ("ViaP[0-1]_1000:500_um", 1000)


def block_end(text, start):
    """Index just past the s-expression that opens at `start`."""
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return i + 1
    raise ValueError("unbalanced")


def inset_boundary(t, by=300):
    """Pull the routing boundary in from the real board outline, in um.

    Freerouting keeps its class clearance from the boundary, 200 to 300 um here, but the
    board rule for copper to the edge is 500. Without this the router happily lays an 0.8 mm
    +5V track 0.32 mm off the edge and DRC catches it afterwards. Insetting the boundary by
    the difference stops it happening in the first place. Axis-aligned outlines only, which
    is what this board has.
    """
    m = re.search(r"\(boundary\s*\(path pcb 0([-0-9\s]+)\)", t)
    if not m:
        return t
    v = [int(x) for x in m.group(1).split()]
    xs, ys = v[0::2], v[1::2]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    pts = " ".join(f"{x - by if x > cx else x + by} {y - by if y > cy else y + by}"
                   for x, y in zip(xs, ys))
    return t[:m.start()] + f"(boundary\n      (path pcb 0 {pts})" + t[m.end():]


def patch_dsn(path):
    """Give the router real net classes.

    KiCad's DSN export carries ONE class, kicad_default, at whatever the board's cached
    design settings say. Net classes live in the .kicad_pro and a board loaded standalone
    from /tmp never sees them, so everything came out at 0.2 mm no matter what the project
    said. Rewriting the class block here is the only place the widths actually stick.
    """
    t = inset_boundary(open(path, encoding="utf-8").read())
    i = t.find("(class kicad_default")
    if i < 0:
        return False
    j = block_end(t, i)
    old = t[i:j]
    nets = old[len("(class kicad_default"):old.find("(circuit")].split()
    assigned = {n for _, ns, *_ in DSN_CLASSES for n in ns}
    rest = [n for n in nets if n not in assigned]

    # a second, fatter via for the power classes
    k = t.find('(padstack "Via[0-1]_600:300_um"')
    if k > 0 and BIG_VIA[0] not in t:
        pad = (f'(padstack "{BIG_VIA[0]}"\n'
               f'      (shape (circle F.Cu {BIG_VIA[1]}))\n'
               f'      (shape (circle B.Cu {BIG_VIA[1]}))\n'
               f'      (attach off)\n    )\n    ')
        t = t[:k] + pad + t[k:]
        t = t.replace('(via "Via[0-1]_600:300_um")',
                      f'(via "Via[0-1]_600:300_um" "{BIG_VIA[0]}")', 1)
        i = t.find("(class kicad_default")
        j = block_end(t, i)

    def blk(name, members, w, c, via):
        v = via or "Via[0-1]_600:300_um"
        return (f'(class {name} ' + " ".join(members) + "\n"
                f'      (circuit\n        (use_via "{v}")\n      )\n'
                f'      (rule\n        (width {w})\n        (clearance {c})\n      )\n    )')

    blocks = [blk(n, [m for m in ms if m in nets], w, c, v)
              for n, ms, w, c, v in DSN_CLASSES if any(m in nets for m in ms)]
    blocks.append(blk("kicad_default", rest, 350, 200, None))
    open(path, "w", encoding="utf-8").write(t[:i] + "\n    ".join(blocks) + t[j:])
    return True


def freeroute(dsn, ses, log, passes, jv):
    env = dict(os.environ,
               FREEROUTING__USAGE_AND_DIAGNOSTIC_DATA__DISABLE_ANALYTICS="true",
               FREEROUTING__GUI__ENABLED=os.environ.get("FR2_GUI", "true"))
    t0 = time.time()
    try:
        r = subprocess.run([jv, "-jar", JAR, "-de", dsn, "-do", ses, "-mp", str(passes)],
                           capture_output=True, text=True, env=env, timeout=TIMEOUT)
        open(log, "w", encoding="utf-8").write(r.stdout + "\n--- STDERR ---\n" + r.stderr)
    except subprocess.TimeoutExpired:
        open(log, "w", encoding="utf-8").write("TIMEOUT")
    return time.time() - t0


def attempt(passes, tag, jv, dst):
    dsn = os.path.join(WORK, f"{tag}.dsn")
    ses = os.path.join(WORK, f"{tag}.ses")
    log = os.path.join(WORK, f"{tag}.log")
    for f in (dsn, ses):
        if os.path.exists(f):
            os.remove(f)
    if sub("export", STRIPPED, dsn) != ["1"]:
        return None
    patch_dsn(dsn)
    dt = freeroute(dsn, ses, log, passes, jv)
    if not os.path.exists(ses):
        return None
    sub("import", STRIPPED, ses, dst)
    left, tracks, layers = (int(v) for v in sub("count", dst))
    return {"tag": tag, "passes": passes, "layers": layers,
            "left": left, "tracks": tracks, "seconds": round(dt)}


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def main():
    if "--stage" in sys.argv:
        i = sys.argv.index("--stage")
        name, rest = sys.argv[i + 1], sys.argv[i + 2:]
        if name == "strip":
            return stage_strip(rest[0], rest[1],
                               rest[2] if len(rest) > 2 and rest[2] != "-" else None,
                               "zones" if "zones" in rest[3:] else "tracks")
        if name == "count":
            return stage_count(rest[0])
        if name == "export":
            return stage_export(rest[0], rest[1])
        if name == "import":
            return stage_import(rest[0], rest[1], rest[2])
        sys.exit(f"unbekannte Stage {name}")

    jv = java()
    if not jv:
        sys.exit("kein lauffaehiges Java (Freerouting 2.x braucht Java 25+)")
    if not os.path.exists(JAR):
        sys.exit(f"Freerouting nicht gefunden: {JAR}")

    layers = arg("--layers")
    os.makedirs(WORK, exist_ok=True)
    bak = os.path.join(WORK, "before-route.kicad_pcb")
    if not os.path.exists(bak):
        shutil.copy(BOARD, bak)

    src = arg("--from", BOARD)
    if "--nozones" in sys.argv:
        nz = with_project(os.path.join(WORK, "nozones.kicad_pcb"))
        sub("strip", src, nz, layers or "-", "zones")
        src, layers = nz, None
    sub("strip", src, with_project(STRIPPED), layers or "-", "tracks")
    start, _, nlay = (int(v) for v in sub("count", STRIPPED))
    print(f"Java {jv}")
    print(f"{nlay} Lagen, {start} Verbindungen zu routen\n")

    plan = [int(p) for p in arg("--sweep").split(",")] if "--sweep" in sys.argv \
        else [int(arg("--passes", "20"))]
    best, results = None, []
    for p in plan:
        tag = arg("--tag") if len(plan) == 1 and "--tag" in sys.argv else f"L{nlay}p{p}"
        dst = with_project(os.path.join(WORK, f"{tag}.kicad_pcb"))
        r = attempt(p, tag, jv, dst)
        if r is None:
            print(f"  {tag:12s} fehlgeschlagen")
            continue
        r["file"] = dst
        results.append(r)
        flag = ""
        if best is None or r["left"] < best["left"]:
            best, flag = r, "  <- bestes"
        print(f"  {tag:12s} {start - r['left']:3d}/{start} verbunden, "
              f"{r['left']:2d} offen, {r['tracks']:4d} Segmente, {r['seconds']:4d}s{flag}")

    if best:
        shutil.copy(best["file"], BOARD)
        print(f"\nbestes Ergebnis {best['tag']} auf das Board geschrieben: "
              f"{best['left']} offen")
    json.dump(results, open(os.path.join(WORK, "results.json"), "w"), indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
