// What Link answers on 127.0.0.1: the WebSocket for the page, /info.json (the page and the
// installer ask who's there), its status page, and /quit and /remove. All of it only when asked by
// its own address (a website on another name pointed at 127.0.0.1 gets nothing), the socket only
// for allowed pages, Remove only from its own status page, and Quit only from a program on this
// computer (a browser always says where a POST comes from).
package main

import (
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// client: one page connected over the WebSocket. Page: the id a page gives (its own connection and
// its output thread's say the same one: one page, two connections)
type client struct {
	Origin string `json:"origin"`
	Since  int64  `json:"since"`
	Page   string `json:"-"`
}

// asked by its own address (not a DNS name that happens to point here)
func hostOK(h string, port int) bool {
	p := strconv.Itoa(port)
	if port == 80 { // (a browser leaves the default port out)
		if h == "127.0.0.1" || h == "localhost" || h == "[::1]" {
			return true
		}
	}
	return h == "127.0.0.1:"+p || h == "localhost:"+p || h == "[::1]:"+p
}

// a POST from Link's own status page
func ownOrigin(o string, port int) bool {
	return strings.HasPrefix(o, "http://") && hostOK(strings.TrimPrefix(o, "http://"), port)
}

type server struct {
	l    *Link
	port int
	in   *installer
	stop func() // ends the program, once the answer went out
}

type statusData struct {
	App       string      `json:"app"`
	Version   string      `json:"version"`
	Nodes     []Node      `json:"nodes"`
	Pages     []client    `json:"pages"`
	FPS       map[int]int `json:"fps"`
	Installed bool        `json:"installed"`
	Autostart bool        `json:"autostart"`
	Dir       string      `json:"dir"`
	Self      string      `json:"self"`
	OS        string      `json:"os"`
	Fresh     bool        `json:"-"` // just installed: the page says so
}

func (s *server) status() statusData {
	d := statusData{App: "luxdmx-link", Version: version, Nodes: s.l.nodeList(), FPS: map[int]int{}, OS: s.in.p.goos,
		Installed: s.in.installed(), Autostart: s.in.autostartOn(), Dir: s.in.p.dir(), Self: s.in.self}
	s.l.mu.Lock()
	// (a page's connections, counted once: the earliest of them)
	byPage := map[string]int{}
	for _, c := range s.l.clients {
		if c.Page != "" {
			if i, ok := byPage[c.Page]; ok {
				if c.Since < d.Pages[i].Since {
					d.Pages[i].Since = c.Since
				}
				continue
			}
			byPage[c.Page] = len(d.Pages)
		}
		d.Pages = append(d.Pages, c)
	}
	for u, n := range s.l.fps {
		d.FPS[u] = n
	}
	s.l.mu.Unlock()
	sort.Slice(d.Pages, func(i, j int) bool { return d.Pages[i].Since < d.Pages[j].Since })
	return d
}

func (s *server) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.l.serveWS)
	mux.HandleFunc("/info.json", func(w http.ResponseWriter, r *http.Request) {
		if o := r.Header.Get("Origin"); o != "" && s.l.originOK(o) {
			w.Header().Set("Access-Control-Allow-Origin", o)
			w.Header().Set("Access-Control-Allow-Private-Network", "true")
		}
		w.Header().Set("Content-Type", "application/json")
		s.l.mu.Lock()
		pages := len(s.l.clients)
		s.l.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]any{"app": "luxdmx-link", "version": version, "nodes": s.l.nodeList(), "pages": pages})
	})
	// (no CORS: only the status page itself reads this)
	mux.HandleFunc("/status.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(s.status())
	})
	mux.HandleFunc("/quit", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.Header.Get("Origin") != "" || r.Header.Get("X-LuxDMX-Link") != "quit" {
			http.Error(w, "no", http.StatusForbidden)
			return
		}
		fmt.Fprintln(w, "stopping")
		s.stop()
	})
	mux.HandleFunc("/remove", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || !ownOrigin(r.Header.Get("Origin"), s.port) {
			http.Error(w, "Remove works from LuxDMX Link's own page only", http.StatusForbidden)
			return
		}
		err := s.in.uninstall(true)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.WriteString(w, removedPage(err, s.in.p.goos == "windows"))
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		s.in.afterRemove()
		s.stop()
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		d := s.status()
		_, d.Fresh = r.URL.Query()["installed"]
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		io.WriteString(w, statusPage(d))
	})
	// every path: only when asked by its own address
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !hostOK(r.Host, s.port) {
			http.Error(w, "wrong host", http.StatusForbidden)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

// The pages are put together by hand (html/template would make the program a third bigger):
// everything that comes from outside (a node's name, a page's address, a path) goes through esc.
var esc = html.EscapeString

const pageHead = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>LuxDMX Link</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='6' fill='%2345d85c'/%3E%3C/svg%3E">
<style>
:root { --bg: #0b0e13; --panel: #151a22; --line: #2a313c; --text: #d7dde6; --muted: #929cab; --green: #45d85c; --orange: #ffaa1c; --pink: #f33abc; color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
main { max-width: 44rem; margin: 0 auto; padding: 2rem 1rem 3rem; }
h1 { font-size: 1.5rem; margin: 0 0 .2rem; display: flex; align-items: center; gap: .6rem; }
h2 { font-size: .76rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 0 0 .4rem; font-weight: 650; }
.dot { width: .8rem; height: .8rem; border-radius: 50%; background: var(--green); box-shadow: 0 0 8px var(--green); flex: none; }
.off .dot { background: var(--pink); box-shadow: none; }
.ver { color: var(--muted); font-size: .9rem; font-weight: 400; }
section { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: .8rem 1rem; margin-top: .8rem; }
.note { border-color: #45d85c66; background: #45d85c14; }
.muted { color: var(--muted); }
table { border-collapse: collapse; width: 100%; }
td, th { text-align: left; padding: .25rem .6rem .25rem 0; border-top: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 500; border-top: 0; }
code { font: .88em ui-monospace, monospace; word-break: break-all; }
ul { margin: .2rem 0; padding-left: 1.2rem; }
button { font: inherit; color: var(--pink); background: #1b212b; border: 1px solid var(--line); border-radius: 7px; padding: .35rem .8rem; cursor: pointer; }
button:hover { border-color: var(--pink); }
button:focus-visible { outline: 2px solid #6aa2ff; outline-offset: 1px; }
</style></head><body><main>`

func statusPage(d statusData) string {
	var b strings.Builder
	w := func(f string, a ...any) { fmt.Fprintf(&b, f, a...) }
	b.WriteString(pageHead)
	w(`<div id="live">
<h1><span class="dot"></span><span id="state">LuxDMX Link is running</span> <span class="ver">%s</span></h1>
<p class="muted">It sends Art-Net and sACN for the LuxDMX Sequencer, which a browser can't do by itself.</p>
`, esc(d.Version))
	if d.Fresh {
		w(`<section class="note"><b>Installed.</b> It starts by itself when you log in, so this was the only time.
Go back to the sequencer: it finds Link by itself (pick <b>Art-Net / sACN from this computer</b> under <b>+</b> if you haven't).</section>
`)
	}
	w(`<section><h2>Pages connected: %d</h2>
`, len(d.Pages))
	if len(d.Pages) > 0 {
		b.WriteString("<ul>")
		for _, p := range d.Pages {
			o := "a program on this computer"
			if p.Origin != "" {
				o = p.Origin
			}
			w(`<li>%s <span class="muted">since %s</span></li>`, esc(o), time.Unix(p.Since, 0).Format("15:04"))
		}
		b.WriteString("</ul>\n")
	} else {
		b.WriteString(`<p class="muted">None right now. Open the LuxDMX Sequencer and pick <b>Art-Net / sACN from this computer</b> under <b>+</b>.</p>` + "\n")
	}
	if len(d.FPS) > 0 {
		k := make([]int, 0, len(d.FPS))
		for u := range d.FPS {
			k = append(k, u)
		}
		sort.Ints(k)
		f := make([]string, len(k))
		for i, u := range k {
			f[i] = fmt.Sprintf("universe %d: %d/s", u, d.FPS[u])
		}
		w(`<p class="muted">Sending: %s</p>`, strings.Join(f, " · "))
	}
	w(`</section>

<section><h2>Nodes found: %d</h2>
`, len(d.Nodes))
	if len(d.Nodes) > 0 {
		b.WriteString(`<table><tr><th>Name</th><th>Address</th><th>Universes</th></tr>` + "\n")
		for _, n := range d.Nodes {
			name := n.Short
			if name == "" {
				name = n.IP
			}
			u := make([]string, len(n.Universes))
			for i, x := range n.Universes {
				u[i] = strconv.Itoa(x)
			}
			us := strings.Join(u, ", ")
			if us == "" {
				us = "no outputs"
			}
			w(`<tr><td>%s</td><td>%s</td><td>%s</td></tr>`+"\n", esc(name), esc(n.IP), us)
		}
		b.WriteString("</table>")
	} else {
		b.WriteString(`<p class="muted">None answered yet (it asks every 3 s). Art-Net then goes to everyone on the network (broadcast), which most nodes take too.</p>`)
	}
	b.WriteString("</section>\n\n<section><h2>On this computer</h2>\n")
	if d.Installed {
		at := "yes"
		if !d.Autostart {
			at = "no (it was taken out of the login items)"
		}
		w(`<p>Installed in <code>%s</code>.<br>Starts at login: %s.</p>`, esc(d.Dir), at)
	} else {
		w(`<p>Running from <code>%s</code>, not installed. Run the downloaded file without options to install it.</p>`, esc(d.Self))
	}
	b.WriteString(`
<p class="muted">It listens on this computer only: nothing on the network can talk to it. Only the LuxDMX Sequencer's pages (and ones served from this computer) may use it.</p></section>
`)
	if d.Installed || d.Autostart {
		apps := ""
		if d.OS == "windows" {
			apps = " Settings, Apps does the same."
		}
		w(`
<section><h2>Remove it</h2>
<form method="post" action="/remove" onsubmit="return confirm('Remove LuxDMX Link from this computer?')">
<p>Stops it, takes it out of what starts at login and deletes its files.%s</p>
<button type="submit">Remove LuxDMX Link</button></form></section>
`, apps)
	}
	b.WriteString(`</div>
<script>
// the counts follow along: the page fetches itself again every 3 s
setInterval(async () => {
  try {
    const r = await fetch(location.href, { cache: 'no-store' });
    const d = new DOMParser().parseFromString(await r.text(), 'text/html').getElementById('live');
    if (d && !document.activeElement?.closest('form')) document.getElementById('live').replaceWith(d);
  } catch {
    document.getElementById('live').classList.add('off');
    document.getElementById('state').textContent = 'LuxDMX Link has stopped';
  }
}, 3000);
</script>
</main></body></html>`)
	return b.String()
}

func removedPage(err error, windows bool) string {
	if err != nil {
		return pageHead + `<h1 class="off"><span class="dot"></span>Removing didn't finish</h1><p>` + esc(err.Error()) + `</p></main></body></html>`
	}
	later := ""
	if windows {
		later = " (the last one a moment after this page)"
	}
	return pageHead + `<h1 class="off"><span class="dot"></span>LuxDMX Link is removed</h1>
<p>It has stopped, it won't start at login any more, and its files are gone` + later + `.
To use it again, download it from the sequencer.</p></main></body></html>`
}
