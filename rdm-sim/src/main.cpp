/*
  LumiGate RDM Fixture Simulator
  ------------------------------
  A throwaway "fixture from hell" for hardware-in-the-loop testing of the
  LumiGate RDM controller. Runs on a second ESP32-S3 + MAX485, sits on the same
  RS485 bus as a real LumiGate board, and pretends to be a DMX/RDM fixture.

  It does two jobs:

    1. CONTENT  - it's a correct, well-behaved RDM responder and DMX receiver.
       Standard RDM (DEVICE_INFO, DMX_START_ADDRESS get/set, IDENTIFY_DEVICE,
       DEVICE_LABEL, SOFTWARE_VERSION_LABEL, personalities) all work, and three
       DMX channels at the start address drive the onboard WS2812 RGB LED. So you
       can verify the controller reads the right data, sets the address, flashes
       identify, etc.

    2. TIMING   - it can deliberately mangle the timing of its RDM responses
       (break length, mark-after-break, bus turnaround delay, baud drift) so you
       can find out how robust the controller's *receive* path actually is across
       the kind of variation real fixtures show. The timing is driven entirely
       over DMX (see the control channels below) - no web UI, no network. The
       device is driven only by DMX and RDM, exactly like a real fixture.

  Personalities (selectable over RDM, like a real fixture):
    1 = "RGB + Timing Ctrl" (7 ch)   default
        +0 R   +1 G   +2 B      -> onboard RGB LED
        +3 break ctl             -> RDM response break length
        +4 mab ctl               -> RDM response mark-after-break
        +5 turnaround ctl        -> extra delay before the RDM response
        +6 baud ctl              -> RDM response baud drift
    2 = "RGB" (3 ch)
        +0 R   +1 G   +2 B      -> onboard RGB LED, always spec-correct timing

  Control-channel mapping (personality 1). Value 0 means "spec default" on every
  axis except turnaround (0 = none), so you can fuzz a single dimension at a time
  and leave the rest clean:
    break ctl  0 -> 176us (default)   1..255 -> 40us .. 1000us (40us = runt)
    mab ctl    0 -> 12us  (default)   1..255 -> 12us .. 500us
    turn ctl   0 -> no delay          1..255 -> ~12us .. 3000us extra
    baud ctl   0 -> 250000 (default)  1..255 -> ~245000 .. 255000 (centered at 128)

  A fresh sim (no control channels driven) is a perfectly nice fixture, so the
  content tests work out of the box and discovery succeeds. It only misbehaves
  when you tell it to over DMX.

  Wiring and the full test matrix live in ../README.md.
*/
#include <Arduino.h>
#include <esp_dmx.h>
#include <rdm/responder.h>
#include <Adafruit_NeoPixel.h>

// ---------------------------------------------------------------------------
// Pins - this is the SIMULATOR board, wired to its own MAX485. Tie the MAX485's
// DE and /RE together and drive them from SIM_EN_PIN (HIGH = transmit).
// ---------------------------------------------------------------------------
#ifndef SIM_TX_PIN
#define SIM_TX_PIN   17    // -> MAX485 DI
#endif
#ifndef SIM_RX_PIN
#define SIM_RX_PIN   18    // <- MAX485 RO
#endif
#ifndef SIM_EN_PIN
#define SIM_EN_PIN    8    // -> MAX485 DE + /RE (tied together)
#endif
#ifndef RGB_LED_PIN
#define RGB_LED_PIN  48    // ESP32-S3-DevKitC-1 onboard WS2812 (some boards: 38)
#endif

static const dmx_port_t DMX_PORT = 1;   // port 0 is the USB serial console

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
static Adafruit_NeoPixel led(1, RGB_LED_PIN, NEO_GRB + NEO_KHZ800);
static uint8_t  dmxBuf[DMX_PACKET_SIZE];

static volatile bool g_identify = false;   // set from the RDM identify callback
static uint8_t  g_r = 0, g_g = 0, g_b = 0; // last RGB from DMX

// Timing profile applied to the RDM responses. Defaults are spec-correct so a
// fresh device discovers fine; the DMX control channels override these.
static uint32_t g_breakUs = 176;
static uint32_t g_mabUs   = 12;
static uint32_t g_turnUs  = 0;
static uint32_t g_baud    = 250000;

static uint32_t g_rdmReqs = 0;             // RDM responses sent (cumulative)

// ---------------------------------------------------------------------------
// Control-channel -> timing maps (see header comment)
// ---------------------------------------------------------------------------
static uint32_t mapBreakUs(uint8_t v) {
    // Floor is 40us (below the 88us spec minimum) so runt breaks the controller
    // should reject are reachable; 0 = spec default.
    return v == 0 ? 176u : 40u + (uint32_t)(v - 1) * (1000u - 40u) / 254u;
}
static uint32_t mapMabUs(uint8_t v) {
    return v == 0 ? 12u : 12u + (uint32_t)(v - 1) * (500u - 12u) / 254u;
}
static uint32_t mapTurnUs(uint8_t v) {
    return (uint32_t)v * 3000u / 255u;     // 0 .. ~3000us
}
static uint32_t mapBaud(uint8_t v) {
    if (v == 0) return 250000u;
    long off = ((long)v - 128) * 5000 / 127;
    return (uint32_t)(250000 + off);       // ~245000 .. 255000
}

// ---------------------------------------------------------------------------
// RDM identify callback - flips a flag the LED renderer watches.
// ---------------------------------------------------------------------------
static void onIdentify(dmx_port_t port, rdm_header_t *request, rdm_header_t *response,
                       void *context) {
    if (request->cc == RDM_CC_SET_COMMAND) {
        bool identify = false;
        rdm_get_identify_device(port, &identify);
        g_identify = identify;
        Serial.printf("[sim] identify -> %s\n", identify ? "ON" : "off");
    }
}

// ---------------------------------------------------------------------------
// Drive the onboard LED. Throttled and change-gated because WS2812 show()
// briefly disables interrupts, and we don't want that jittering our own DMX
// receive timing any more than necessary.
// ---------------------------------------------------------------------------
static void renderLed() {
    static uint32_t lastShow = 0;
    static uint8_t  prevR = 1, prevG = 1, prevB = 1;   // force first show
    uint32_t now = millis();
    if (now - lastShow < 33) return;                   // ~30 Hz cap

    uint8_t r, g, b;
    if (g_identify) {
        bool on = (now / 250) % 2;                      // 2 Hz white blink
        r = g = b = on ? 255 : 0;
    } else {
        r = g_r; g = g_g; b = g_b;
    }
    if (r == prevR && g == prevG && b == prevB) return; // nothing changed
    prevR = r; prevG = g; prevB = b;
    lastShow = now;
    led.setPixelColor(0, led.Color(r, g, b));
    led.show();
}

// ---------------------------------------------------------------------------
// A DMX (non-RDM) frame arrived. Update the LED colour and, in personality 1,
// latch the timing profile from the control channels.
// ---------------------------------------------------------------------------
static void ingestDmx(size_t n) {
    uint16_t addr = dmx_get_start_address(DMX_PORT);     // 1..512
    if (addr == 0 || addr == DMX_START_ADDRESS_NONE) return;

    // RGB (slot index == channel number; slot 0 is the start code)
    if (addr + 2 < n) {
        g_r = dmxBuf[addr];
        g_g = dmxBuf[addr + 1];
        g_b = dmxBuf[addr + 2];
    }

    // Timing control channels exist only in personality 1 (footprint 7)
    if (dmx_get_current_personality(DMX_PORT) == 1 && addr + 6 < n) {
        g_breakUs = mapBreakUs(dmxBuf[addr + 3]);
        g_mabUs   = mapMabUs(dmxBuf[addr + 4]);
        g_turnUs  = mapTurnUs(dmxBuf[addr + 5]);
        g_baud    = mapBaud(dmxBuf[addr + 6]);
    }
}

// ---------------------------------------------------------------------------
// Send the RDM response with the currently-selected (possibly mangled) timing.
// break/mab affect only the transmitted frame, so they're safe to leave set.
// baud affects RX too, so we change it only for the response and restore it
// before the next receive.
// ---------------------------------------------------------------------------
static void respondRdm() {
    dmx_set_break_len(DMX_PORT, g_breakUs);
    dmx_set_mab_len(DMX_PORT, g_mabUs);

    bool baudChanged = (g_baud != 250000);
    if (baudChanged) dmx_set_baud_rate(DMX_PORT, g_baud);

    if (g_turnUs) delayMicroseconds(g_turnUs);   // widen the bus turnaround
    rdm_send_response(DMX_PORT);

    if (baudChanged) {
        dmx_wait_sent(DMX_PORT, DMX_TIMEOUT_TICK);
        dmx_set_baud_rate(DMX_PORT, 250000);     // back to spec so we can receive
    }
    g_rdmReqs++;
}

// ---------------------------------------------------------------------------
// One status line per second, so the host harness (or a human on the serial
// monitor) can see what the sim is doing without a UI.
// ---------------------------------------------------------------------------
static void logStatus() {
    static uint32_t last = 0;
    uint32_t now = millis();
    if (now - last < 1000) return;
    last = now;
    Serial.printf("[sim] addr=%u pers=%u rgb=(%u,%u,%u) ident=%d rdmReqs=%lu "
                  "timing break=%luus mab=%luus turn=%luus baud=%lu\n",
                  dmx_get_start_address(DMX_PORT), dmx_get_current_personality(DMX_PORT),
                  g_r, g_g, g_b, g_identify ? 1 : 0, (unsigned long)g_rdmReqs,
                  (unsigned long)g_breakUs, (unsigned long)g_mabUs,
                  (unsigned long)g_turnUs, (unsigned long)g_baud);
}

void setup() {
    Serial.begin(115200);
    delay(200);
    Serial.println("\n[sim] LumiGate RDM fixture simulator");

    led.begin();
    led.setBrightness(64);
    led.setPixelColor(0, led.Color(0, 0, 0));
    led.show();

    dmx_config_t config = DMX_CONFIG_DEFAULT;
    config.model_id              = 0x4C31;          // 'L1' - identifies this sim
    config.product_category      = 0x0700;          // RDM product category: Test
    config.software_version_id   = 0x00010000;      // 1.0.0
    config.software_version_label = "rdm-sim 1.0";

    dmx_personality_t personalities[] = {
        {7, "RGB + Timing Ctrl"},
        {3, "RGB"},
    };
    dmx_driver_install(DMX_PORT, &config, personalities, 2);
    dmx_set_pin(DMX_PORT, SIM_TX_PIN, SIM_RX_PIN, SIM_EN_PIN);

    rdm_register_identify_device(DMX_PORT, onIdentify, NULL);
    rdm_register_device_label(DMX_PORT, "LumiGate RDM Sim", NULL, NULL);

    dmx_set_break_len(DMX_PORT, g_breakUs);
    dmx_set_mab_len(DMX_PORT, g_mabUs);

    Serial.printf("[sim] ready: port=%d tx=%d rx=%d en=%d led=%d\n",
                  DMX_PORT, SIM_TX_PIN, SIM_RX_PIN, SIM_EN_PIN, RGB_LED_PIN);
}

void loop() {
    dmx_packet_t pkt;
    if (dmx_receive(DMX_PORT, &pkt, DMX_TIMEOUT_TICK)) {
        if (pkt.err == DMX_OK) {
            if (pkt.is_rdm) {
                respondRdm();
            } else if (pkt.sc == 0) {                // standard DMX dimmer data
                size_t n = dmx_read(DMX_PORT, dmxBuf, pkt.size);
                ingestDmx(n);
            }
        }
    }
    renderLed();
    logStatus();
}
