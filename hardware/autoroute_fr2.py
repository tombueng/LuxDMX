import os, sys, subprocess, tempfile, glob, pcbnew
HERE = os.path.dirname(os.path.abspath(__file__))
BOARD = os.path.join(HERE, "luxdmx.kicad_pcb")
# Freerouting 2.x jar + portable JDK 25 live in hardware/tools/ (gitignored).
# Override with env FR2_JAR / FR2_JAVA / FR2_PASSES. FR2 needs Java 25+ (class file v69).
JAR = os.environ.get("FR2_JAR", os.path.join(HERE, "tools", "freerouting2.jar"))
JAVA = os.environ.get("FR2_JAVA") or next(iter(glob.glob(os.path.join(HERE, "tools", "jdk*", "*", "bin", "java.exe"))), "java")
PASSES = os.environ.get("FR2_PASSES", "30")
TIMEOUT = int(os.environ.get("FR2_TIMEOUT", "600"))   # max wait for the GUI session (you close the window to export)
dsn = os.path.join(tempfile.gettempdir(), "l_fr2.dsn")
ses = os.path.join(tempfile.gettempdir(), "l_fr2.ses")
runlog = os.path.join(tempfile.gettempdir(), "l_fr2_run.log")
if os.path.exists(ses):
    os.remove(ses)
b = pcbnew.LoadBoard(BOARD)
# In1=GND, In2=+3V3 are POWER PLANES: export them as power so Freerouting keeps them solid and
# routes signals only on F.Cu/B.Cu (was LT_SIGNAL, which let it route signals on the planes and
# fragment them).
b.SetLayerType(pcbnew.In1_Cu, pcbnew.LT_POWER)
b.SetLayerType(pcbnew.In2_Cu, pcbnew.LT_POWER)
n = 0; kept = 0
for t in list(b.GetTracks()):
    if t.IsLocked():
        kept += 1; continue          # keep locked connector escapes
    b.Remove(t); n += 1
print("cleared", n, "unlocked tracks, kept", kept, "locked", flush=True)
pcbnew.ExportSpecctraDSN(b, dsn)
# Run Freerouting with its GUI VISIBLE so the routing can be watched (user preference: never headless).
# Analytics stays disabled so it doesn't block on the api.freerouting.app telemetry call. The window
# opens, loads the DSN, autoroutes (-mp passes) while you watch, writes the .ses, and closes itself.
env = dict(os.environ,
           FREEROUTING__USAGE_AND_DIAGNOSTIC_DATA__DISABLE_ANALYTICS="true",
           FREEROUTING__GUI__ENABLED="true")
print(f"running Freerouting 2.2.4 with GUI visible (-mp {PASSES})...", flush=True)
try:
    r = subprocess.run([JAVA, "-jar", JAR,
                        "-de", dsn, "-do", ses, "-mp", PASSES],
                       capture_output=True, text=True, env=env, timeout=TIMEOUT)
    with open(runlog, "w", encoding="utf-8") as f:
        f.write(r.stdout + "\n---STDERR---\n" + r.stderr)
    print("FR2 stdout tail:", r.stdout[-200:])
except subprocess.TimeoutExpired:
    print(f"FR2 timed out after {TIMEOUT}s", flush=True)
if not os.path.exists(ses):
    sys.exit(f"FR2 produced no SES -- see {runlog} and %TEMP%/freerouting/freerouting.log")
pcbnew.ImportSpecctraSES(b, ses)
pcbnew.ZONE_FILLER(b).Fill(b.Zones())
pcbnew.SaveBoard(BOARD, b)
print("DONE: saved", flush=True)
