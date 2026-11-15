#!/usr/bin/env python3
"""Check the JLCPCB assembly files against the format their uploader takes.

    production/BOM-LCSC-upload.csv   Comment, Designator, Footprint, LCSC Part #, ...
    production/luxdmx-carrier-cpl.csv Designator, Mid X, Mid Y, Layer, Rotation

JLCPCB's uploader says nothing but "failed to load" when it doesn't like a file (issue #164),
so this checks everything we know it trips over: encoding (UTF-8 without BOM, no UTF-16),
the header names, empty rows, ragged rows, designators that aren't plain R12 style or appear
twice, designators in one file and not the other, layer values, units, rotations.

gen_bom.py runs this after writing the files. Standalone:

    python3 hardware-carrier/tools/check_jlc_files.py [production dir]

Exit code 1 on any error. Warnings (a BOM line without an LCSC number) don't fail.
"""
import csv
import io
import os
import re
import sys

BOM_NAME = "BOM-LCSC-upload.csv"
CPL_NAME = "luxdmx-carrier-cpl.csv"
BOM_HEAD = ["Comment", "Designator", "Footprint", "LCSC Part #"]
CPL_HEAD = ["Designator", "Mid X", "Mid Y", "Layer", "Rotation"]
DESIGNATOR = re.compile(r"^[A-Z]{1,3}[0-9]{1,4}$")
LCSC = re.compile(r"^C[0-9]+$")
COORD = re.compile(r"^-?[0-9]+(\.[0-9]+)?mm$")


def _read(path, errors):
    raw = open(path, "rb").read()
    name = os.path.basename(path)
    if raw.startswith(b"\xef\xbb\xbf"):
        errors.append(f"{name}: starts with a UTF-8 BOM")
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")) or b"\x00" in raw:
        errors.append(f"{name}: looks like UTF-16 (NUL bytes)")
        return []
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as e:
        errors.append(f"{name}: not UTF-8 ({e})")
        return []
    first = text.splitlines()[0] if text else ""
    if "\t" in first or ";" in first:
        errors.append(f"{name}: header uses tabs or semicolons, JLCPCB wants commas")
    rows = list(csv.reader(io.StringIO(text)))
    for i, r in enumerate(rows, 1):
        if not any(c.strip() for c in r):
            errors.append(f"{name}: line {i} is empty")
        elif len(r) != len(rows[0]):
            errors.append(f"{name}: line {i} has {len(r)} fields, header has {len(rows[0])}")
        for c in r:
            if c != c.strip():
                errors.append(f"{name}: line {i} field {c!r} has stray whitespace")
    return [r for r in rows if any(c.strip() for c in r)]


def check(prod):
    errors, warnings = [], []
    bom = _read(os.path.join(prod, BOM_NAME), errors)
    cpl = _read(os.path.join(prod, CPL_NAME), errors)
    if not bom or not cpl:
        errors.append("a file is empty or unreadable")
        return errors, warnings

    if bom[0][:len(BOM_HEAD)] != BOM_HEAD:
        errors.append(f"{BOM_NAME}: header {bom[0]} must start with {BOM_HEAD}")
    if cpl[0] != CPL_HEAD:
        errors.append(f"{CPL_NAME}: header {cpl[0]} must be {CPL_HEAD}")
    if errors:
        return errors, warnings

    bom_refs = {}
    for i, r in enumerate(bom[1:], 2):
        comment, refs, fp, lcsc = r[:4]
        if not comment or not fp:
            errors.append(f"{BOM_NAME}: line {i} has an empty Comment or Footprint")
        if lcsc and not LCSC.match(lcsc):
            errors.append(f"{BOM_NAME}: line {i} LCSC Part # {lcsc!r} is not C<digits>")
        if not lcsc:
            warnings.append(f"{BOM_NAME}: line {i} ({comment}) has no LCSC Part #, "
                            "pick it in JLCPCB's part search")
        for d in refs.split(","):
            if not DESIGNATOR.match(d):
                errors.append(f"{BOM_NAME}: line {i} designator {d!r} is not like R12")
            elif d in bom_refs:
                errors.append(f"{BOM_NAME}: {d} on lines {bom_refs[d]} and {i}")
            else:
                bom_refs[d] = i
        if "Quantity" in bom[0]:
            q = r[bom[0].index("Quantity")]
            n = len(refs.split(","))
            if not q.isdigit() or int(q) % n:
                errors.append(f"{BOM_NAME}: line {i} Quantity {q} doesn't fit {n} designators")

    cpl_refs = {}
    for i, r in enumerate(cpl[1:], 2):
        d, x, y, layer, rot = r
        if not DESIGNATOR.match(d):
            errors.append(f"{CPL_NAME}: line {i} designator {d!r} is not like R12")
        if d in cpl_refs:
            errors.append(f"{CPL_NAME}: {d} on lines {cpl_refs[d]} and {i}")
        cpl_refs[d] = i
        for v in (x, y):
            if not COORD.match(v):
                errors.append(f"{CPL_NAME}: line {i} coordinate {v!r} is not <number>mm")
        if layer not in ("Top", "Bottom"):
            errors.append(f"{CPL_NAME}: line {i} layer {layer!r} is not Top or Bottom")
        try:
            if not 0 <= float(rot) < 360:
                raise ValueError
        except ValueError:
            errors.append(f"{CPL_NAME}: line {i} rotation {rot!r} is not 0..359")

    for d in sorted(set(bom_refs) - set(cpl_refs)):
        errors.append(f"{d} is in the BOM but has no placement")
    for d in sorted(set(cpl_refs) - set(bom_refs)):
        errors.append(f"{d} is placed but not in the BOM")
    return errors, warnings


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    prod = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, "..", "production")
    errors, warnings = check(prod)
    for w in warnings:
        print("  warn: " + w)
    for e in errors:
        print("  FEHLER: " + e)
    print(f"JLC files: {len(errors)} errors, {len(warnings)} warnings")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
