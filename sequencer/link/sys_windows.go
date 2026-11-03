// The Windows parts: the user's registry (start at login, the line in Settings > Apps), a message
// box (the program has no console window to print to), starting a copy, opening the browser.
package main

import (
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

var (
	advapi32        = syscall.NewLazyDLL("advapi32.dll")
	procCreateKey   = advapi32.NewProc("RegCreateKeyExW")
	procSetValue    = advapi32.NewProc("RegSetValueExW")
	procDeleteValue = advapi32.NewProc("RegDeleteValueW")
	procDeleteKey   = advapi32.NewProc("RegDeleteKeyW")
	user32          = syscall.NewLazyDLL("user32.dll")
	procMessageBox  = user32.NewProc("MessageBoxW")
)

const (
	hkcu         = syscall.Handle(0x80000001)
	keyAllAccess = 0xf003f
	regSZ        = 1
	regDword     = 4
)

type winReg struct{}

func sysRegistry() regStore { return winReg{} }

func errno(r uintptr) error {
	if r != 0 {
		return syscall.Errno(r)
	}
	return nil
}

func (winReg) open(key string) (syscall.Handle, error) {
	var h syscall.Handle
	k, _ := syscall.UTF16PtrFromString(key)
	r, _, _ := procCreateKey.Call(uintptr(hkcu), uintptr(unsafe.Pointer(k)), 0, 0, 0, keyAllAccess, 0, uintptr(unsafe.Pointer(&h)), 0)
	return h, errno(r)
}

func (w winReg) set(key, name string, typ uint32, data []byte) error {
	h, err := w.open(key)
	if err != nil {
		return err
	}
	defer syscall.RegCloseKey(h)
	n, _ := syscall.UTF16PtrFromString(name)
	var p *byte
	if len(data) > 0 {
		p = &data[0]
	}
	r, _, _ := procSetValue.Call(uintptr(h), uintptr(unsafe.Pointer(n)), 0, uintptr(typ), uintptr(unsafe.Pointer(p)), uintptr(len(data)))
	return errno(r)
}

func (w winReg) setString(key, name, val string) error {
	u, _ := syscall.UTF16FromString(val)
	b := make([]byte, len(u)*2)
	for i, c := range u {
		b[2*i], b[2*i+1] = byte(c), byte(c>>8)
	}
	return w.set(key, name, regSZ, b)
}

func (w winReg) setDword(key, name string, v uint32) error {
	return w.set(key, name, regDword, []byte{byte(v), byte(v >> 8), byte(v >> 16), byte(v >> 24)})
}

func (w winReg) deleteValue(key, name string) error {
	h, err := w.open(key)
	if err != nil {
		return err
	}
	defer syscall.RegCloseKey(h)
	n, _ := syscall.UTF16PtrFromString(name)
	r, _, _ := procDeleteValue.Call(uintptr(h), uintptr(unsafe.Pointer(n)))
	return errno(r)
}

func (winReg) deleteKey(key string) error {
	k, _ := syscall.UTF16PtrFromString(key)
	r, _, _ := procDeleteKey.Call(uintptr(hkcu), uintptr(unsafe.Pointer(k)))
	return errno(r)
}

func (winReg) has(key, name string) bool {
	var h syscall.Handle
	k, _ := syscall.UTF16PtrFromString(key)
	if syscall.RegOpenKeyEx(hkcu, k, 0, syscall.KEY_READ, &h) != nil {
		return false
	}
	defer syscall.RegCloseKey(h)
	n, _ := syscall.UTF16PtrFromString(name)
	var typ, size uint32
	return syscall.RegQueryValueEx(h, n, nil, &typ, nil, &size) == nil
}

func detach(c *exec.Cmd) {
	// its own process group, no window: it carries on after this one exits
	c.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000008 | 0x00000200, HideWindow: true}
}

func startDetached(exe string) error {
	c := exec.Command(exe, "-run")
	c.Dir = filepath.Dir(filepath.Dir(exe)) // (not its own folder: that couldn't be removed while it runs)
	detach(c)
	if err := c.Start(); err != nil {
		return err
	}
	return c.Process.Release()
}

func openBrowser(url string) error {
	c := exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	detach(c)
	return c.Start()
}

func unloadAgent() {}

// The folder goes once this program has exited (Windows doesn't delete a running program's file,
// and a message box may keep it open for a while): a hidden cmd tries once a second, for up to ten
// minutes, until the folder is gone. It works from the folder above (a process's working folder
// can't be deleted either).
func removeLater(dir string) {
	c := exec.Command("cmd")
	c.Dir = filepath.Dir(dir)
	c.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000, HideWindow: true,
		CmdLine: `cmd /c for /l %i in (1,1,600) do @(if exist "` + dir + `\" (rmdir /s /q "` + dir + `" 2>nul & ping -n 2 127.0.0.1 >nul))`}
	c.Start()
}

// No console: what a terminal would show goes into a message box.
func tell(msg string, bad bool) {
	t, _ := syscall.UTF16PtrFromString(appName)
	m, _ := syscall.UTF16PtrFromString(msg)
	flags := uintptr(0x40) // information
	if bad {
		flags = 0x30 // warning
	}
	procMessageBox.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), flags)
}
