// WS281x mapping arithmetic: universes -> port framebuffer, colour order, brightness,
// gamma and the power estimate.
//
// Deliberately free of Arduino and IDF headers. This is the part most likely to be subtly
// wrong (off-by-one start channels, a universe boundary landing mid-pixel, an RGBW port
// counted as RGB), and the part that is cheapest to test properly, so test/native compiles
// this file directly and hammers it on the host. Everything here is pure: no globals, no
// allocation, no hardware.
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <math.h>

#include "config_enums.h"

// Channels a pixel occupies on the wire.
static inline int pixBytesPerPixel(int chip) { return chip == PIX_CHIP_SK6812 ? 4 : 3; }

// Bit clock. WS2811 strip in its slow mode is half rate, everything else is 800 kHz.
static inline int pixKhz(int chip) { return chip == PIX_CHIP_WS2811 ? 400 : 800; }

// How long one frame occupies the wire, in microseconds. 24 (or 32) bits per pixel at the
// chip's bit rate, plus the reset gap. This is the hard ceiling on frame rate and the UI
// shows it live as the pixel count is typed, because "2040 pixels" and "16 fps" are the
// same statement.
static inline uint32_t pixFrameUs(int chip, int count) {
    const int bits = pixBytesPerPixel(chip) * 8;
    const uint32_t perPixelNs = (uint32_t)bits * (pixKhz(chip) == 400 ? 2500 : 1250);
    return (uint32_t)(((uint64_t)perPixelNs * (uint32_t)count) / 1000) + 300;   // + reset
}
static inline int pixMaxFps(int chip, int count) {
    const uint32_t us = pixFrameUs(chip, count);
    return us ? (int)(1000000UL / us) : 0;
}

// Colour order: where each of the incoming R,G,B(,W) bytes goes on the wire.
// The framebuffer holds what the console sent (R,G,B[,W]); the permutation is applied
// once, on the way out, so the buffer and every readback stay in console order.
struct PixOrder { uint8_t idx[4]; };
static inline PixOrder pixOrderMap(int order) {
    switch (order) {
        case PIX_ORDER_RGB:  return { {0, 1, 2, 3} };
        case PIX_ORDER_BRG:  return { {2, 0, 1, 3} };
        case PIX_ORDER_RBG:  return { {0, 2, 1, 3} };
        case PIX_ORDER_GBR:  return { {1, 2, 0, 3} };
        case PIX_ORDER_BGR:  return { {2, 1, 0, 3} };
        case PIX_ORDER_RGBW: return { {0, 1, 2, 3} };
        case PIX_ORDER_GRBW: return { {1, 0, 2, 3} };
        case PIX_ORDER_GRB:
        default:             return { {1, 0, 2, 3} };
    }
}

// ---------------------------------------------------------------------------
// Universe -> framebuffer slices
// ---------------------------------------------------------------------------
// One slice per universe the port consumes. `srcOff` is the offset inside that universe's
// 512 channels, `dstOff` the offset inside the port's framebuffer, `len` the byte count.
struct PixSlice {
    uint16_t uniSlot;   // 0-based position in the port's universe span (the latch-mask bit)
    uint16_t srcOff;
    uint16_t dstOff;
    uint16_t len;
};

// Fill `out` with the port's slices, return how many there are (never more than `maxOut`).
// Pass out == nullptr to just count.
//
// PIX_UNI_ALIGNED  every universe starts on a whole pixel, so nothing straddles a boundary
//                  and the first universe is short by (startCh - 1). This is what consoles
//                  and every other pixel controller assume, hence the default.
// PIX_UNI_PACKED   channels run continuously across universes and a pixel may straddle one.
static inline int pixBuildSlices(int chip, int uniMode, int count, int startCh,
                                 PixSlice* out, int maxOut) {
    const int bpp = pixBytesPerPixel(chip);
    if (count <= 0 || bpp <= 0) return 0;
    if (startCh < 1) startCh = 1;
    if (startCh > 512) return 0;

    int n = 0;
    if (uniMode == PIX_UNI_PACKED) {
        const int32_t total = (int32_t)count * bpp;
        int32_t done = 0;
        int off = startCh - 1;
        while (done < total && n < maxOut) {
            const int room = 512 - off;
            if (room <= 0) break;
            int take = (int)(total - done);
            if (take > room) take = room;
            if (out) out[n] = { (uint16_t)n, (uint16_t)off, (uint16_t)done, (uint16_t)take };
            done += take; off = 0; n++;
        }
        return n;
    }

    // Aligned. Whole pixels only, so a universe carries floor(room / bpp) of them.
    const int perUni = 512 / bpp;                  // 170 RGB, 128 RGBW
    const int firstCap = (512 - (startCh - 1)) / bpp;
    int remaining = count, dstOff = 0;
    while (remaining > 0 && n < maxOut) {
        const int cap = (n == 0) ? firstCap : perUni;
        if (cap <= 0) break;                       // start channel leaves no room for a pixel
        int take = remaining < cap ? remaining : cap;
        const int srcOff = (n == 0) ? (startCh - 1) : 0;
        if (out) out[n] = { (uint16_t)n, (uint16_t)srcOff, (uint16_t)dstOff, (uint16_t)(take * bpp) };
        dstOff += take * bpp; remaining -= take; n++;
    }
    return n;
}

// Universes the port spans. Same arithmetic, without writing anything.
static inline int pixUniverseSpan(int chip, int uniMode, int count, int startCh) {
    return pixBuildSlices(chip, uniMode, count, startCh, nullptr, 4096);
}

// ---------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------
// Two terms, and the second is the one every online calculator forgets: the controller IC
// draws its idle current even at black, so a thousand dark pixels is still about an amp.
//
//   mA = count * quiesMa            (both x100, i.e. hundredths of a mA)
//      + sum(channel) / 255 * mAPerCh
//
// `mAPerCh` is defined as the current ONE channel draws at 255, which stays unambiguous
// across RGB and RGBW where "full white" could mean three channels or four.
static inline uint32_t pixEstimateMa(const uint8_t* fb, size_t len,
                                     int count, int mAPerCh_x100, int quiesMa_x100) {
    uint64_t sum = 0;
    for (size_t i = 0; i < len; i++) sum += fb[i];
    const uint64_t lit  = (sum * (uint64_t)mAPerCh_x100) / 255ULL;   // x100 mA
    const uint64_t idle = (uint64_t)count * (uint64_t)quiesMa_x100;  // x100 mA
    return (uint32_t)((lit + idle) / 100ULL);
}

// What the port would draw with every channel at 255. The number worth showing next to the
// live figure, because it tells you your headroom BEFORE somebody pushes a white cue.
static inline uint32_t pixWorstCaseMa(int count, int bpp, int mAPerCh_x100, int quiesMa_x100) {
    const uint64_t lit  = (uint64_t)count * (uint64_t)bpp * (uint64_t)mAPerCh_x100;
    const uint64_t idle = (uint64_t)count * (uint64_t)quiesMa_x100;
    return (uint32_t)((lit + idle) / 100ULL);
}

// Scale factor (0..256, 256 = unity) that brings `estMa` under `capMa`. Only the lit term
// scales: the idle draw is there whatever we do, so scaling against the total would
// under-dim and still miss the cap on a long strip.
static inline int pixPowerScale(uint32_t estMa, uint32_t idleMa, int capMa) {
    if (capMa <= 0 || estMa <= (uint32_t)capMa) return 256;
    if ((uint32_t)capMa <= idleMa) return 0;              // idle alone is over budget
    const uint32_t litNow  = estMa - idleMa;
    const uint32_t litRoom = (uint32_t)capMa - idleMa;
    if (litNow == 0) return 256;
    uint32_t s = (litRoom * 256UL) / litNow;
    return (int)(s > 256 ? 256 : s);
}

// Gamma + brightness lookup. gamma is x100 (220 = 2.2); 0 disables and the curve is linear.
// Built once when config is applied, 256 entries, so powf is entirely affordable here and
// a hand-rolled fixed-point pow is not worth the bugs (the first attempt at one was not
// monotonic, which shows as banding on a fade).
static inline void pixBuildGamma(uint8_t* tab, int gamma_x100, int bright) {
    const float g = (gamma_x100 > 0) ? (float)gamma_x100 / 100.0f : 1.0f;
    const int   b = bright < 0 ? 0 : (bright > 255 ? 255 : bright);
    for (int i = 0; i < 256; i++) {
        const float x = (float)i / 255.0f;
        const float y = (g == 1.0f) ? x : powf(x, g);
        int v = (int)(y * 255.0f + 0.5f);
        v = (v * b) / 255;
        tab[i] = (uint8_t)(v < 0 ? 0 : (v > 255 ? 255 : v));
    }
}
