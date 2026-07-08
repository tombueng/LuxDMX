// RP2350 multi-fixture RDM responder / simulator  (Pimoroni Pico Plus 2 W)
// =============================================================================
// A crowded RDM bus in one box: up to MAXFIX virtual E1.20 fixtures, each with its
// own UID / DMX address / footprint / personality / mute state, answered from custom
// PIO on cycle-accurate 250 kBaud timing. Built to develop and STRESS-TEST the LuxDMX
// ESP32-S3 RDM controller (does it discover and talk to every fixture on a busy bus,
// catching every response?).
//
//   core 1 : PIO RX (GP0) + message-length frame completion + tight-turnaround TX (GP1)
//            - DISC_UNIQUE_BRANCH -> discovery response for the first in-range fixture
//              (controller subdivides on any reply -> full binary search of all fixtures)
//            - DISC_MUTE / DISC_UN_MUTE  -> mute state + mute ACK
//            - GET / SET  -> DEVICE_INFO, SW_VERSION, MODEL_DESC, MANUFACTURER_LABEL,
//              SUPPORTED_PARAMETERS, DMX_START_ADDRESS, IDENTIFY_DEVICE  (+ NACK others)
//   core 0 : activity LED, USB console + command parser, per-discovery drop report.
//
// Wiring (confirmed): GP0=RO(RX), GP1=DI(TX), GP2=DE+RE (low=receive).
// Console commands (115200, one per line):
//   t<us>   set responder turnaround delay (E1.20 min 176, max 2000)
//   f<n>    set active fixture count (1..MAXFIX) and regenerate the bus
//   r       un-mute all fixtures    v  toggle verbose (per-DUB trace)    ?  status
//   a       DMX analyzer stats (framing errors / refresh / break, Swisson-style); ar = reset window
// -----------------------------------------------------------------------------
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include "hardware/pio.h"
#include "hardware/clocks.h"
#include "hardware/gpio.h"
#include "hardware/uart.h"
#include "hardware/dma.h"
#include "dmxrdm_rx.pio.h"
#include "dmxrdm_tx.pio.h"
#include "dmxa_rx.pio.h"
#include "web_index.h"

static const char* STA_SSID = "dropsnet";           // join the normal network
static const char* STA_PASS = "dasistprivat0815";
static const char* AP_SSID  = "LuxDMX-RDM-Sim";     // fallback AP if STA fails
static const char* AP_PASS  = "luxrdm-sim";         // >= 8 chars
static WebServer   g_web(80);

static const uint8_t RS485_RX = 0;   // GP0 <- RO
static const uint8_t RS485_TX = 1;   // GP1 -> DI
static const uint8_t RS485_DE = 2;   // GP2 -> DE+RE (high=drive, low=receive)

// --- Bus timing (E1.20) ------------------------------------------------------
static volatile uint32_t g_turnaround = 250;   // reply delay us; sweepable via console
static const uint32_t BREAK_US = 176, MAB_US = 12;

// --- Fuzz / fault injection (M4): make fixtures deliberately misbehave ---------
static volatile uint8_t  g_fuzzDrop = 0;        // drop this % of responses
static volatile bool     g_fuzzLate = false;    // answer near the 2 ms limit
static volatile bool     g_fuzzBadCsum = false; // occasionally corrupt our checksum
static volatile bool     g_fuzzMute = false;    // sometimes ignore DISC_MUTE
static uint32_t g_rng = 0x9E3779B1;
static inline uint32_t rng() { g_rng ^= g_rng<<13; g_rng ^= g_rng>>17; g_rng ^= g_rng<<5; return g_rng; }
static inline bool chance(uint8_t pct) { return pct && (rng()%100) < pct; }
static inline uint32_t replyDelay() { return g_fuzzLate ? (1500 + rng()%400) : g_turnaround; }

// --- RDM constants -----------------------------------------------------------
static const uint8_t  RDM_SC = 0xCC, RDM_SUB_SC = 0x01, RDM_PREAMBLE = 0xFE, RDM_DELIM = 0xAA;
static const uint8_t  CC_DISC = 0x10, CC_DISC_RESP = 0x11;
static const uint8_t  CC_GET = 0x20, CC_GET_RESP = 0x21, CC_SET = 0x30, CC_SET_RESP = 0x31;
static const uint8_t  RESP_ACK = 0x00, RESP_NACK = 0x02;
static const uint16_t PID_DISC_UNIQUE_BRANCH = 0x0001, PID_DISC_MUTE = 0x0002, PID_DISC_UN_MUTE = 0x0003;
static const uint16_t PID_SUPPORTED_PARAMETERS = 0x0050, PID_DEVICE_INFO = 0x0060;
static const uint16_t PID_DEVICE_MODEL_DESCRIPTION = 0x0080, PID_MANUFACTURER_LABEL = 0x0081;
static const uint16_t PID_SOFTWARE_VERSION_LABEL = 0x00C0, PID_DMX_START_ADDRESS = 0x00F0;
static const uint16_t PID_IDENTIFY_DEVICE = 0x1000;
static const uint16_t NR_UNKNOWN_PID = 0x0000;

// --- Virtual fixtures --------------------------------------------------------
static const int MAXFIX = 200;
struct Fixture {
  uint8_t  uid[6];
  uint16_t address; uint16_t footprint;
  uint16_t modelId; uint16_t category;
  uint8_t  persCur; uint8_t persCount;
  const char* model;
  volatile bool muted;
  volatile bool identify;
};
static Fixture g_fix[MAXFIX];
static volatile int g_fixCount = 64;
static const char* MODELS[] = { "LX Par 4", "LX Wash 8", "LX Spot 16", "LX Mover 32",
                                "LX Strobe", "LX Bar 12", "LX Beam", "LX Blinder" };

static int  uidcmp(const uint8_t* a, const uint8_t* b) { for (int i=0;i<6;i++) if (a[i]!=b[i]) return a[i]<b[i]?-1:1; return 0; }
static bool inRange(const uint8_t* u, const uint8_t* lo, const uint8_t* hi) { return uidcmp(u,lo)>=0 && uidcmp(u,hi)<=0; }
static bool isBroadcast(const uint8_t* u) { for (int i=0;i<6;i++) if (u[i]!=0xFF) return false; return true; }

// Spread UIDs across the device-id space (Knuth multiplicative hash is a bijection, so
// every fixture is unique) so the controller's binary search is realistic, not trivial.
static void genFixtures(int n) {
  if (n < 1) n = 1; if (n > MAXFIX) n = MAXFIX;
  for (int i = 0; i < n; i++) {
    uint32_t h = (uint32_t)(i + 1) * 2654435761u;
    if (h == 0xFFFFFFFFu) h = 0xFFFFFFFEu;               // avoid manufacturer-broadcast dev id
    g_fix[i].uid[0] = 0x4C; g_fix[i].uid[1] = 0x58;      // manufacturer "LX"
    g_fix[i].uid[2] = h >> 24; g_fix[i].uid[3] = h >> 16; g_fix[i].uid[4] = h >> 8; g_fix[i].uid[5] = h;
    g_fix[i].footprint = 1 + (i % 32);
    g_fix[i].address   = 1 + ((i * 17) % 500);
    g_fix[i].modelId   = 0x0100 + (i % 8);
    g_fix[i].category  = 0x0500;
    g_fix[i].persCur   = 1; g_fix[i].persCount = 1 + (i % 4);
    g_fix[i].model     = MODELS[i % (int)(sizeof(MODELS)/sizeof(MODELS[0]))];
    g_fix[i].muted     = false; g_fix[i].identify = false;
  }
  g_fixCount = n;
}
static int mutedCount() { int c=0; const int n=g_fixCount; for (int i=0;i<n;i++) if (g_fix[i].muted) c++; return c; }

// --- shared state (core 1 writes, core 0 reads) ------------------------------
static volatile uint32_t g_frames = 0, g_rdmSeen = 0, g_lastActivityMs = 0, g_lastRdmMs = 0, g_rxBytes = 0, g_rxBadCsum = 0;
static volatile uint32_t g_respCount = 0, g_getCount = 0, g_setCount = 0, g_nackCount = 0;
// S3 RX-loss metric: controller re-asks the SAME branch it just got a reply for = it
// dropped our (spec-compliant) response. Ground truth for "does the S3 catch every response".
static volatile uint32_t g_ctrlReAsk = 0, g_discReAsk = 0;
static uint8_t g_prevLo[6], g_prevHi[6]; static bool g_prevReplied = false, g_havePrev = false;
static volatile uint8_t  g_lastCC = 0; static volatile uint16_t g_lastPID = 0;
static volatile uint8_t  g_ctrlUid[6] = {0};
static volatile bool     g_verbose = false;
static volatile bool     g_listenOnly = false;   // decode+count but never transmit (isolate sim TX)
static volatile bool     g_diagMode = false;     // wiring-check: LED reflects idle-bus RX noise
// Analog bus probe: tap A->A0(GP40) and B->A1(GP41) each via a 2:1 divider (line-10k-pin-10k-GND).
static const float       ADC_DIVIDER = 2.0f;      // undo the /2 hardware divider in software
static volatile int      g_vdiff = 0, g_vpp = 0;  // A-B idle level and noise, in mV (actual line)
// --- DMX line analyzer (issue #64): count framing errors like a Swisson tester --------------------
// A dedicated pio1 SM samples 8 data bits + the stop bit of every slot. A framing error = stop bit
// low. Break boundaries are found from the gap in byte arrivals (the sole 0x00-with-framing byte the
// PIO emits during a break is the placeholder that precedes the big gap, so we drop it). Lets the sim
// double as a DMX-output QA meter: run it against a LuxDMX output and watch framing errors accumulate
// with network load (the core-contention symptom KM-LED reported on WT32-ETH01).
static volatile uint32_t g_anFrames = 0;      // valid DMX frames seen (break -> slots)
static volatile uint32_t g_anSlots = 0;       // slot count of the last complete frame (513 incl. start)
static volatile uint32_t g_anFramingErr = 0;  // total framing errors (stop bit low on a data slot)
static volatile uint32_t g_anRxSlots = 0;     // total data slots inspected (denominator for the rate)
static uint32_t g_anSlotCount = 0;            // clean data slots since the last break (frame builder)
static uint32_t g_anExpectFrame = 0;          // learned frame length, capped (see serviceAnalyzer)
static volatile uint8_t  g_anStartCode = 0;   // slot-0 of the last frame (0x00 = DMX, 0xCC = RDM)
static volatile uint32_t g_anBreakUs = 0;     // approx inter-frame gap (break+MAB+MBB), microseconds
static volatile float    g_anRefreshHz = 0;   // refresh rate from slot-0 -> slot-0 spacing
static volatile uint32_t g_anResetMs = 0;     // millis() at last analyzer counter reset (for rate calc)

// --- GROUND-TRUTH framing detector: the RP's HARDWARE UART (issue #64 re-investigation) -----------
// The PIO analyzer's framing detection proved unreliable (gap-based = false positives on FIFO bursts;
// position-based = blind at the frame boundary). A real PL011 UART is the authoritative framing check
// -- it's exactly what a Swisson tester uses internally, and it's immune to how promptly we poll it
// (32-deep HW FIFO + an explicit overrun flag if we ever fall behind). Wire WT32 GPIO4 -> RP GP5.
//
// The PL011 data register (DR) carries per-byte error flags: bit8=FE (framing), bit10=BE (break),
// bit11=OE (overrun). A DMX break is a long low -> the UART flags FE+BE on a 0x00 char: that's the
// frame boundary, NOT a real error. A GENUINE framing error (a slot whose stop bit was low, or a
// mis-framed first slot after a too-short MAB) shows as FE set with BE CLEAR. That is the number #64
// is really about, and it also catches the break/MAB-boundary corruption the PIO analyzer missed.
static const uint8_t GT_RX_PIN = 5;           // GP5 = uart1 RX
#define GT_UART uart1
static volatile uint32_t g_gtFrames = 0;      // BE events (breaks) = frames seen
static volatile uint32_t g_gtFramingErr = 0;  // FE && !BE = genuine framing errors (the ground truth)
static volatile uint32_t g_gtOverrun = 0;     // OE = we fell behind draining (measurement-integrity flag)
static volatile uint32_t g_gtBytes = 0;
static volatile float    g_gtRefreshHz = 0;
static volatile uint32_t g_gtResetMs = 0;
static bool g_gtReady = false;

// --- Reply-side capture -----------------------------------------------------------------------
// The responder's own RO goes dark while it drives (single combined DE+RE), so the on-board analyzer
// can't see the RDM reply it transmits. To catch reply corruption we tap what the CONTROLLER actually
// receives: wire the WT32 controller's RDM-reply RX pin (IO4, logic level after its transceiver) to
// GP13 (uart0 RX). The RP then holds "what I sent" next to "what the controller got" and diffs them,
// which pins any bit error on the analog path (RP DI -> xcvr -> bus -> WT32 xcvr -> IO4) versus the
// controller's own firmware read. RDM replies are break-less, so a reply burst is split on an idle gap.
static const uint8_t RC_RX_PIN = 13;          // GP13 = uart0 RX <- WT32 IO4 (controller reply RX)
#define RC_UART uart0
static volatile uint32_t g_rcBytes = 0;       // bytes the controller reply line delivered
static volatile uint32_t g_rcFramingErr = 0;  // FE on a reply byte = on-wire corruption (break-less)
static volatile uint32_t g_rcOverrun = 0;     // OE = capture fell behind
static volatile uint32_t g_rcReplies = 0;     // reply bursts located + checked
static volatile uint32_t g_rcBadReplies = 0;  // of those, how many were corrupted (mismatch or framing err)
static volatile uint32_t g_rcMismatch = 0;    // last reply: bytes that differ from what we sent
static uint8_t  g_txReply[64]; static volatile int g_txReplyLen = 0;   // last reply the responder sent
static uint8_t  g_rcWin[96];   static volatile int g_rcWinLen = 0;     // raw bytes seen in a reply window
static uint8_t  g_rcLast[64];  static volatile int g_rcLastLen = 0;    // the reply as the controller saw it
static volatile uint32_t g_rcFeAtArm = 0;     // framing-error count when a reply window opened
static volatile uint32_t g_rcCalls = 0;       // DIAG: times rcAfterReply ran (== replies we drove)
static volatile int      g_rcWinLast = 0;     // DIAG: bytes the last reply-window drain saw
static volatile bool     g_rcDisable = false; // DIAG: when set, skip all reply-capture (isolate analyzer)
static volatile bool     g_mlDisable = false; // DIAG: when set, skip the analog A-B sampler in loop()
static volatile uint32_t g_rcResetMs = 0;
static bool g_rcReady = false;

// Snapshot the bytes we are about to drive AND arm the capture. The controller's reply-RX line also
// carries the forward DMX, so we only trust bytes that land in the short window right after we send
// (and then align on the reply signature). Without this the capture just grabs the next DMX frame.
static inline void snapTxReply(const uint8_t* b, int n) {
  int m = n > (int)sizeof(g_txReply) ? (int)sizeof(g_txReply) : n;
  for (int i = 0; i < m; i++) g_txReply[i] = b[i];
  g_txReplyLen = m;
  // Flush any stale forward-DMX out of the capture FIFO so the drain after the send sees only the
  // reply (the bus is idle through the turnaround, so nothing else lands in between).
  if (g_rcReady) { uart_hw_t* h = uart_get_hw(RC_UART); while (!(h->fr & UART_UARTFR_RXFE_BITS)) (void)h->dr; }
  g_rcWinLen = 0; g_rcFeAtArm = g_rcFramingErr;
}
static String hexBuf(const uint8_t* b, int n) {
  static const char H[] = "0123456789ABCDEF";
  String s; s.reserve(n * 2);
  for (int i = 0; i < n; i++) { s += H[b[i] >> 4]; s += H[b[i] & 0xF]; }
  return s;
}

static void gtUartInit() {
  uart_init(GT_UART, 250000);
  uart_set_format(GT_UART, 8, 2, UART_PARITY_NONE);   // DMX slot framing = 8 data + 2 stop, no parity
  uart_set_fifo_enabled(GT_UART, true);
  gpio_set_function(GT_RX_PIN, GPIO_FUNC_UART);
  g_gtReady = true;
}
// Drain the UART FIFO, folding per-byte flags into the ground-truth counters. Call often (core 1).
static void serviceGtUart() {
  if (!g_gtReady) return;
  static uint32_t lastBreakUs = 0; static bool haveBreak = false;
  uart_hw_t* h = uart_get_hw(GT_UART);
  while (!(h->fr & UART_UARTFR_RXFE_BITS)) {           // while RX FIFO is not empty
    const uint32_t dr = h->dr;                         // pop one entry: data + error flags
    g_gtBytes++;
    if (dr & (1u << 11)) g_gtOverrun++;                // OE
    if (dr & (1u << 10)) {                             // BE = break = frame boundary
      g_gtFrames++;
      const uint32_t nowUs = time_us_32();
      if (haveBreak) { const uint32_t p = nowUs - lastBreakUs;
        if (p > 1000 && p < 200000) g_gtRefreshHz = 1000000.0f / (float)p; }
      lastBreakUs = nowUs; haveBreak = true;
    } else if (dr & (1u << 8)) {                        // FE without BE = a genuine framing error
      g_gtFramingErr++;
    }
  }
}

static void rcUartInit() {
  uart_init(RC_UART, 250000);
  uart_set_format(RC_UART, 8, 2, UART_PARITY_NONE);   // same slot framing as DMX/RDM: 8 data + 2 stop
  uart_set_fifo_enabled(RC_UART, true);
  gpio_set_function(RC_RX_PIN, GPIO_FUNC_UART);
  gpio_pull_up(RC_RX_PIN);      // idle-high when no tap is wired (a driven WT32 IO4 overrides this),
                                // so the "no tap" state reads clean instead of flagging float glitches
  busy_wait_us(200);            // let the pull-up settle, then drop the transition glitch the FIFO
  uart_hw_t* h = uart_get_hw(RC_UART);            // latched while the pad switched to UART mode
  while (!(h->fr & UART_UARTFR_RXFE_BITS)) (void)h->dr;
  g_rcReady = true;
}
// Pull the actual reply out of the captured window and diff it against what we drove. The window can
// also hold trailing forward-DMX bytes, so align on the reply signature: the 0xAA delimiter for a
// DISC reply, else the start code + sub-start-code (0xCC 0x01) for a GET/SET reply.
static void rcExtractReply() {
  if (g_txReplyLen == 0 || g_rcWinLen == 0) return;
  const bool disc = (g_txReply[0] == RDM_PREAMBLE);        // 0xFE preamble -> DISC reply
  int start = -1, soff = 0;
  if (disc) {
    for (int i = 0; i < g_txReplyLen; i++) if (g_txReply[i] == RDM_DELIM) { soff = i; break; }  // sent delimiter
    for (int i = 0; i < g_rcWinLen;   i++) if (g_rcWin[i]   == RDM_DELIM) { start = i; break; }  // recv delimiter
  } else {
    for (int i = 0; i + 1 < g_rcWinLen; i++) if (g_rcWin[i] == g_txReply[0] && g_rcWin[i+1] == g_txReply[1]) { start = i; break; }
  }
  if (start < 0) { g_rcBadReplies++; return; }             // reply signature not found (lost/mangled)
  int n = 0; uint32_t diff = 0;
  for (; start + n < g_rcWinLen && soff + n < g_txReplyLen && n < (int)sizeof(g_rcLast); n++) {
    g_rcLast[n] = g_rcWin[start + n];
    if (g_rcLast[n] != g_txReply[soff + n]) diff++;
  }
  const int expect = g_txReplyLen - soff;
  if (n < expect) diff += (expect - n);                    // truncated (overflow) counts as mismatch
  g_rcLastLen = n; g_rcMismatch = diff; g_rcReplies++;
  const bool feInWindow = (g_rcFramingErr != g_rcFeAtArm);
  if (diff > 0 || feInWindow) g_rcBadReplies++;
}
// Between transactions, just drain the FIFO so forward DMX can't overflow it. rcBytes is a
// bus-activity reference; the reply itself is grabbed synchronously by rcAfterReply().
static void serviceRcUart() {
  if (!g_rcReady) return;
  uart_hw_t* h = uart_get_hw(RC_UART);
  while (!(h->fr & UART_UARTFR_RXFE_BITS)) { (void)h->dr; g_rcBytes++; }
}
// Called right after we release DE: the reply has just been clocked into the controller and echoed
// onto its reply-RX line (which we tap). snapTxReply() flushed the FIFO before the send, and the bus
// is idle during the turnaround, so what's here now is exactly the reply. Drain it, then extract.
static void rcAfterReply() {
  if (!g_rcReady) return;
  g_rcCalls++;
  g_rcWinLen = 0;
  busy_wait_us(120);                                       // let the controller clock in the last byte
  uart_hw_t* h = uart_get_hw(RC_UART);                     // the reply (if any) is already in the FIFO;
  while (!(h->fr & UART_UARTFR_RXFE_BITS)) {               // a single drain keeps core 1 responsive
    const uint32_t dr = h->dr;
    g_rcBytes++;
    if (dr & (1u << 11)) g_rcOverrun++;                            // OE
    if ((dr & (1u << 8)) && !(dr & (1u << 10))) g_rcFramingErr++;  // FE without BE = corruption
    if (g_rcWinLen < (int)sizeof(g_rcWin)) g_rcWin[g_rcWinLen++] = dr & 0xFF;
  }
  g_rcWinLast = g_rcWinLen;
  { int m = g_rcWinLen < (int)sizeof(g_rcLast) ? g_rcWinLen : (int)sizeof(g_rcLast);  // DIAG: raw capture
    for (int i = 0; i < m; i++) g_rcLast[i] = g_rcWin[i]; g_rcLastLen = m; }
  rcExtractReply();
}
// Per-discovery tracking (a discovery starts on a broadcast DISC_UN_MUTE).
static volatile bool     g_discActive = false;
static volatile uint32_t g_discResp = 0; static volatile int g_discSeq = 0;
static volatile int      g_lastDiscMuted = -1, g_lastDiscExpected = 0; static volatile uint32_t g_lastDiscResp = 0, g_lastDiscReAsk = 0;
static volatile bool     g_discDoneNew = false;
// DUB depth trace ring for verbose mode.
struct Ev { uint8_t depth; uint8_t resp; uint8_t muted; uint8_t lo[6]; uint8_t hi[6]; };
static volatile Ev g_ev[128]; static volatile uint16_t g_evHead = 0; static uint16_t g_evTail = 0;
static int prefixBits(const uint8_t* lo, const uint8_t* hi) {
  int bits = 0;
  for (int i = 0; i < 6; i++) { const uint8_t x = lo[i]^hi[i]; if (x==0){bits+=8;continue;} for (int b=7;b>=0;b--){if(x&(1<<b))return bits;bits++;} return bits; }
  return bits;
}

// --- Activity LED ------------------------------------------------------------
static inline bool busActive() { return (millis() - g_lastActivityMs) < 250; }
static void serviceLed() {
  // Error indicator, not a heartbeat: dark when healthy, blinks only while errors are actively
  // arriving (framing errors on the wire, a corrupt request, or a mangled reply). Nothing to watch
  // when everything is fine, which is the normal state, so the LED stays off.
  static uint32_t lastErr = 0, lastErrMs = 0, lastToggle = 0; static bool on = false, cur = false;
  const uint32_t now = millis();
  const uint32_t errs = g_gtFramingErr + g_rxBadCsum + g_rcBadReplies;
  if (errs != lastErr) { lastErr = errs; lastErrMs = now; }
  bool want = false;
  if (now - lastErrMs < 1500) {                        // an error in the last 1.5 s -> blink fast
    if (now - lastToggle >= 80) { on = !on; lastToggle = now; }
    want = on;
  }
  if (want != cur) { digitalWrite(LED_BUILTIN, want); cur = want; }
}
// Wiring-check LED: reflects idle-bus RX noise so you can wiggle the board and watch it clean up.
// SOLID ON = clean (no stray edges). BLINKING = noise, faster blink = more noise. Idle the bus
// (no discovery / no DMX) while using this. `g_rxBytes` climbs only when GP0 sees line transitions.
static void serviceDiagLed() {
  static uint32_t lastMs = 0, lastBytes = 0, noise = 0, lastToggle = 0; static bool ledOn = true, cur = false;
  const uint32_t now = millis();
  if (now - lastMs >= 100) { noise = g_rxBytes - lastBytes; lastBytes = g_rxBytes; lastMs = now; }
  bool want;
  if (noise <= 2) want = true;                                  // essentially clean -> solid ON
  else {
    const uint32_t period = noise > 800 ? 30 : noise > 200 ? 70 : noise > 30 ? 150 : 350;
    if (now - lastToggle >= period) { ledOn = !ledOn; lastToggle = now; }
    want = ledOn;
  }
  if (want != cur) { digitalWrite(LED_BUILTIN, want); cur = want; }
}
// Sample the two analog taps and report the A-B differential: mean = idle level, span = noise pp.
// Gives real millivolts so you can see if the idle sits at the ~350mV it should, or oscillates.
static void measureLines() {
  const int N = 500;
  long sum = 0; int mn = 32767, mx = -32768;
  for (int i = 0; i < N; i++) {
    const int d = analogRead(A0) - analogRead(A1);     // raw 12-bit counts, A minus B
    sum += d; if (d < mn) mn = d; if (d > mx) mx = d;
  }
  const float k = (3300.0f / 4095.0f) * ADC_DIVIDER;   // counts -> mV at the actual line
  g_vdiff = (int)((sum / (float)N) * k);
  g_vpp   = (int)((mx - mn) * k);
}

// ============================ CORE 1: PIO RX + responder =====================
static PIO g_pio = pio0;
static const int RX_SM = 0, TX_SM = 1;
static uint g_rxOff = 0, g_txOff = 0;
// The DMX analyzer lives on its OWN PIO block (pio1) so its extra SM + program never crowds the
// RDM RX/TX or the CYW43 radio's SM out of pio0's 32-instruction / 4-SM budget.
static PIO g_anPio = pio1;
static const int AN_SM = 0;
static uint g_anOff = 0;
// --- Analyzer capture via DMA -------------------------------------------------------------------
// The old code drained the PIO RX FIFO directly from loop1(). But loop1 also assembles RDM frames
// and BLOCKS ~1 ms sending each RDM reply, so whenever it was busy the 8-word analyzer FIFO
// overflowed and dropped slots. A dropped slot makes the once-per-frame break land "mid-frame",
// which the structural detector below then miscounts as a framing error -- that is the bogus
// "thousands of errors per minute on a perfectly clean signal" (confirmed: the ground-truth UART on
// the same wire read 0). FIX: a DMA channel streams every 9-bit slot word straight into a big RAM
// ring buffer, so capture never stalls no matter what the CPU does. loop1 consumes it at its leisure.
#define AN_RING_LOG2   11                          // 2^11 words = 2048 slots ~= 100 ms of DMX @ 20.5k/s
#define AN_RING_WORDS  (1u << AN_RING_LOG2)
static uint32_t g_anRing[AN_RING_WORDS] __attribute__((aligned(AN_RING_WORDS * 4)));
static int      g_anDma  = -1;
static uint32_t g_anTail = 0;                      // consumer index into g_anRing

static void anDmaStart() {
  if (g_anDma < 0) g_anDma = dma_claim_unused_channel(true);
  dma_channel_config c = dma_channel_get_default_config(g_anDma);
  channel_config_set_transfer_data_size(&c, DMA_SIZE_32);
  channel_config_set_read_increment(&c, false);                    // always the same FIFO register
  channel_config_set_write_increment(&c, true);                    // walk the ring...
  channel_config_set_ring(&c, true, AN_RING_LOG2 + 2);             // ...wrapping the write addr (bytes)
  channel_config_set_dreq(&c, pio_get_dreq(g_anPio, AN_SM, false));// paced by the PIO RX FIFO
  g_anTail = 0;
  dma_channel_configure(g_anDma, &c, g_anRing, &g_anPio->rxf[AN_SM], 0xFFFFFFFFu, true);
}

// Consume whatever the DMA captured and fold each slot into the counters. Frame boundary = the break
// placeholder byte (stop-low at ~full frame length); a stop-low well before that is a genuine framing
// error. expectFrame learns the true frame length (a gateway sends a fixed 513). Refresh is a frame
// count over a wall-clock window (per-byte timestamps are gone with DMA, but frame-rate over 500 ms is
// exactly what a DMX tester reports and is immune to how bursty loop1 is).
// A DMX frame is at most 1 start code + 512 channels = 513 slots. The learned frame length is capped
// just above that so a long break-less stretch (e.g. while DMX pauses during an RDM discovery) can
// never poison it into a huge value. AN_HARD_RESYNC is a self-heal: if we somehow run this many slots
// with no recognised break, force a boundary and re-learn, so the analyzer can never get stuck.
static const uint32_t AN_MAX_FRAME   = 520;
static const uint32_t AN_HARD_RESYNC = 1100;
static void serviceAnalyzer() {
  static uint32_t lastRefMs = 0, lastRefFrames = 0;
  if (g_anDma < 0) return;
  const uint32_t head = (uint32_t)((dma_hw->ch[g_anDma].write_addr - (uintptr_t)g_anRing) >> 2)
                        & (AN_RING_WORDS - 1);
  while (g_anTail != head) {
    const uint32_t w = g_anRing[g_anTail];
    g_anTail = (g_anTail + 1) & (AN_RING_WORDS - 1);
    const uint8_t data    = (w >> 23) & 0xFF;
    const bool    stopLow = ((w >> 31) & 1) == 0;
    if (!stopLow) {                                 // clean data slot (stop bit high = framed OK)
      if (g_anSlotCount == 0) g_anStartCode = data; // first slot after a break = the start code
      g_anSlotCount++; g_anRxSlots++;
      if (g_anSlotCount > AN_HARD_RESYNC) {         // no break for way too long -> force a resync
        g_anSlots = g_anSlotCount; g_anFrames++; g_anSlotCount = 0; g_anExpectFrame = 0;
      }
      continue;
    }
    const bool atFrameEnd = (g_anExpectFrame == 0) ? (g_anSlotCount >= 16)
                                                   : (g_anSlotCount + 4 >= g_anExpectFrame);
    if (atFrameEnd) {                               // real break -> frame boundary
      if (g_anSlotCount > g_anExpectFrame && g_anSlotCount <= AN_MAX_FRAME) g_anExpectFrame = g_anSlotCount;
      g_anSlots = g_anSlotCount; g_anFrames++; g_anSlotCount = 0;
    } else {                                        // stop-low mid-frame -> framing error, but only
      // count it on an actual DMX frame (start code 0x00). During an RDM discovery the bus carries
      // requests/replies (start code 0xCC, break-less preambles) that a DMX-tuned analyzer would
      // otherwise flag as errors -- that is not the issue #64 signal, so ignore it.
      if (g_anExpectFrame > 256 && g_anStartCode == 0x00) g_anFramingErr++;
      g_anSlotCount++; g_anRxSlots++;
    }
  }
  const uint32_t nowMs = millis();
  if (nowMs - lastRefMs >= 500) {
    if (lastRefMs && g_anFrames >= lastRefFrames)
      g_anRefreshHz = (g_anFrames - lastRefFrames) * 1000.0f / (float)(nowMs - lastRefMs);
    if (g_anRefreshHz > 1.0f) {                     // display-only break estimate: period - active
      const float active = g_anExpectFrame * 44.0f; // ~44 us per 8N2 slot
      const float period = 1000000.0f / g_anRefreshHz;
      g_anBreakUs = (period > active) ? (uint32_t)(period - active) : 0;
    }
    lastRefMs = nowMs; lastRefFrames = g_anFrames;
  }
  if (!dma_channel_is_busy(g_anDma)) anDmaStart();  // the huge transfer count ran out (rare) -> restart
}
static inline void deTx() { gpio_put(RS485_DE, 1); }
static inline void deRx() { gpio_put(RS485_DE, 0); }

// Hard-reset the RX state machine so the next frame reframes from a clean idle->start
// edge (clearing the FIFO alone leaves the shifter mid-byte after we drove the bus).
static void rxReset() {
  pio_sm_set_enabled(g_pio, RX_SM, false);
  pio_sm_clear_fifos(g_pio, RX_SM);
  pio_sm_restart(g_pio, RX_SM);
  pio_sm_exec(g_pio, RX_SM, pio_encode_jmp(g_rxOff));
  pio_sm_set_enabled(g_pio, RX_SM, true);
}

// Feed a byte stream and block until the SM has fully shifted the LAST byte out (it
// stalls back at the `pull` instruction = program start). Releasing DE any earlier
// truncates the final byte on the wire -> bad checksum -> the controller drops it.
static void txBytes(const uint8_t* buf, int n) {
  for (int i = 0; i < n; i++) pio_sm_put_blocking(g_pio, TX_SM, buf[i]);
  while (!pio_sm_is_tx_fifo_empty(g_pio, TX_SM)) tight_loop_contents();
  // Wait for the last byte to leave the shifter (SM idles back at `pull` == program start),
  // but bounded so a PC we never observe can't stall core 1.
  uint32_t t0 = time_us_32();
  while (pio_sm_get_pc(g_pio, TX_SM) != g_txOff && (time_us_32() - t0) < 300) tight_loop_contents();
  busy_wait_us(14);            // >2 stop-bit times of margin before releasing DE
}
static void sendBreak() {
  gpio_set_function(RS485_TX, GPIO_FUNC_SIO);
  gpio_set_dir(RS485_TX, true);
  gpio_put(RS485_TX, 0); busy_wait_us(BREAK_US);
  gpio_put(RS485_TX, 1); busy_wait_us(MAB_US);
  pio_gpio_init(g_pio, RS485_TX);
}

// DISC_UNIQUE_BRANCH reply (no break): preamble + delimiter + 12 EUID + 4 checksum bytes.
static void sendDiscResponse(const Fixture* fx) {
  if (g_listenOnly) return;                            // isolation mode: decode but never drive the bus
  if (chance(g_fuzzDrop)) return;                      // fault injection: silently drop this reply
  uint8_t r[24]; int k = 0;
  for (int i = 0; i < 7; i++) r[k++] = RDM_PREAMBLE;
  r[k++] = RDM_DELIM;
  uint16_t cs = 0;
  for (int j = 0; j < 6; j++) { r[k++] = fx->uid[j] | 0xAA; r[k++] = fx->uid[j] | 0x55; cs += (uint16_t)fx->uid[j] + 0xFF; }
  r[k++] = (cs>>8)|0xAA; r[k++] = (cs>>8)|0x55; r[k++] = (cs&0xFF)|0xAA; r[k++] = (cs&0xFF)|0x55;
  if (g_fuzzBadCsum && chance(20)) r[23] ^= 0xFF;      // fault injection: corrupt the checksum
  snapTxReply(r, 24);
  deTx(); busy_wait_us(replyDelay()); txBytes(r, 24); deRx();
  if (!g_rcDisable) rcAfterReply();                     // capture what the controller received
  pio_sm_clear_fifos(g_pio, RX_SM);   // clearing works; SM disable/restart (rxReset) intermittently kills RX
}

// Standard RDM response (with break). pd may be NULL when pdl==0.
static void sendRdmResponse(const uint8_t* ctrlUid, const Fixture* fx, uint8_t tn,
                            uint8_t respType, uint8_t cc, uint16_t pid, const uint8_t* pd, uint8_t pdl) {
  if (g_listenOnly) return;
  uint8_t p[64];
  p[0]=RDM_SC; p[1]=RDM_SUB_SC; p[2]=24+pdl;
  for (int i=0;i<6;i++) p[3+i]=ctrlUid[i];
  for (int i=0;i<6;i++) p[9+i]=fx->uid[i];
  p[15]=tn; p[16]=respType; p[17]=0; p[18]=0; p[19]=0;
  p[20]=cc; p[21]=pid>>8; p[22]=pid&0xFF; p[23]=pdl;
  for (int i=0;i<pdl;i++) p[24+i]=pd[i];
  uint16_t cs=0; const int ml=24+pdl; for (int i=0;i<ml;i++) cs+=p[i];
  p[ml]=cs>>8; p[ml+1]=cs&0xFF;
  snapTxReply(p, ml+2);
  deTx(); busy_wait_us(replyDelay()); sendBreak(); txBytes(p, ml+2); deRx();
  if (!g_rcDisable) rcAfterReply();                     // capture what the controller received
  pio_sm_clear_fifos(g_pio, RX_SM);
}
static void sendNack(const uint8_t* ctrlUid, const Fixture* fx, uint8_t tn, uint8_t cc, uint16_t pid, uint16_t reason) {
  const uint8_t pd[2] = { (uint8_t)(reason>>8), (uint8_t)reason };
  sendRdmResponse(ctrlUid, fx, tn, RESP_NACK, cc, pid, pd, 2);
  g_nackCount++;
}

static void handleGetSet(const uint8_t* f, uint8_t cc, uint16_t pid, Fixture* fx) {
  const uint8_t tn = f[15];
  const uint8_t* ctrl = (const uint8_t*)g_ctrlUid;
  const uint8_t respCc = (cc == CC_GET) ? CC_GET_RESP : CC_SET_RESP;

  if (cc == CC_GET) {
    g_getCount++;
    switch (pid) {
      case PID_DEVICE_INFO: {
        uint8_t d[19]; int k=0;
        d[k++]=0x01; d[k++]=0x00;                                  // RDM protocol 1.0
        d[k++]=fx->modelId>>8; d[k++]=fx->modelId;                 // device model id
        d[k++]=fx->category>>8; d[k++]=fx->category;               // product category
        d[k++]=0x00; d[k++]=0x00; d[k++]=0x00; d[k++]=0x01;        // software version id
        d[k++]=fx->footprint>>8; d[k++]=fx->footprint;             // DMX footprint
        d[k++]=fx->persCur; d[k++]=fx->persCount;                  // personality current/count
        d[k++]=fx->address>>8; d[k++]=fx->address;                 // DMX start address
        d[k++]=0x00; d[k++]=0x00;                                  // sub-device count
        d[k++]=0x00;                                              // sensor count
        sendRdmResponse(ctrl, fx, tn, RESP_ACK, respCc, pid, d, 19); return;
      }
      case PID_SOFTWARE_VERSION_LABEL: {
        const char* s = "LX-SIM v1.0"; uint8_t d[32]; int n=0; while (s[n] && n<32){d[n]=s[n];n++;}
        sendRdmResponse(ctrl, fx, tn, RESP_ACK, respCc, pid, d, n); return;
      }
      case PID_DEVICE_MODEL_DESCRIPTION: {
        const char* s = fx->model; uint8_t d[32]; int n=0; while (s[n] && n<32){d[n]=s[n];n++;}
        sendRdmResponse(ctrl, fx, tn, RESP_ACK, respCc, pid, d, n); return;
      }
      case PID_MANUFACTURER_LABEL: {
        const char* s = "LuxDMX Simulator"; uint8_t d[32]; int n=0; while (s[n] && n<32){d[n]=s[n];n++;}
        sendRdmResponse(ctrl, fx, tn, RESP_ACK, respCc, pid, d, n); return;
      }
      case PID_DMX_START_ADDRESS: {
        const uint8_t d[2] = { (uint8_t)(fx->address>>8), (uint8_t)fx->address };
        sendRdmResponse(ctrl, fx, tn, RESP_ACK, respCc, pid, d, 2); return;
      }
      case PID_IDENTIFY_DEVICE: {
        const uint8_t d[1] = { (uint8_t)(fx->identify?1:0) };
        sendRdmResponse(ctrl, fx, tn, RESP_ACK, respCc, pid, d, 1); return;
      }
      case PID_SUPPORTED_PARAMETERS: {
        const uint16_t pids[] = { PID_DEVICE_MODEL_DESCRIPTION, PID_MANUFACTURER_LABEL,
                                  PID_DMX_START_ADDRESS, PID_IDENTIFY_DEVICE };
        uint8_t d[32]; int k=0;
        for (unsigned i=0;i<sizeof(pids)/sizeof(pids[0]);i++){ d[k++]=pids[i]>>8; d[k++]=pids[i]; }
        sendRdmResponse(ctrl, fx, tn, RESP_ACK, respCc, pid, d, k); return;
      }
      default: sendNack(ctrl, fx, tn, respCc, pid, NR_UNKNOWN_PID); return;
    }
  } else { // SET
    g_setCount++;
    switch (pid) {
      case PID_DMX_START_ADDRESS: {
        const uint16_t a = ((uint16_t)f[24]<<8) | f[25];
        if (a >= 1 && a <= 512) fx->address = a;
        sendRdmResponse(ctrl, fx, tn, RESP_ACK, respCc, pid, NULL, 0); return;
      }
      case PID_IDENTIFY_DEVICE: {
        fx->identify = (f[24] != 0);
        sendRdmResponse(ctrl, fx, tn, RESP_ACK, respCc, pid, NULL, 0); return;
      }
      default: sendNack(ctrl, fx, tn, respCc, pid, NR_UNKNOWN_PID); return;
    }
  }
}

static void handleRdm(const uint8_t* f, int n) {
  if (f[1] != RDM_SUB_SC) return;
  const uint8_t  cc  = f[20];
  const uint16_t pid = ((uint16_t)f[21]<<8) | f[22];
  for (int i=0;i<6;i++) g_ctrlUid[i] = f[9+i];
  g_rdmSeen++; g_lastCC = cc; g_lastPID = pid; g_lastRdmMs = millis();
  const int nf = g_fixCount;

  if (cc == CC_DISC) {
    if (pid == PID_DISC_UNIQUE_BRANCH && n >= 38) {
      const uint8_t* lo = &f[24]; const uint8_t* hi = &f[30];
      int first = -1;
      for (int i=0;i<nf;i++) if (!g_fix[i].muted && inRange(g_fix[i].uid, lo, hi)) { first = i; break; }
      // Same branch re-asked right after we replied => the controller dropped our reply.
      bool sameBranch = g_havePrev;
      for (int i=0;i<6 && sameBranch;i++) if (g_prevLo[i]!=lo[i] || g_prevHi[i]!=hi[i]) sameBranch=false;
      if (sameBranch && g_prevReplied) { g_ctrlReAsk++; if (g_discActive) g_discReAsk++; }
      for (int i=0;i<6;i++){ g_prevLo[i]=lo[i]; g_prevHi[i]=hi[i]; } g_havePrev=true; g_prevReplied=(first>=0);
      { // always record the DUB event (cheap) so the web log + verbose trace both have data
        volatile Ev* e = &g_ev[g_evHead & 127];
        e->depth = (uint8_t)prefixBits(lo,hi); e->resp = (uint8_t)(first>=0?1:0); e->muted = (uint8_t)mutedCount();
        for (int i=0;i<6;i++){ e->lo[i]=lo[i]; e->hi[i]=hi[i]; }
        g_evHead++;
      }
      if (first >= 0) { sendDiscResponse(&g_fix[first]); g_respCount++; if (g_discActive) g_discResp++; }
    } else if (pid == PID_DISC_MUTE) {
      const uint8_t* dst = &f[3];
      if (isBroadcast(dst)) { for (int i=0;i<nf;i++) g_fix[i].muted = true; }
      else for (int i=0;i<nf;i++) if (uidcmp(g_fix[i].uid, dst)==0) {
        if (g_fuzzMute && chance(50)) break;          // fault injection: flaky mute (ignore it)
        g_fix[i].muted = true;
        static const uint8_t ctrlField[2] = {0, 0};   // mute-response control field
        sendRdmResponse((const uint8_t*)g_ctrlUid, &g_fix[i], f[15], RESP_ACK, CC_DISC_RESP, PID_DISC_MUTE, ctrlField, 2);
        break;
      }
    } else if (pid == PID_DISC_UN_MUTE) {
      const uint8_t* dst = &f[3];
      if (isBroadcast(dst)) {
        for (int i=0;i<nf;i++) g_fix[i].muted = false;
        // A broadcast un-mute begins a discovery sweep -> arm per-discovery tracking.
        g_discActive = true; g_discResp = 0; g_discReAsk = 0; g_discSeq++; g_havePrev = false;
      } else for (int i=0;i<nf;i++) if (uidcmp(g_fix[i].uid, dst)==0) { g_fix[i].muted = false; break; }
    }
  } else if (cc == CC_GET || cc == CC_SET) {
    const uint8_t* dst = &f[3];
    if (!isBroadcast(dst)) for (int i=0;i<nf;i++) if (uidcmp(g_fix[i].uid, dst)==0) { handleGetSet(f, cc, pid, &g_fix[i]); break; }
  }
  g_lastActivityMs = millis();
}


// Set up the RDM PIO on core 0 BEFORE WiFi, and claim our SMs, so the CYW43 radio (which
// grabs a free SM) can't take them. loop1() on core 1 only starts once g_pioReady is set.
static volatile bool g_pioReady = false;
static void setupPio() {
  pio_sm_claim(g_pio, RX_SM);
  pio_sm_claim(g_pio, TX_SM);
  uint rxOff = pio_add_program(g_pio, &dmxrdm_rx_program);
  g_rxOff = rxOff;
  pio_sm_config rc = dmxrdm_rx_program_get_default_config(rxOff);
  sm_config_set_in_pins(&rc, RS485_RX);
  sm_config_set_in_shift(&rc, true, true, 8);
  sm_config_set_fifo_join(&rc, PIO_FIFO_JOIN_RX);
  sm_config_set_clkdiv(&rc, (float)clock_get_hz(clk_sys) / (250000.0f * 8.0f));
  pio_gpio_init(g_pio, RS485_RX);
  pio_sm_set_consecutive_pindirs(g_pio, RX_SM, RS485_RX, 1, false);
  pio_sm_init(g_pio, RX_SM, rxOff, &rc);
  pio_sm_set_enabled(g_pio, RX_SM, true);

  uint txOff = pio_add_program(g_pio, &dmxrdm_tx_program);
  g_txOff = txOff;
  pio_sm_config tc = dmxrdm_tx_program_get_default_config(txOff);
  sm_config_set_out_pins(&tc, RS485_TX, 1);
  sm_config_set_sideset_pins(&tc, RS485_TX);
  sm_config_set_out_shift(&tc, true, false, 8);
  sm_config_set_clkdiv(&tc, (float)clock_get_hz(clk_sys) / (250000.0f * 8.0f));
  pio_gpio_init(g_pio, RS485_TX);
  pio_sm_set_consecutive_pindirs(g_pio, TX_SM, RS485_TX, 1, true);
  pio_sm_init(g_pio, TX_SM, txOff, &tc);
  pio_sm_set_enabled(g_pio, TX_SM, true);

  // DMX line analyzer on pio1: watch the same RX line (GP0), sample 8 data + stop bit, autopush 9.
  // Claimed here (before WiFi) so the CYW43 radio's pio_claim_free can't take it. Read-only: it never
  // sets pindirs to output, so it just listens alongside the RDM RX.
  pio_sm_claim(g_anPio, AN_SM);
  uint anOff = pio_add_program(g_anPio, &dmxa_rx_program);
  g_anOff = anOff;
  pio_sm_config ac = dmxa_rx_program_get_default_config(anOff);
  sm_config_set_in_pins(&ac, RS485_RX);
  sm_config_set_in_shift(&ac, true, true, 9);          // shift right, autopush, threshold 9 (8 data + stop)
  sm_config_set_fifo_join(&ac, PIO_FIFO_JOIN_RX);
  sm_config_set_clkdiv(&ac, (float)clock_get_hz(clk_sys) / (250000.0f * 8.0f));
  pio_gpio_init(g_anPio, RS485_RX);
  pio_sm_set_consecutive_pindirs(g_anPio, AN_SM, RS485_RX, 1, false);
  pio_sm_init(g_anPio, AN_SM, anOff, &ac);
  pio_sm_set_enabled(g_anPio, AN_SM, true);
  anDmaStart();          // stream analyzer slots into a RAM ring buffer so capture never stalls

  gtUartInit();          // ground-truth hardware-UART framing detector on GP5 (uart1)
  rcUartInit();          // reply-side capture: what the controller receives, on GP13 (uart0)
  g_pioReady = true;
}

// Core 1 waits for core 0 to finish PIO + WiFi bring-up, then just runs loop1().
void setup1() { while (!g_pioReady) delay(1); }

// Extract RDM request frames from the raw byte stream by SIGNATURE, so the continuous DMX
// flood (and break artefacts / TX float garbage) can't clog the assembler. A frame is only
// accepted on: start code 0xCC, sub-code 0x01, a sane message length, and a valid checksum.
void loop1() {
  if (!g_pioReady) return;
  static uint8_t frame[64]; static int fidx = 0;    // RDM requests are <= ~40 bytes
  while (!pio_sm_is_rx_fifo_empty(g_pio, RX_SM)) {
    const uint8_t b = pio_sm_get(g_pio, RX_SM) >> 24;
    g_rxBytes++;
    if (fidx == 0) {
      if (b == RDM_SC) frame[fidx++] = b;                          // only start on 0xCC
    } else if (fidx == 1) {
      if (b == RDM_SUB_SC) frame[fidx++] = b; else fidx = 0;       // require 0x01, else drop
    } else {
      frame[fidx++] = b;
      const int total = (int)frame[2] + 2;
      if (fidx == 3 && (total < 26 || total > (int)sizeof(frame))) { fidx = 0; }   // bad length
      else if (fidx >= 3 && fidx >= total) {
        uint16_t cs = 0; for (int i = 0; i < total - 2; i++) cs += frame[i];
        const uint16_t rxcs = ((uint16_t)frame[total-2] << 8) | frame[total-1];
        if (cs == rxcs) { g_frames++; handleRdm(frame, total); }   // valid checksum -> act
        else g_rxBadCsum++;                                         // 0xCC 0x01 but corrupt
        fidx = 0;
      }
    }
  }
  serviceAnalyzer();          // fold DMX slot framing / timing into the analyzer counters
  serviceGtUart();            // ground-truth: hardware-UART framing flags (authoritative)
  if (!g_rcDisable) serviceRcUart();   // reply-side capture (ISOLATION: disable to test analyzer starve)
  g_lastActivityMs = millis();
}

// ============================ CORE 0: LED + console =========================
static void printStatus() {
  Serial.printf("[cfg] fixtures=%d turnaround=%luus verbose=%d muted=%d\n",
    g_fixCount, (unsigned long)g_turnaround, g_verbose?1:0, mutedCount());
}
// Zero the analyzer + ground-truth counters and stamp the window start (like clearing a DMX tester).
static void anReset() {
  g_anFrames = g_anSlots = g_anFramingErr = g_anRxSlots = 0;
  g_anSlotCount = 0; g_anExpectFrame = 0;       // clear the frame-builder state so reset truly re-syncs
  g_anRefreshHz = 0; g_anBreakUs = 0; g_anStartCode = 0; g_anResetMs = millis();
  g_gtFrames = g_gtFramingErr = g_gtOverrun = g_gtBytes = 0; g_gtRefreshHz = 0; g_gtResetMs = millis();
  g_rcBytes = g_rcFramingErr = g_rcOverrun = g_rcReplies = g_rcBadReplies = g_rcMismatch = 0;
  g_rcLastLen = 0; g_rcResetMs = millis();
}
static void printGt() {
  const uint32_t el = millis() - g_gtResetMs; const float mins = el / 60000.0f;
  const float perMin = (mins > 0.001f) ? (g_gtFramingErr / mins) : 0.0f;
  Serial.printf("[ground-truth UART] frames=%lu framingErr=%lu (%.1f/min)  overrun=%lu  refresh=%.1fHz  bytes=%lu%s\n",
    (unsigned long)g_gtFrames, (unsigned long)g_gtFramingErr, (double)perMin, (unsigned long)g_gtOverrun,
    (double)g_gtRefreshHz, (unsigned long)g_gtBytes, g_gtOverrun ? "  [OVERRUN: fell behind, counts suspect]" : "");
}
static void printAnalyzer() {
  const uint32_t elapsed = millis() - g_anResetMs;
  const float mins = elapsed / 60000.0f;
  const float perMin = (mins > 0.001f) ? (g_anFramingErr / mins) : 0.0f;
  const bool sig = (millis() - g_lastActivityMs) < 1000 && g_anFrames > 0;
  Serial.printf("[analyzer] signal=%s startcode=0x%02X frames=%lu slots/frame=%lu refresh=%.1fHz break~%luus "
                "framingErr=%lu (%.1f/min, of %lu slots)\n",
    sig ? "OK" : "none", g_anStartCode, (unsigned long)g_anFrames, (unsigned long)g_anSlots,
    (double)g_anRefreshHz, (unsigned long)g_anBreakUs,
    (unsigned long)g_anFramingErr, (double)perMin, (unsigned long)g_anRxSlots);
}
static void printRc() {
  Serial.printf("[reply-capture] replies=%lu bad=%lu framingErr=%lu overrun=%lu mismatch(last)=%lu\n"
                "  sent: %s\n  recv: %s\n",
    (unsigned long)g_rcReplies, (unsigned long)g_rcBadReplies, (unsigned long)g_rcFramingErr,
    (unsigned long)g_rcOverrun, (unsigned long)g_rcMismatch,
    hexBuf(g_txReply, g_txReplyLen).c_str(), hexBuf(g_rcLast, g_rcLastLen).c_str());
}
static void handleCommand(char* line) {
  switch (line[0]) {
    case 'a': { if (line[1]=='r' || line[1]=='0') { anReset(); Serial.println("[analyzer] counters reset"); }
                printAnalyzer(); printGt(); printRc(); break; }
    case 'u': { if (line[1]=='r') { anReset(); Serial.println("[ground-truth] reset"); } printGt(); break; }
    case 't': { long v = atol(line+1); if (v>=100 && v<=3000) g_turnaround=v; printStatus(); break; }
    case 'f': { long v = atol(line+1); if (v>=1 && v<=MAXFIX) { genFixtures(v); } printStatus(); break; }
    case 'r': { for (int i=0;i<g_fixCount;i++) g_fix[i].muted=false; Serial.println("[cmd] un-muted all"); break; }
    case 'm': { const uint32_t fd = g_pio->fdebug; g_pio->fdebug = 0xFFFFFFFF;   // read+clear
                Serial.printf("[metrics] reAsk=%lu resp=%lu rdmReq=%lu badCsum=%lu rxStall=%d muted=%d fixtures=%d turnaround=%lu\n",
                  (unsigned long)g_ctrlReAsk, (unsigned long)g_respCount, (unsigned long)g_rdmSeen,
                  (unsigned long)g_rxBadCsum, (int)((fd >> RX_SM) & 1),
                  mutedCount(), g_fixCount, (unsigned long)g_turnaround); break; }
    case 'v': { g_verbose = !g_verbose; printStatus(); break; }
    case 'l': { g_listenOnly = !g_listenOnly; Serial.printf("[cmd] listenOnly=%d\n", g_listenOnly); break; }
    case 'd': { g_diagMode = !g_diagMode;
                Serial.printf("[diag] wiring-check LED %s: SOLID=clean, BLINK=noise (faster=worse). Idle the bus.\n",
                  g_diagMode?"ON":"OFF"); break; }
    case 'w': {   // on-demand WiFi scan + STA reconnect diagnostic
      WiFi.disconnect(); delay(200);
      int n = WiFi.scanNetworks();
      Serial.printf("[wifi] scan %d nets:\n", n);
      bool seen = false;
      for (int i = 0; i < n && i < 20; i++) {
        Serial.printf("  '%s' rssi=%d ch=%d enc=%d\n", WiFi.SSID(i), WiFi.RSSI(i), WiFi.channel(i), WiFi.encryptionType(i));
        if (String(WiFi.SSID(i)) == STA_SSID) seen = true;
      }
      Serial.printf("[wifi] '%s' visible=%d. connecting...\n", STA_SSID, seen);
      WiFi.begin(STA_SSID, STA_PASS);
      uint32_t t0 = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) { delay(500); Serial.printf("[wifi] status=%d\n", WiFi.status()); }
      if (WiFi.status() == WL_CONNECTED) Serial.printf("[wifi] CONNECTED  http://%s/\n", WiFi.localIP().toString().c_str());
      else Serial.println("[wifi] STA still failed");
      break;
    }
    case '?': default: printStatus(); break;
  }
}

// ============================ WEB SERVER (core 0) ===========================
static long jsonNum(const String& b, const char* key) {
  int k = b.indexOf(String("\"") + key + "\""); if (k < 0) return -1;
  k = b.indexOf(':', k); if (k < 0) return -1;
  return atol(b.c_str() + k + 1);
}
static void handleRoot()    { g_web.send(200, "text/html", INDEX_HTML); }
static void handleStatus() {
  char up[28]; uint32_t s = millis()/1000;
  snprintf(up, sizeof(up), "%lud %02lu:%02lu:%02lu", (unsigned long)(s/86400),
    (unsigned long)((s/3600)%24), (unsigned long)((s/60)%60), (unsigned long)(s%60));
  String j = "{";
  j += "\"fw\":\"sim-1.0\",\"up\":\"" + String(up) + "\",";
  const bool sta = (WiFi.status() == WL_CONNECTED);
  j += "\"heap\":" + String(rp2040.getFreeHeap()) + ",";
  j += "\"wifi\":\"" + String(sta ? STA_SSID : AP_SSID) + "\",";
  j += "\"ip\":\"" + (sta ? WiFi.localIP().toString() : WiFi.softAPIP().toString()) + "\",";
  j += "\"bus\":{\"state\":\"" + String(busActive()?"active":"idle") + "\"},";
  j += "\"fixtures\":" + String(g_fixCount) + ",\"discovered\":" + String(mutedCount()) + ",";
  j += "\"turnaround\":" + String((unsigned long)g_turnaround) + ",\"verbose\":" + String(g_verbose?"true":"false") + "}";
  g_web.send(200, "application/json", j);
}
static void handleMetrics() {
  const uint32_t fd = g_pio->fdebug;
  String j = "{";
  j += "\"rdmReq\":" + String((unsigned long)g_rdmSeen) + ",\"resp\":" + String((unsigned long)g_respCount) + ",";
  j += "\"get\":" + String((unsigned long)g_getCount) + ",\"set\":" + String((unsigned long)g_setCount) + ",";
  j += "\"nack\":" + String((unsigned long)g_nackCount) + ",\"reAsk\":" + String((unsigned long)g_ctrlReAsk) + ",";
  j += "\"badCsum\":" + String((unsigned long)g_rxBadCsum) + ",\"rxStall\":" + String((int)((fd>>RX_SM)&1)) + ",";
  j += "\"rxBytes\":" + String((unsigned long)g_rxBytes) + ",";
  j += "\"vdiff\":" + String(g_vdiff) + ",\"vpp\":" + String(g_vpp) + ",";
  // DMX line analyzer (issue #64): framing errors + frame timing, Swisson-style.
  const uint32_t anEl = millis() - g_anResetMs;
  const float anMin = anEl / 60000.0f;
  const float anRate = (anMin > 0.001f) ? (g_anFramingErr / anMin) : 0.0f;
  const bool anSig = (millis() - g_lastActivityMs) < 1000 && g_anFrames > 0;
  j += "\"anSignal\":" + String(anSig?"true":"false") + ",\"anFrames\":" + String((unsigned long)g_anFrames) + ",";
  j += "\"anSlots\":" + String((unsigned long)g_anSlots) + ",\"anStartCode\":" + String(g_anStartCode) + ",";
  j += "\"anRefresh\":" + String(g_anRefreshHz, 1) + ",\"anBreakUs\":" + String((unsigned long)g_anBreakUs) + ",";
  j += "\"anFramingErr\":" + String((unsigned long)g_anFramingErr) + ",\"anFramingPerMin\":" + String(anRate, 1) + ",";
  j += "\"anRxSlots\":" + String((unsigned long)g_anRxSlots) + ",\"anWindowMs\":" + String((unsigned long)anEl) + ",";
  // Ground-truth hardware-UART framing detector (authoritative)
  const uint32_t gtEl = millis() - g_gtResetMs; const float gtMin = gtEl / 60000.0f;
  const float gtRate = (gtMin > 0.001f) ? (g_gtFramingErr / gtMin) : 0.0f;
  j += "\"gtFrames\":" + String((unsigned long)g_gtFrames) + ",\"gtFramingErr\":" + String((unsigned long)g_gtFramingErr) + ",";
  j += "\"gtFramingPerMin\":" + String(gtRate, 1) + ",\"gtOverrun\":" + String((unsigned long)g_gtOverrun) + ",";
  j += "\"gtRefresh\":" + String(g_gtRefreshHz, 1) + ",\"gtBytes\":" + String((unsigned long)g_gtBytes) + ",";
  // Reply-side capture: what the controller received vs what we drove
  j += "\"rcBytes\":" + String((unsigned long)g_rcBytes) + ",\"rcFramingErr\":" + String((unsigned long)g_rcFramingErr) + ",";
  j += "\"rcOverrun\":" + String((unsigned long)g_rcOverrun) + ",\"rcReplies\":" + String((unsigned long)g_rcReplies) + ",";
  j += "\"rcBadReplies\":" + String((unsigned long)g_rcBadReplies) + ",\"rcMismatch\":" + String((unsigned long)g_rcMismatch) + ",";
  j += "\"rcCalls\":" + String((unsigned long)g_rcCalls) + ",\"rcWinLast\":" + String((long)g_rcWinLast) + ",";
  j += "\"txReplyHex\":\"" + hexBuf(g_txReply, g_txReplyLen) + "\",\"rcReplyHex\":\"" + hexBuf(g_rcLast, g_rcLastLen) + "\",";
  j += "\"discovered\":" + String(mutedCount()) + ",\"muted\":" + String(mutedCount()) + "}";
  g_web.send(200, "application/json", j);
}
static void handleFixtures() {
  String j = "["; const int n = g_fixCount;
  for (int i = 0; i < n && i < 120; i++) {
    if (i) j += ",";
    char uid[16]; snprintf(uid, sizeof(uid), "%02X%02X:%02X%02X%02X%02X",
      g_fix[i].uid[0],g_fix[i].uid[1],g_fix[i].uid[2],g_fix[i].uid[3],g_fix[i].uid[4],g_fix[i].uid[5]);
    j += "{\"idx\":" + String(i) + ",\"uid\":\"" + uid + "\",\"address\":" + String(g_fix[i].address);
    j += ",\"footprint\":" + String(g_fix[i].footprint) + ",\"persCur\":" + String(g_fix[i].persCur);
    j += ",\"persCount\":" + String(g_fix[i].persCount) + ",\"model\":\"" + g_fix[i].model + "\",\"muted\":";
    j += String(g_fix[i].muted?"true":"false") + ",\"identify\":" + String(g_fix[i].identify?"true":"false") + "}";
  }
  j += "]";
  g_web.send(200, "application/json", j);
}
static void handleConfig() {
  const String b = g_web.arg("plain");
  const long t = jsonNum(b, "turnaround"), f = jsonNum(b, "fixtures");
  if (t >= 100 && t <= 3000) g_turnaround = t;
  if (b.indexOf("\"verbose\":true") >= 0) g_verbose = true;
  else if (b.indexOf("\"verbose\":false") >= 0) g_verbose = false;
  if (f >= 1 && f <= MAXFIX) genFixtures(f);
  g_web.send(200, "application/json", "{\"ok\":true}");
}
static void handleUnmute()   { for (int i=0;i<g_fixCount;i++) g_fix[i].muted=false; g_web.send(200,"application/json","{\"ok\":true}"); }
static void handleAnReset()  { anReset(); g_web.send(200,"application/json","{\"ok\":true}"); }
// DIAG: toggle reply-capture / analog sampler at runtime to isolate what starves the analyzer.
//   /api/diag?rc=0|1&ml=0|1   (1 = DISABLE that subsystem). Returns current flag state.
static void handleDiag() {
  if (g_web.hasArg("rc")) g_rcDisable = g_web.arg("rc").toInt() != 0;
  if (g_web.hasArg("ml")) g_mlDisable = g_web.arg("ml").toInt() != 0;
  g_web.send(200,"application/json",
    String("{\"rcDisable\":") + (g_rcDisable?"true":"false") + ",\"mlDisable\":" + (g_mlDisable?"true":"false") + "}");
}
static void handleDiscover() { g_web.send(200,"application/json","{\"ok\":true,\"note\":\"the controller triggers its own discovery\"}"); }
static void handleLog() {
  String j = "["; const uint16_t head = g_evHead; int start = (int)head - 40; if (start < 0) start = 0;
  for (int i = start; i < (int)head; i++) {
    volatile Ev* e = &g_ev[i & 127]; if (i > start) j += ",";
    j += "{\"cls\":\"" + String(e->resp?"rep":"dub") + "\",\"txt\":\"depth " + String(e->depth) + (e->resp?" -> reply":" (silent)") + "\"}";
  }
  j += "]";
  g_web.send(200, "application/json", j);
}
static void handleFuzz() {
  const String b = g_web.arg("plain");
  const long drop = jsonNum(b, "drop");
  if (drop >= 0 && drop <= 100) g_fuzzDrop = (uint8_t)drop;
  g_fuzzLate    = b.indexOf("\"late\":true")    >= 0;
  g_fuzzBadCsum = b.indexOf("\"badcsum\":true") >= 0;
  g_fuzzMute    = b.indexOf("\"mute\":true")    >= 0;
  Serial.printf("[fuzz] drop=%u%% late=%d badcsum=%d mute=%d\n", g_fuzzDrop, g_fuzzLate, g_fuzzBadCsum, g_fuzzMute);
  g_web.send(200, "application/json", "{\"ok\":true}");
}
static void setupWeb() {
  g_web.on("/", handleRoot);
  g_web.on("/api/status", handleStatus);
  g_web.on("/api/metrics", handleMetrics);
  g_web.on("/api/fixtures", handleFixtures);
  g_web.on("/api/config", HTTP_POST, handleConfig);
  g_web.on("/api/unmute", HTTP_POST, handleUnmute);
  g_web.on("/api/discover", HTTP_POST, handleDiscover);
  g_web.on("/api/fuzz", HTTP_POST, handleFuzz);
  g_web.on("/api/analyzer/reset", HTTP_POST, handleAnReset);
  g_web.on("/api/diag", handleDiag);
  g_web.on("/api/log", handleLog);
  g_web.begin();
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(RS485_DE, OUTPUT);
  digitalWrite(RS485_DE, LOW);
  analogReadResolution(12);         // 0..4095 for the A/B analog bus probe
  genFixtures(g_fixCount);
  setupPio();                       // claim + start the RDM PIO BEFORE WiFi grabs a state machine
  WiFi.mode(WIFI_STA);
  WiFi.begin(STA_SSID, STA_PASS);       // AP fallback keeps the UI reachable; `w` cmd retries on demand.
  uint32_t t0 = millis(); bool retried = false;
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(200);
    if (!retried && millis() - t0 > 10000) { WiFi.disconnect(); delay(100); WiFi.begin(STA_SSID, STA_PASS); retried = true; }
  }
  String url; const char* net;
  if (WiFi.status() == WL_CONNECTED) { url = WiFi.localIP().toString(); net = "STA dropsnet"; }
  else { WiFi.softAP(AP_SSID, AP_PASS); url = WiFi.softAPIP().toString(); net = "AP LuxDMX-RDM-Sim"; }
  setupWeb();
  Serial.printf("[boot] RDM sim ready. %d fixtures, turnaround %luus. Web: http://%s/  (%s)\n",
    g_fixCount, (unsigned long)g_turnaround, url.c_str(), net);
}

void loop() {
  if (g_diagMode) serviceDiagLed(); else serviceLed();
  g_web.handleClient();

  // Keep the A-B analog reading fresh for the dashboard in every mode (it used to update only in
  // diag mode, so the "A-B line" tile sat at 0 the rest of the time).
  static uint32_t mlLast = 0;
  if (!g_mlDisable && millis() - mlLast >= 400) { mlLast = millis(); measureLines(); }

  // Wiring-check readout on serial too (numbers, for when you have the console open).
  if (g_diagMode) {
    static uint32_t dl = 0, db = 0;
    if (millis() - dl >= 500) { const uint32_t n = g_rxBytes - db; db = g_rxBytes; dl = millis();
      Serial.printf("[diag] noise=%lu bytes/500ms  A-B idle=%d mV  noise=%d mVpp  %s\n",
        (unsigned long)n, g_vdiff, g_vpp, (n <= 5) ? "CLEAN <<<" : "noisy"); }
  }

  // Per-discovery drop report: a sweep is done when the bus falls idle after a DISC_UN_MUTE.
  if (g_discActive && (millis() - g_lastRdmMs) > 600 && g_lastRdmMs != 0) {
    g_discActive = false;
    g_lastDiscMuted = mutedCount(); g_lastDiscExpected = g_fixCount;
    g_lastDiscResp = g_discResp; g_lastDiscReAsk = g_discReAsk;
    g_discDoneNew = true;
  }
  if (g_discDoneNew) {
    g_discDoneNew = false;
    const int miss = g_lastDiscExpected - g_lastDiscMuted;
    Serial.printf("[disc#%d] discovered %d/%d  (%s%d missed)  responses=%lu  S3-dropped-replies=%lu  turnaround=%luus\n",
      g_discSeq, g_lastDiscMuted, g_lastDiscExpected, miss?"** ":"", miss,
      (unsigned long)g_lastDiscResp, (unsigned long)g_lastDiscReAsk, (unsigned long)g_turnaround);
  }

  if (g_verbose) while (g_evTail != g_evHead) {
    volatile Ev* e = &g_ev[g_evTail&127];
    Serial.printf("[dub] d=%2d %s muted=%d lo=%02X%02X%02X%02X%02X%02X hi=%02X%02X%02X%02X%02X%02X\n",
      e->depth, e->resp?"REPLY ":"silent", e->muted,
      e->lo[0],e->lo[1],e->lo[2],e->lo[3],e->lo[4],e->lo[5],
      e->hi[0],e->hi[1],e->hi[2],e->hi[3],e->hi[4],e->hi[5]);
    g_evTail++;
  }

  // Console command input
  static char line[32]; static int li = 0;
  while (Serial.available()) {
    char c = Serial.read();
    if (c=='\n' || c=='\r') { if (li>0){ line[li]=0; handleCommand(line); li=0; } }
    else if (li < (int)sizeof(line)-1) line[li++]=c;
  }

  // Fast heartbeat while the bus is active: lets us see whether core-1's RX freezes
  // (rxBytes stops climbing) or stays alive during an early-terminating discovery.
  static uint32_t hb = 0;
  if (busActive() && millis() - hb >= 200) {
    hb = millis();
    Serial.printf("[hb] rxBytes=%lu rdmReq=%lu resp=%lu reAsk=%lu\n",
      (unsigned long)g_rxBytes, (unsigned long)g_rdmSeen, (unsigned long)g_respCount, (unsigned long)g_ctrlReAsk);
  }
  static uint32_t lp = 0;
  if (millis() - lp >= 3000) {
    lp = millis();
    Serial.printf("[stat] fixtures=%d frames=%lu rdmReq=%lu resp=%lu get=%lu set=%lu nack=%lu reAsk=%lu %s\n",
      g_fixCount, (unsigned long)g_frames, (unsigned long)g_rdmSeen, (unsigned long)g_respCount,
      (unsigned long)g_getCount, (unsigned long)g_setCount, (unsigned long)g_nackCount,
      (unsigned long)g_ctrlReAsk, busActive()?"active":"idle");
  }
}
