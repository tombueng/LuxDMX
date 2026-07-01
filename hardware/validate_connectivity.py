"""HARD FAB GATE: the board MUST have 0 unconnected nets before ANY fab output is produced.

This is the guard that was missing when **C17** (the SY8089 3V3 buck output cap) shipped
UNROUTED in a board that had supposedly been "validated x times". Nothing actually enforced
connectivity -- VALIDATION.md just carried a hand-typed "0 unrouted" note that went stale the
moment the board was edited again. A near-miss that could have cost a fab respin.

So connectivity is now checked by KiCad's OWN DRC engine (the same one the GUI uses), every time,
and it is wired into gen_gerbers.py / gen_cpl.py: you physically CANNOT emit gerbers or a CPL while
any net is unrouted. Trust the tool, not a comment.

    py validate_connectivity.py [board.kicad_pcb]     # exit 1 if ANY net is unconnected
    from validate_connectivity import check_connectivity
    check_connectivity(PCB, CLI)                       # raises SystemExit on any unconnected net

Run it after every routing change. KiCad 10 (kicad-cli)."""
import os, json, shutil, subprocess, tempfile, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PCB = os.path.join(HERE, "luxdmx.kicad_pcb")


def _find_cli(cli=None):
    cli = cli or os.environ.get("KICAD_CLI")
    if cli and os.path.exists(cli):
        return cli
    for c in (r"C:\Program Files\KiCad\10.0\bin\kicad-cli.exe",
              r"C:\Program Files\KiCad\9.0\bin\kicad-cli.exe",
              shutil.which("kicad-cli")):
        if c and os.path.exists(c):
            return c
    raise SystemExit("kicad-cli not found - set $KICAD_CLI")


def run_drc(pcb=DEFAULT_PCB, cli=None):
    cli = _find_cli(cli)
    out = os.path.join(tempfile.gettempdir(), "luxdmx_drc_gate.json")
    # kicad-cli drc returns non-zero when violations exist on some builds -> check=False, parse the JSON.
    subprocess.run([cli, "pcb", "drc", "--format", "json", "-o", out, pcb],
                   check=False, capture_output=True, text=True)
    return json.load(open(out, encoding="utf-8"))


def check_connectivity(pcb=DEFAULT_PCB, cli=None, hard=True):
    """Gate on UNCONNECTED nets (the C17 class). Returns (ok, report).
    If hard and not ok, raise SystemExit so the calling fab-output script aborts."""
    d = run_drc(pcb, cli)
    unconnected = d.get("unconnected_items", [])
    viol = d.get("violations", [])
    n_err = sum(1 for v in viol if v.get("severity") == "error")
    n_warn = sum(1 for v in viol if v.get("severity") == "warning")
    ok = len(unconnected) == 0
    print(f"[connectivity gate] unrouted nets: {len(unconnected)} | DRC errors: {n_err} | warnings: {n_warn}")
    if unconnected:
        print("  *** UNROUTED NETS (fab-blocking) -- the C17 class of defect: ***")
        for u in unconnected:
            parts = " <-> ".join(i.get("description", "?") for i in u.get("items", []))
            print(f"    - {parts}")
    if not ok and hard:
        raise SystemExit("ABORT: board has unrouted net(s) -> refusing to produce fab output. "
                         "Route them, re-run, then retry the fab export.")
    return ok, {"unconnected": len(unconnected), "errors": n_err, "warnings": n_warn}


if __name__ == "__main__":
    pcb = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PCB
    ok, _ = check_connectivity(pcb, hard=False)
    print("RESULT:", "PASS (0 unrouted)" if ok else "FAIL -- unrouted nets present, fab output is BLOCKED")
    sys.exit(0 if ok else 1)
