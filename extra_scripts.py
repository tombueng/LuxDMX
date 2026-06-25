"""
LumiGate pre-build script.
Converts src/pages/*.html and src/assets/*.{png,css} into C PROGMEM headers
under src/generated/ — runs at script-load time (before compilation).
Also writes src/generated/version.h from the LUMIGATE_VERSION env var.
"""
Import("env")
import os
import gzip
import pathlib

def escape_c(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\r", "")

# Large static pages are gzip-compressed (served with Content-Encoding: gzip)
# to slash per-connection heap/airtime. They must contain no {{placeholders}}
# (dynamic values are fetched client-side from /info.json).
GZIP_PAGES = {"index", "config"}

def html_to_header(path: pathlib.Path, out_dir: pathlib.Path):
    var = path.stem.upper().replace("-", "_").replace(".", "_") + "_HTML"
    out = out_dir / (path.stem + "_html.h")
    if path.stem in GZIP_PAGES:
        raw = path.read_bytes()
        gz  = gzip.compress(raw, compresslevel=9)
        rows = ["  " + ", ".join(f"0x{b:02x}" for b in gz[i:i+16]) + ","
                for i in range(0, len(gz), 16)]
        h  = f"// Auto-generated from {path.name} (gzip) — do not edit\n"
        h += f"static const uint8_t {var}[] PROGMEM = {{\n"
        h += "\n".join(rows) + "\n};\n"
        h += f"static const size_t  {var}_LEN = {len(gz)};\n"
        out.write_text(h, encoding="utf-8")
        print(f"  [embed] {path.name} -> {out.name}  gzip {len(raw)} -> {len(gz)} bytes")
        return
    content = path.read_text(encoding="utf-8")
    lines = content.split("\n")
    body = "\n".join(f'    "{escape_c(l)}\\n"' for l in lines)
    h = f"// Auto-generated from {path.name} — do not edit\n"
    h += f"static const char {var}[] PROGMEM =\n{body};\n"
    out.write_text(h, encoding="utf-8")
    print(f"  [embed] {path.name} -> {out.name}  ({len(content)} chars)")

def binary_to_header(path: pathlib.Path, out_dir: pathlib.Path, type_suffix: str):
    data = path.read_bytes()
    safe = path.stem.upper().replace("-", "_").replace(".", "_")
    var  = safe + "_" + type_suffix
    rows = ["  " + ", ".join(f"0x{b:02x}" for b in data[i:i+16]) + ","
            for i in range(0, len(data), 16)]
    h  = f"// Auto-generated from {path.name} — do not edit\n"
    h += f"static const uint8_t {var}[] PROGMEM = {{\n"
    h += "\n".join(rows) + "\n};\n"
    h += f"static const size_t  {var}_LEN = {len(data)};\n"
    out_name = path.stem.replace(".", "_") + "_" + type_suffix.lower() + ".h"
    out = out_dir / out_name
    out.write_text(h, encoding="utf-8")
    print(f"  [embed] {path.name} -> {out.name}  ({len(data)} bytes)")

def patch_esp_dmx():
    """Patch esp_dmx 4.1.0 so it builds + runs on arduino-esp32 v3 (ESP-IDF 5.5).

    Three fixes, all in dmx/hal/uart.c, all idempotent:

    1. UART2 crash. dmx_uart_context[] guards the UART2 entry with
       `#if DMX_NUM_MAX > 2`, but DMX_NUM_MAX is an *enum* constant — invisible to
       the preprocessor, which reads it as 0 — so `0 > 2` is false and the UART2
       entry is never compiled, even though the array is sized for it. Result:
       dmx_uart_context[2].dev is NULL and installing a driver on port 2 panics
       (LoadProhibited). The array's own size and types.h both use the real macro
       SOC_UART_NUM, so rewrite the guard to match.

    2. ESP-IDF 5.x removed the `.module` member of uart_periph_signal[] (the
       periph_module_t per UART), so esp_dmx fails to compile on the v3 framework
       ("'uart_signal_conn_t' has no member named 'module'"). periph_module_
       enable/reset/disable still exist, so pass the module enum directly:
       PERIPH_UART0_MODULE + dmx_num (PERIPH_UART0/1/2_MODULE are consecutive in
       soc/periph_defs.h, matching what the removed field used to hold).

    3. Fresh-boot Art-Net brick (issue #34). On a fresh board the TX ISR can fire
       with a corrupt driver->dmx_num (a stomp on the heap-allocated driver struct
       that only turns fatal in the release binary's memory layout). It then indexes
       past the 3-entry dmx_uart_context[] and writes to a garbage UART base
       (0x40000000) -> LoadStoreError boot loop on the first Art-Net frame. Drop any
       ISR entry whose dmx_num is out of range instead of dereferencing junk. This is
       a safety net; the underlying stomp still wants a root fix.
    """
    libdeps = pathlib.Path(env.subst("$PROJECT_LIBDEPS_DIR")) / env.subst("$PIOENV")
    uart_c = libdeps / "esp_dmx" / "src" / "dmx" / "hal" / "uart.c"
    if not uart_c.exists():
        print(f"  [patch] esp_dmx uart.c not present yet — skipped ({uart_c})")
        return
    text = original = uart_c.read_text(encoding="utf-8")

    text = text.replace("#if DMX_NUM_MAX > 2", "#if SOC_UART_NUM > 2")

    # Fix 3 (issue #34): guard the TX/RX ISR against a corrupt driver->dmx_num so it
    # cannot index past dmx_uart_context[] and dereference a garbage UART base.
    guard = "if (dmx_num < 0 || dmx_num >= DMX_NUM_MAX) return;"
    if guard not in text:
        text = text.replace(
            "  const dmx_port_t dmx_num = driver->dmx_num;\n",
            "  const dmx_port_t dmx_num = driver->dmx_num;\n"
            "  " + guard + "  // issue #34: drop a stray ISR with an out-of-range dmx_num\n",
            1)

    for old, new in [
        ("periph_module_enable(uart_periph_signal[dmx_num].module)",
         "periph_module_enable((periph_module_t)(PERIPH_UART0_MODULE + dmx_num))"),
        ("periph_module_reset(uart_periph_signal[dmx_num].module)",
         "periph_module_reset((periph_module_t)(PERIPH_UART0_MODULE + dmx_num))"),
        ("periph_module_disable(uart_periph_signal[uart->num].module)",
         "periph_module_disable((periph_module_t)(PERIPH_UART0_MODULE + uart->num))"),
    ]:
        text = text.replace(old, new)

    if text != original:
        uart_c.write_text(text, encoding="utf-8")
        print("  [patch] esp_dmx uart.c: UART2 guard + IDF5 periph_module + dmx_num ISR guard applied")
    else:
        print("  [patch] esp_dmx uart.c: already patched")

def generate_version(gen_dir: pathlib.Path):
    version = os.environ.get("LUMIGATE_VERSION", "dev")
    (gen_dir / "version.h").write_text(
        f'static const char FIRMWARE_VERSION[] = "{version}";\n',
        encoding="utf-8"
    )
    print(f"  [version] FIRMWARE_VERSION = {version}")

def generate():
    root    = pathlib.Path(env.subst("$PROJECT_DIR"))
    gen_dir = root / "src" / "generated"
    gen_dir.mkdir(exist_ok=True)
    print("LumiGate: generating embedded assets...")
    patch_esp_dmx()
    generate_version(gen_dir)
    for f in sorted((root / "src" / "pages").glob("*.html")):
        html_to_header(f, gen_dir)
    for f in sorted((root / "src" / "assets").glob("*.png")):
        binary_to_header(f, gen_dir, "PNG")
    for f in sorted((root / "src" / "assets").glob("*.svg")):
        binary_to_header(f, gen_dir, "SVG")
    for f in sorted((root / "src" / "assets").glob("*.css")):
        # Gzip-compress CSS before embedding — reduces 232 KB bootstrap to ~40 KB
        raw = f.read_bytes()
        compressed = gzip.compress(raw, compresslevel=9)
        # Write to a temp file with the original name so the header/variable
        # names stay identical (BOOTSTRAP_MIN_CSS / bootstrap_min_css.h)
        tmp = gen_dir / f.name
        tmp.write_bytes(compressed)
        binary_to_header(tmp, gen_dir, "CSS")
        tmp.unlink()
        print(f"  [gzip]  {f.name}: {len(raw)} -> {len(compressed)} bytes ({100*len(compressed)//len(raw)}%)")
    print("LumiGate: done.")

# Run immediately so headers exist before main.cpp is compiled
generate()
