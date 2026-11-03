package main

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func testServer(t *testing.T) (*server, *rig, *int) {
	r := newRig(t, "linux")
	if _, err := r.in.setup(); err != nil {
		t.Fatal(err)
	}
	l := &Link{nodes: map[string]Node{}, clients: map[*wsConn]client{}, fps: map[int]int{0: 40}, allowed: []string{"https://luxdmx.org", "http://localhost:*"}}
	l.nodes["10.0.0.7/0"] = Node{IP: "10.0.0.7", Short: "<b>stage</b>", Universes: []int{0, 1}, Seen: time.Now().Unix()}
	stops := 0
	s := &server{l: l, port: 47920, in: r.in, stop: func() { stops++ }}
	return s, r, &stops
}

func ask(h http.Handler, method, url, host string, hdr map[string]string) (int, string, http.Header) {
	req := httptest.NewRequest(method, url, nil)
	req.Host = host
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	b, _ := io.ReadAll(w.Result().Body)
	return w.Code, string(b), w.Result().Header
}

func TestHostCheck(t *testing.T) {
	for h, want := range map[string]bool{"127.0.0.1:47920": true, "localhost:47920": true, "[::1]:47920": true,
		"127.0.0.1": false, "evil.example:47920": false, "127.0.0.1:47921": false, "127.0.0.1.evil.example:47920": false} {
		if hostOK(h, 47920) != want {
			t.Errorf("hostOK(%q) = %v", h, !want)
		}
	}
	// a website on a name that points at 127.0.0.1 (DNS rebinding) gets nothing at all
	s, _, _ := testServer(t)
	h := s.handler()
	for _, p := range []string{"/", "/info.json", "/status.json", "/ws"} {
		if code, _, _ := ask(h, "GET", p, "evil.example:47920", nil); code != 403 {
			t.Errorf("%s by another name: %d", p, code)
		}
	}
	if code, _, _ := ask(h, "GET", "/ws", "127.0.0.1:47920", map[string]string{"Origin": "https://evil.example"}); code != 403 {
		t.Errorf("socket for another site: %d", code)
	}
}

func TestStatusPage(t *testing.T) {
	s, _, _ := testServer(t)
	h := s.handler()
	code, body, _ := ask(h, "GET", "/", "127.0.0.1:47920", nil)
	for _, want := range []string{"LuxDMX Link is running", version, "Pages connected: 0", "Nodes found: 1", "&lt;b&gt;stage&lt;/b&gt;", "10.0.0.7", "0, 1",
		"Installed in", "Starts at login: yes", "Remove LuxDMX Link", `action="/remove"`} {
		if !strings.Contains(body, want) {
			t.Errorf("page lacks %q", want)
		}
	}
	if code != 200 || strings.Contains(body, "<b>stage</b>") || strings.Contains(body, "Installed.</b>") {
		t.Errorf("%d, or a node's name went in as HTML, or says just installed", code)
	}
	// a page connects; the page says so, and that it's just been installed when asked so
	s.l.clients[&wsConn{}] = client{Origin: "https://luxdmx.org", Since: time.Now().Unix()}
	_, body, _ = ask(h, "GET", "/?installed", "localhost:47920", nil)
	if !strings.Contains(body, "Pages connected: 1") || !strings.Contains(body, "https://luxdmx.org") || !strings.Contains(body, "Installed.</b>") || !strings.Contains(body, "universe 0: 40/s") {
		t.Error("connected page, sending or the installed note missing")
	}
	var st statusData
	_, body, _ = ask(h, "GET", "/status.json", "127.0.0.1:47920", nil)
	if json.Unmarshal([]byte(body), &st) != nil || st.Version != version || len(st.Pages) != 1 || len(st.Nodes) != 1 || !st.Installed {
		t.Errorf("status.json %s", body)
	}
	if code, _, _ := ask(h, "GET", "/nothing", "127.0.0.1:47920", nil); code != 404 {
		t.Error(code)
	}
	// not installed (a -run copy somewhere): no Remove, says where it runs from
	os.RemoveAll(s.in.p.dir())
	os.Remove(s.in.p.autostart())
	_, body, _ = ask(h, "GET", "/", "127.0.0.1:47920", nil)
	if strings.Contains(body, "Remove LuxDMX Link") || !strings.Contains(body, "not installed") {
		t.Error("a copy that isn't installed offers Remove")
	}
}

func TestInfoCORS(t *testing.T) {
	s, _, _ := testServer(t)
	h := s.handler()
	_, body, hd := ask(h, "GET", "/info.json", "127.0.0.1:47920", map[string]string{"Origin": "https://luxdmx.org"})
	if hd.Get("Access-Control-Allow-Origin") != "https://luxdmx.org" || !strings.Contains(body, `"app":"luxdmx-link"`) {
		t.Errorf("allowed page: %v %s", hd, body)
	}
	if _, _, hd = ask(h, "GET", "/info.json", "127.0.0.1:47920", map[string]string{"Origin": "https://evil.example"}); hd.Get("Access-Control-Allow-Origin") != "" {
		t.Error("another site may read the node list")
	}
	if _, _, hd = ask(h, "GET", "/status.json", "127.0.0.1:47920", map[string]string{"Origin": "https://luxdmx.org"}); hd.Get("Access-Control-Allow-Origin") != "" {
		t.Error("status.json is for the status page only")
	}
}

func TestQuitAndRemove(t *testing.T) {
	s, _, stops := testServer(t)
	h := s.handler()
	quit := map[string]string{"X-LuxDMX-Link": "quit"}
	// a website can't stop it: a browser always says where a POST is from
	for _, c := range []struct {
		method string
		hdr    map[string]string
	}{{"GET", quit}, {"POST", nil}, {"POST", map[string]string{"X-LuxDMX-Link": "quit", "Origin": "https://luxdmx.org"}},
		{"POST", map[string]string{"X-LuxDMX-Link": "quit", "Origin": "http://127.0.0.1:47920"}}} {
		if code, _, _ := ask(h, c.method, "/quit", "127.0.0.1:47920", c.hdr); code != 403 || *stops != 0 {
			t.Errorf("%s %v: %d", c.method, c.hdr, code)
		}
	}
	if code, _, _ := ask(h, "POST", "/quit", "127.0.0.1:47920", quit); code != 200 || *stops != 1 {
		t.Errorf("a program here can't stop it: %d", code)
	}
	// Remove only from its own page
	for _, o := range []string{"", "https://luxdmx.org", "http://localhost:5173", "http://evil.example:47920"} {
		if code, _, _ := ask(h, "POST", "/remove", "127.0.0.1:47920", map[string]string{"Origin": o}); code != 403 || !s.in.installed() {
			t.Errorf("removed from %q: %d", o, code)
		}
	}
	code, body, _ := ask(h, "POST", "/remove", "127.0.0.1:47920", map[string]string{"Origin": "http://127.0.0.1:47920"})
	if code != 200 || !strings.Contains(body, "LuxDMX Link is removed") || *stops != 2 || s.in.installed() || s.in.autostartOn() {
		t.Errorf("remove: %d stops %d installed %v %s", code, *stops, s.in.installed(), body)
	}
}

// the installer's own requests to a running Link (not http.Client: by hand), against the real handler
func TestProbeAndQuit(t *testing.T) {
	s, _, stops := testServer(t)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	s.port = port
	go http.Serve(ln, s.handler())
	defer ln.Close()
	if st, v := probeLink(port); st != linkOurs || v != version {
		t.Fatalf("probe: %d %q", st, v)
	}
	if err := quitLink(port); err != nil || *stops != 1 {
		t.Fatalf("quit: %v, stops %d", err, *stops)
	}
	// something else on a port: a web server that isn't Link, and a program that doesn't speak HTTP
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, `{"app":"else"}`) }))
	defer other.Close()
	if st, _ := probeLink(other.Listener.Addr().(*net.TCPAddr).Port); st != linkOther {
		t.Error("another web server taken for Link")
	}
	junk, _ := net.Listen("tcp", "127.0.0.1:0")
	go func() {
		for {
			c, err := junk.Accept()
			if err != nil {
				return
			}
			c.Write([]byte("hello\r\n\r\n"))
			c.Close()
		}
	}()
	if st, _ := probeLink(junk.Addr().(*net.TCPAddr).Port); st != linkOther {
		t.Error("a program that isn't a web server taken for nothing")
	}
	jp := junk.Addr().(*net.TCPAddr).Port
	junk.Close()
	if st, _ := probeLink(jp); st != linkNone {
		t.Error("a free port taken for something")
	}
}

// A page and its output thread, two connections that give the same page id: one page on the
// status page; a connection without an id (an older page) counts on its own.
func TestOnePagePerID(t *testing.T) {
	s, _, _ := testServer(t)
	h := s.handler()
	now := time.Now().Unix()
	s.l.clients[&wsConn{}] = client{Origin: "http://127.0.0.1:5173", Since: now - 5, Page: "p1"}
	s.l.clients[&wsConn{}] = client{Origin: "http://127.0.0.1:5173", Since: now, Page: "p1"}
	_, body, _ := ask(h, "GET", "/", "127.0.0.1:47920", nil)
	if !strings.Contains(body, "Pages connected: 1") {
		t.Error("a page and its thread should count once")
	}
	s.l.clients[&wsConn{}] = client{Origin: "https://luxdmx.org", Since: now}
	_, body, _ = ask(h, "GET", "/", "127.0.0.1:47920", nil)
	if !strings.Contains(body, "Pages connected: 2") {
		t.Error("a connection without an id counts on its own")
	}
}
