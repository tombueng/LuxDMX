"""Bundle each functional block into a KiCad PCB group so it can be dragged/rotated as ONE unit for
manual tight packing (select any member -> whole group moves). Idempotent: clears existing groups
first. Grouping is just metadata -- it does not affect the netlist/route. After you finish packing,
re-run the pipeline (rebuild_iso -> escape -> autoroute -> cleanup_pads -> tighten_poe_void). KiCad 10."""
import pcbnew
PCB = r"C:\dev\DMX\hardware\luxdmx.kicad_pcb"
b = pcbnew.LoadBoard(PCB)

CLUSTERS = {
    "ESP32":       ["U1", "C1", "C2", "C3", "R1", "R2"],
    "USB-UART":    ["U3", "C15", "Q1", "Q2", "R6", "R7"],
    "Ethernet":    ["U2", "C8", "C9", "C10", "C11", "C4", "C5", "C6", "R3", "Y1", "C12", "C13",
                    "J3", "R18", "C14", "C22", "R4", "R5"],
    "Buck-3V3":    ["U4", "C16", "C17", "L1", "R10", "R11"],
    "PoE-PD":      ["U7", "C27", "C28", "D10", "C29", "D8", "D9"],
    "USB-C-in":    ["J2", "R8", "R9"],
    "DMX1-iso":    ["U5", "C18", "C19", "C20", "PS1", "C21", "R12", "D1", "J1"],
    "DMX2-iso":    ["U6", "C23", "C24", "C25", "PS2", "C26", "R19", "D7", "J5"],
    "Status-LEDs": ["D2", "D3", "D4", "D5", "D6", "R13", "R14", "R15", "R16", "R17"],
}

# clear any existing groups (idempotent)
try:
    for g in list(b.Groups()):
        b.Remove(g)
except Exception:
    pass

made = 0
for name, refs in CLUSTERS.items():
    g = pcbnew.PCB_GROUP(b)
    g.SetName(name)
    cnt = 0
    for ref in refs:
        fp = b.FindFootprintByReference(ref)
        if fp:
            g.AddItem(fp); cnt += 1
        else:
            print(f"  ?? {name}: {ref} not found")
    if cnt:
        b.Add(g); made += 1
        print(f"  group '{name}': {cnt} parts")

# report anything left ungrouped (so you know what moves individually)
grouped = {r for refs in CLUSTERS.values() for r in refs}
loose = sorted(fp.GetReference() for fp in b.GetFootprints() if fp.GetReference() not in grouped)
pcbnew.SaveBoard(PCB, b)
print(f"created {made} groups. Ungrouped (move individually): {loose}")
