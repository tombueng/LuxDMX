#pragma once
// Structural constants the schema references. These are NOT board defaults — they
// describe what the compiled code supports (how many merge modes / fallback modes
// / RMII PHY families exist). They mirror the values in main.cpp; when the engine
// is wired in (Phase 1) main.cpp includes this header instead of redefining them.

// Values MUST match main.cpp's definitions exactly (separate translation units
// share the cfg struct, so the ints have to mean the same thing on both sides).
enum { MERGE_OFF = 0, MERGE_HTP = 1, MERGE_LTP = 2 };
enum { LOSS_HOLD = 0, LOSS_ZERO = 1, LOSS_STOP = 2 };   // per-output signal-loss policy
enum { NET_WIFI_STA = 0, NET_WIFI_AP = 1 };
enum { WIRED_FB_RETRY = 0, WIRED_FB_AP = 1, WIRED_FB_REBOOT = 2, WIRED_FB_WIFI = 3 };

#ifndef RMII_PHY_COUNT
#define RMII_PHY_COUNT 6   // count of RMII PHY families the code knows (structural)
#endif

// ---- WS281x pixel ports ----------------------------------------------------
// Chip family. Determines the bit clock and how many channels a pixel carries; the
// colour ORDER is separate (below), because the same chip ships in several orders.
enum { PIX_CHIP_WS2812 = 0,   // 800 kHz, 3 ch. WS2812/2812B/2813/2815, WS2811 @800k
       PIX_CHIP_WS2811 = 1,   // 400 kHz, 3 ch. Older WS2811 strip runs at half rate
       PIX_CHIP_SK6812 = 2,   // 800 kHz, 4 ch. SK6812 RGBW / WS2814 / UCS2904
       PIX_CHIP_COUNT  = 3 };

// Colour order on the wire. Index into PIX_ORDER_MAP in pixel.h, which holds the
// channel permutation; RGBW orders append W as the 4th.
enum { PIX_ORDER_GRB = 0, PIX_ORDER_RGB = 1, PIX_ORDER_BRG = 2,
       PIX_ORDER_RBG = 3, PIX_ORDER_GBR = 4, PIX_ORDER_BGR = 5,
       PIX_ORDER_GRBW = 6, PIX_ORDER_RGBW = 7,
       PIX_ORDER_COUNT = 8 };

// When a multi-universe pixel frame is pushed to the strip. See docs/pixels.md.
enum { PIX_LATCH_COMPLETE = 0,   // as soon as every universe of the port has arrived (default)
       PIX_LATCH_SYNC     = 1,   // only on ArtSync / E1.31 sync (falls back on timeout)
       PIX_LATCH_FREERUN  = 2,   // fixed rate, whatever is in the buffer (can tear)
       PIX_LATCH_COUNT    = 3 };

// Universe packing: whole pixels per universe (nothing straddles a boundary), or
// channels running continuously across universes.
enum { PIX_UNI_ALIGNED = 0, PIX_UNI_PACKED = 1, PIX_UNI_COUNT = 2 };
