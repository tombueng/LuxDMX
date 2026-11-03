package main

import (
	"encoding/binary"
	"net"
	"sync"
	"testing"
	"time"
)

func TestUIDAndRdmPacket(t *testing.T) {
	u, ok := parseUID("4c55:0000002a")
	if !ok || u.String() != "4C55:0000002A" {
		t.Fatalf("uid: %v %v", u, ok)
	}
	if _, ok := parseUID("4c55-2a"); ok {
		t.Fatal("a bad uid read")
	}
	src := UID{0x7f, 0xf0, 0, 0, 0, 1}
	p := rdmPacket(u, src, 9, ccGet, pidDeviceInfo, []byte{1, 2})
	if p[0] != 0xCC || p[2] != 26 || len(p) != 28 {
		t.Fatalf("packet %x", p)
	}
	r, ok := parseRdm(p[1:])
	if !ok || r.src != src || r.tn != 9 || r.pid != pidDeviceInfo || len(r.pd) != 2 {
		t.Fatalf("read back %+v %v", r, ok)
	}
	p[5] ^= 1 // a wrong checksum is no packet
	if _, ok := parseRdm(p[1:]); ok {
		t.Fatal("a broken packet read")
	}
}

// a node with RDM lights on its output, answering like one
type fakeLight struct {
	uid      UID
	addr     int
	pers     int
	modes    [][2]any // name, footprint
	label    string
	identify bool
	temp     int
}
type fakeNode struct {
	conn   *net.UDPConn
	mu     sync.Mutex
	lights []*fakeLight
	pa     int
	quiet  map[UID]bool
}

func (n *fakeNode) serve() {
	buf := make([]byte, 1500)
	for {
		k, from, err := n.conn.ReadFromUDP(buf)
		if err != nil {
			return
		}
		b := buf[:k]
		if k < 24 || string(b[:8]) != string(artID) {
			continue
		}
		switch binary.LittleEndian.Uint16(b[8:]) {
		case opTodRequest:
			p := artHead(opTodData, 28+6*len(n.lights))
			p[12], p[13] = 1, 1
			p[21], p[23] = byte(n.pa>>8), byte(n.pa)
			binary.BigEndian.PutUint16(p[24:], uint16(len(n.lights)))
			p[27] = byte(len(n.lights))
			for i, l := range n.lights {
				copy(p[28+i*6:], l.uid[:])
			}
			n.conn.WriteToUDP(p, from)
		case opRdm:
			req, ok := parseRdm(b[24:])
			if !ok {
				continue
			}
			var dest UID
			copy(dest[:], b[26:32])
			n.mu.Lock()
			var l *fakeLight
			for _, x := range n.lights {
				if x.uid == dest && !n.quiet[x.uid] {
					l = x
				}
			}
			if l == nil {
				n.mu.Unlock()
				continue
			}
			pd := n.answer(l, req)
			n.mu.Unlock()
			resp := rdmPacket(req.src, l.uid, req.tn, req.cc+1, req.pid, pd)
			resp[16] = respAck
			// (the checksum again: the response type byte changed)
			m := int(resp[2])
			var sum uint16
			for _, x := range resp[:m] {
				sum += uint16(x)
			}
			binary.BigEndian.PutUint16(resp[m:], sum)
			n.conn.WriteToUDP(artRdm(n.pa, resp), from)
		}
	}
}

func (n *fakeNode) answer(l *fakeLight, r rdmResp) []byte {
	foot := l.modes[l.pers-1][1].(int)
	if r.cc == ccSet {
		switch r.pid {
		case pidStartAddress:
			l.addr = int(binary.BigEndian.Uint16(r.pd))
		case pidPersonality:
			l.pers = int(r.pd[0])
		case pidDeviceLabel:
			l.label = string(r.pd)
		case pidIdentify:
			l.identify = r.pd[0] == 1
		}
		return nil
	}
	switch r.pid {
	case pidDeviceInfo:
		b := make([]byte, 19)
		b[0], b[1] = 1, 0
		binary.BigEndian.PutUint16(b[2:], 0x0042)
		binary.BigEndian.PutUint16(b[4:], 0x0101)
		binary.BigEndian.PutUint32(b[6:], 7)
		binary.BigEndian.PutUint16(b[10:], uint16(foot))
		b[12], b[13] = byte(l.pers), byte(len(l.modes))
		binary.BigEndian.PutUint16(b[14:], uint16(l.addr))
		b[18] = 1
		return b
	case pidMfgLabel:
		return []byte("Test Lights")
	case pidModelDesc:
		return []byte("Head 11")
	case pidDeviceLabel:
		return []byte(l.label)
	case pidSoftwareLabel:
		return []byte("1.0")
	case pidPersonalityDesc:
		i := int(r.pd[0])
		m := l.modes[i-1]
		return append([]byte{byte(i), 0, byte(m[1].(int))}, []byte(m[0].(string))...)
	case pidSensorDef:
		return append([]byte{0, 0, 1, 0, 0, 0, 0, 100, 0, 0, 0, 80, 0}, []byte("Head")...)
	case pidSensorValue:
		return []byte{0, 0, byte(l.temp), 0, 20, 0, byte(l.temp), 0, 0}
	case pidStatusMessages:
		return []byte{0, 0, 3, 0, 0x20, 0, 0, 0, 0}
	case pidDeviceHours:
		return []byte{0, 0, 1, 0}
	}
	return nil
}

func TestRdmOverArtNet(t *testing.T) {
	nc, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	node := &fakeNode{conn: nc, pa: 0x0001, quiet: map[UID]bool{}, lights: []*fakeLight{
		{uid: UID{0x4c, 0x55, 0, 0, 0, 1}, addr: 1, pers: 1, modes: [][2]any{{"11 channel", 11}, {"16 channel", 16}}, label: "SL head", temp: 41},
		{uid: UID{0x4c, 0x55, 0, 0, 0, 2}, addr: 20, pers: 2, modes: [][2]any{{"11 channel", 11}, {"16 channel", 16}}, temp: 38},
	}}
	go node.serve()
	defer nc.Close()
	l, err := newLink(0, nil)
	if err != nil {
		t.Fatal(err)
	}
	l.nodePort = nc.LocalAddr().(*net.UDPAddr).Port
	l.rdmWait, l.rdmSearch = 200*time.Millisecond, 100*time.Millisecond
	l.nodes["127.0.0.1/0"] = Node{IP: "127.0.0.1", Universes: []int{0x0001}, Seen: time.Now().Unix()}
	go l.listen()
	defer l.art.Close()

	if r := l.rdm.handle(rdmReq{ID: "1", Op: "scan"}); r["ok"] != true {
		t.Fatalf("scan: %v", r)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && !l.rdm.list()["scanned"].(bool) {
		time.Sleep(20 * time.Millisecond)
	}
	devs := l.rdm.list()["devices"].([]rdmDev)
	if len(devs) != 2 {
		t.Fatalf("found %d lights", len(devs))
	}
	d := devs[0]
	if d.UID != "4C55:00000001" || d.Uni != 1 || d.Addr != 1 || d.Footprint != 11 || d.Pers != 1 || d.PersCount != 2 || d.Mfg != "Test Lights" || d.ModelName != "Head 11" || d.Label != "SL head" || d.Node != "127.0.0.1" {
		t.Fatalf("light 1: %+v", d)
	}
	if len(d.Modes) != 2 || d.Modes[1].Name != "16 channel" || d.Modes[1].Footprint != 16 {
		t.Fatalf("its modes: %+v", d.Modes)
	}
	if len(d.Sensors) != 1 || d.Sensors[0].Name != "Head" || d.Sensors[0].Unit != "C" || d.Sensors[0].Value != 41 || d.StType != 3 || d.StID != 0x20 || d.Hours == nil || *d.Hours != 256 {
		t.Fatalf("its health: %+v %d %d %v", d.Sensors, d.StType, d.StID, d.Hours)
	}
	if devs[1].Footprint != 16 || devs[1].Addr != 20 {
		t.Fatalf("light 2: %+v", devs[1])
	}

	// set its address, mode, label, identify: the light changes, the list says so
	for _, q := range []rdmReq{{Op: "address", UID: "4C55:00000001", Addr: 100}, {Op: "mode", UID: "4c55:00000001", Mode: 2}, {Op: "label", UID: "4C55:00000001", Label: "Spot left"}, {Op: "identify", UID: "4C55:00000001", On: true}} {
		q.ID = "2"
		if r := l.rdm.handle(q); r["ok"] != true {
			t.Fatalf("%s: %v", q.Op, r)
		}
	}
	got := node.lights[0]
	if got.addr != 100 || got.pers != 2 || got.label != "Spot left" || !got.identify {
		t.Fatalf("the light: %+v", got)
	}
	d = l.rdm.list()["devices"].([]rdmDev)[0]
	if d.Addr != 100 || d.Pers != 2 || d.Footprint != 16 || d.Label != "Spot left" || !d.Identify {
		t.Fatalf("the list: %+v", d)
	}
	// a light that doesn't answer: an error, soon; an unknown one: refused
	node.mu.Lock()
	node.quiet[node.lights[1].uid] = true
	node.mu.Unlock()
	if r := l.rdm.handle(rdmReq{ID: "3", Op: "identify", UID: "4C55:00000002", On: true}); r["ok"] != false || r["status"] != 502 {
		t.Fatalf("quiet light: %v", r)
	}
	if r := l.rdm.handle(rdmReq{ID: "4", Op: "address", UID: "4C55:00000099", Addr: 1}); r["ok"] != false || r["status"] != 400 {
		t.Fatalf("unknown light: %v", r)
	}
}
