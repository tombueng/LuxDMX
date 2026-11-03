package main

import (
	"encoding/xml"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPlaces(t *testing.T) {
	for _, c := range []struct {
		p                place
		dir, exe, autost string
	}{
		{place{goos: "windows", home: `C:\Users\Ann`, local: `C:\Users\Ann\AppData\Local`},
			`C:\Users\Ann\AppData\Local\LuxDMX Link`, `C:\Users\Ann\AppData\Local\LuxDMX Link\luxdmx-link.exe`, ""},
		{place{goos: "windows", home: `C:\Users\Ann`}, // (no %LOCALAPPDATA%: where it usually is)
			`C:\Users\Ann\AppData\Local\LuxDMX Link`, `C:\Users\Ann\AppData\Local\LuxDMX Link\luxdmx-link.exe`, ""},
		{place{goos: "darwin", home: "/Users/ann"},
			"/Users/ann/Library/Application Support/LuxDMX Link", "/Users/ann/Library/Application Support/LuxDMX Link/luxdmx-link",
			"/Users/ann/Library/LaunchAgents/org.luxdmx.link.plist"},
		{place{goos: "linux", home: "/home/ann"},
			"/home/ann/.local/share/luxdmx-link", "/home/ann/.local/share/luxdmx-link/luxdmx-link", "/home/ann/.config/autostart/luxdmx-link.desktop"},
		{place{goos: "linux", home: "/home/ann", data: "/data/ann", conf: "/conf/ann"},
			"/data/ann/luxdmx-link", "/data/ann/luxdmx-link/luxdmx-link", "/conf/ann/autostart/luxdmx-link.desktop"},
		{place{goos: "linux", home: "/home/ann", data: "rel", conf: "rel"}, // (relative XDG dirs don't count)
			"/home/ann/.local/share/luxdmx-link", "/home/ann/.local/share/luxdmx-link/luxdmx-link", "/home/ann/.config/autostart/luxdmx-link.desktop"},
	} {
		if c.p.dir() != c.dir || c.p.exe() != c.exe || c.p.autostart() != c.autost {
			t.Errorf("%+v:\n %q\n %q\n %q", c.p, c.p.dir(), c.p.exe(), c.p.autostart())
		}
	}
}

func TestAutostartFiles(t *testing.T) {
	mac := place{goos: "darwin", home: "/Users/a&b"}
	body := mac.autostartBody(mac.exe())
	// a well-formed plist that starts the copy with -run at login
	d := xml.NewDecoder(strings.NewReader(body))
	var strs []string
	for {
		tok, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("plist: %v\n%s", err, body)
		}
		if cd, ok := tok.(xml.CharData); ok && strings.TrimSpace(string(cd)) != "" {
			strs = append(strs, string(cd))
		}
	}
	if strings.Join(strs, "|") != "Label|org.luxdmx.link|ProgramArguments|/Users/a&b/Library/Application Support/LuxDMX Link/luxdmx-link|-run|RunAtLoad|ProcessType|Interactive" {
		t.Errorf("plist says %q", strs)
	}
	lin := place{goos: "linux", home: "/home/ann"}
	if b := lin.autostartBody(lin.exe()); !strings.Contains(b, "\nExec=\"/home/ann/.local/share/luxdmx-link/luxdmx-link\" -run\n") || !strings.HasPrefix(b, "[Desktop Entry]\nType=Application\n") {
		t.Errorf("desktop file:\n%s", b)
	}
	// the odd characters a home folder can have: quoted, escaped, % doubled, \ four times
	if q := desktopQuote(`/home/a "b" $x 100% \z`); q != `"/home/a \\"b\\" \\$x 100%% \\\\z"` {
		t.Errorf("quoted %s", q)
	}
	if v := runValue(`C:\Users\Ann\AppData\Local\LuxDMX Link\luxdmx-link.exe`); v != `"C:\Users\Ann\AppData\Local\LuxDMX Link\luxdmx-link.exe" -run` {
		t.Error(v)
	}
}

func TestNewer(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{{"1.1.0", "1.0.0", true}, {"1.10.0", "1.9.2", true}, {"1.0.0", "1.0.0", false}, {"1.0", "1.0.1", false}, {"2", "1.9.9", true}} {
		if newer(c.a, c.b) != c.want {
			t.Errorf("newer(%s, %s)", c.a, c.b)
		}
	}
}

// a pretend system: a home in a temp folder, a Link that starts when told to
type rig struct {
	in             *installer
	running        string // the version on the port ("" = nothing)
	other          bool   // something else has the port
	started, opens []string
	quits          int
	unloads        int
	reg            map[string]string
}

func newRig(t *testing.T, goos string) *rig {
	home := t.TempDir()
	dl := filepath.Join(home, "Downloads", "luxdmx-link-download")
	os.MkdirAll(filepath.Dir(dl), 0o755)
	os.WriteFile(dl, []byte("the program "+version), 0o644) // (a download isn't executable)
	r := &rig{reg: map[string]string{}}
	r.in = &installer{p: place{goos: goos, home: home}, self: dl, port: 47920, wait: time.Second}
	r.in.probe = func() (int, string) {
		if r.other {
			return linkOther, ""
		}
		if r.running == "" {
			return linkNone, ""
		}
		return linkOurs, r.running
	}
	r.in.quit = func() error { r.quits++; r.running = ""; return nil }
	r.in.start = func(exe string) error { r.started = append(r.started, exe); r.running = version; return nil }
	r.in.open = func(u string) error { r.opens = append(r.opens, u); return nil }
	r.in.unload = func() { r.unloads++ }
	return r
}

func TestInstallLinux(t *testing.T) {
	r := newRig(t, "linux")
	in := r.in
	msg, err := in.setup()
	if err != nil {
		t.Fatal(err)
	}
	exe := filepath.Join(in.p.home, ".local/share/luxdmx-link/luxdmx-link")
	if s, err := os.Stat(exe); err != nil || s.Mode().Perm() != 0o755 || !sameContent(in.self, exe) {
		t.Fatalf("copy: %v %v", s, err)
	}
	if b, _ := os.ReadFile(filepath.Join(in.p.home, ".config/autostart/luxdmx-link.desktop")); !strings.Contains(string(b), `Exec="`+exe+`" -run`) {
		t.Fatalf("autostart: %s", b)
	}
	if len(r.started) != 1 || r.started[0] != exe || len(r.opens) != 1 || r.opens[0] != "http://127.0.0.1:47920/?installed" || !strings.Contains(msg, "starts by itself") {
		t.Fatalf("started %v, opened %v, said %q", r.started, r.opens, msg)
	}
	if !in.installed() || !in.autostartOn() {
		t.Fatal("installed() / autostartOn()")
	}
	// double-clicked again: it's running, just show it
	r.opens = nil
	if msg, err := in.setup(); err != nil || len(r.started) != 1 || r.quits != 0 || len(r.opens) != 1 || r.opens[0] != "http://127.0.0.1:47920/" || !strings.Contains(msg, "already running") {
		t.Fatalf("again: %v %v %v %q", r.started, r.quits, r.opens, msg)
	}
	// an older download double-clicked while a newer Link runs: nothing changes
	r.running = "99.0.0"
	if _, err := in.setup(); err != nil || r.quits != 0 || len(r.started) != 1 {
		t.Fatal("an older download replaced a newer Link")
	}
	// an update: the old one is asked to stop, the new file takes its place and starts
	r.running = "1.0.0"
	os.WriteFile(in.self, []byte("the new program"), 0o644)
	if _, err := in.setup(); err != nil || r.quits != 1 || len(r.started) != 2 || !sameContent(in.self, exe) {
		t.Fatalf("update: %v quits %d started %v", err, r.quits, r.started)
	}
	// and removed: stopped, autostart and folder gone
	if err := in.uninstall(false); err != nil {
		t.Fatal(err)
	}
	if r.quits != 2 || in.installed() || in.autostartOn() {
		t.Fatal("still there after uninstall")
	}
	if _, err := os.Stat(in.p.dir()); !os.IsNotExist(err) {
		t.Fatal("folder still there")
	}
}

func TestInstallTrouble(t *testing.T) {
	r := newRig(t, "linux")
	r.other = true
	if _, err := r.in.setup(); err == nil || !strings.Contains(err.Error(), "another program uses port 47920") {
		t.Fatal(err)
	}
	if r.in.installed() {
		t.Fatal("installed although it can't run")
	}
	// an old Link that doesn't stop when asked: no half-done update
	r = newRig(t, "linux")
	r.running = "1.0.0"
	r.in.quit = func() error { return errors.New("404") }
	if _, err := r.in.setup(); err == nil || r.in.installed() {
		t.Fatal("went on although the old one runs")
	}
	// started, but never answers
	r = newRig(t, "linux")
	r.in.start = func(string) error { return nil }
	if _, err := r.in.setup(); err == nil || !strings.Contains(err.Error(), "didn't start answering") {
		t.Fatal(err)
	}
}

func TestInstallMac(t *testing.T) {
	r := newRig(t, "darwin")
	in := r.in
	if _, err := in.setup(); err != nil {
		t.Fatal(err)
	}
	plist := filepath.Join(in.p.home, "Library/LaunchAgents/org.luxdmx.link.plist")
	exe := filepath.Join(in.p.home, "Library/Application Support/LuxDMX Link/luxdmx-link")
	if b, _ := os.ReadFile(plist); !strings.Contains(string(b), "<string>"+exe+"</string>") {
		t.Fatalf("LaunchAgent: %s", b)
	}
	// removed from its own status page (it's the one running): files gone first, then launchd lets
	// go (that stops this very process, so it must come last)
	in.self = exe
	if err := in.uninstall(true); err != nil || r.unloads != 0 || r.quits != 0 {
		t.Fatalf("%v unloads %d quits %d", err, r.unloads, r.quits)
	}
	in.unload = func() {
		if _, err := os.Stat(plist); !os.IsNotExist(err) {
			t.Fatal("launchd let go while the plist was still there")
		}
		r.unloads++
	}
	in.afterRemove()
	if r.unloads != 1 {
		t.Fatalf("unloads %d", r.unloads)
	}
	if _, err := os.Stat(plist); !os.IsNotExist(err) {
		t.Fatal("plist still there")
	}
	if _, err := os.Stat(in.p.dir()); !os.IsNotExist(err) {
		t.Fatal("folder still there")
	}
}

type fakeReg map[string]any

func (f fakeReg) setString(k, n, v string) error       { f[k+`\`+n] = v; return nil }
func (f fakeReg) setDword(k, n string, v uint32) error { f[k+`\`+n] = v; return nil }
func (f fakeReg) deleteValue(k, n string) error        { delete(f, k+`\`+n); return nil }
func (f fakeReg) has(k, n string) bool                 { _, ok := f[k+`\`+n]; return ok }
func (f fakeReg) deleteKey(k string) error {
	for x := range f {
		if strings.HasPrefix(x, k+`\`) {
			delete(f, x)
		}
	}
	return nil
}

func TestWindowsRegistry(t *testing.T) {
	reg := fakeReg{}
	in := &installer{p: place{goos: "windows", home: `C:\Users\Ann`, local: `C:\Users\Ann\AppData\Local`}, reg: reg}
	exe := in.p.exe()
	if err := in.setAutostart(exe); err != nil {
		t.Fatal(err)
	}
	run := `Software\Microsoft\Windows\CurrentVersion\Run\LuxDMX Link`
	un := `Software\Microsoft\Windows\CurrentVersion\Uninstall\LuxDMXLink\`
	if reg[run] != `"C:\Users\Ann\AppData\Local\LuxDMX Link\luxdmx-link.exe" -run` || !in.autostartOn() {
		t.Fatalf("Run: %v", reg[run])
	}
	if reg[un+"UninstallString"] != `"C:\Users\Ann\AppData\Local\LuxDMX Link\luxdmx-link.exe" -uninstall` || reg[un+"DisplayName"] != "LuxDMX Link" ||
		reg[un+"DisplayVersion"] != version || reg[un+"NoModify"] != uint32(1) {
		t.Fatalf("Settings > Apps entry: %v", reg)
	}
	in.self = exe
	in.unload = func() { t.Fatal("launchd on Windows") }
	in.uninstall(true)
	if len(reg) != 0 || in.autostartOn() {
		t.Fatalf("left in the registry: %v", reg)
	}
}
