// The pixel output seam.
//
// Everything above this line (mapping, merging, config, web UI) is hardware-agnostic and
// host-testable; everything below is one specific peripheral. Two backends exist because
// no single one fits every board we support:
//
//   RMT       one TX channel per port. A classic ESP32 has 8 of them, an S3 only 4. Note what
//             does NOT compete for them: DMX output is a UART peripheral, so enabling all
//             three DMX ports costs zero RMT channels (measured on the carrier: 3 DMX plus
//             one pixel port selects RMT). What eats channels is pixel ports themselves, plus
//             one for a WS2812 status LED. Measured limit on an S3: THREE ports. The first
//             lane takes the DMA channel, whose larger symbol buffer borrows the neighbouring
//             channel's memory block, so it costs two of the four slots and two lanes fit in
//             what is left. The 4th port is what tips the board onto LCD_CAM.
//   LCD_CAM   the S3's parallel LCD peripheral + GDMA, all lanes clocked together, zero RMT
//             channels and ~0 CPU. Prefers PSRAM for the expanded frame but falls back to
//             internal DMA RAM. This is what the carrier's 4th port forces, and it is cheaper
//             than that many RMT lanes because every port shares one expanded frame.
//
// push() deliberately takes no port argument and covers every port at once, because the
// parallel backend is physically one DMA transaction. A per-port push would be a lie there,
// and an interface that lies is worse than one that is slightly awkward.
#pragma once
#include <stdint.h>

struct PixOutPort {
    int   pin;      // data GPIO
    int   count;    // pixels
    int   chip;     // PIX_CHIP_*
    int   order;    // PIX_ORDER_*
};

enum PixBackend { PIXBK_NONE = 0, PIXBK_RMT = 1, PIXBK_LCD = 2 };

// The i80 bus API demands a DC and a WR pin because a real display needs them; we need
// neither, so they are pointed at a pin nothing is wired to. It must NOT be GPIO 0 (the BOOT
// button: config reset and the setup portal) even though the reference drivers use exactly
// that. IO45 is a strapping pin the carrier leaves unrouted, so it is inert here. Override at
// build time for a board where it is not.
#ifndef PIXLCD_GHOST_PIN
#define PIXLCD_GHOST_PIN 45
#endif

// Per-backend entry points. pixOutBegin() picks between them; nothing else calls these.
PixBackend pixLcdBegin(const PixOutPort* ports, int n);
void       pixLcdEnd();
bool       pixLcdBusy();
void       pixLcdPush(const uint8_t* const* bufs, const uint16_t* counts);

// Bring up `n` ports. Returns the backend actually chosen, or PIXBK_NONE if none can serve
// this many ports on this chip (out of RMT channels and no LCD_CAM). Safe to call again to
// reconfigure: it tears the previous one down first.
PixBackend pixOutBegin(const PixOutPort* ports, int n);
void       pixOutEnd();
PixBackend pixOutBackend();

// True while a frame is still going out. push() is a no-op when busy.
bool pixOutBusy();

// Clock one frame. `bufs[i]` is port i's framebuffer in console order (R,G,B[,W] per pixel);
// the backend applies that port's colour order and the caller's already-applied scaling.
void pixOutPush(const uint8_t* const* bufs, const uint16_t* counts);

// Human-readable name for /pixels.json and the console.
const char* pixOutBackendName();
