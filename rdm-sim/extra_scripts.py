"""
RDM-sim pre-build script.

Patches esp_dmx 4.1.0 so it builds on arduino-esp32 v3 (ESP-IDF 5.5), identical
to the fix the main LumiGate firmware carries. Two idempotent edits in
dmx/hal/uart.c:

  1. UART2 guard: `#if DMX_NUM_MAX > 2` reads DMX_NUM_MAX (an enum) as 0 in the
     preprocessor, so the UART2 context entry is never compiled. Use the real
     macro SOC_UART_NUM instead. (The sim only uses UART1, but keep the fix so
     the build matches the main firmware.)
  2. ESP-IDF 5.x removed uart_periph_signal[].module, so pass the module enum
     directly: PERIPH_UART0_MODULE + dmx_num.
"""
Import("env")
import pathlib

def patch_esp_dmx():
    libdeps = pathlib.Path(env.subst("$PROJECT_LIBDEPS_DIR")) / env.subst("$PIOENV")
    uart_c = libdeps / "esp_dmx" / "src" / "dmx" / "hal" / "uart.c"
    if not uart_c.exists():
        print(f"  [patch] esp_dmx uart.c not present yet - skipped ({uart_c})")
        return
    text = original = uart_c.read_text(encoding="utf-8")

    text = text.replace("#if DMX_NUM_MAX > 2", "#if SOC_UART_NUM > 2")

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
        print("  [patch] esp_dmx uart.c: UART2 guard + IDF5 periph_module fix applied")
    else:
        print("  [patch] esp_dmx uart.c: already patched")

print("RDM-sim: patching esp_dmx...")
patch_esp_dmx()
print("RDM-sim: done.")
