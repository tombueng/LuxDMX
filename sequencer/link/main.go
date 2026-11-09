// LuxDMX Link: lets the LuxDMX Sequencer (a web page, which can't send UDP) play any Art-Net or
// sACN node on the network. It listens on this computer only (127.0.0.1:47920), takes the page's
// DMX frames over a WebSocket, and sends them as Art-Net (unicast to the nodes that play that
// universe, else broadcast) or sACN (multicast); it finds the nodes with ArtPoll and tells the page.
// Only pages from allowed origins may use it (a site you happen to visit can't flash your rig).
package main

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const version = "1.4.0"

type Route struct {
	Uni   int    `json:"uni"`
	Proto string `json:"proto"` // artnet, sacn, both
	To    string `json:"to"`    // auto, broadcast, multicast, or an address (ip or ip:port)
}

type Link struct {
	mu      sync.Mutex
	nodes   map[string]Node
	routes  map[int]Route
	art     *net.UDPConn // bound to the Art-Net port: replies to ArtPoll come back to it
	sacnOut *net.UDPConn
	cid     [16]byte
	seqArt  map[int]byte
	seqSacn map[int]byte
	clients map[*wsConn]client
	sent    map[int]int // frames sent per universe since the last stats
	fps     map[int]int // frames per universe in the last second (the status page shows them)
	allowed []string
	artPort int
	artTo   *net.UDPAddr // everything Art-Net to this one address (-to), instead of finding nodes
	sacnTo  *net.UDPAddr // sACN to this address instead of the multicast groups (-sacn-to)
	// RDM over Art-Net (rdm.go): the controller, the port nodes listen on, how long a light has to
	// answer, how long the nodes get to search their lines
	rdm       *rdmCtl
	nodePort  int
	rdmWait   time.Duration
	rdmSearch time.Duration
	// what LuxDMX boxes say about their pixel ports, by address (pixels.go)
	pixels map[string]*pixelInfo
	httpc  *http.Client
}

func newLink(artPort int, allowed []string) (*Link, error) {
	l := &Link{nodes: map[string]Node{}, routes: map[int]Route{}, seqArt: map[int]byte{}, seqSacn: map[int]byte{}, clients: map[*wsConn]client{}, sent: map[int]int{}, fps: map[int]int{}, allowed: allowed, artPort: artPort,
		nodePort: 6454, rdmWait: 800 * time.Millisecond, rdmSearch: 2500 * time.Millisecond,
		pixels: map[string]*pixelInfo{}, httpc: &http.Client{Timeout: 1500 * time.Millisecond}}
	l.rdm = newRdm(l)
	rand.Read(l.cid[:])
	var err error
	if l.art, err = net.ListenUDP("udp4", &net.UDPAddr{Port: artPort}); err != nil {
		// another program has the Art-Net port: send from anywhere (finding nodes won't work)
		log.Printf("Art-Net port %d is taken (%v): sending works, finding nodes doesn't", artPort, err)
		if l.art, err = net.ListenUDP("udp4", &net.UDPAddr{}); err != nil {
			return nil, err
		}
	}
	if l.sacnOut, err = net.ListenUDP("udp4", &net.UDPAddr{}); err != nil {
		return nil, err
	}
	return l, nil
}

// ---- finding nodes
// the broadcast addresses, looked up at most every 5 s (asking the system costs more than a frame)
var bcastMu sync.Mutex
var bcastList []*net.UDPAddr
var bcastAt time.Time

func broadcasts() []*net.UDPAddr {
	bcastMu.Lock()
	defer bcastMu.Unlock()
	if bcastList == nil || time.Since(bcastAt) > 5*time.Second {
		bcastList, bcastAt = lookupBroadcasts(), time.Now()
	}
	return bcastList
}

// the broadcast address of every network this computer is on (255.255.255.255 if none)
func lookupBroadcasts() []*net.UDPAddr {
	out := []*net.UDPAddr{}
	ifs, _ := net.Interfaces()
	for _, i := range ifs {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagBroadcast == 0 {
			continue
		}
		addrs, _ := i.Addrs()
		for _, a := range addrs {
			n, ok := a.(*net.IPNet)
			if !ok || n.IP.To4() == nil {
				continue
			}
			ip, m := n.IP.To4(), n.Mask
			b := net.IPv4(ip[0]|^m[0], ip[1]|^m[1], ip[2]|^m[2], ip[3]|^m[3])
			out = append(out, &net.UDPAddr{IP: b, Port: 6454})
		}
	}
	if len(out) == 0 {
		out = append(out, &net.UDPAddr{IP: net.IPv4bcast, Port: 6454})
	}
	return out
}

func (l *Link) poll() {
	if l.artTo != nil { // pointed at one address: nothing to find, nothing on the networks
		return
	}
	for _, b := range broadcasts() {
		l.art.WriteToUDP(artPoll(), b)
	}
}

func (l *Link) listen() {
	buf := make([]byte, 1500)
	for {
		n, from, err := l.art.ReadFromUDP(buf)
		if err != nil {
			return
		}
		// RDM from a node: its table of lights, or a light's answer (rdm.go)
		if n >= 10 && string(buf[:8]) == string(artID) {
			switch binary.LittleEndian.Uint16(buf[8:]) {
			case opTodData:
				l.rdm.onTod(from.IP.String(), append([]byte{}, buf[:n]...))
				continue
			case opRdm:
				l.rdm.onRdm(append([]byte{}, buf[:n]...))
				continue
			}
		}
		node, ok := parsePollReply(buf[:n])
		if !ok {
			continue
		}
		node.Seen = time.Now().Unix()
		// one entry per reply (a node with more than four ports sends one per four, told apart by
		// its bind index): a renumbered port replaces what it said before
		key := fmt.Sprintf("%s/%d", node.IP, node.Bind)
		l.mu.Lock()
		old, had := l.nodes[key]
		// (an older node without bind indices sends all its replies as bind 0: keep them together)
		if had && node.Bind == 0 && time.Now().Unix()-old.Seen < 10 {
			node.Universes = union(old.Universes, node.Universes)
		}
		changed := !had || fmt.Sprint(old.Universes) != fmt.Sprint(node.Universes) || old.Short != node.Short
		l.nodes[key] = node
		l.mu.Unlock()
		if changed {
			go l.tellNodes() // (not holding up the replies behind it)
		}
		// (only a node that answered from the address it names: a reply anyone can send mustn't make
		// Link ask some other machine)
		if from != nil && from.IP.Equal(net.ParseIP(node.IP)) {
			l.askPixels(node.IP)
		}
	}
}

// the nodes that answered lately, one per address (its replies' universes together)
func (l *Link) nodeList() []Node {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now().Unix()
	by := map[string]*Node{}
	for k, n := range l.nodes {
		if now-n.Seen > 20 {
			delete(l.nodes, k)
			continue
		}
	}
	// (what a node said about its pixels goes with it)
	for ip := range l.pixels {
		gone := true
		for _, n := range l.nodes {
			if n.IP == ip {
				gone = false
				break
			}
		}
		if gone && !l.pixels[ip].asking {
			delete(l.pixels, ip)
		}
	}
	for _, n := range l.nodes {
		if m, ok := by[n.IP]; ok {
			m.Universes = append(m.Universes, n.Universes...)
		} else {
			c := n
			c.Universes = append([]int{}, n.Universes...)
			by[n.IP] = &c
		}
	}
	out := []Node{}
	for _, n := range by {
		n.Universes = union(n.Universes, nil)
		if p := l.pixels[n.IP]; p != nil && len(p.ports) > 0 {
			n.PixelPorts = p.ports
		}
		out = append(out, *n)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].IP < out[j].IP })
	return out
}

// ---- sending
func addrOf(s string, port int) *net.UDPAddr {
	if h, p, err := net.SplitHostPort(s); err == nil {
		pn, _ := strconv.Atoi(p)
		return &net.UDPAddr{IP: net.ParseIP(h), Port: pn}
	}
	return &net.UDPAddr{IP: net.ParseIP(s), Port: port}
}

// a and b together, each once, in order
func union(a, b []int) []int {
	seen, out := map[int]bool{}, []int{}
	for _, u := range append(append([]int{}, a...), b...) {
		if !seen[u] {
			seen[u] = true
			out = append(out, u)
		}
	}
	sort.Ints(out)
	return out
}

func (l *Link) send(uni int, prio byte, data []byte) {
	l.mu.Lock()
	r, ok := l.routes[uni]
	if !ok {
		r = Route{Uni: uni, Proto: "artnet", To: "auto"}
	}
	var targets []*net.UDPAddr
	if r.Proto != "sacn" {
		switch {
		case l.artTo != nil:
			targets = []*net.UDPAddr{l.artTo}
		case r.To == "broadcast":
			targets = broadcasts()
		case r.To != "auto" && r.To != "" && r.To != "multicast":
			targets = []*net.UDPAddr{addrOf(r.To, 6454)}
		default:
			// each box once, however many of its outputs play this universe
			ips := map[string]bool{}
			for _, n := range l.nodes {
				for _, u := range n.Universes {
					if u == uni && !ips[n.IP] {
						ips[n.IP] = true
						targets = append(targets, &net.UDPAddr{IP: net.ParseIP(n.IP), Port: 6454})
					}
				}
			}
			if len(targets) == 0 {
				targets = broadcasts()
			}
		}
	}
	l.seqArt[uni] = l.seqArt[uni]%255 + 1
	sa := l.seqArt[uni]
	l.seqSacn[uni]++
	ss := l.seqSacn[uni]
	l.sent[uni]++
	l.mu.Unlock()
	if len(targets) > 0 {
		p := artDmx(uni, sa, data)
		for _, t := range targets {
			l.art.WriteToUDP(p, t)
		}
	}
	if r.Proto == "sacn" || r.Proto == "both" {
		u := uni + 1 // sACN counts universes from 1 (Art-Net 0 = sACN 1, as LuxDMX does)
		to := sacnGroup(u)
		if l.sacnTo != nil {
			to = l.sacnTo
		} else if r.To != "auto" && r.To != "multicast" && r.To != "" && r.To != "broadcast" {
			to = addrOf(r.To, 5568)
		}
		if prio > 200 { // (E1.31 allows 0 to 200)
			prio = 200
		}
		l.sacnOut.WriteToUDP(sacn(l.cid, "LuxDMX Link", u, prio, ss, data), to)
	}
}

// ---- the page
type msg struct {
	Type   string  `json:"type"`
	Routes []Route `json:"routes,omitempty"`
	ID     string  `json:"id,omitempty"` // "page": which page this connection is (1.2.0 on)
}

func (l *Link) tellNodes() {
	b, _ := json.Marshal(map[string]any{"type": "nodes", "nodes": l.nodeList()})
	l.mu.Lock()
	cs := make([]*wsConn, 0, len(l.clients))
	for c := range l.clients {
		cs = append(cs, c)
	}
	l.mu.Unlock()
	for _, c := range cs {
		l.write(c, b)
	}
}

// a message to one page; a page that doesn't take it (gone, frozen) is let go
func (l *Link) write(c *wsConn, b []byte) {
	if err := c.write(1, b); err != nil {
		l.mu.Lock()
		delete(l.clients, c)
		l.mu.Unlock()
		c.close()
	}
}

func (l *Link) originOK(o string) bool {
	if o == "" {
		return true // not a browser: nothing a website could abuse
	}
	for _, a := range l.allowed {
		if strings.HasSuffix(a, ":*") {
			if strings.HasPrefix(o, strings.TrimSuffix(a, "*")) || o == strings.TrimSuffix(a, ":*") {
				return true
			}
		} else if o == a {
			return true
		}
	}
	return false
}

func (l *Link) serveWS(w http.ResponseWriter, r *http.Request) {
	if !l.originOK(r.Header.Get("Origin")) {
		http.Error(w, "this page may not use LuxDMX Link (start it with -allow "+r.Header.Get("Origin")+")", http.StatusForbidden)
		return
	}
	c, err := wsUpgrade(w, r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	l.mu.Lock()
	l.clients[c] = client{Origin: r.Header.Get("Origin"), Since: time.Now().Unix()}
	l.mu.Unlock()
	defer func() { l.mu.Lock(); delete(l.clients, c); l.mu.Unlock(); c.close() }()
	hello, _ := json.Marshal(map[string]any{"type": "hello", "app": "luxdmx-link", "version": version, "nodes": l.nodeList()})
	l.write(c, hello)
	for {
		op, p, err := c.read()
		if err != nil {
			return
		}
		if op == 2 {
			// a frame, as the LuxDMX bridge takes it: 'D', 1, universe lo, hi, priority, 0, then the channels
			if len(p) < 7 || len(p) > 6+512 || p[0] != 'D' || p[1] != 1 {
				continue
			}
			prio := p[4]
			if prio == 0 {
				prio = 100
			}
			l.send(int(binary.LittleEndian.Uint16(p[2:]))&0x7fff, prio, p[6:])
			continue
		}
		// RDM: answered by itself (a scan or a light takes a while), with the request's id
		if strings.HasPrefix(string(p), `{"type":"rdm"`) {
			var q rdmReq
			if json.Unmarshal(p, &q) == nil {
				go func() { b, _ := json.Marshal(l.rdm.handle(q)); l.write(c, b) }()
			}
			continue
		}
		var m msg
		if json.Unmarshal(p, &m) != nil {
			continue
		}
		switch m.Type {
		case "routes":
			l.mu.Lock()
			l.routes = map[int]Route{}
			for _, r := range m.Routes {
				l.routes[r.Uni] = r
			}
			l.mu.Unlock()
		case "poll":
			l.poll()
		case "page":
			l.mu.Lock()
			if cl, ok := l.clients[c]; ok && len(m.ID) <= 64 {
				cl.Page = m.ID
				l.clients[c] = cl
			}
			l.mu.Unlock()
		}
	}
}
