// A small WebSocket server (RFC 6455): the handshake, frames in (masked, fragmented, ping, close)
// and frames out. Enough for one page talking to its helper; no library to trust or update.
package main

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

type wsConn struct {
	c  net.Conn
	r  *bufio.Reader
	mu sync.Mutex // one writer at a time
}

func wsAccept(key string) string {
	h := sha1.Sum([]byte(key + wsGUID))
	return base64.StdEncoding.EncodeToString(h[:])
}

func wsUpgrade(w http.ResponseWriter, r *http.Request) (*wsConn, error) {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") || !strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade") {
		return nil, errors.New("not a websocket request")
	}
	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		return nil, errors.New("no key")
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		return nil, errors.New("can't hijack")
	}
	c, rw, err := hj.Hijack()
	if err != nil {
		return nil, err
	}
	resp := "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + wsAccept(key) + "\r\n\r\n"
	if _, err := c.Write([]byte(resp)); err != nil {
		c.Close()
		return nil, err
	}
	return &wsConn{c: c, r: rw.Reader}, nil
}

// next message: its opcode (1 text, 2 binary) and payload; pings answered, close returns io.EOF.
// A client's frames must be masked (the RFC says so), and a message stays under 1 MB in all.
func (w *wsConn) read() (byte, []byte, error) {
	var msg []byte
	var op byte
	for {
		h := make([]byte, 2)
		if _, err := io.ReadFull(w.r, h); err != nil {
			return 0, nil, err
		}
		fin, code, masked := h[0]&0x80 != 0, h[0]&0x0f, h[1]&0x80 != 0
		n := uint64(h[1] & 0x7f)
		switch n {
		case 126:
			b := make([]byte, 2)
			if _, err := io.ReadFull(w.r, b); err != nil {
				return 0, nil, err
			}
			n = uint64(binary.BigEndian.Uint16(b))
		case 127:
			b := make([]byte, 8)
			if _, err := io.ReadFull(w.r, b); err != nil {
				return 0, nil, err
			}
			n = binary.BigEndian.Uint64(b)
		}
		if n > 1<<20 || uint64(len(msg))+n > 1<<20 {
			return 0, nil, errors.New("message too big")
		}
		if !masked {
			return 0, nil, errors.New("unmasked frame from a client")
		}
		var mask [4]byte
		if _, err := io.ReadFull(w.r, mask[:]); err != nil {
			return 0, nil, err
		}
		p := make([]byte, n)
		if _, err := io.ReadFull(w.r, p); err != nil {
			return 0, nil, err
		}
		for i := range p {
			p[i] ^= mask[i%4]
		}
		switch code {
		case 8:
			w.write(8, nil)
			return 0, nil, io.EOF
		case 9:
			w.write(10, p)
			continue
		case 10:
			continue
		case 0:
			msg = append(msg, p...)
		default:
			op, msg = code, p
		}
		if fin {
			return op, msg, nil
		}
	}
}

func (w *wsConn) write(op byte, p []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	// a client that stops reading doesn't hold up the others (nor this one's sender) for long
	w.c.SetWriteDeadline(time.Now().Add(2 * time.Second))
	h := []byte{0x80 | op}
	switch n := len(p); {
	case n < 126:
		h = append(h, byte(n))
	case n < 65536:
		h = append(h, 126, byte(n>>8), byte(n))
	default:
		h = append(h, 127, 0, 0, 0, 0, byte(n>>24), byte(n>>16), byte(n>>8), byte(n))
	}
	if _, err := w.c.Write(append(h, p...)); err != nil {
		return err
	}
	return nil
}

func (w *wsConn) close() { w.c.Close() }
