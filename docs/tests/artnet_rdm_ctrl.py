#!/usr/bin/env python3
# Art-Net RDM controller / test harness for LuxDMX.
#
# Speaks the controller ("console") side of Art-Net 4 RDM against a LuxDMX node:
#   ArtPoll        (0x2000) -> ArtPollReply  (0x2100)   node discovery
#   ArtTodRequest  (0x8000) -> ArtTodData    (0x8100)   read the node's Table of Devices
#   ArtTodControl  (0x8200) -> ArtTodData    (0x8100)   AtcFlush = force a fresh discovery
#   ArtRdm         (0x8300) <-> ArtRdm       (0x8300)   GET/SET pass-through to a fixture
#
# The node runs RDM discovery on the physical DMX wire itself and exposes the
# result as its TOD; GET/SET are relayed to the fixture and the reply comes back.
# This is exactly the model in docs/rdm-investigation/rdm-over-network-investigation.md.
#
# Pure stdlib, no deps. Usage examples at the bottom (run with -h).

import argparse
import socket
import struct
import sys
import time

ART_ID = b"Art-Net\x00"
ART_PORT = 6454

OP_POLL          = 0x2000
OP_POLL_REPLY    = 0x2100
OP_DMX           = 0x5000
OP_TOD_REQUEST   = 0x8000
OP_TOD_DATA      = 0x8100
OP_TOD_CONTROL   = 0x8200
OP_RDM           = 0x8300

# RDM (E1.20)
RDM_SC      = 0xCC
RDM_SUB_SC  = 0x01
CC_DISC     = 0x10
CC_GET      = 0x20
CC_GET_RESP = 0x21
CC_SET      = 0x30
CC_SET_RESP = 0x31
SUB_ROOT    = 0x0000

PID_DISC_UNIQUE_BRANCH   = 0x0001
PID_DISC_MUTE            = 0x0002
PID_DISC_UN_MUTE         = 0x0003
PID_SUPPORTED_PARAMETERS = 0x0050
PID_DEVICE_INFO          = 0x0060
PID_SOFTWARE_VERSION_LABEL = 0x00C0
PID_DMX_START_ADDRESS    = 0x00F0
PID_IDENTIFY_DEVICE      = 0x1000
PID_SENSOR_DEFINITION    = 0x0200
PID_SENSOR_VALUE         = 0x0201

RESP_ACK       = 0x00
RESP_ACK_TIMER = 0x01
RESP_NACK      = 0x02
RESP_ACK_OVER  = 0x03


def uid_bytes(uid):
    """uid = (man_id, dev_id) -> 6 bytes."""
    man, dev = uid
    return struct.pack(">HI", man, dev)


def parse_uid(b):
    man, dev = struct.unpack(">HI", b[:6])
    return (man, dev)


def uid_str(uid):
    return "%04X:%08X" % uid


def rdm_checksum(msg):
    """E1.20 checksum = sum of every byte INCLUDING the 0xCC start code."""
    return sum(msg) & 0xFFFF


def build_rdm(dest_uid, src_uid, cc, pid, pd=b"", tn=1, port_id=1, msg_count=0,
              sub=SUB_ROOT):
    """Full RDM message on the wire, with 0xCC start code + 16-bit checksum."""
    pdl = len(pd)
    body = bytes([RDM_SC, RDM_SUB_SC, 24 + pdl])
    body += uid_bytes(dest_uid) + uid_bytes(src_uid)
    body += bytes([tn & 0xFF, port_id, msg_count])
    body += struct.pack(">H", sub)
    body += bytes([cc])
    body += struct.pack(">H", pid)
    body += bytes([pdl]) + pd
    ck = rdm_checksum(body)
    return body + struct.pack(">H", ck)


def parse_rdm(msg):
    """Parse a full RDM message (with SC). Returns dict or None if malformed."""
    if len(msg) < 26 or msg[0] != RDM_SC or msg[1] != RDM_SUB_SC:
        return None
    mlen = msg[2]
    if mlen + 2 > len(msg):
        return None
    if rdm_checksum(msg[:mlen]) != struct.unpack(">H", msg[mlen:mlen + 2])[0]:
        return {"bad_checksum": True}
    pdl = msg[23]
    return {
        "dest": parse_uid(msg[3:9]),
        "src":  parse_uid(msg[9:15]),
        "tn":   msg[15],
        "resp_type": msg[16],   # response type for a reply
        "msg_count": msg[17],
        "sub":  struct.unpack(">H", msg[18:20])[0],
        "cc":   msg[20],
        "pid":  struct.unpack(">H", msg[21:23])[0],
        "pd":   bytes(msg[24:24 + pdl]),
    }


# --------------------------------------------------------------------------- #
#  Art-Net packet builders
# --------------------------------------------------------------------------- #
def build_artpoll():
    return ART_ID + struct.pack("<H", OP_POLL) + bytes([0, 14, 0x00, 0x10])


def build_tod_request(port_address):
    net = (port_address >> 8) & 0x7F
    addr = port_address & 0xFF
    p = ART_ID + struct.pack("<H", OP_TOD_REQUEST) + bytes([0, 14])
    p += bytes([0, 0]) + bytes(7)            # Filler1, Filler2, Spare[7]
    p += bytes([net, 0x00, 1, addr])         # Net, Command(AtcNone), AddCount=1, Address
    return p


def build_tod_control(port_address, flush=True):
    net = (port_address >> 8) & 0x7F
    addr = port_address & 0xFF
    p = ART_ID + struct.pack("<H", OP_TOD_CONTROL) + bytes([0, 14])
    p += bytes([0, 0]) + bytes(7)            # Filler1, Filler2, Spare[7]
    p += bytes([net, 0x01 if flush else 0x00, addr])   # Net, Command(AtcFlush=1), Address
    return p


def build_artrdm(port_address, rdm_full_msg):
    """Wrap a full RDM message (with SC) as ArtRdm: SC is stripped for transport."""
    net = (port_address >> 8) & 0x7F
    addr = port_address & 0xFF
    p = ART_ID + struct.pack("<H", OP_RDM) + bytes([0, 14])
    p += bytes([0x01, 0x00]) + bytes(7)      # RdmVer=1, Filler2, Spare[7]
    p += bytes([net, 0x00, addr])            # Net, Command(ArProcess=0), Address
    p += bytes(rdm_full_msg[1:])             # RDM packet WITHOUT the 0xCC start code
    return p


def parse_artrdm(pkt):
    """Extract the RDM response from an ArtRdm packet (re-add the SC)."""
    if len(pkt) < 25:
        return None
    rdm_no_sc = pkt[24:]
    return parse_rdm(bytes([RDM_SC]) + rdm_no_sc)


def parse_tod_data(pkt):
    if len(pkt) < 28:
        return None
    net = pkt[21]
    addr = pkt[23]
    uid_total = struct.unpack(">H", pkt[24:26])[0]
    uid_count = pkt[27]
    uids = []
    for i in range(uid_count):
        off = 28 + i * 6
        if off + 6 <= len(pkt):
            uids.append(parse_uid(pkt[off:off + 6]))
    return {"port_address": (net << 8) | addr, "uid_total": uid_total, "uids": uids}


def parse_poll_reply(pkt):
    if len(pkt) < 207 or pkt[:8] != ART_ID:
        return None
    ip = ".".join(str(b) for b in pkt[10:14])
    short = pkt[26:44].split(b"\x00")[0].decode("latin1", "replace")
    long = pkt[44:108].split(b"\x00")[0].decode("latin1", "replace")
    num_ports = struct.unpack(">H", pkt[172:174])[0]
    port_types = pkt[174:178]
    good_output = pkt[182:186]   # GoodOutput[4]
    sw_out = pkt[190:194]        # SwOut[4] (low nibble of each port-address)
    net_switch = pkt[18]
    sub_switch = pkt[19]
    # Per-port 15-bit Port-Address = Net(7) : SubSwitch(4) : SwOut(4)
    port_addresses = []
    for i in range(min(num_ports, 4)):
        pa = (net_switch << 8) | ((sub_switch & 0x0F) << 4) | (sw_out[i] & 0x0F)
        port_addresses.append(pa)
    good_output_b = pkt[212:216] if len(pkt) >= 216 else b"\x00\x00\x00\x00"
    return {"ip": ip, "short": short, "long": long, "num_ports": num_ports,
            "port_types": list(port_types), "good_output": list(good_output),
            "good_output_b": list(good_output_b),
            "port_addresses": port_addresses}


# --------------------------------------------------------------------------- #
#  Controller
# --------------------------------------------------------------------------- #
class ArtRdmController:
    def __init__(self, node_ip, my_uid=(0x7FF0, 0x00000001), timeout=3.0, verbose=False):
        self.node_ip = node_ip
        self.my_uid = my_uid
        self.verbose = verbose
        self.tn = 1
        # Bind to the interface that routes to the node (like a real console binds to its
        # Art-Net NIC), so a broadcast ArtPoll leaves the correct interface on a multi-homed host.
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            probe.connect((node_ip, 6454)); self.local_ip = probe.getsockname()[0]
        except Exception:
            self.local_ip = "0.0.0.0"
        finally:
            probe.close()
        self.bcast = self.local_ip.rsplit(".", 1)[0] + ".255" if self.local_ip != "0.0.0.0" else "255.255.255.255"
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        self.sock.bind((self.local_ip, ART_PORT))
        self.sock.settimeout(timeout)

    def _send(self, pkt, ip=None):
        self.sock.sendto(pkt, (ip or self.node_ip, ART_PORT))

    def _recv_op(self, want_op, timeout=3.0, from_ip=None):
        """Wait for an Art-Net packet with opcode want_op (from node)."""
        end = time.time() + timeout
        while time.time() < end:
            self.sock.settimeout(max(0.05, end - time.time()))
            try:
                data, addr = self.sock.recvfrom(2048)
            except socket.timeout:
                break
            if len(data) < 10 or data[:8] != ART_ID:
                continue
            op = struct.unpack("<H", data[8:10])[0]
            if op == want_op and (from_ip is None or addr[0] == from_ip):
                return data, addr
        return None, None

    def poll(self):
        self._send(build_artpoll(), ip=self.bcast)   # subnet-directed broadcast on the bound NIC
        data, addr = self._recv_op(OP_POLL_REPLY, from_ip=self.node_ip)
        return parse_poll_reply(data) if data else None

    def tod_request(self, port_address):
        self._send(build_tod_request(port_address))
        data, _ = self._recv_op(OP_TOD_DATA)
        return parse_tod_data(data) if data else None

    def tod_flush(self, port_address, wait=6.0):
        self._send(build_tod_control(port_address, flush=True))
        # After a flush the node re-discovers (takes a couple seconds) then
        # pushes ArtTodData. Collect the freshest one within the window.
        end = time.time() + wait
        latest = None
        while time.time() < end:
            data, _ = self._recv_op(OP_TOD_DATA, timeout=max(0.1, end - time.time()))
            if data:
                latest = parse_tod_data(data)
        return latest

    def rdm(self, port_address, dest_uid, cc, pid, pd=b"", retries=2):
        """One ArtRdm GET/SET transaction. Returns parsed RDM response or None."""
        for _ in range(retries + 1):
            self.tn = (self.tn % 255) + 1
            msg = build_rdm(dest_uid, self.my_uid, cc, pid, pd, tn=self.tn)
            self._send(build_artrdm(port_address, msg))
            end = time.time() + 3.0
            while time.time() < end:
                data, _ = self._recv_op(OP_RDM, timeout=max(0.1, end - time.time()))
                if not data:
                    break
                r = parse_artrdm(data)
                if r and not r.get("bad_checksum") and r.get("src") == dest_uid \
                        and r.get("pid") == pid:
                    return r
        return None

    # -- typed helpers -----------------------------------------------------
    def get_device_info(self, pa, uid):
        r = self.rdm(pa, uid, CC_GET, PID_DEVICE_INFO)
        if not r or r["resp_type"] != RESP_ACK or len(r["pd"]) < 19:
            return None
        pd = r["pd"]
        return {
            "rdm_proto": struct.unpack(">H", pd[0:2])[0],
            "model": struct.unpack(">H", pd[2:4])[0],
            "category": struct.unpack(">H", pd[4:6])[0],
            "sw_ver": struct.unpack(">I", pd[6:10])[0],
            "footprint": struct.unpack(">H", pd[10:12])[0],
            "pers_cur": pd[12], "pers_count": pd[13],
            "dmx_addr": struct.unpack(">H", pd[14:16])[0],
            "sub_count": struct.unpack(">H", pd[16:18])[0],
            "sensor_count": pd[18],
        }

    def get_sw_label(self, pa, uid):
        r = self.rdm(pa, uid, CC_GET, PID_SOFTWARE_VERSION_LABEL)
        if not r or r["resp_type"] != RESP_ACK:
            return None
        return r["pd"].split(b"\x00")[0].decode("latin1", "replace")

    def get_sensor_value(self, pa, uid, sensor=0):
        r = self.rdm(pa, uid, CC_GET, PID_SENSOR_VALUE, bytes([sensor]))
        if not r or r["resp_type"] != RESP_ACK or len(r["pd"]) < 3:
            return None
        return struct.unpack(">h", r["pd"][1:3])[0]

    def set_dmx_address(self, pa, uid, addr):
        r = self.rdm(pa, uid, CC_SET, PID_DMX_START_ADDRESS, struct.pack(">H", addr))
        return bool(r and r["resp_type"] == RESP_ACK)

    def set_identify(self, pa, uid, on):
        r = self.rdm(pa, uid, CC_SET, PID_IDENTIFY_DEVICE, bytes([1 if on else 0]))
        return bool(r and r["resp_type"] == RESP_ACK)


# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(description="Art-Net RDM controller / test harness")
    ap.add_argument("node", help="LuxDMX node IP")
    ap.add_argument("--pa", type=lambda x: int(x, 0), default=0, help="port-address (universe)")
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("poll")
    sub.add_parser("tod")
    sub.add_parser("flush")
    g = sub.add_parser("get"); g.add_argument("uid"); g.add_argument("what",
        choices=["info", "sw", "sensor"])
    s = sub.add_parser("setaddr"); s.add_argument("uid"); s.add_argument("addr", type=int)
    idn = sub.add_parser("identify"); idn.add_argument("uid"); idn.add_argument("on", choices=["on", "off"])
    sub.add_parser("selftest")
    args = ap.parse_args()

    def puid(s):
        man, dev = s.split(":")
        return (int(man, 16), int(dev, 16))

    c = ArtRdmController(args.node, verbose=args.verbose)

    if args.cmd == "poll":
        r = c.poll()
        print(r)
    elif args.cmd == "tod":
        r = c.tod_request(args.pa)
        if r:
            print("port-address 0x%04X, %d device(s):" % (r["port_address"], r["uid_total"]))
            for u in r["uids"]:
                print("  ", uid_str(u))
        else:
            print("no ArtTodData")
    elif args.cmd == "flush":
        r = c.tod_flush(args.pa)
        if r:
            print("after flush: %d device(s)" % len(r["uids"]))
            for u in r["uids"]:
                print("  ", uid_str(u))
        else:
            print("no ArtTodData after flush")
    elif args.cmd == "get":
        uid = puid(args.uid)
        if args.what == "info":
            print(c.get_device_info(args.pa, uid))
        elif args.what == "sw":
            print(c.get_sw_label(args.pa, uid))
        elif args.what == "sensor":
            print("sensor0 =", c.get_sensor_value(args.pa, uid))
    elif args.cmd == "setaddr":
        print("ok" if c.set_dmx_address(args.pa, puid(args.uid), args.addr) else "FAIL")
    elif args.cmd == "identify":
        print("ok" if c.set_identify(args.pa, puid(args.uid), args.on == "on") else "FAIL")
    elif args.cmd == "selftest":
        sys.exit(selftest(c, args.pa))


def selftest(c, pa):
    """Full end-to-end Art-Net RDM validation. Returns process exit code."""
    fails = 0

    def check(name, ok, detail=""):
        nonlocal fails
        print(("PASS " if ok else "FAIL ") + name + ((" -- " + detail) if detail else ""))
        if not ok:
            fails += 1
        return ok

    print("== Art-Net RDM self-test against %s (port-address 0x%04X) ==" % (c.node_ip, pa))

    r = c.poll()
    check("ArtPoll -> ArtPollReply", r is not None,
          (r["short"] + " " + str(r.get("port_addresses")) if r else ""))

    tod = c.tod_request(pa)
    check("ArtTodRequest -> ArtTodData", tod is not None,
          ("%d devices" % len(tod["uids"])) if tod else "")
    if not tod or not tod["uids"]:
        # try a flush to force discovery
        tod = c.tod_flush(pa)
        check("AtcFlush -> discovery", bool(tod and tod["uids"]),
              ("%d devices" % len(tod["uids"])) if tod else "")
    if not tod or not tod["uids"]:
        print("no devices in TOD; cannot test GET/SET")
        return 1 + fails

    uid = tod["uids"][0]
    print("testing against fixture", uid_str(uid))

    info = c.get_device_info(pa, uid)
    check("GET DEVICE_INFO", info is not None, str(info))

    sw = c.get_sw_label(pa, uid)
    check("GET SOFTWARE_VERSION_LABEL", sw is not None, repr(sw))

    if info and info["sensor_count"] > 0:
        v = c.get_sensor_value(pa, uid, 0)
        check("GET SENSOR_VALUE", v is not None, "value=%s" % v)

    orig = info["dmx_addr"] if info else 1
    newaddr = 123 if orig != 123 else 45
    ok = c.set_identify(pa, uid, True)
    check("SET IDENTIFY on", ok)
    ok = c.set_dmx_address(pa, uid, newaddr)
    check("SET DMX_START_ADDRESS -> %d" % newaddr, ok)
    info2 = c.get_device_info(pa, uid)
    check("read back new address", bool(info2 and info2["dmx_addr"] == newaddr),
          "got %s" % (info2["dmx_addr"] if info2 else None))
    # restore
    c.set_dmx_address(pa, uid, orig)
    c.set_identify(pa, uid, False)
    print("restored address to %d, identify off" % orig)

    print("== %s ==" % ("ALL PASS" if fails == 0 else "%d FAILURE(S)" % fails))
    return fails


if __name__ == "__main__":
    main()
