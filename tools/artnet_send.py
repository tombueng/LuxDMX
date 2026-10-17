#!/usr/bin/env python3
"""Send Art-Net DMX to a device. Bring-up tool, not a substitute for the tests.
  tools/artnet_send.py <ip> <universe> <seconds> [channel:value ...]
Without channel args: channels 1..8 at 10,20,...,80 and everything else 0.
"""
import socket, struct, sys, time

ip = sys.argv[1]
uni = int(sys.argv[2])
secs = float(sys.argv[3])
vals = bytearray(512)
if len(sys.argv) > 4:
    for a in sys.argv[4:]:
        c, v = a.split(':')
        vals[int(c) - 1] = int(v)
else:
    for i in range(8):
        vals[i] = (i + 1) * 10

s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
seq = 1
t0 = time.time()
n = 0
while time.time() - t0 < secs:
    pkt = b'Art-Net\x00' + struct.pack('<HH', 0x5000, 14) + bytes([seq, 0]) \
        + struct.pack('<H', uni) + struct.pack('>H', 512) + bytes(vals)
    s.sendto(pkt, (ip, 6454))
    seq = seq % 255 + 1
    n += 1
    time.sleep(0.025)
print("sent %d frames to %s uni=%d" % (n, ip, uni))
