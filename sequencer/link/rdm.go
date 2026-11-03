// RDM (ANSI E1.20) over Art-Net 4, for the sequencer's rig check: Link is the RDM controller.
// It asks every node for the lights on its outputs (ArtTodControl to search afresh, then
// ArtTodRequest; the node answers with ArtTodData), then reads and sets each light through its node
// (ArtRdm): who it is, its labels, its modes, its address, sensors, status messages and hours;
// identify, address, mode and label. The page gets what a LuxDMX box's /rdm.json says, in the same
// shape, so the sequencer reads both the same way.
package main

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	opTodRequest = 0x8000
	opTodData    = 0x8100
	opTodControl = 0x8200
	opRdm        = 0x8300
)

// RDM command classes, response types and the parameters we use
const (
	ccGet     = 0x20
	ccGetResp = 0x21
	ccSet     = 0x30
	ccSetResp = 0x31

	respAck      = 0x00
	respAckTimer = 0x01

	pidStatusMessages  = 0x0030
	pidDeviceInfo      = 0x0060
	pidModelDesc       = 0x0080
	pidMfgLabel        = 0x0081
	pidDeviceLabel     = 0x0082
	pidSoftwareLabel   = 0x00C0
	pidPersonality     = 0x00E0
	pidPersonalityDesc = 0x00E1
	pidStartAddress    = 0x00F0
	pidSensorDef       = 0x0200
	pidSensorValue     = 0x0201
	pidDeviceHours     = 0x0400
	pidIdentify        = 0x1000
)

// UID: a light's RDM id, maker (2 bytes) and device (4)
type UID [6]byte

func (u UID) String() string {
	return fmt.Sprintf("%02X%02X:%02X%02X%02X%02X", u[0], u[1], u[2], u[3], u[4], u[5])
}

func parseUID(s string) (UID, bool) {
	var u UID
	parts := strings.Split(s, ":")
	if len(parts) != 2 || len(parts[0]) != 4 || len(parts[1]) != 8 {
		return u, false
	}
	m, err1 := strconv.ParseUint(parts[0], 16, 16)
	d, err2 := strconv.ParseUint(parts[1], 16, 32)
	if err1 != nil || err2 != nil {
		return u, false
	}
	binary.BigEndian.PutUint16(u[0:], uint16(m))
	binary.BigEndian.PutUint32(u[2:], uint32(d))
	return u, true
}

// ---- the packets
func artHead(op uint16, n int) []byte {
	p := make([]byte, n)
	copy(p, artID)
	binary.LittleEndian.PutUint16(p[8:], op)
	p[10], p[11] = 0, protVer
	return p
}

// ArtTodRequest: "send me your table of devices" for one port-address
func artTodRequest(portAddr int) []byte {
	p := artHead(opTodRequest, 24+32)
	p[21] = byte((portAddr >> 8) & 0x7f) // Net
	p[22] = 0                            // TodFull
	p[23] = 1                            // AdCount
	p[24] = byte(portAddr & 0xff)        // Address[0]: sub-net and universe
	return p
}

// ArtTodControl: flush (search the line afresh) for one port-address
func artTodControl(portAddr int) []byte {
	p := artHead(opTodControl, 24)
	p[21] = byte((portAddr >> 8) & 0x7f)
	p[22] = 0x01 // AtcFlush
	p[23] = byte(portAddr & 0xff)
	return p
}

// ArtRdm carrying one RDM packet (without its start code) to a port-address
func artRdm(portAddr int, rdm []byte) []byte {
	p := artHead(opRdm, 24+len(rdm)-1)
	p[12] = 0x01 // RdmVer: RDM standard
	p[21] = byte((portAddr >> 8) & 0x7f)
	p[22] = 0 // ArProcess
	p[23] = byte(portAddr & 0xff)
	copy(p[24:], rdm[1:])
	return p
}

// an RDM request (start code first, the checksum last) to a light's root device
func rdmPacket(dest, src UID, tn, cc byte, pid uint16, pd []byte) []byte {
	n := 24 + len(pd)
	p := make([]byte, n+2)
	p[0], p[1], p[2] = 0xCC, 0x01, byte(n)
	copy(p[3:9], dest[:])
	copy(p[9:15], src[:])
	p[15], p[16], p[17] = tn, 1, 0
	p[20] = cc
	binary.BigEndian.PutUint16(p[21:], pid)
	p[23] = byte(len(pd))
	copy(p[24:], pd)
	var sum uint16
	for _, b := range p[:n] {
		sum += uint16(b)
	}
	binary.BigEndian.PutUint16(p[n:], sum)
	return p
}

type rdmResp struct {
	src   UID
	tn    byte
	rtype byte
	cc    byte
	pid   uint16
	pd    []byte
}

// an RDM packet as ArtRdm carries it (from the sub start code on), checked
func parseRdm(b []byte) (rdmResp, bool) {
	var r rdmResp
	if len(b) < 25 || b[0] != 0x01 {
		return r, false
	}
	n := int(b[1]) // counts the start code that isn't there
	if n < 24 || len(b) < n+1 {
		return r, false
	}
	sum := uint16(0xCC)
	for _, x := range b[:n-1] {
		sum += uint16(x)
	}
	if binary.BigEndian.Uint16(b[n-1:]) != sum {
		return r, false
	}
	copy(r.src[:], b[8:14])
	r.tn, r.rtype, r.cc = b[14], b[15], b[19]
	r.pid = binary.BigEndian.Uint16(b[20:])
	pdl := int(b[22])
	if 23+pdl > n-1 {
		return r, false
	}
	r.pd = append([]byte{}, b[23:23+pdl]...)
	return r, true
}

// ---- what the page reads (the shape of a LuxDMX box's /rdm.json)
type rdmMode struct {
	N         int    `json:"n"`
	Name      string `json:"name"`
	Footprint int    `json:"footprint"`
}
type rdmSensor struct {
	Name  string `json:"name"`
	Value int    `json:"value"`
	Lo    int    `json:"lo"`
	Hi    int    `json:"hi"`
	Type  int    `json:"type"`
	Unit  string `json:"unit"`
	num   int
}
type rdmDev struct {
	UID       string      `json:"uid"`
	Uni       int         `json:"uni"`
	Addr      int         `json:"addr"`
	Footprint int         `json:"footprint"`
	Model     int         `json:"model"`
	Pers      int         `json:"pers"`
	PersCount int         `json:"persCount"`
	Modes     []rdmMode   `json:"modes,omitempty"`
	Identify  bool        `json:"identify"`
	Sw        string      `json:"sw"`
	Mfg       string      `json:"mfg"`
	ModelName string      `json:"modelName"`
	Label     string      `json:"label"`
	Cat       int         `json:"cat"`
	SwVer     uint32      `json:"swVer"`
	Sensors   []rdmSensor `json:"sensors"`
	StType    int         `json:"stType"`
	StID      int         `json:"stId"`
	StCount   int         `json:"stCount"`
	Hours     *uint32     `json:"hours,omitempty"`
	Node      string      `json:"node"` // the Art-Net node it's on
	uid       UID
	sensors   int
}

// units of SENSOR_DEFINITION (E1.20 table A-13), the ones lights use
var sensorUnits = map[byte]string{1: "C", 2: "V", 4: "A", 6: "W", 8: "Hz", 9: "Ohm", 11: "%", 17: "RPM", 18: "Hz", 25: "lx"}

type rdmCtl struct {
	l       *Link
	src     UID
	mu      sync.Mutex
	tx      sync.Mutex // one RDM transaction on the network at a time
	tn      byte
	devs    map[string]*rdmDev
	tods    map[string]map[UID]bool // node|port-address -> the lights it has
	wait    map[byte]chan rdmResp   // by transaction number
	busy    bool
	stage   int
	found   int
	scanned bool
	readAt  time.Time
	reading bool
}

func newRdm(l *Link) *rdmCtl {
	c := &rdmCtl{l: l, devs: map[string]*rdmDev{}, tods: map[string]map[UID]bool{}, wait: map[byte]chan rdmResp{}}
	// a controller id from the range kept for development and private use (0x7FF0..0x7FFF)
	c.src[0], c.src[1] = 0x7F, 0xF0
	rand.Read(c.src[2:])
	return c
}

// what came back from a node (called by the Art-Net listener)
func (c *rdmCtl) onTod(from string, b []byte) {
	if len(b) < 28 {
		return
	}
	pa := int(b[21]&0x7f)<<8 | int(b[23])
	n := int(b[27])
	key := fmt.Sprintf("%s|%d", from, pa)
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.tods[key] == nil {
		c.tods[key] = map[UID]bool{}
	}
	for i := 0; i < n && 28+i*6+6 <= len(b); i++ {
		var u UID
		copy(u[:], b[28+i*6:])
		c.tods[key][u] = true
	}
}

func (c *rdmCtl) onRdm(b []byte) {
	if len(b) < 24 {
		return
	}
	r, ok := parseRdm(b[24:])
	if !ok {
		return
	}
	c.mu.Lock()
	ch := c.wait[r.tn]
	c.mu.Unlock()
	if ch != nil {
		select {
		case ch <- r:
		default:
		}
	}
}

func (c *rdmCtl) nodeAddr(ip string) *net.UDPAddr {
	return &net.UDPAddr{IP: net.ParseIP(ip), Port: c.l.nodePort}
}

// one request to one light, its answer (ACK) or an error; tried twice
func (c *rdmCtl) ask(node string, portAddr int, to UID, cc byte, pid uint16, pd []byte) ([]byte, error) {
	c.tx.Lock()
	defer c.tx.Unlock()
	for try := 0; try < 2; try++ {
		c.mu.Lock()
		c.tn++
		tn := c.tn
		ch := make(chan rdmResp, 4)
		c.wait[tn] = ch
		c.mu.Unlock()
		c.l.art.WriteToUDP(artRdm(portAddr, rdmPacket(to, c.src, tn, cc, pid, pd)), c.nodeAddr(node))
		deadline := time.After(c.l.rdmWait)
		var got *rdmResp
	loop:
		for {
			select {
			case r := <-ch:
				if r.src == to && r.pid == pid && r.cc == cc+1 {
					got = &r
					break loop
				}
			case <-deadline:
				break loop
			}
		}
		c.mu.Lock()
		delete(c.wait, tn)
		c.mu.Unlock()
		if got == nil {
			continue
		}
		if got.rtype == respAck {
			return got.pd, nil
		}
		if got.rtype == respAckTimer {
			time.Sleep(200 * time.Millisecond)
			continue
		}
		return nil, fmt.Errorf("refused (NACK %v)", got.pd)
	}
	return nil, fmt.Errorf("no answer")
}

func (c *rdmCtl) get(d *rdmDev, pid uint16, pd []byte) ([]byte, error) {
	return c.ask(d.Node, d.Uni, d.uid, ccGet, pid, pd)
}
func (c *rdmCtl) set(d *rdmDev, pid uint16, pd []byte) error {
	_, err := c.ask(d.Node, d.Uni, d.uid, ccSet, pid, pd)
	return err
}
func text(b []byte) string { return strings.TrimRight(string(b), "\x00 ") }

// who a light is and where it listens (DEVICE_INFO), its labels and modes
func (c *rdmCtl) readInfo(d *rdmDev, full bool) bool {
	b, err := c.get(d, pidDeviceInfo, nil)
	if err != nil || len(b) < 19 {
		return false
	}
	c.mu.Lock()
	d.Model = int(binary.BigEndian.Uint16(b[2:]))
	d.Cat = int(binary.BigEndian.Uint16(b[4:]))
	d.SwVer = binary.BigEndian.Uint32(b[6:])
	d.Footprint = int(binary.BigEndian.Uint16(b[10:]))
	d.Pers, d.PersCount = int(b[12]), int(b[13])
	d.Addr = int(binary.BigEndian.Uint16(b[14:]))
	if d.Addr == 0xFFFF {
		d.Addr = 0
	}
	d.sensors = int(b[18])
	c.mu.Unlock()
	if !full {
		return true
	}
	strs := []struct {
		pid uint16
		to  *string
	}{{pidMfgLabel, &d.Mfg}, {pidModelDesc, &d.ModelName}, {pidDeviceLabel, &d.Label}, {pidSoftwareLabel, &d.Sw}}
	for _, s := range strs {
		if v, err := c.get(d, s.pid, nil); err == nil {
			c.mu.Lock()
			*s.to = text(v)
			c.mu.Unlock()
		}
	}
	modes := []rdmMode{}
	for i := 1; i <= d.PersCount && i <= 32; i++ {
		v, err := c.get(d, pidPersonalityDesc, []byte{byte(i)})
		if err != nil || len(v) < 3 {
			continue
		}
		modes = append(modes, rdmMode{N: int(v[0]), Footprint: int(binary.BigEndian.Uint16(v[1:])), Name: text(v[3:])})
	}
	sensors := []rdmSensor{}
	for i := 0; i < d.sensors && i < 16; i++ {
		v, err := c.get(d, pidSensorDef, []byte{byte(i)})
		if err != nil || len(v) < 13 {
			continue
		}
		sensors = append(sensors, rdmSensor{num: i, Type: int(v[1]), Unit: sensorUnits[v[2]], Name: text(v[13:])})
	}
	c.mu.Lock()
	if len(modes) > 0 {
		d.Modes = modes
	}
	d.Sensors = sensors
	c.mu.Unlock()
	return true
}

// how it's doing: sensor values, its status messages, its hours
func (c *rdmCtl) readHealth(d *rdmDev) {
	c.mu.Lock()
	ss := append([]rdmSensor{}, d.Sensors...)
	c.mu.Unlock()
	for i, s := range ss {
		v, err := c.get(d, pidSensorValue, []byte{byte(s.num)})
		if err != nil || len(v) < 9 {
			continue
		}
		val := func(o int) int { return int(int16(binary.BigEndian.Uint16(v[o:]))) }
		ss[i].Value, ss[i].Lo, ss[i].Hi = val(1), val(3), val(5)
	}
	st, err := c.get(d, pidStatusMessages, []byte{0x02}) // advisories and worse
	h, err2 := c.get(d, pidDeviceHours, nil)
	c.mu.Lock()
	d.Sensors = ss
	if err == nil {
		d.StType, d.StID, d.StCount = 0, 0, len(st)/9
		if len(st) >= 9 {
			last := st[len(st)/9*9-9:]
			d.StType, d.StID = int(last[2]), int(binary.BigEndian.Uint16(last[3:]))
		}
	}
	if err2 == nil && len(h) >= 4 {
		v := binary.BigEndian.Uint32(h)
		d.Hours = &v
	}
	c.mu.Unlock()
}

// search every node's outputs afresh, then read every light found
func (c *rdmCtl) scan() {
	c.mu.Lock()
	if c.busy {
		c.mu.Unlock()
		return
	}
	c.busy, c.stage, c.found, c.tods = true, 1, 0, map[string]map[UID]bool{}
	c.mu.Unlock()
	nodes := c.l.nodeList()
	for _, n := range nodes {
		for _, u := range n.Universes {
			c.l.art.WriteToUDP(artTodControl(u), c.nodeAddr(n.IP))
		}
	}
	time.Sleep(c.l.rdmSearch) // (the nodes search their lines)
	for _, n := range nodes {
		for _, u := range n.Universes {
			c.l.art.WriteToUDP(artTodRequest(u), c.nodeAddr(n.IP))
		}
	}
	time.Sleep(c.l.rdmSearch / 2)
	// every light found, where
	type at struct {
		node string
		pa   int
		uid  UID
	}
	all := []at{}
	c.mu.Lock()
	for k, us := range c.tods {
		p := strings.LastIndex(k, "|")
		pa, _ := strconv.Atoi(k[p+1:])
		for u := range us {
			all = append(all, at{k[:p], pa, u})
		}
	}
	c.stage, c.found = 2, len(all)
	c.mu.Unlock()
	sort.Slice(all, func(i, j int) bool { return all[i].uid.String() < all[j].uid.String() })
	seen := map[string]bool{}
	for _, a := range all {
		k := a.uid.String()
		seen[k] = true
		c.mu.Lock()
		d := c.devs[k]
		if d == nil {
			d = &rdmDev{UID: k, uid: a.uid, Sensors: []rdmSensor{}}
			c.devs[k] = d
		}
		d.Node, d.Uni = a.node, a.pa
		c.mu.Unlock()
		if c.readInfo(d, true) {
			c.readHealth(d)
		}
	}
	c.mu.Lock()
	for k := range c.devs {
		if !seen[k] {
			delete(c.devs, k)
		}
	}
	c.busy, c.stage, c.scanned, c.readAt = false, 0, true, time.Now()
	c.mu.Unlock()
}

// the lights read again now and then (address and mode may change at the light, sensors move)
func (c *rdmCtl) refresh() {
	c.mu.Lock()
	if c.busy || c.reading || time.Since(c.readAt) < 3*time.Second {
		c.mu.Unlock()
		return
	}
	c.reading = true
	ds := []*rdmDev{}
	for _, d := range c.devs {
		ds = append(ds, d)
	}
	c.mu.Unlock()
	for _, d := range ds {
		if c.readInfo(d, false) {
			c.readHealth(d)
		}
	}
	c.mu.Lock()
	c.reading, c.readAt = false, time.Now()
	c.mu.Unlock()
}

// the page's view
func (c *rdmCtl) list() map[string]any {
	c.mu.Lock()
	defer c.mu.Unlock()
	devs := []rdmDev{}
	for _, d := range c.devs {
		x := *d
		x.Sensors = append([]rdmSensor{}, d.Sensors...)
		devs = append(devs, x)
	}
	sort.Slice(devs, func(i, j int) bool { return devs[i].UID < devs[j].UID })
	lines := []map[string]int{}
	for i, n := range c.l.nodeList() {
		for _, u := range n.Universes {
			lines = append(lines, map[string]int{"line": i, "uni": u})
		}
	}
	return map[string]any{"available": true, "busy": c.busy, "discovering": c.busy, "scanned": c.scanned, "discStage": c.stage,
		"discFound": c.found, "rdmLines": lines, "devices": devs}
}

// one request from the page: {type:"rdm", id, op, uid, on, addr, mode, label}
type rdmReq struct {
	ID    json.Number `json:"id"`
	Op    string      `json:"op"`
	UID   string      `json:"uid"`
	On    bool        `json:"on"`
	Addr  int         `json:"addr"`
	Mode  int         `json:"mode"`
	Label string      `json:"label"`
}

func (c *rdmCtl) handle(q rdmReq) map[string]any {
	reply := func(ok bool, status int, data any) map[string]any {
		id, _ := q.ID.Int64()
		return map[string]any{"type": "rdm", "id": id, "ok": ok, "status": status, "data": data}
	}
	switch q.Op {
	case "list":
		go c.refresh()
		return reply(true, 200, c.list())
	case "scan":
		go c.scan()
		return reply(true, 200, map[string]any{"ok": true, "op": "discover"})
	}
	c.mu.Lock()
	d := c.devs[strings.ToUpper(q.UID)]
	c.mu.Unlock()
	if d == nil {
		return reply(false, 400, map[string]any{"ok": false})
	}
	var err error
	switch q.Op {
	case "identify":
		on := byte(0)
		if q.On {
			on = 1
		}
		if err = c.set(d, pidIdentify, []byte{on}); err == nil {
			c.mu.Lock()
			d.Identify = q.On
			c.mu.Unlock()
		}
	case "address":
		if q.Addr < 1 || q.Addr > 512 {
			return reply(false, 400, nil)
		}
		err = c.set(d, pidStartAddress, []byte{byte(q.Addr >> 8), byte(q.Addr)})
	case "mode":
		if q.Mode < 1 || q.Mode > 255 {
			return reply(false, 400, nil)
		}
		err = c.set(d, pidPersonality, []byte{byte(q.Mode)})
	case "label":
		l := q.Label
		if len(l) > 32 {
			l = l[:32]
		}
		if err = c.set(d, pidDeviceLabel, []byte(l)); err == nil {
			c.mu.Lock()
			d.Label = l
			c.mu.Unlock()
		}
	default:
		return reply(false, 400, nil)
	}
	if err != nil {
		return reply(false, 502, map[string]any{"ok": false, "error": err.Error()})
	}
	c.readInfo(d, false) // (its address and mode as the light now says)
	return reply(true, 200, map[string]any{"ok": true, "op": q.Op})
}
