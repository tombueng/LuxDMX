package main

// What a LuxDMX box says about its pixel ports (its /pixels.json), so the page can draw the LEDs
// the way the box drives them: brightness, gamma and the power cap decide which low values the
// LEDs show at all. Link asks every node that answers ArtPoll now and then, over plain HTTP on the
// network it already sends to; a node that isn't a LuxDMX box just doesn't answer it. Nothing is
// sent to a box, only read.

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// PixelPort is one enabled pixel port as /pixels.json says it (gamma x100, mA per channel and
// idle mA x100, as the box keeps them).
type PixelPort struct {
	Uni     int `json:"uni"`
	Start   int `json:"start"`
	Count   int `json:"count"`
	Spans   int `json:"spans"` // universes it reads (only the box knows it exactly for RGBW and packed)
	Bright  int `json:"bright"`
	Gamma   int `json:"gamma"`
	MaxMa   int `json:"maxMa"`
	MAPerCh int `json:"mAPerCh"`
	QuiesMa int `json:"quiesMa"`
}

type pixelInfo struct {
	at     int64 // when it was last asked (unix seconds)
	asking bool
	ports  []PixelPort
}

// how often a box is asked again (its ports change when someone sets them on its page)
const pixelsEvery = 30

// The enabled ports from a /pixels.json, or false when it isn't one.
func parsePixels(b []byte) ([]PixelPort, bool) {
	var j struct {
		Ports []struct {
			En bool `json:"en"`
			PixelPort
		} `json:"ports"`
	}
	if err := json.Unmarshal(b, &j); err != nil || j.Ports == nil {
		return nil, false
	}
	out := []PixelPort{}
	for _, p := range j.Ports {
		if p.En {
			out = append(out, p.PixelPort)
		}
	}
	return out, true
}

func fetchPixels(c *http.Client, url string) ([]PixelPort, bool) {
	r, err := c.Get(url)
	if err != nil {
		return nil, false
	}
	defer r.Body.Close()
	if r.StatusCode != http.StatusOK {
		return nil, false
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, 256<<10))
	if err != nil {
		return nil, false
	}
	return parsePixels(b)
}

// Ask a node about its pixel ports unless it was asked lately (or is being asked); tell the pages
// when what it says changed.
func (l *Link) askPixels(ip string) {
	if l.httpc == nil {
		return
	}
	l.mu.Lock()
	p := l.pixels[ip]
	if p == nil {
		p = &pixelInfo{}
		l.pixels[ip] = p
	}
	if p.asking || time.Now().Unix()-p.at < pixelsEvery {
		l.mu.Unlock()
		return
	}
	p.asking = true
	l.mu.Unlock()
	go func() {
		ports, ok := fetchPixels(l.httpc, "http://"+ip+"/pixels.json")
		l.mu.Lock()
		p.asking, p.at = false, time.Now().Unix()
		changed := ok && fmt.Sprint(ports) != fmt.Sprint(p.ports)
		if ok {
			p.ports = ports
		}
		l.mu.Unlock()
		if changed {
			l.tellNodes()
		}
	}()
}
