#!/usr/bin/env python3
"""Generate src/generated/config_templates.cpp from templates/*.ini.

The board templates (templates/*.ini) are the SINGLE SOURCE OF TRUTH for each
board's runtime default values. This embeds them as PROGMEM C strings into the
registry the config engine reads (CONFIG_TEMPLATES in config_core.h), so the
defaults live in editable data files instead of -D macros in platformio.ini.

Comment ('#') and blank lines are dropped — the engine ignores them anyway, and
stripping keeps the embedded blob small. Run by extra_scripts.py at build time
and by test/native/run.bat before the host test compiles.

Usage: gen_config_templates.py [<project_root>] [<out_cpp>]
"""
import sys
import pathlib


def template_name(path: pathlib.Path) -> str:
    return path.stem  # "_base", "luxdmx_v4", ...


def c_symbol(name: str) -> str:
    return "T_" + name.strip("_").upper().replace("-", "_")


def meaningful_lines(text: str):
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        yield line


def main():
    root = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parent.parent
    out = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else root / "src" / "generated" / "config_templates.cpp"
    tdir = root / "templates"

    inis = sorted(tdir.glob("*.ini"), key=lambda p: (p.stem != "_base", p.stem))  # _base first
    if not inis:
        print(f"  [templates] no .ini files in {tdir}", file=sys.stderr)
        sys.exit(1)

    out.parent.mkdir(parents=True, exist_ok=True)
    blocks, registry = [], []
    for ini in inis:
        name = template_name(ini)
        sym = c_symbol(name)
        body = "".join(f'    "{line}\\n"\n' for line in meaningful_lines(ini.read_text(encoding="utf-8")))
        # No PROGMEM: on ESP32 const .rodata lives in memory-mapped flash and is
        # directly readable (strchr/strcmp/memcpy), so the attribute buys nothing
        # and would break the native host test (shim has no PROGMEM).
        blocks.append(f"static const char {sym}[] =\n{body};\n")
        registry.append(f'    {{"{name}", {sym}}},')

    h = "// Auto-generated from templates/*.ini by tools/gen_config_templates.py — do not edit.\n"
    h += '#include "../config/config_core.h"\n\n'
    h += "\n".join(blocks) + "\n"
    h += "const CfgTemplate CONFIG_TEMPLATES[] = {\n" + "\n".join(registry) + "\n};\n"
    h += "const size_t CONFIG_TEMPLATE_COUNT = sizeof(CONFIG_TEMPLATES) / sizeof(CONFIG_TEMPLATES[0]);\n"
    out.write_text(h, encoding="utf-8")
    print(f"  [templates] {len(inis)} templates -> {out}")


if __name__ == "__main__":
    main()
