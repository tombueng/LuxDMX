"""Finish Freerouting's occasional PARTIAL nets. FR sometimes leaves a net with one pad unconnected to the
rest of the net by a small gap; the maze straggler in route_all.sh skips it because the net already has
tracks (its _rnets filter). This finds those nets via kicad-cli DRC (unconnected_items), DELETES their
routing so they become fully unrouted, and lets the maze straggler that runs right after re-route them
cleanly (2-layer). Run between the Freerouting loop and the maze straggler. Idempotent (no-op if none).

The re-routed nets come out at the maze's 0.15mm width. That's fine: signals are unaffected, and the only
power nets that ever end up here (+5V_POE 0.4A, +5V_USBF 0.5A-on-USB) carry <=0.5A, which 0.15mm/1oz meets
(so validate_geometry still passes). KiCad 10."""
import os, re, json, shutil, subprocess, tempfile, sys, pcbnew

PCB = r"C:\dev\DMX\hardware\luxdmx.kicad_pcb"


def find_cli():
    for c in (os.environ.get("KICAD_CLI"), r"C:\Program Files\KiCad\10.0\bin\kicad-cli.exe",
              r"C:\Program Files\KiCad\9.0\bin\kicad-cli.exe", shutil.which("kicad-cli")):
        if c and os.path.exists(c):
            return c
    sys.exit("finish_partial: kicad-cli not found (set $KICAD_CLI)")


out = os.path.join(tempfile.gettempdir(), "finish_partial_drc.json")
subprocess.run([find_cli(), "pcb", "drc", "--format", "json", "-o", out, PCB],
               check=False, capture_output=True, text=True)
d = json.load(open(out, encoding="utf-8"))

partial = set()
for u in d.get("unconnected_items", []):
    for it in u.get("items", []):
        m = re.search(r"\[([^\]]+)\]", it.get("description", ""))
        if m:
            partial.add(m.group(1))

if not partial:
    print("finish_partial: no FR partial nets -- nothing to do")
    sys.exit(0)

print("finish_partial: FR left partial net(s) ->", " ".join(sorted(partial)), "-- deleting so the maze re-routes them")
b = pcbnew.LoadBoard(PCB)
n = 0
for t in list(b.GetTracks()):
    if t.GetNetname() in partial:
        b.Remove(t)
        n += 1
pcbnew.SaveBoard(PCB, b)
print(f"  deleted {n} tracks/vias on {len(partial)} net(s); the maze straggler will route them next")
