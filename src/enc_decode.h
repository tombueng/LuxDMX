// ---------------------------------------------------------------------------
// enc_decode.h — pure rotary-encoder + push-button decode primitives (issue #24)
//
// The low-level, mechanically-fiddly bits of reading a quadrature rotary encoder
// and debouncing a push-button. Everything here is deliberately free of Arduino
// (only <stdint.h>) so the whole lot is unit-tested on the host with plain g++ /
// MSVC — no ESP32 needed. The firmware glue (pinMode / digitalRead / the polling
// task / the display) lives in main.cpp and includes this after Arduino.h.
//
// Layering: this header is the bottom. input_map.h turns these raw motions and
// presses into abstract navigation events (INC/DEC/ENTER/BACK); menu.h consumes
// those. Keeping the three layers separate is what makes "any combination of an
// encoder and 0..4 buttons" testable without hardware.
// ---------------------------------------------------------------------------
#ifndef ENC_DECODE_H
#define ENC_DECODE_H

#include <stdint.h>

// --- Quadrature decode ------------------------------------------------------
// Classic full-step state-table decoder. Each call takes the previous 2-bit
// A/B reading and the current one (bit1 = A, bit0 = B) and returns the motion
// for THAT transition: +1, -1, or 0. The table indexes [prev<<2 | cur]; the
// four "impossible" double-bit transitions (electrical bounce) decode to 0, so
// contact bounce on a single edge never produces a phantom count. Summing the
// per-transition results over a full mechanical detent (the A/B Gray sequence
// 00 -> 01 -> 11 -> 10 -> 00 for one direction) yields a net +1 detent's worth
// of +1 steps; the opposite sequence yields -1's. The caller accumulates these
// and divides by the encoder's transitions-per-detent (typically 4, but 1/2 for
// some encoders) to get one step per click — see EncDetent.
//
// Table (rows = prev AB, cols = cur AB), standard Gray-code transition matrix:
//          cur: 00   01   10   11
//   prev 00      0   -1   +1    0
//   prev 01     +1    0    0   -1
//   prev 10     -1    0    0   +1
//   prev 11      0   +1   -1    0
static inline int8_t encStep(uint8_t prevAB, uint8_t curAB) {
    static const int8_t TBL[16] = {
        0, -1, +1,  0,
        +1,  0,  0, -1,
        -1,  0,  0, +1,
        0, +1, -1,  0
    };
    return TBL[((prevAB & 0x3) << 2) | (curAB & 0x3)];
}

// Detent accumulator: feed it every raw A/B sample. It tracks the previous
// reading internally, sums encStep() results, and emits exactly one -1/0/+1 per
// full mechanical detent (perDetent quadrature edges).
//
// perDetent is configurable to cover the common encoder flavours:
//   4 = one output step per mechanical click on a standard detented EC11 (default)
//   2 = half-step encoders / "every click bounces two edges"
//   1 = non-detented / raw (every quadrature edge is a step)
// reverse flips the sign so a knob wired A/B-swapped (or mounted upside down)
// counts up when turned the "natural" way — the wiring-versatility knob.
struct EncDetent {
    uint8_t prevAB    = 0xFF;   // 0xFF = "no sample yet"; first call just seeds
    int16_t accum     = 0;
    uint8_t perDetent = 4;      // quadrature edges per emitted step (1/2/4)
    bool    reverse   = false;

    EncDetent() {}
    EncDetent(uint8_t transitionsPerDetent, bool rev = false)
        : perDetent(transitionsPerDetent ? transitionsPerDetent : 1), reverse(rev) {}

    // Returns +1 / -1 once a full detent of motion has accumulated, else 0.
    int8_t feed(uint8_t a, uint8_t b) {
        uint8_t cur = (uint8_t)(((a ? 1 : 0) << 1) | (b ? 1 : 0));
        if (prevAB == 0xFF) { prevAB = cur; return 0; }   // seed only
        if (cur == prevAB) return 0;                       // no edge
        int8_t s = encStep(prevAB, cur);
        if (reverse) s = (int8_t)-s;
        accum  += s;
        prevAB  = cur;
        int16_t step = (int16_t)perDetent;
        if (accum >= step)  { accum -= step; return +1; }
        if (accum <= -step) { accum += step; return -1; }
        return 0;
    }
};

// --- Button press classification -------------------------------------------
// A push-button can do double (or triple) duty via press length: a SHORT tap vs
// a LONG hold. We classify on RELEASE so a long press is unambiguous and a quick
// tap can't be mistaken for a hold. What each length MEANS is decided a layer up
// (input_map.h) from the button's configured role and how many inputs exist.
enum EncPress {
    ENC_PRESS_NONE  = 0,
    ENC_PRESS_SHORT = 1,
    ENC_PRESS_LONG  = 2
};

static constexpr uint32_t ENC_DEBOUNCE_MS   = 25;     // ignore sub-25ms blips
static constexpr uint32_t ENC_LONG_PRESS_MS = 600;    // >=600ms held = long

// Classify a completed press from how long the button was held (ms) and the
// long-press threshold. Presses shorter than a small debounce floor are noise.
static inline EncPress encClassifyPress(uint32_t heldMs, uint32_t holdMs) {
    if (heldMs < ENC_DEBOUNCE_MS) return ENC_PRESS_NONE;
    return (heldMs >= holdMs) ? ENC_PRESS_LONG : ENC_PRESS_SHORT;
}

// Edge-debounced button tracker. Feed it the logical "pressed" state each poll
// (the caller has already applied active-high/low), with a millisecond stamp; it
// debounces and, on release, returns the classified press length.
struct EncButton {
    bool     stable        = false;   // last debounced logical state (pressed?)
    bool     lastRaw       = false;
    uint32_t lastChangeMs  = 0;
    uint32_t pressStartMs  = 0;
    uint32_t holdMs        = ENC_LONG_PRESS_MS;

    EncButton() {}
    explicit EncButton(uint32_t longPressMs) : holdMs(longPressMs ? longPressMs : ENC_LONG_PRESS_MS) {}

    // Returns the classified press on the release edge, else ENC_PRESS_NONE.
    // heldOut (optional) receives the current press duration so the caller can
    // show a "keep holding" hint while a long press is building.
    EncPress feed(bool pressedNow, uint32_t nowMs, uint32_t* heldOut = nullptr) {
        if (pressedNow != lastRaw) { lastRaw = pressedNow; lastChangeMs = nowMs; }
        EncPress out = ENC_PRESS_NONE;
        if (nowMs - lastChangeMs >= ENC_DEBOUNCE_MS && pressedNow != stable) {
            stable = pressedNow;
            if (stable) pressStartMs = nowMs;                          // press edge
            else        out = encClassifyPress(nowMs - pressStartMs, holdMs);  // release
        }
        if (heldOut) *heldOut = (stable && pressStartMs) ? (nowMs - pressStartMs) : 0;
        return out;
    }

    // True once the current (still-held) press has crossed the long threshold,
    // so the UI can hint "release now" before the user lets go.
    bool isHolding(uint32_t nowMs) const {
        return stable && pressStartMs && (nowMs - pressStartMs) >= holdMs;
    }
};

#endif  // ENC_DECODE_H
