// The pixel output seam.
//
// Everything above this line (mapping, merging, config, web UI) is hardware-agnostic and
// host-testable; everything below is one specific peripheral. Two backends exist because
// no single one fits every board we support:
//
//   RMT       one TX channel per port -- and pixels are not the only claimant. DMX TX runs on
//             RMT too (dmx_rmt.h, so the break is clocked in hardware and cannot be malformed
//             by a late ISR), and a WS2812 status LED takes one as well. The budget is simply:
//
//                 enabled DMX outputs + RMT pixel ports + WS2812 status LED <= TX channels
//
//             which is 4 on an ESP32-S3 and 8 on a classic ESP32. Measured on the carrier:
//             1 DMX + 3 ports selects RMT, 1 DMX + 4 does not; 3 DMX + 1 selects RMT, 3 DMX + 2
//             does not. Both sides of that are the same rule.
//
//             One channel per chip is DMA-capable, and DMX takes it first. A pixel lane that
//             misses out is refilled from an ISR: under load a late refill stretches whichever
//             bit was being clocked, always at the same offsets in the stream, so the SAME few
//             LEDs flicker. /pixels.json reports this as "rmtDma":false.
//   LCD_CAM   the S3's parallel LCD peripheral + GDMA, all lanes clocked together, zero RMT
//             channels, no refill ISR and ~0 CPU. Prefers PSRAM for the expanded frame but
//             falls back to internal DMA RAM. Costs 72 bytes per pixel, doubled -- but shared
//             by every port, so it gets cheaper the more ports there are, and it is immune to
//             the glitch above. Worth forcing on a board that has PSRAM even when RMT would
//             fit: see the `want` argument below.
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
//
// `want` forces a driver: PIXBK_NONE picks automatically (RMT first, LCD_CAM when RMT cannot
// serve every port), PIXBK_RMT or PIXBK_LCD demand that one. Forcing matters because the
// automatic rule only asks how many ports FIT, and that is not the only thing worth choosing
// on: an RMT lane without a DMA channel is refilled from an ISR, so under load it stretches
// whichever bit it was clocking and the same pixels glitch every frame. A forced request that
// cannot be met fails rather than quietly using the other one -- silently ignoring the setting
// is how you spend an evening measuring the wrong thing.
PixBackend pixOutBegin(const PixOutPort* ports, int n, PixBackend want = PIXBK_NONE);
void       pixOutEnd();
PixBackend pixOutBackend();

// True while a frame is still going out. push() is a no-op when busy.
bool pixOutBusy();

// Clock one frame. `bufs[i]` is port i's framebuffer in console order (R,G,B[,W] per pixel);
// the backend applies that port's colour order and the caller's already-applied scaling.
void pixOutPush(const uint8_t* const* bufs, const uint16_t* counts);

// Human-readable name for /pixels.json and the console.
const char* pixOutBackendName();

// RMT only: did every lane get a DMA channel? False = ISR-refilled, can glitch under load.
bool pixOutRmtDma();

// Should the automatic choice prefer LCD_CAM on this box? True when the chip has the peripheral
// AND there is PSRAM to hold the expanded frame. Both conditions matter: the only reason to
// prefer RMT is that LCD_CAM costs 72 bytes per pixel doubled, and that argument disappears the
// moment there are megabytes of external RAM to spend. On a board with PSRAM, LCD_CAM is simply
// the better driver -- no refill ISR, so none of the fixed-offset flicker an RMT lane without a
// DMA channel produces.
bool pixLcdPreferred();
