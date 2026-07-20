#!/usr/bin/env python3
"""Issue #93, experiment 3: is dmxBuf torn between core 0 (writer) and core 1 (RMT encoder)?

Fills ALL 512 channels with the SAME byte (a per-input-frame counter). A clean output
frame therefore has 512 identical bytes. A frame assembled while core 0 was memcpy'ing
a new frame in shows a split: a prefix of one value and a suffix of another. That split
IS the tear, and its position is the memcpy progress point.

Control for a false positive in the analyzer itself (its DMA also writes while the HTTP
handler reads): tears caused by the DUT must scale with the INPUT rate, since that is
what drives writes into dmxBuf. Tears caused by the analyzer would not.
"""
import json
import socket
import struct
import sys
import threading
import time
import urllib.request

DEV = "192.168.178.66"
SIM = "192.168.178.105"
UNIVERSE = 31432
RATES = [5.0, 20.0, 44.0]        # control (few writes) -> many writes
DWELL = float(sys.argv[1]) if len(sys.argv) > 1 else 30.0

stop = threading.Event()


def artdmx(seq, uni, data):
    p = bytearray(b"Art-Net\x00")
    p += struct.pack("<H", 0x5000)
    p += bytes([0, 14])
    p += bytes([seq & 0xFF, 0])
    p += bytes([uni & 0xFF, (uni >> 8) & 0xFF])
    p += struct.pack(">H", len(data))
    p += data
    return bytes(p)


def injector(rate):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    period = 1.0 / rate
    start = time.perf_counter()
    i = 0
    while not stop.is_set():
        v = (i % 251) + 1                     # 1..251, never 0, prime-ish wrap
        sock.sendto(artdmx(i, UNIVERSE, bytes([v]) * 512), (DEV, 6454))
        i += 1
        deadline = start + i * period
        while not stop.is_set():
            now = time.perf_counter()
            if now >= deadline:
                break
            if deadline - now > 0.0020:
                time.sleep(deadline - now - 0.0015)
    sock.close()


def run(rate):
    stop.clear()
    t = threading.Thread(target=injector, args=(rate,), daemon=True)
    t.start()
    time.sleep(2.0)

    frames = torn = 0
    examples = []
    seen_seq = set()
    t_end = time.perf_counter() + DWELL
    while time.perf_counter() < t_end:
        try:
            with urllib.request.urlopen(f"http://{SIM}/api/dmx", timeout=4) as r:
                d = json.loads(r.read().decode())
        except Exception:
            continue
        if d["seq"] in seen_seq:
            continue                          # only judge each wire frame once
        seen_seq.add(d["seq"])
        vals = bytes.fromhex(d["v"])
        frames += 1
        distinct = set(vals)
        if len(distinct) > 1:
            torn += 1
            # find the split point(s)
            splits = [i for i in range(1, len(vals)) if vals[i] != vals[i - 1]]
            if len(examples) < 5:
                examples.append(dict(seq=d["seq"], distinct=sorted(distinct),
                                     splits=splits[:4], nsplits=len(splits)))
    stop.set()
    t.join(timeout=3)
    return dict(rate=rate, frames=frames, torn=torn,
                pct=100.0 * torn / frames if frames else float("nan"),
                examples=examples)


def main():
    print(f"all-512-channels-identical tear detector, universe {UNIVERSE}, {DWELL}s per rate\n")
    print(f"{'inject Hz':>9} {'frames':>7} {'torn':>6} {'torn %':>8}")
    print("-" * 34)
    out = []
    for r in RATES:
        res = run(r)
        out.append(res)
        print(f"{res['rate']:9.2f} {res['frames']:7d} {res['torn']:6d} {res['pct']:7.2f}%")
        for e in res["examples"]:
            print(f"           seq={e['seq']} values={e['distinct']} "
                  f"split@{e['splits']} (n={e['nsplits']})")
    with open("tear_results.json", "w") as f:
        json.dump(out, f, indent=2)
    print("\nwrote tear_results.json")
    print("If torn% scales with inject Hz -> the tear is in the DUT (dmxBuf race).")
    print("If torn% is flat across rates  -> it is the analyzer's own read race, not the DUT.")


if __name__ == "__main__":
    main()
