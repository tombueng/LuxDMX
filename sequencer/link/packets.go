// Art-Net 4 and sACN (E1.31) packets: what the sequencer's frames become on the network, and the
// ArtPoll / ArtPollReply that find the nodes.
package main

import (
	"encoding/binary"
	"net"
	"strings"
)

var artID = []byte("Art-Net\x00")

const (
	opPoll      = 0x2000
	opPollReply = 0x2100
	opDmx       = 0x5000
	protVer     = 14
)

// ArtDmx for a 15-bit port-address (net 7 bits, sub-net 4, universe 4), 2..512 channels (even).
func artDmx(portAddr int, seq byte, data []byte) []byte {
	n := len(data)
	if n%2 == 1 {
		n++
	}
	if n < 2 {
		n = 2
	}
	p := make([]byte, 18+n)
	copy(p, artID)
	binary.LittleEndian.PutUint16(p[8:], opDmx)
	p[10], p[11] = 0, protVer
	p[12] = seq
	p[13] = 0
	p[14] = byte(portAddr & 0xff)
	p[15] = byte((portAddr >> 8) & 0x7f)
	binary.BigEndian.PutUint16(p[16:], uint16(n))
	copy(p[18:], data)
	return p
}

func artPoll() []byte {
	p := make([]byte, 14)
	copy(p, artID)
	binary.LittleEndian.PutUint16(p[8:], opPoll)
	p[10], p[11] = 0, protVer
	p[12] = 0x02 // tell me when something changes
	p[13] = 0
	return p
}

// Node is one Art-Net node as its ArtPollReply describes it (a node with many ports answers once
// per four ports, told apart by its bind index; nodeList puts them together).
type Node struct {
	IP        string `json:"ip"`
	Short     string `json:"short"`
	Long      string `json:"long"`
	Universes []int  `json:"universes"` // port-addresses its outputs play
	Proto     string `json:"proto"`
	// a LuxDMX box: how its pixel ports drive their LEDs (pixels.go), so the page draws them that way
	PixelPorts []PixelPort `json:"pixelPorts,omitempty"`
	Bind       int         `json:"-"` // which of its replies (a node with many ports sends one per four)
	Seen       int64       `json:"-"`
}

func parsePollReply(b []byte) (Node, bool) {
	if len(b) < 207 || string(b[:8]) != string(artID) || binary.LittleEndian.Uint16(b[8:]) != opPollReply {
		return Node{}, false
	}
	n := Node{IP: net.IPv4(b[10], b[11], b[12], b[13]).String(), Proto: "artnet", Universes: []int{}}
	if len(b) > 211 {
		n.Bind = int(b[211])
	}
	n.Short = strings.TrimRight(string(b[26:44]), "\x00 ")
	n.Long = strings.TrimRight(string(b[44:108]), "\x00 ")
	ports := int(binary.BigEndian.Uint16(b[172:]))
	if ports > 4 {
		ports = 4
	}
	netSw, subSw := int(b[18]&0x7f), int(b[19]&0x0f)
	for i := 0; i < ports; i++ {
		if b[174+i]&0x80 == 0 { // this port can't output DMX
			continue
		}
		n.Universes = append(n.Universes, netSw<<8|subSw<<4|int(b[190+i]&0x0f))
	}
	return n, true
}

// sACN data packet for universe u (1..63999), priority 0..200.
func sacn(cid [16]byte, source string, u int, prio byte, seq byte, data []byte) []byte {
	n := len(data)
	p := make([]byte, 126+n)
	// root layer
	binary.BigEndian.PutUint16(p[0:], 0x0010)
	copy(p[4:], "ASC-E1.17\x00\x00\x00")
	binary.BigEndian.PutUint16(p[16:], uint16(0x7000|(110+n)))
	binary.BigEndian.PutUint32(p[18:], 0x00000004)
	copy(p[22:], cid[:])
	// framing layer
	binary.BigEndian.PutUint16(p[38:], uint16(0x7000|(88+n)))
	binary.BigEndian.PutUint32(p[40:], 0x00000002)
	copy(p[44:108], source)
	p[108] = prio
	p[111] = seq
	p[112] = 0
	binary.BigEndian.PutUint16(p[113:], uint16(u))
	// DMP layer
	binary.BigEndian.PutUint16(p[115:], uint16(0x7000|(11+n)))
	p[117] = 0x02
	p[118] = 0xa1
	binary.BigEndian.PutUint16(p[119:], 0)
	binary.BigEndian.PutUint16(p[121:], 1)
	binary.BigEndian.PutUint16(p[123:], uint16(n+1))
	p[125] = 0 // start code
	copy(p[126:], data)
	return p
}

// the multicast group of a sACN universe
func sacnGroup(u int) *net.UDPAddr {
	return &net.UDPAddr{IP: net.IPv4(239, 255, byte(u>>8), byte(u&0xff)), Port: 5568}
}
