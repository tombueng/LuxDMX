package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const pixelsJSON = `{"railMa":9200,"ports":[
 {"idx":0,"en":false,"uni":0,"start":1,"count":47,"bright":40,"gamma":220,"maxMa":800,"mAPerCh":2000,"quiesMa":100},
 {"idx":3,"en":true,"uni":10,"start":1,"count":241,"spans":2,"bright":150,"gamma":220,"maxMa":500,"mAPerCh":2000,"quiesMa":100,"inFps":40.0}]}`

func TestParsePixels(t *testing.T) {
	ports, ok := parsePixels([]byte(pixelsJSON))
	if !ok || len(ports) != 1 {
		t.Fatalf("want one enabled port, got %v %v", ports, ok)
	}
	want := PixelPort{Uni: 10, Start: 1, Count: 241, Spans: 2, Bright: 150, Gamma: 220, MaxMa: 500, MAPerCh: 2000, QuiesMa: 100}
	if ports[0] != want {
		t.Fatalf("got %+v", ports[0])
	}
	if _, ok := parsePixels([]byte("<html>not a box</html>")); ok {
		t.Fatal("html read as pixels")
	}
	if _, ok := parsePixels([]byte(`{"something":"else"}`)); ok {
		t.Fatal("json without ports read as pixels")
	}
}

func TestAskPixelsTellsThePageOnce(t *testing.T) {
	asked := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/pixels.json" {
			http.NotFound(w, r)
			return
		}
		asked++
		w.Write([]byte(pixelsJSON))
	}))
	defer srv.Close()
	host := strings.TrimPrefix(srv.URL, "http://")
	l := &Link{nodes: map[string]Node{}, clients: map[*wsConn]client{}, pixels: map[string]*pixelInfo{}, httpc: srv.Client()}
	l.nodes[host+"/0"] = Node{IP: host, Short: "LuxDMX", Universes: []int{0}, Seen: time.Now().Unix()}
	l.askPixels(host)
	l.askPixels(host) // asked once, not twice
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if ns := l.nodeList(); len(ns) == 1 && len(ns[0].PixelPorts) == 1 {
			if ns[0].PixelPorts[0].Bright != 150 || asked != 1 {
				t.Fatalf("ports %+v, asked %d times", ns[0].PixelPorts, asked)
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("no ports on the node: %+v", l.nodeList())
}

func TestANodeThatIsntABoxHasNoPorts(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	defer srv.Close()
	if _, ok := fetchPixels(srv.Client(), srv.URL+"/pixels.json"); ok {
		t.Fatal("a 404 read as pixels")
	}
}

func TestWhatAGoneNodeSaidIsForgotten(t *testing.T) {
	l := &Link{nodes: map[string]Node{}, clients: map[*wsConn]client{}, pixels: map[string]*pixelInfo{}}
	l.nodes["10.0.0.5/0"] = Node{IP: "10.0.0.5", Universes: []int{0}, Seen: time.Now().Unix() - 60}
	l.pixels["10.0.0.5"] = &pixelInfo{at: time.Now().Unix(), ports: []PixelPort{{Uni: 10, Count: 1}}}
	l.pixels["10.0.0.9"] = &pixelInfo{at: time.Now().Unix()}
	if ns := l.nodeList(); len(ns) != 0 {
		t.Fatalf("an old node is still listed: %+v", ns)
	}
	if len(l.pixels) != 0 {
		t.Fatalf("pixels kept for nodes that are gone: %v", l.pixels)
	}
}
