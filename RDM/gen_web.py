#!/usr/bin/env python3
"""Embed web/index.html into src/web_index.h as a C++ raw string literal.

The RP2350 sim has no filesystem for the web UI; the page is compiled into
flash. Edit web/index.html, then run `python gen_web.py` to regenerate the
header. Kept dead simple on purpose (no minifier) so the served page is a
byte-for-byte copy of the source you can diff.
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "web" / "index.html"
DST = ROOT / "src" / "web_index.h"
DELIM = ")RDMHTML\""  # raw-string closing token that must not appear in the page

html = SRC.read_text(encoding="utf-8")
if DELIM in html:
    sys.exit("error: index.html contains the raw-string terminator %r" % DELIM)

out = (
    "// Auto-generated from web/index.html by gen_web.py. Do not edit by hand.\n"
    "#pragma once\n"
    "static const char INDEX_HTML[] = R\"RDMHTML(\n"
    + html
    + "\n)RDMHTML\";\n"
)
DST.write_text(out, encoding="utf-8", newline="\n")
print("wrote %s (%d bytes of HTML)" % (DST.relative_to(ROOT), len(html)))
