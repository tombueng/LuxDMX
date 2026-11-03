package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const defaultPort = 47920

func main() {
	runHere := flag.Bool("run", false, "run here, without installing (what the autostart and the tests use)")
	doInstall := flag.Bool("install", false, "install it for this user, start it and open its page (what a double-click does)")
	doUninstall := flag.Bool("uninstall", false, "stop it and remove it from this computer")
	noOpen := flag.Bool("no-open", false, "with -install: don't open the status page in the browser")
	port := flag.Int("port", defaultPort, "with -run: where the page finds it (on this computer only)")
	artPort := flag.Int("artnet-port", 6454, "the Art-Net port to listen on for nodes answering")
	allow := flag.String("allow", "", "more page origins that may use it, comma separated (e.g. http://192.168.1.10:8080)")
	artTo := flag.String("to", "", "send all Art-Net to this address (ip or ip:port) instead of finding the nodes")
	sacnTo := flag.String("sacn-to", "", "send sACN to this address (ip or ip:port) instead of multicast")
	flag.Parse()

	// Started with nothing (a double-click) it installs; any option for running (as people started
	// it before it could install itself) runs it here, as -run does.
	running := *runHere
	flag.Visit(func(f *flag.Flag) {
		switch f.Name {
		case "port", "artnet-port", "allow", "to", "sacn-to":
			running = true
		}
	})
	in := newInstaller(defaultPort)
	if *noOpen {
		in.open = func(string) error { return nil }
	}
	switch {
	case *doUninstall:
		if err := in.uninstall(false); err != nil {
			tell("Couldn't remove "+appName+": "+err.Error(), true)
			os.Exit(1)
		}
		tell(appName+" is removed from this computer.", false)
	case *doInstall || !running:
		msg, err := in.setup()
		if err != nil {
			tell(err.Error(), true)
			os.Exit(1)
		}
		if runtime.GOOS != "windows" { // (on Windows the status page in the browser says it; no box to click away)
			tell(msg, false)
		}
	default:
		in.port = *port
		run(in, *artPort, *allow, *artTo, *sacnTo)
	}
}

func run(in *installer, artPort int, allow, artTo, sacnTo string) {
	// the installed copy has no terminal (it starts at login): it writes its log next to itself
	if samePath(filepath.Dir(in.self), in.p.dir()) {
		f := filepath.Join(in.p.dir(), "link.log")
		mode := os.O_CREATE | os.O_WRONLY | os.O_APPEND
		if s, err := os.Stat(f); err == nil && s.Size() > 1<<20 {
			mode |= os.O_TRUNC
		}
		if w, err := os.OpenFile(f, mode, 0o644); err == nil {
			log.SetOutput(io.MultiWriter(w, os.Stderr))
		}
	}
	// the page's port first: a second copy stops here, before it touches anything else
	addr := fmt.Sprintf("127.0.0.1:%d", in.port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		if st, v := probeLink(in.port); st == linkOurs {
			log.Printf("%s %s is already running on %s", appName, v, addr)
			return
		}
		log.Fatalf("can't listen on %s: %v", addr, err)
	}
	allowed := []string{"https://luxdmx.org", "https://www.luxdmx.org", "https://tombueng.github.io", "http://localhost:*", "http://127.0.0.1:*"}
	for _, a := range strings.Split(allow, ",") {
		if a = strings.TrimSpace(a); a != "" {
			allowed = append(allowed, a)
		}
	}
	l, err := newLink(artPort, allowed)
	if err != nil {
		log.Fatal(err)
	}
	if artTo != "" {
		l.artTo = addrOf(artTo, 6454)
	}
	if sacnTo != "" {
		l.sacnTo = addrOf(sacnTo, 5568)
	}
	go l.listen()
	go func() {
		for {
			l.poll()
			time.Sleep(3 * time.Second)
			l.tellNodes() // (also lets nodes that went quiet drop off the list)
		}
	}()
	go func() {
		for range time.Tick(time.Second) {
			l.mu.Lock()
			fps := l.sent
			l.fps, l.sent = fps, map[int]int{}
			cs := make([]*wsConn, 0, len(l.clients))
			for c := range l.clients {
				cs = append(cs, c)
			}
			l.mu.Unlock()
			b, _ := json.Marshal(map[string]any{"type": "stats", "fps": fps})
			for _, c := range cs {
				l.write(c, b)
			}
		}
	}()
	srv := &http.Server{ReadHeaderTimeout: 5 * time.Second}
	s := &server{l: l, port: in.port, in: in}
	s.stop = func() {
		go func() {
			time.Sleep(300 * time.Millisecond) // (the answer goes out first)
			log.Printf("%s stops", appName)
			srv.Close()
			os.Exit(0)
		}()
	}
	srv.Handler = s.handler()
	log.Printf("%s %s on http://%s (Art-Net port %d)", appName, version, addr, artPort)
	if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
	select {} // (closed by stop: it exits in a moment)
}
