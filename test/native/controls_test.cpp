// ---------------------------------------------------------------------------
// Host unit test for the on-unit controls logic (issue #24): the pure headers
// src/enc_decode.h, src/input_map.h, src/menu.h. No Arduino, no ESP32 — compiles
// with MSVC or g++ and runs on the box. Covers the quadrature/detent/button
// primitives, the "any combination of an encoder + 0..4 buttons" mapping incl.
// the long-press/solo-button synthesis, and the menu state machine (browse/edit/
// wrap/actions/disabled items).
//
//   test\native\run_controls.bat        (MSVC)
//   g++ -std=c++17 -I src test/native/controls_test.cpp -o build/ctl && ./build/ctl
// ---------------------------------------------------------------------------
#include "enc_decode.h"
#include "input_map.h"
#include "menu.h"
#include <cstdio>

static int g_pass = 0, g_fail = 0;
#define CHECK(cond, msg) do { if (cond) { g_pass++; } else { g_fail++; \
    printf("  FAIL: %s\n", msg); } } while (0)

// --- helpers ----------------------------------------------------------------
// Feed one full mechanical detent (4 quadrature edges) in the CW / CCW direction
// through an EncDetent, returning the net emitted step summed over the detent.
static const uint8_t CW_A[5]  = {1,0,0,1,1}, CW_B[5]  = {1,1,0,0,1};   // 11->01->00->10->11 = +1
static const uint8_t CCW_A[5] = {1,1,0,0,1}, CCW_B[5] = {1,0,0,1,1};   // 11->10->00->01->11 = -1

static int feedDetent(EncDetent& d, bool cw) {
    const uint8_t* A = cw ? CW_A : CCW_A;
    const uint8_t* B = cw ? CW_B : CCW_B;
    int net = 0;
    for (int i = 0; i < 5; i++) net += d.feed(A[i], B[i]);
    return net;
}

// Simulate a debounced press of `durMs` on an EncButton, returning the classified
// release. Active-high logical "pressed" already applied by caller.
static EncPress pressFor(EncButton& b, uint32_t& t, uint32_t durMs) {
    b.feed(true,  t);                          // press edge seen
    b.feed(true,  t + ENC_DEBOUNCE_MS + 1);    // becomes stable pressed
    uint32_t rel = t + ENC_DEBOUNCE_MS + 1 + durMs;
    b.feed(false, rel);                        // release edge seen
    EncPress p = b.feed(false, rel + ENC_DEBOUNCE_MS + 1);  // becomes stable released -> classify
    t = rel + ENC_DEBOUNCE_MS + 100;
    return p;
}

// ===========================================================================
static void test_encoder() {
    // Detent direction + net step.
    { EncDetent d(4); CHECK(feedDetent(d, true)  == +1, "detent CW = +1"); }
    { EncDetent d(4); CHECK(feedDetent(d, false) == -1, "detent CCW = -1"); }

    // Reverse flips the sign (A/B swapped wiring / upside-down mount).
    { EncDetent d(4, true); CHECK(feedDetent(d, true)  == -1, "reverse: CW = -1"); }
    { EncDetent d(4, true); CHECK(feedDetent(d, false) == +1, "reverse: CCW = +1"); }

    // perDetent = 1 (non-detented): each of the 4 edges is its own step.
    { EncDetent d(1); int n = 0, s;
      const uint8_t* A = CW_A; const uint8_t* B = CW_B;
      d.feed(A[0], B[0]);                       // seed
      for (int i = 1; i < 5; i++) { s = d.feed(A[i], B[i]); n += s; }
      CHECK(n == 4, "perDetent=1 emits 4 steps per detent"); }

    // perDetent = 2 (half-step): 4 edges -> 2 steps.
    { EncDetent d(2); int n = 0;
      const uint8_t* A = CW_A; const uint8_t* B = CW_B;
      d.feed(A[0], B[0]);
      for (int i = 1; i < 5; i++) n += d.feed(A[i], B[i]);
      CHECK(n == 2, "perDetent=2 emits 2 steps per detent"); }

    // A double-bit "impossible" transition (bounce) must not phantom-count.
    { EncDetent d(1); d.feed(1,1); CHECK(d.feed(0,0) == 0, "double-bit transition = 0 (no phantom)"); }

    // Button: short vs long vs noise.
    { EncButton b; uint32_t t = 1000; CHECK(pressFor(b, t, 100) == ENC_PRESS_SHORT, "100ms = short"); }
    { EncButton b; uint32_t t = 1000; CHECK(pressFor(b, t, 700) == ENC_PRESS_LONG,  "700ms = long"); }
    { EncButton b; uint32_t t = 1000;                       // sub-debounce blip = nothing
      b.feed(true, t); EncPress p = b.feed(false, t + 5);
      CHECK(p == ENC_PRESS_NONE, "5ms blip = none"); }
}

// --- input_map: drive the mapper and collect the events it emits --------------
static InputSample idle() { InputSample s; return s; }   // all present=false, idle levels high

// press separate button `i` (active-low: pressed level = LOW) for durMs
static void mapPressBtn(InputMapper& m, int i, uint32_t& t, uint32_t durMs, bool activeHigh = false) {
    InputSample s; s.btnPresent[i] = true;
    bool downLvl = activeHigh, upLvl = !activeHigh;
    s.btnLevel[i] = downLvl;  m.poll(s, t);
    s.btnLevel[i] = downLvl;  m.poll(s, t + ENC_DEBOUNCE_MS + 1);
    uint32_t rel = t + ENC_DEBOUNCE_MS + 1 + durMs;
    s.btnLevel[i] = upLvl;    m.poll(s, rel);
    s.btnLevel[i] = upLvl;    m.poll(s, rel + ENC_DEBOUNCE_MS + 1);
    t = rel + ENC_DEBOUNCE_MS + 100;
}
static void mapPressSw(InputMapper& m, uint32_t& t, uint32_t durMs) {
    InputSample s; s.swPresent = true;
    s.swLevel = false; m.poll(s, t);
    s.swLevel = false; m.poll(s, t + ENC_DEBOUNCE_MS + 1);
    uint32_t rel = t + ENC_DEBOUNCE_MS + 1 + durMs;
    s.swLevel = true;  m.poll(s, rel);
    s.swLevel = true;  m.poll(s, rel + ENC_DEBOUNCE_MS + 1);
    t = rel + ENC_DEBOUNCE_MS + 100;
}
static void mapRotate(InputMapper& m, bool cw, uint32_t& t) {
    const uint8_t* A = cw ? CW_A : CCW_A; const uint8_t* B = cw ? CW_B : CCW_B;
    InputSample s; s.encPresent = true;
    for (int i = 0; i < 5; i++) { s.a = A[i]; s.b = B[i]; m.poll(s, t++); }
}
static NavEvent drain1(InputMapper& m) { return m.next(); }

static void test_input_map() {
    uint32_t t = 1000;

    // --- encoder + push only ---
    { InputConfig c; c.hasEncoder = true; c.hasSw = true;
      InputMapper m(c);
      mapRotate(m, true, t);  CHECK(drain1(m) == NAV_INC, "enc CW -> INC");
      mapRotate(m, false, t); CHECK(drain1(m) == NAV_DEC, "enc CCW -> DEC");
      mapPressSw(m, t, 100);  CHECK(drain1(m) == NAV_ENTER, "push short -> ENTER");
      mapPressSw(m, t, 700);  CHECK(drain1(m) == NAV_BACK,  "push long -> BACK");
      CHECK(m.canSelect() && m.hasAnyInput(), "enc+push can select"); }

    // --- reverse encoder ---
    { InputConfig c; c.hasEncoder = true; c.encReverse = true;
      InputMapper m(c);
      mapRotate(m, true, t);  CHECK(drain1(m) == NAV_DEC, "reverse: CW -> DEC"); }

    // --- four buttons NEXT/PREV/ENTER/BACK ---
    { InputConfig c;
      c.btnPresent[0] = c.btnPresent[1] = c.btnPresent[2] = c.btnPresent[3] = true;
      c.role[0] = ROLE_NEXT; c.role[1] = ROLE_PREV; c.role[2] = ROLE_ENTER; c.role[3] = ROLE_BACK;
      InputMapper m(c);
      mapPressBtn(m, 0, t, 100); CHECK(drain1(m) == NAV_INC,   "NEXT short -> INC");
      mapPressBtn(m, 1, t, 100); CHECK(drain1(m) == NAV_DEC,   "PREV short -> DEC");
      mapPressBtn(m, 2, t, 100); CHECK(drain1(m) == NAV_ENTER, "ENTER short -> ENTER");
      mapPressBtn(m, 3, t, 100); CHECK(drain1(m) == NAV_BACK,  "BACK short -> BACK");
      mapPressBtn(m, 0, t, 700); CHECK(drain1(m) == NAV_ENTER, "NEXT long -> ENTER (synth)");
      mapPressBtn(m, 2, t, 700); CHECK(drain1(m) == NAV_BACK,  "ENTER long -> BACK (synth)"); }

    // --- two buttons NEXT/PREV, no explicit enter: long-press synthesises ENTER ---
    { InputConfig c; c.btnPresent[0] = c.btnPresent[1] = true;
      c.role[0] = ROLE_NEXT; c.role[1] = ROLE_PREV;
      InputMapper m(c);
      CHECK(m.canSelect(), "2 nav buttons still selectable (via long-press)");
      mapPressBtn(m, 0, t, 700); CHECK(drain1(m) == NAV_ENTER, "2-btn: NEXT long -> ENTER"); }

    // --- single button (solo): short=INC, long=ENTER, role ignored ---
    { InputConfig c; c.btnPresent[0] = true; c.role[0] = ROLE_BACK;  // role deliberately "wrong"
      InputMapper m(c);
      CHECK(m.soloButton, "one button, no encoder = solo mode");
      mapPressBtn(m, 0, t, 100); CHECK(drain1(m) == NAV_INC,   "solo short -> INC");
      mapPressBtn(m, 0, t, 700); CHECK(drain1(m) == NAV_ENTER, "solo long -> ENTER"); }

    // --- active-high wiring (switch to Vcc, pressed == HIGH) ---
    { InputConfig c; c.activeHigh = true; c.btnPresent[0] = true; c.role[0] = ROLE_NEXT;
      c.btnPresent[1] = true; c.role[1] = ROLE_ENTER;   // 2 buttons so not solo
      InputMapper m(c);
      mapPressBtn(m, 0, t, 100, /*activeHigh=*/true); CHECK(drain1(m) == NAV_INC, "active-high NEXT -> INC"); }

    // --- encoder-only, no button: can't select -> caller uses fallback mode ---
    { InputConfig c; c.hasEncoder = true; InputMapper m(c);
      CHECK(!m.canSelect() && m.hasAnyInput(), "enc-only: input present but not selectable"); }

    // --- lossless queue: a rotation and a push in the same window both survive ---
    { InputConfig c; c.hasEncoder = true; c.hasSw = true; InputMapper m(c);
      mapRotate(m, true, t); mapPressSw(m, t, 100);
      NavEvent e1 = drain1(m), e2 = drain1(m);
      CHECK((e1 == NAV_INC && e2 == NAV_ENTER), "queue keeps both rotate+press"); }

    // --- nothing configured: dead, no events, hasAnyInput false ---
    { InputConfig c; InputMapper m(c);
      m.poll(idle(), t);
      CHECK(!m.hasAnyInput() && drain1(m) == NAV_NONE, "no inputs -> nothing"); }
}

// --- menu -------------------------------------------------------------------
static void buildMenu(Menu& mn, bool bEnabled) {
    mn.clear();
    mn.addValue(10, "Uni A", 3, 0, 15, true);
    mn.addValue(11, "Uni B", 7, 0, 15, bEnabled);   // disabled on a 1-output unit
    mn.addValue(12, "Protocol", 2, 0, 2, true);
    mn.addAction(99, "Exit", true);
    mn.open();
}

static void test_menu() {
    // Browse skips the disabled item; wraps.
    { Menu mn; buildMenu(mn, /*bEnabled=*/false);
      CHECK(mn.mode == MENU_BROWSE && mn.sel == 0, "opens on first enabled");
      mn.handle(NAV_INC);
      CHECK(mn.items[mn.sel].id == 12, "INC skips disabled Uni B -> Protocol");
      mn.handle(NAV_INC);
      CHECK(mn.items[mn.sel].id == 99, "INC -> Exit");
      mn.handle(NAV_INC);
      CHECK(mn.items[mn.sel].id == 10, "INC wraps -> Uni A");
      mn.handle(NAV_DEC);
      CHECK(mn.items[mn.sel].id == 99, "DEC wraps back -> Exit"); }

    // Enter a value item, edit with wrap, commit.
    { Menu mn; buildMenu(mn, true);
      MenuResult r = mn.handle(NAV_ENTER);                 // edit Uni A (value 3)
      CHECK(mn.mode == MENU_EDIT && mn.edit == 3, "ENTER on value -> EDIT seeded");
      mn.handle(NAV_DEC); mn.handle(NAV_DEC); mn.handle(NAV_DEC);  // 3 -> 0
      r = mn.handle(NAV_DEC);                              // 0 wraps -> 15
      CHECK(mn.edit == 15, "edit wraps 0 -> 15");
      r = mn.handle(NAV_ENTER);                            // commit
      CHECK(r.committedId == 10 && r.value == 15 && mn.items[0].value == 15, "commit writes value + reports id");
      CHECK(mn.mode == MENU_BROWSE, "commit returns to BROWSE"); }

    // Edit then BACK discards.
    { Menu mn; buildMenu(mn, true);
      mn.handle(NAV_ENTER); mn.handle(NAV_INC);            // Uni A 3 -> edit 4
      MenuResult r = mn.handle(NAV_BACK);
      CHECK(mn.mode == MENU_BROWSE && mn.items[0].value == 3 && r.committedId < 0, "BACK discards edit"); }

    // Action item fires; BACK in browse closes.
    { Menu mn; buildMenu(mn, true);
      mn.sel = 3;                                          // Exit
      MenuResult r = mn.handle(NAV_ENTER);
      CHECK(r.actionId == 99, "ENTER on action reports actionId");
      MenuResult r2 = mn.handle(NAV_BACK);
      CHECK(r2.closed && mn.mode == MENU_CLOSED, "BACK in browse closes"); }

    // Single-output unit: only 3 enabled items, navigation never lands on Uni B.
    { Menu mn; buildMenu(mn, false);
      CHECK(mn.enabledCount() == 3, "1-output: 3 enabled items");
      for (int i = 0; i < 6; i++) { mn.handle(NAV_INC); CHECK(mn.items[mn.sel].id != 11, "never selects disabled"); } }
}

int main() {
    test_encoder();
    test_input_map();
    test_menu();
    printf("\ncontrols_test: %d passed, %d failed\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
