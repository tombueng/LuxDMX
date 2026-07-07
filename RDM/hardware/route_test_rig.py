#!/usr/bin/env python
"""Autoroute test_rig.kicad_pcb with Freerouting 2.x, then fill the GND pours.

Reuses the Freerouting 2 jar + portable JDK 25 from the main hardware/tools/ dir
(FR2 needs Java 25). GUI is shown so the routing can be watched (user preference:
never headless). The window loads the DSN, autoroutes -mp passes, writes the .ses,
and closes; we import it and fill the ground pours.

    "/c/Program Files/KiCad/10.0/bin/python.exe" route_test_rig.py
"""
import os, sys, subprocess, tempfile, glob, pcbnew

HERE = os.path.dirname(os.path.abspath(__file__))
BOARD = os.path.join(HERE, "test_rig.kicad_pcb")
TOOLS = os.path.join(HERE, "..", "..", "hardware", "tools")   # RDM/hardware -> hardware/tools
JAR = os.environ.get("FR2_JAR", os.path.join(TOOLS, "freerouting2.jar"))
JAVA = os.environ.get("FR2_JAVA") or next(
    iter(glob.glob(os.path.join(TOOLS, "jdk*", "*", "bin", "java.exe"))), "java")
PASSES = os.environ.get("FR2_PASSES", "30")
TIMEOUT = int(os.environ.get("FR2_TIMEOUT", "900"))
TRACK_W = float(os.environ.get("FR2_TRACK", "1.0"))   # trace width (mm) - thick bench traces (1.0/1.5 both fine)
CLEAR = float(os.environ.get("FR2_CLEAR", "0.2"))

dsn = os.path.join(tempfile.gettempdir(), "tr_fr2.dsn")
ses = os.path.join(tempfile.gettempdir(), "tr_fr2.ses")
runlog = os.path.join(tempfile.gettempdir(), "tr_fr2_run.log")
if os.path.exists(ses):
    os.remove(ses)

b = pcbnew.LoadBoard(BOARD)
# clear any previous unlocked routing, keep locked escapes if any
n = kept = 0
for t in list(b.GetTracks()):
    if t.IsLocked():
        kept += 1
        continue
    b.Remove(t)
    n += 1
print(f"cleared {n} tracks, kept {kept} locked", flush=True)
# Set the routing width by forcing it directly in the exported DSN text. The pcbnew
# netclass setter (GetDesignSettings().m_NetSettings...) intermittently returns a raw
# SwigPyObject and silently drops back to the 0.2mm default, so don't depend on it.
pcbnew.ExportSpecctraDSN(b, dsn)
import re as _re
wnm = int(round(TRACK_W * 1000))
_txt = open(dsn, encoding="utf-8").read()
_txt = _re.sub(r"\(width\s+\d+\)", f"(width {wnm})", _txt)   # force every rule width
open(dsn, "w", encoding="utf-8").write(_txt)
_w = _re.search(r"\(rule\s*\(width\s+(\d+)\)", _txt)
if not _w or int(_w.group(1)) != wnm:
    raise SystemExit(f"ABORT: DSN track width not set ({_w and _w.group(1)}) - refusing to route")
print(f"forced DSN track width {TRACK_W}mm (rule width {_w.group(1)}nm)", flush=True)

env = dict(os.environ,
           FREEROUTING__USAGE_AND_DIAGNOSTIC_DATA__DISABLE_ANALYTICS="true",
           FREEROUTING__GUI__ENABLED="true")
print(f"running Freerouting (GUI visible, -mp {PASSES}) with {JAVA}...", flush=True)
try:
    r = subprocess.run([JAVA, "-jar", JAR, "-de", dsn, "-do", ses, "-mp", PASSES],
                       capture_output=True, text=True, env=env, timeout=TIMEOUT)
    with open(runlog, "w", encoding="utf-8") as f:
        f.write(r.stdout + "\n---STDERR---\n" + r.stderr)
    print("FR2 stdout tail:", r.stdout[-300:])
except subprocess.TimeoutExpired:
    print(f"FR2 timed out after {TIMEOUT}s", flush=True)

if not os.path.exists(ses):
    sys.exit(f"FR2 produced no SES -- see {runlog}")
pcbnew.ImportSpecctraSES(b, ses)
pcbnew.ZONE_FILLER(b).Fill(b.Zones())
pcbnew.SaveBoard(BOARD, b)
print("DONE: routed + filled, saved", flush=True)
