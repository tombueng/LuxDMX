//go:build !windows

// macOS and Linux: starting a copy in its own session (so closing the Terminal window doesn't take
// it along), opening the browser, launchd, and saying things in the terminal.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
	"time"
)

func sysRegistry() regStore { return nil }

func startDetached(exe string) error {
	c := exec.Command(exe, "-run")
	c.Dir = filepath.Dir(filepath.Dir(exe))
	c.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := c.Start(); err != nil {
		return err
	}
	return c.Process.Release()
}

func openBrowser(url string) error {
	name := "xdg-open"
	if runtime.GOOS == "darwin" {
		name = "open"
	}
	c := exec.Command(name, url)
	c.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := c.Start(); err != nil {
		return err
	}
	// (a moment for it to hand the address over before this program exits)
	done := make(chan error, 1)
	go func() { done <- c.Wait() }()
	select {
	case err := <-done:
		return err
	case <-time.After(3 * time.Second):
		return nil
	}
}

// launchd lets go of it (it may have started it at login); best effort
func unloadAgent() {
	exec.Command("launchctl", "remove", launchName).Run()
}

func removeLater(dir string) { os.RemoveAll(dir) }

// In a terminal (macOS opens one for it) it prints; double-clicked on a Linux desktop there is no
// terminal, so a problem also goes to a desktop notification where there is one.
func tell(msg string, bad bool) {
	if bad {
		fmt.Fprintln(os.Stderr, msg)
	} else {
		fmt.Println(msg)
	}
	if fi, err := os.Stdout.Stat(); bad && runtime.GOOS == "linux" && err == nil && fi.Mode()&os.ModeCharDevice == 0 {
		exec.Command("notify-send", "-a", appName, appName, msg).Run()
	}
}
