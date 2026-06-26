#!/usr/bin/env python3
"""Smoke-test the LuxDMX serial config console on a real device.

Opens the device serial port, lets it boot, then sends console commands and
prints each response. Usage:  python serial_console_test.py [COM5] [115200]
"""
import sys, time, serial

port = sys.argv[1] if len(sys.argv) > 1 else "COM5"
baud = int(sys.argv[2]) if len(sys.argv) > 2 else 115200

def drain(ser, quiet=0.4, hard=3.0):
    """Read until `quiet` seconds pass with no new byte (or `hard` total)."""
    out = b""
    t0 = time.time(); last = time.time()
    while time.time() - t0 < hard:
        n = ser.in_waiting
        if n:
            out += ser.read(n); last = time.time()
        elif time.time() - last > quiet:
            break
        else:
            time.sleep(0.02)
    return out.decode("utf-8", "replace")

def cmd(ser, line):
    ser.reset_input_buffer()
    ser.write((line + "\n").encode())
    resp = drain(ser)
    print(f"\n>>> {line}\n{resp.strip()}")
    return resp

with serial.Serial(port, baud, timeout=1) as ser:
    time.sleep(0.3)
    boot = drain(ser, quiet=1.0, hard=6.0)   # capture boot log
    print("--- boot log (tail) ---")
    print("\n".join(boot.strip().splitlines()[-12:]))

    ok = True
    def expect(resp, needle):
        global ok
        good = needle in resp
        ok = ok and good
        print(f"    [{'OK ' if good else 'MISS'}] expect '{needle}'")

    expect(cmd(ser, "help"), "set <id>")
    expect(cmd(ser, "list Identity"), "hostname")
    expect(cmd(ser, "get o0_tx"), "o0_tx=")
    expect(cmd(ser, "set hostname luxtest"), "OK")
    expect(cmd(ser, "get hostname"), "hostname=luxtest")
    expect(cmd(ser, "set o0_tx 9"), "OK")
    expect(cmd(ser, "get o0_tx"), "o0_tx=9")
    expect(cmd(ser, "set o0_tx 999"), "OK")        # clamps
    expect(cmd(ser, "get o0_tx"), "o0_tx=48")
    expect(cmd(ser, "set boguskey 1"), "ERR")
    expect(cmd(ser, "json"), "\"outputs\":[")
    expect(cmd(ser, "template esp32s3dev"), "OK")
    expect(cmd(ser, "frobnicate"), "unknown command")

    print("\n=== RESULT:", "ALL OK" if ok else "SOME CHECKS MISSED", "===")
    sys.exit(0 if ok else 1)
