// Installing: a double-click on the downloaded file copies it into this user's programs folder,
// makes it start at login, starts that copy in the background and opens its status page. No admin
// rights anywhere: everything goes into the user's own folders (and on Windows the user's own part
// of the registry). -uninstall (or Remove on the status page) takes all of it away again.
package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	appName    = "LuxDMX Link"
	launchName = "org.luxdmx.link" // the macOS LaunchAgent
	runKey     = `Software\Microsoft\Windows\CurrentVersion\Run`
	uninstKey  = `Software\Microsoft\Windows\CurrentVersion\Uninstall\LuxDMXLink`
)

// place: where things go on one system, from what that system says (passed in, so the tests can
// ask for any system on any other)
type place struct {
	goos  string
	home  string
	local string // %LOCALAPPDATA% (Windows)
	data  string // $XDG_DATA_HOME (Linux), may be empty
	conf  string // $XDG_CONFIG_HOME (Linux), may be empty
}

func herePlace() place {
	h, _ := os.UserHomeDir()
	return place{goos: runtime.GOOS, home: h, local: os.Getenv("LOCALAPPDATA"), data: os.Getenv("XDG_DATA_HOME"), conf: os.Getenv("XDG_CONFIG_HOME")}
}

// paths the way that system writes them (filepath.Join would use this system's separator)
func (p place) join(parts ...string) string {
	if p.goos == "windows" {
		for i := range parts {
			if i > 0 {
				parts[i] = strings.Trim(parts[i], `\`)
			}
		}
		return strings.Join(parts, `\`)
	}
	return path.Join(parts...)
}

// the folder the program lives in
func (p place) dir() string {
	switch p.goos {
	case "windows":
		base := p.local
		if base == "" {
			base = p.join(p.home, "AppData", "Local")
		}
		return p.join(base, appName)
	case "darwin":
		return p.join(p.home, "Library", "Application Support", appName)
	default:
		base := p.data
		if !path.IsAbs(base) { // (the spec says a relative one doesn't count)
			base = p.join(p.home, ".local", "share")
		}
		return p.join(base, "luxdmx-link")
	}
}

func (p place) exe() string {
	if p.goos == "windows" {
		return p.join(p.dir(), "luxdmx-link.exe")
	}
	return p.join(p.dir(), "luxdmx-link")
}

// the file that starts it at login ("" on Windows: that's a registry value)
func (p place) autostart() string {
	switch p.goos {
	case "windows":
		return ""
	case "darwin":
		return p.join(p.home, "Library", "LaunchAgents", launchName+".plist")
	default:
		base := p.conf
		if !path.IsAbs(base) {
			base = p.join(p.home, ".config")
		}
		return p.join(base, "autostart", "luxdmx-link.desktop")
	}
}

// what that file says: start exe with -run
func (p place) autostartBody(exe string) string {
	if p.goos == "darwin" {
		// Interactive: launchd doesn't throttle it like a background job (frames go out on time)
		return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>` + launchName + `</string>
	<key>ProgramArguments</key>
	<array>
		<string>` + html.EscapeString(exe) + `</string>
		<string>-run</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>ProcessType</key>
	<string>Interactive</string>
</dict>
</plist>
`
	}
	return "[Desktop Entry]\nType=Application\nName=" + appName + "\nComment=Sends Art-Net and sACN for the LuxDMX Sequencer\n" +
		"Exec=" + desktopQuote(exe) + " -run\nTerminal=false\nNoDisplay=true\nX-GNOME-Autostart-enabled=true\n"
}

// the Windows Run value: the program and -run, quoted (the path has a space in it)
func runValue(exe string) string { return `"` + exe + `" -run` }

// One argument of a .desktop Exec line: quoted, with ", `, $ and \ escaped inside the quotes, %
// doubled, and then the file format's own escaping of \ on top (so a backslash ends up as four).
func desktopQuote(s string) string {
	var b strings.Builder
	for _, c := range s {
		switch c {
		case '"', '`', '$', '\\':
			b.WriteByte('\\')
		}
		b.WriteRune(c)
	}
	q := strings.ReplaceAll(b.String(), "%", "%%")
	return `"` + strings.ReplaceAll(q, `\`, `\\`) + `"`
}

// ---- what's running

const (
	linkNone  = iota // nothing on the port
	linkOurs         // a LuxDMX Link answers
	linkOther        // something else has the port
)

// regStore: the user's part of the Windows registry (a map in the tests)
type regStore interface {
	setString(key, name, val string) error
	setDword(key, name string, v uint32) error
	deleteValue(key, name string) error
	deleteKey(key string) error
	has(key, name string) bool
}

type installer struct {
	p    place
	self string // this program's file
	port int
	reg  regStore // Windows only
	// the parts that touch the running system, replaced in the tests
	probe  func() (int, string)   // linkNone/linkOurs/linkOther, and its version
	quit   func() error           // ask the running Link to stop
	start  func(exe string) error // start a copy in the background
	open   func(url string) error // the browser
	unload func()                 // macOS: launchd lets go of it
	wait   time.Duration          // how long a Link may take to start or stop
}

func newInstaller(port int) *installer {
	self, _ := os.Executable()
	if s, err := filepath.EvalSymlinks(self); err == nil {
		self = s
	}
	in := &installer{p: herePlace(), self: self, port: port, reg: sysRegistry(), wait: 6 * time.Second}
	in.probe = func() (int, string) { return probeLink(port) }
	in.quit = func() error { return quitLink(port) }
	in.start = startDetached
	in.open = openBrowser
	in.unload = unloadAgent
	return in
}

func (in *installer) statusURL() string { return fmt.Sprintf("http://127.0.0.1:%d/", in.port) }

var errNotHTTP = errors.New("not HTTP")

// One request to whatever listens on the port, by hand: http.Client would make the program half a
// megabyte bigger, and this only ever talks to Link's own server (HTTP/1.0: it answers and closes).
func askLocal(port int, method, path, header string) (int, []byte, error) {
	c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 1500*time.Millisecond)
	if err != nil {
		return 0, nil, err
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(3 * time.Second))
	if _, err := fmt.Fprintf(c, "%s %s HTTP/1.0\r\nHost: 127.0.0.1:%d\r\nContent-Length: 0\r\n%s\r\n", method, path, port, header); err != nil {
		return 0, nil, err
	}
	b, err := io.ReadAll(io.LimitReader(c, 1<<20))
	if err != nil && len(b) == 0 {
		return 0, nil, err
	}
	head, body, _ := bytes.Cut(b, []byte("\r\n\r\n"))
	var code int
	if _, err := fmt.Sscanf(string(head), "HTTP/1.%d %d", new(int), &code); err != nil {
		return 0, nil, errNotHTTP
	}
	return code, body, nil
}

// Is a Link on the port, and which version?
func probeLink(port int) (int, string) {
	code, body, err := askLocal(port, "GET", "/info.json", "")
	if errors.Is(err, errNotHTTP) {
		return linkOther, ""
	} else if err != nil {
		return linkNone, ""
	}
	var i struct{ App, Version string }
	if code != 200 || json.Unmarshal(body, &i) != nil || i.App != "luxdmx-link" {
		return linkOther, ""
	}
	return linkOurs, i.Version
}

// Ask the running Link to stop (for an update, or to remove it). Only a program on this computer
// can: a browser always says where a POST comes from, and Link refuses any page doing it.
func quitLink(port int) error {
	code, _, err := askLocal(port, "POST", "/quit", "X-LuxDMX-Link: quit\r\n")
	if err != nil {
		return err
	}
	if code != 200 {
		return fmt.Errorf("it said %d", code)
	}
	return nil
}

// until the probe says st (or time's up)
func (in *installer) until(st int) bool {
	for t := time.Now(); time.Since(t) < in.wait; time.Sleep(100 * time.Millisecond) {
		if s, _ := in.probe(); s == st {
			return true
		}
	}
	return false
}

// "1.10.0" is newer than "1.9.2"
func newer(a, b string) bool {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(pa) || i < len(pb); i++ {
		var x, y int
		if i < len(pa) {
			x, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			y, _ = strconv.Atoi(pb[i])
		}
		if x != y {
			return x > y
		}
	}
	return false
}

func fileSum(f string) []byte {
	h := sha256.New()
	r, err := os.Open(f)
	if err != nil {
		return nil
	}
	defer r.Close()
	if _, err := io.Copy(h, r); err != nil {
		return nil
	}
	return h.Sum(nil)
}

func sameContent(a, b string) bool {
	x, y := fileSum(a), fileSum(b)
	return x != nil && bytes.Equal(x, y)
}

func samePath(a, b string) bool {
	sa, err1 := os.Stat(a)
	sb, err2 := os.Stat(b)
	return err1 == nil && err2 == nil && os.SameFile(sa, sb)
}

// a copy that's either all there or not at all (written next to it, then renamed over it);
// Windows keeps a file that just stopped running locked for a moment, so the rename tries again
func copyFile(src, dst string) error {
	r, err := os.Open(src)
	if err != nil {
		return err
	}
	defer r.Close()
	tmp := dst + ".new"
	w, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	if _, err = io.Copy(w, r); err == nil {
		err = w.Sync()
	}
	if e := w.Close(); err == nil {
		err = e
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	for i := 0; ; i++ {
		if err = os.Rename(tmp, dst); err == nil || i == 20 {
			break
		}
		time.Sleep(150 * time.Millisecond)
	}
	if err != nil {
		os.Remove(tmp)
	}
	return err
}

// The double-click. Returns what to tell the person.
func (in *installer) setup() (string, error) {
	st, ver := in.probe()
	exe := in.p.exe()
	switch {
	case st == linkOther:
		return "", fmt.Errorf("another program uses port %d on this computer, so %s can't start. Close it and try again", in.port, appName)
	case st == linkOurs && (newer(ver, version) || ver == version && sameContent(in.self, exe)):
		// it's there and running (this file again, or an older download): just show it
		in.open(in.statusURL())
		return fmt.Sprintf("%s %s is already running: %s", appName, ver, in.statusURL()), nil
	case st == linkOurs:
		// another version runs: stop it, so this one can take its place
		if err := in.quit(); err != nil || !in.until(linkNone) {
			return "", fmt.Errorf("%s %s is running and didn't stop for the update. Stop it (or log out and in again) and try again", appName, ver)
		}
	}
	if err := in.install(); err != nil {
		return "", err
	}
	if err := in.start(exe); err != nil {
		return "", fmt.Errorf("installed, but it didn't start: %v", err)
	}
	if !in.until(linkOurs) {
		return "", fmt.Errorf("installed in %s, but it didn't start answering on port %d", in.p.dir(), in.port)
	}
	in.open(in.statusURL() + "?installed")
	return fmt.Sprintf("%s %s is installed in %s\nIt starts by itself when you log in.\nRunning: %s\nYou can close this window.", appName, version, in.p.dir(), in.statusURL()), nil
}

// the copy, the autostart, and on Windows its line in Settings > Apps
func (in *installer) install() error {
	exe := in.p.exe()
	if err := os.MkdirAll(in.p.dir(), 0o755); err != nil {
		return err
	}
	if !samePath(in.self, exe) {
		if err := copyFile(in.self, exe); err != nil {
			return fmt.Errorf("couldn't copy it to %s: %v", in.p.dir(), err)
		}
	}
	return in.setAutostart(exe)
}

func (in *installer) setAutostart(exe string) error {
	if in.p.goos == "windows" {
		if in.reg == nil {
			return errors.New("no registry")
		}
		if err := in.reg.setString(runKey, appName, runValue(exe)); err != nil {
			return fmt.Errorf("couldn't make it start at login: %v", err)
		}
		// Settings > Apps lists it, and its Uninstall runs -uninstall (all per user, no admin)
		size := uint32(0)
		if s, err := os.Stat(exe); err == nil {
			size = uint32(s.Size() / 1024)
		}
		for k, v := range map[string]string{"DisplayName": appName, "DisplayVersion": version, "Publisher": "LuxDMX",
			"DisplayIcon": exe, "InstallLocation": in.p.dir(), "UninstallString": `"` + exe + `" -uninstall`,
			"URLInfoAbout": "https://luxdmx.org"} {
			in.reg.setString(uninstKey, k, v)
		}
		in.reg.setDword(uninstKey, "NoModify", 1)
		in.reg.setDword(uninstKey, "NoRepair", 1)
		in.reg.setDword(uninstKey, "EstimatedSize", size)
		return nil
	}
	f := in.p.autostart()
	if err := os.MkdirAll(filepath.Dir(f), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(f, []byte(in.p.autostartBody(exe)), 0o644); err != nil {
		return fmt.Errorf("couldn't make it start at login: %v", err)
	}
	return nil
}

func (in *installer) autostartOn() bool {
	if in.p.goos == "windows" {
		return in.reg != nil && in.reg.has(runKey, appName)
	}
	_, err := os.Stat(in.p.autostart())
	return err == nil
}

// After Remove on its own page has answered: on macOS launchd lets go of it now, which ends this
// process (its files are already gone).
func (in *installer) afterRemove() {
	if in.p.goos == "darwin" && in.unload != nil {
		in.unload()
	}
}

func (in *installer) installed() bool {
	_, err := os.Stat(in.p.exe())
	return err == nil
}

// Takes it all away. serving: this is the running Link itself (Remove on its status page), so it
// doesn't ask itself to stop and, on Windows, leaves deleting its own file to a moment after it exits.
func (in *installer) uninstall(serving bool) error {
	if !serving {
		if st, _ := in.probe(); st == linkOurs {
			if err := in.quit(); err != nil || !in.until(linkNone) {
				return fmt.Errorf("%s is running and didn't stop. Stop it and try again", appName)
			}
		}
	}
	var errs []string
	if in.p.goos == "windows" {
		if in.reg != nil {
			in.reg.deleteValue(runKey, appName)
			in.reg.deleteKey(uninstKey)
		}
	} else {
		// (launchd letting go stops the job: when that's this very Link, it waits until its files
		// are gone and the page has its answer, see afterRemove)
		if in.p.goos == "darwin" && in.unload != nil && !serving {
			in.unload()
		}
		if err := os.Remove(in.p.autostart()); err != nil && !os.IsNotExist(err) {
			errs = append(errs, err.Error())
		}
	}
	dir := in.p.dir()
	if in.p.goos == "windows" && strings.EqualFold(filepath.Dir(in.self), dir) {
		removeLater(dir) // (a running program's file can't be deleted on Windows)
	} else if err := os.RemoveAll(dir); err != nil {
		errs = append(errs, err.Error())
	}
	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}
	return nil
}
