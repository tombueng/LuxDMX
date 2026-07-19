// ---------------------------------------------------------------------------
// input_map.h — turn whatever physical controls a unit has into abstract nav
// events (issue #24). Pure / host-tested (only <stdint.h> + enc_decode.h).
//
// A unit might have: a rotary encoder (A/B), the encoder's push, and/or up to
// four separate buttons — in ANY combination. This layer maps all of that onto a
// tiny alphabet the menu understands:
//
//     NAV_INC   move to the next item / increment the value   (encoder CW, "next" button)
//     NAV_DEC   move to the previous item / decrement          (encoder CCW, "prev" button)
//     NAV_ENTER select / drill in / confirm                    (encoder push, "enter" button)
//     NAV_BACK  cancel / leave                                 ("back" button, or a long press)
//
// The whole point is "every combination produces a usable result", so missing
// primitives are synthesised from press length:
//   - encoder push:      short = ENTER, long = BACK
//   - a Next/Prev button: short = INC/DEC, long = ENTER   (lets a 2-button rig commit)
//   - an Enter button:    short = ENTER,  long = BACK      (lets an enter-only rig back out)
//   - a SINGLE button, nothing else: short = INC, long = ENTER (BACK via the menu's Exit item)
// BACK is never strictly required: the menu always carries an Exit item, so even
// a lone button can leave. See menu.h.
//
// Wiring versatility: buttons are active-low with a pull-up by default (a switch
// to GND, the usual case); set activeHigh for a switch to Vcc with a pull-down.
// The encoder's step count per detent and direction live in enc_decode.h.
// ---------------------------------------------------------------------------
#ifndef INPUT_MAP_H
#define INPUT_MAP_H

#include <stdint.h>
#include "enc_decode.h"

enum NavEvent : uint8_t {
    NAV_NONE  = 0,
    NAV_INC   = 1,
    NAV_DEC   = 2,
    NAV_ENTER = 3,
    NAV_BACK  = 4,
};

// What a configured button does. Order == the stored config enum value, so don't
// reorder without bumping the schema. A button set to ROLE_OFF is ignored even if
// it has a pin (lets you disable one without unwiring it).
enum BtnRole : uint8_t {
    ROLE_OFF   = 0,
    ROLE_ENTER = 1,
    ROLE_BACK  = 2,
    ROLE_NEXT  = 3,   // -> NAV_INC
    ROLE_PREV  = 4,   // -> NAV_DEC
};

static constexpr int INPUT_MAX_BTN = 4;

// One raw sample of every input, taken by the firmware poll (main.cpp) and handed
// to InputMapper::poll(). Levels are the raw pin reads (true = HIGH); the mapper
// applies active-high/low itself so that wiring choice is covered by the tests.
struct InputSample {
    bool    encPresent = false;   // A/B wired -> decode rotation
    uint8_t a = 1, b = 1;         // raw A/B levels
    bool    swPresent  = false;   // encoder push wired
    bool    swLevel    = true;    // raw level of the push pin
    bool    btnPresent[INPUT_MAX_BTN] = {false, false, false, false};
    bool    btnLevel[INPUT_MAX_BTN]   = {true,  true,  true,  true};   // raw levels
};

// Static description of a unit's controls, built once from config at init.
struct InputConfig {
    // encoder
    bool     hasEncoder = false;
    uint8_t  encSteps   = 4;      // quadrature edges per detent (1/2/4)
    bool     encReverse = false;
    // encoder push button
    bool     hasSw      = false;
    // separate buttons
    BtnRole  role[INPUT_MAX_BTN] = {ROLE_OFF, ROLE_OFF, ROLE_OFF, ROLE_OFF};
    bool     btnPresent[INPUT_MAX_BTN] = {false, false, false, false};
    // wiring
    bool     activeHigh = false;  // buttons + push: pressed == HIGH (default: pressed == LOW)
    uint32_t longMs     = ENC_LONG_PRESS_MS;
};

// Fixed-size lossless event queue: a single poll can legitimately emit a rotation
// step and a button release, and dropping either feels broken. 8 is plenty at a
// ~1 kHz poll (a human can't out-run it).
struct NavQueue {
    NavEvent ev[8];
    uint8_t  head = 0, tail = 0;
    void push(NavEvent e) {
        if (e == NAV_NONE) return;
        uint8_t n = (uint8_t)((tail + 1) & 7);
        if (n == head) return;        // full: drop oldest-safe (shouldn't happen in practice)
        ev[tail] = e; tail = n;
    }
    NavEvent pop() {
        if (head == tail) return NAV_NONE;
        NavEvent e = ev[head]; head = (uint8_t)((head + 1) & 7);
        return e;
    }
    bool empty() const { return head == tail; }
};

// Turns raw samples into nav events. Holds one detent accumulator + one debounced
// button tracker per physical button (encoder push counts as button index 0 of a
// separate "system" set). Construct with an InputConfig; call poll() every tick,
// then drain next() until it returns NAV_NONE.
struct InputMapper {
    InputConfig cfg;
    EncDetent   dec;
    EncButton   sw;
    EncButton   btn[INPUT_MAX_BTN];
    NavQueue    q;
    bool        soloButton = false;   // exactly one actuator, no rotation -> INC/ENTER via short/long

    InputMapper() {}
    explicit InputMapper(const InputConfig& c) { begin(c); }

    void begin(const InputConfig& c) {
        cfg = c;
        dec = EncDetent(c.encSteps, c.encReverse);
        sw  = EncButton(c.longMs);
        for (int i = 0; i < INPUT_MAX_BTN; i++) btn[i] = EncButton(c.longMs);
        q.head = q.tail = 0;
        // "Solo button" = a single press-actuator and no rotation. In that mode a
        // lone button must reach every primitive, so short=INC and long=ENTER
        // regardless of its configured role (BACK is via the menu's Exit item).
        int actuators = (c.hasSw ? 1 : 0);
        for (int i = 0; i < INPUT_MAX_BTN; i++)
            if (c.btnPresent[i] && c.role[i] != ROLE_OFF) actuators++;
        soloButton = (!c.hasEncoder && actuators == 1);
    }

    // Is there any way to trigger ENTER/select? If not, a menu can't be driven and
    // the caller should fall back to a display-less "just nudge the universe" mode.
    bool canSelect() const {
        if (cfg.hasSw) return true;
        for (int i = 0; i < INPUT_MAX_BTN; i++)
            if (cfg.btnPresent[i] && cfg.role[i] != ROLE_OFF) return true;
        return false;
    }
    bool hasAnyInput() const { return cfg.hasEncoder || canSelect(); }

    // logical "pressed" from a raw level, honouring the wiring choice.
    bool pressed(bool rawLevel) const { return cfg.activeHigh ? rawLevel : !rawLevel; }

    void poll(const InputSample& s, uint32_t now) {
        // --- rotation ---
        if (cfg.hasEncoder && s.encPresent) {
            int8_t step = dec.feed(s.a, s.b);
            if (step > 0) q.push(NAV_INC);
            else if (step < 0) q.push(NAV_DEC);
        }
        // --- encoder push: short=ENTER, long=BACK (solo: short=INC, long=ENTER) ---
        if (cfg.hasSw && s.swPresent) {
            EncPress p = sw.feed(pressed(s.swLevel), now);
            if (soloButton) {
                if (p == ENC_PRESS_SHORT) q.push(NAV_INC);
                else if (p == ENC_PRESS_LONG) q.push(NAV_ENTER);
            } else {
                if (p == ENC_PRESS_SHORT) q.push(NAV_ENTER);
                else if (p == ENC_PRESS_LONG) q.push(NAV_BACK);
            }
        }
        // --- separate buttons ---
        for (int i = 0; i < INPUT_MAX_BTN; i++) {
            if (!(cfg.btnPresent[i] && s.btnPresent[i]) || cfg.role[i] == ROLE_OFF) continue;
            EncPress p = btn[i].feed(pressed(s.btnLevel[i]), now);
            if (p == ENC_PRESS_NONE) continue;
            if (soloButton) {                       // lone button: short=INC, long=ENTER
                q.push(p == ENC_PRESS_LONG ? NAV_ENTER : NAV_INC);
                continue;
            }
            q.push(mapRole(cfg.role[i], p));
        }
    }

    NavEvent next() { return q.pop(); }

private:
    // Role + press length -> nav event, with the long-press synthesis that keeps
    // sparse button sets fully usable.
    static NavEvent mapRole(BtnRole r, EncPress p) {
        const bool lng = (p == ENC_PRESS_LONG);
        switch (r) {
            case ROLE_NEXT:  return lng ? NAV_ENTER : NAV_INC;   // long-press commits
            case ROLE_PREV:  return lng ? NAV_ENTER : NAV_DEC;
            case ROLE_ENTER: return lng ? NAV_BACK  : NAV_ENTER; // long-press backs out
            case ROLE_BACK:  return NAV_BACK;
            default:         return NAV_NONE;
        }
    }
};

#endif  // INPUT_MAP_H
