"""Incrementally sync lumigate.kicad_pcb to lumigate.net WITHOUT discarding the
existing placement.

  * parts already on the board keep their position; their pad nets are refreshed
    (so e.g. J2's VBUS moving from +5V to +5V_USB just updates in place)
  * a part whose FOOTPRINT changed (e.g. J3 swapped to the PoE magjack) is removed
    and re-dropped in the grid for you to place
  * brand-new parts (2nd universe, PoE stage) are dropped in a grid inside the newly
    enlarged board area (a strip on the right) for you to place
  * footprints no longer in the netlist are removed
  * tracks/zones are left untouched here -- rebuild_iso.py clears them before the
    re-route, so the normal pipeline (rebuild_iso -> escape_connectors ->
    autoroute_fr2 -> cleanup_pads) still applies.

Use this instead of build_v3.py when you want to keep the current layout and only
place the newly-added parts. build_v3.py remains the full from-scratch grid build.
Run with the KiCad 10 bundled python (ships pcbnew)."""
import pcbnew, re, os

HERE = os.path.dirname(os.path.abspath(__file__))
PCB = os.path.join(HERE, "lumigate.kicad_pcb")
NET = os.path.join(HERE, "lumigate.net")
STOCK = r"C:\Program Files\KiCad\10.0\share\kicad\footprints"
EZ = os.path.join(HERE, "easyeda")
fm = pcbnew.FromMM; mm = pcbnew.ToMM

# ---- parse netlist (same shape build_v3.py expects) ----
txt = open(NET, encoding="utf-8").read()
comps = []
for m in re.finditer(r'\(comp\s+\(ref "([^"]+)"\)(.*?)(?=\(comp\s+\(ref|\Z)', txt, re.S):
    ref, body = m.group(1), m.group(2)
    fpm = re.search(r'\(footprint "([^"]+)"\)', body)
    val = re.search(r'\(value "([^"]*)"\)', body)
    comps.append((ref, fpm.group(1) if fpm else None, val.group(1) if val else ""))
padnet = {}
for blk in re.split(r'\(net\s+\(code\s+\d+\)', txt)[1:]:
    nm = re.search(r'\(name "([^"]*)"\)', blk)
    if not nm:
        continue
    for ref, pin in re.findall(r'\(node\s*\(ref "([^"]+)"\)\s*\(pin "([^"]+)"', blk):
        padnet[(ref, pin)] = nm.group(1)


def libdir(lib):
    d = os.path.join(EZ, lib + ".pretty")
    return d if os.path.isdir(d) else os.path.join(STOCK, lib + ".pretty")


b = pcbnew.LoadBoard(PCB)

# edge bbox for the new-part grid — read NOW, before any add/remove. After a b.Remove()/b.Add()
# the SWIG iterators (GetDrawings/GetBoardEdgesBoundingBox) go stale and throw, so capture it up front.
_exs = []; _eys = []
for _d in b.GetDrawings():
    if _d.GetLayer() == pcbnew.Edge_Cuts:
        _r = _d.GetBoundingBox(); _exs += [mm(_r.GetLeft()), mm(_r.GetRight())]; _eys += [mm(_r.GetTop()), mm(_r.GetBottom())]
GX0 = (max(_exs) if _exs else 190.0) - 42.0
GY0 = (min(_eys) if _eys else 90.0) + 6.0

# nets — reuse existing, create only missing
netobj = {}
for nm in sorted(set(padnet.values())):
    if not nm:
        continue
    n = b.FindNet(nm)
    if n is None:
        n = pcbnew.NETINFO_ITEM(b, nm); b.Add(n)
    netobj[nm] = n


def assign_nets(fp, ref):
    for pad in fp.Pads():
        nm = padnet.get((ref, pad.GetNumber()))
        if nm:
            pad.SetNet(netobj[nm])


_fps0 = list(b.GetFootprints())
existing = {f.GetReference(): f for f in _fps0}
# capture footprint NAMES as plain strings NOW -- after a b.Remove() the wrappers go stale and
# cur.GetFPID().GetLibItemName() segfaults/throws.
existing_name = {f.GetReference(): str(f.GetFPID().GetLibItemName()) for f in _fps0}
want = set(r for r, _, _ in comps)

# drop footprints that left the netlist (keep mechanical mounting holes MH* — not in the netlist)
for ref in list(existing):
    if ref not in want and not ref.startswith("MH"):
        print("remove (not in netlist):", ref)
        b.Remove(existing.pop(ref))

# re-materialise wrappers after the removals (the old ones are stale)
existing = {f.GetReference(): f for f in b.GetFootprints()}

# grid for new/changed parts: a strip inside the enlarged area, right of the old board
gx0, gy0 = GX0, GY0

i = 0; added = []; replaced = []; kept = []; missing = []
for ref, fpid, val in comps:
    if not fpid or ":" not in fpid:
        missing.append((ref, fpid)); continue
    lib, name = fpid.split(":", 1)
    cur = existing.get(ref)
    # compare by footprint NAME captured up-front (board FPIDs carry no lib nickname; wrappers may be stale)
    if cur is not None and existing_name.get(ref) == name:
        cur.SetValue(val); assign_nets(cur, ref); kept.append(ref); continue
    if cur is not None:
        b.Remove(cur); replaced.append(ref)
    d = libdir(lib)
    if not os.path.isdir(d):
        print("  !! lib dir missing:", d); missing.append((ref, fpid)); continue
    fp = pcbnew.FootprintLoad(d, name)
    if fp is None:
        missing.append((ref, fpid)); continue
    fp.SetReference(ref); fp.SetValue(val)
    fp.SetPosition(pcbnew.VECTOR2I(fm(gx0 + (i % 5) * 8.0), fm(gy0 + (i // 5) * 8.0)))
    b.Add(fp); assign_nets(fp, ref); i += 1; added.append(ref)

pcbnew.SaveBoard(PCB, b)
print(f"kept {len(kept)} placed; added {len(added)}: {added}")
print(f"replaced (footprint changed) {replaced}; missing {missing}")
