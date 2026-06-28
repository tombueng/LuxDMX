#!/usr/bin/env python3
"""Smoke-test the LuxDMX minimal serial config interface on a real device.

Opens the device serial port, lets it boot, then exercises the key=value grammar
(dump / bare key=value partial write / get) and prints each exchange.
Usage:  python serial_console_test.py [COM5] [115200]
"""
import sys, time, serial

port = sys.argv[1] if len(sys.argv) > 1 else "COM5"
baud = int(sys.argv[2]) if len(sys.argv) > 2 else 115200

def drain(ser, quiet=0.4, hard=3.0):
    out = b""; t0 = time.time(); last = time.time()
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
    boot = drain(ser, quiet=1.0, hard=6.0)
    print("--- boot log (tail) ---")
    print("\n".join(boot.strip().splitlines()[-10:]))

    ok = True
    def expect(resp, needle):
        global ok
        good = needle in resp
        ok = ok and good
        print(f"    [{'OK ' if good else 'MISS'}] expect '{needle}'")

    d = cmd(ser, "dump")
    expect(d, "o0_tx=")
    expect(d, "hostname=")
    expect(d, "otapw=***")                 # secret masked
    expect(cmd(ser, "o0_rx=16"), "OK")     # bare key=value partial write
    expect(cmd(ser, "get o0_rx"), "o0_rx=16")
    expect(cmd(ser, "o0_rx=18 protocol=2"), "OK 2")   # multi, space-separated
    expect(cmd(ser, "get o0_rx"), "o0_rx=18")
    expect(cmd(ser, "bogus=1"), "ERR")
    expect(cmd(ser, "help"), "dump")
    expect(cmd(ser, "frobnicate"), "unknown command")

    print("\n=== RESULT:", "ALL OK" if ok else "SOME CHECKS MISSED", "===")
    sys.exit(0 if ok else 1)
