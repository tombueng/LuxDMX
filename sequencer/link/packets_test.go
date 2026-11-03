package main

import (
	"encoding/binary"
	"testing"
)

func TestArtDmx(t *testing.T) {
	p := artDmx(0x123, 7, []byte{1, 2, 3})
	if string(p[:8]) != "Art-Net\x00" || binary.LittleEndian.Uint16(p[8:]) != 0x5000 || p[11] != 14 {
		t.Fatalf("header %v", p[:12])
	}
	if p[12] != 7 || p[14] != 0x23 || p[15] != 0x01 {
		t.Fatalf("seq/universe %v", p[12:16])
	}
	if binary.BigEndian.Uint16(p[16:]) != 4 || len(p) != 22 || p[18] != 1 || p[21] != 0 { // odd lengths padded to even
		t.Fatalf("length %d %v", len(p), p[16:])
	}
}

func TestSacn(t *testing.T) {
	var cid [16]byte
	data := make([]byte, 512)
	data[0] = 255
	p := sacn(cid, "LuxDMX Link", 1, 100, 9, data)
	if len(p) != 638 || binary.BigEndian.Uint16(p[16:])&0x0fff != 622 || binary.BigEndian.Uint16(p[38:])&0x0fff != 600 || binary.BigEndian.Uint16(p[115:])&0x0fff != 523 {
		t.Fatalf("lengths %d", len(p))
	}
	if string(p[4:13]) != "ASC-E1.17" || p[108] != 100 || p[111] != 9 || binary.BigEndian.Uint16(p[113:]) != 1 || binary.BigEndian.Uint16(p[123:]) != 513 || p[126] != 255 {
		t.Fatal("fields")
	}
	if g := sacnGroup(258); g.IP.String() != "239.255.1.2" || g.Port != 5568 {
		t.Fatal(g)
	}
}

func TestPollReply(t *testing.T) {
	b := make([]byte, 239)
	copy(b, "Art-Net\x00")
	binary.LittleEndian.PutUint16(b[8:], 0x2100)
	copy(b[10:], []byte{192, 168, 1, 50})
	b[18], b[19] = 1, 2 // net 1, sub-net 2
	copy(b[26:], "dmx-gateway")
	copy(b[44:], "LuxDMX WT32")
	binary.BigEndian.PutUint16(b[172:], 2)
	b[174], b[175] = 0x80, 0x80
	b[190], b[191] = 3, 4
	n, ok := parsePollReply(b)
	if !ok || n.IP != "192.168.1.50" || n.Short != "dmx-gateway" || n.Long != "LuxDMX WT32" || len(n.Universes) != 2 || n.Universes[0] != 0x123 || n.Universes[1] != 0x124 {
		t.Fatalf("%+v", n)
	}
	if _, ok := parsePollReply(b[:100]); ok {
		t.Fatal("short packet accepted")
	}
}

func TestOrigins(t *testing.T) {
	l := &Link{allowed: []string{"https://luxdmx.org", "http://localhost:*"}}
	for o, want := range map[string]bool{"https://luxdmx.org": true, "http://localhost:5173": true, "http://localhost": true, "https://evil.example": false, "http://localhost.evil.example": false, "": true} {
		if l.originOK(o) != want {
			t.Errorf("%q: %v", o, !want)
		}
	}
}
