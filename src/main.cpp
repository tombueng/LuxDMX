/*
 * LuxDMX — Art-Net / sACN → DMX Gateway
 * ESP32 / ESP32-S3 / WT32-ETH01 + Waveshare RS485 (C)
 *
 * Default pins: DMX TX=17, RX=16 (compile-time: DEF_DMX_TX_PIN/DEF_DMX_RX_PIN; runtime: web /config)
 * WT32-ETH01:   DMX TX=4, RX=5  (GPIO16 used by LAN8720 power)
 */

#include <Arduino.h>
#include <soc/soc.h>
#include <soc/rtc_cntl_reg.h>
#include <Adafruit_NeoPixel.h>
#include <Wire.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_SH110X.h>
#include <Adafruit_SSD1351.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_wifi.h>   // for esp_wifi_get/set_config (BSSID lock clearing)
// Schema-driven config engine (src/config/). config_schema.h defines the Config +
// DmxOutput structs + MAX_OUTPUTS (moved here out of main.cpp); config_core.h is
// the transport-agnostic load/save/setValue/toJson engine the handlers drive. The
// per-board default VALUES live in templates/*.ini (embedded via extra_scripts.py),
// not in -D macros. The structural enums (MERGE_*, NET_*, WIRED_FB_*, RMII_*) stay
// defined below in main.cpp; config_enums.h mirrors them for the engine TU.
#include <config_core.h>     // EmbeddedConfig library (lib/EmbeddedConfig)
#include <config_serial.h>   // serial configuration console (Phase 2/3)
// Wired-Ethernet capability (compile-time). WiFi is ALWAYS compiled in too; the
// active interface — and, on the classic ESP32, which wired PHY — is chosen at
// runtime (issue #14).
//   HAS_ETH_SPI  : W5500 over SPI. Works on any ESP32 variant; on when USE_ETH_SPI.
//   HAS_ETH_RMII : LAN8720 over RMII. Uses the ESP32's INTERNAL EMAC, which only the
//                  original ESP32 has — so it is available on the classic ESP32
//                  regardless of board (the S3 never gets it). cfg.wiredPhy picks it.
//   USE_ETH_RMII : the WT32-ETH01 build marker only — drives OTA_BIN + its RMII /
//                  useEthernet=true defaults. RMII compilation is the chip macro now.
#if defined(USE_ETH_SPI)
#define HAS_ETH_SPI 1
#endif
#if defined(CONFIG_IDF_TARGET_ESP32)   // original ESP32 → has the internal EMAC for RMII
#define HAS_ETH_RMII 1
#endif
#if defined(HAS_ETH_SPI) || defined(HAS_ETH_RMII)
#include <ETH.h>
#define HAS_WIRED_ETH 1
#endif

// Wired PHY runtime selection (cfg.wiredPhy). DEF_WIRED_PHY is the per-OTA-artifact
// default and MUST reproduce what the device used before, so an OTA to a both-PHY
// build never changes behavior: the WT32 artifact (USE_ETH_RMII) defaults to RMII,
// every other build defaults to W5500 — exactly the old compile-time split.
#define WIRED_PHY_SPI  0   // W5500 over SPI (external module)
#define WIRED_PHY_RMII 1   // LAN8720 over RMII (ESP32 internal EMAC)
#ifndef DEF_WIRED_PHY
#if defined(USE_ETH_RMII)
#define DEF_WIRED_PHY WIRED_PHY_RMII
#else
#define DEF_WIRED_PHY WIRED_PHY_SPI
#endif
#endif

// RMII PHY family + wiring (cfg.rmii*, used when wiredPhy = RMII). These indices are
// stable in NVS and mapped to the arduino-esp32 ETH enums in startEthRmii(). The
// defaults reproduce the LAN8720 / WT32-ETH01 wiring, so an existing RMII device is
// unchanged across an OTA. The RMII DATA lines are fixed by the EMAC and not settable;
// only the PHY type, address, MDC/MDIO/power pins and REF_CLK mode are configurable.
#define RMII_PHY_LAN8720 0
#define RMII_PHY_IP101   1
#define RMII_PHY_RTL8201 2
#define RMII_PHY_DP83848 3
#define RMII_PHY_KSZ8081 4
#define RMII_PHY_JL1101  5
#define RMII_PHY_COUNT   6
#define RMII_CLK_GPIO0_IN   0   // external 50MHz clock fed in on GPIO0 (WT32-ETH01)
#define RMII_CLK_GPIO0_OUT  1
#define RMII_CLK_GPIO16_OUT 2
#define RMII_CLK_GPIO17_OUT 3
#ifndef DEF_RMII_PHY
#define DEF_RMII_PHY  RMII_PHY_LAN8720
#endif
#ifndef DEF_RMII_ADDR
#define DEF_RMII_ADDR 1
#endif
#ifndef DEF_RMII_MDC
#define DEF_RMII_MDC  23
#endif
#ifndef DEF_RMII_MDIO
#define DEF_RMII_MDIO 18
#endif
#ifndef DEF_RMII_PWR
#define DEF_RMII_PWR  16
#endif
#ifndef DEF_RMII_CLK
#define DEF_RMII_CLK  RMII_CLK_GPIO0_IN
#endif
#include <WiFiManager.h>  // WiFi (STA config portal) is always available
#include <ESPAsyncWebServer.h>
#include <ESPmDNS.h>
#include <ArduinoOTA.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <Update.h>
#include <ArtnetWifi.h>
#include <esp_dmx.h>
#include <rdm/controller.h>             // RDM controller: discovery + GET/SET
#include <rdm/controller/include/utils.h>  // rdm_send_request() for sensor PIDs
#include <rdm/include/uid.h>            // rdm_uid_is_eq() and friends

// Auto-generated asset headers (produced by extra_scripts.py before each build)
#include "generated/version.h"
#include "generated/index_html.h"
#include "generated/config_html.h"
#include "generated/config_saved_html.h"
#include "generated/reset_html.h"
#include "generated/reset_done_html.h"
#include "generated/ota_progress_html.h"
#include "generated/ota_done_html.h"
#include "generated/logo_png.h"
#include "generated/favicon_png.h"
#include "generated/bootstrap_min_css.h"

// ---------------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------------
#ifndef DEF_DMX_TX_PIN
#define DEF_DMX_TX_PIN 17
#endif
#ifndef DEF_DMX_RX_PIN
#define DEF_DMX_RX_PIN 16
#endif
#ifndef DEF_DMX_RTS_PIN
#define DEF_DMX_RTS_PIN -1
#endif
#ifndef DEF_DMX_PORT
#define DEF_DMX_PORT 1
#endif

// Second DMX universe (output #2). Defaults to -1 / disabled on boards with a
// single transceiver; a board that wires a 2nd isolated driver sets real pins via
// build_flags (e.g. the LuxDMX board: TX=16 RX=21 DE/nRE=47) so its 2nd XLR
// comes up ready out of the box.
#ifndef DEF_DMX2_TX_PIN
#define DEF_DMX2_TX_PIN -1
#endif
#ifndef DEF_DMX2_RX_PIN
#define DEF_DMX2_RX_PIN -1
#endif
#ifndef DEF_DMX2_RTS_PIN
#define DEF_DMX2_RTS_PIN -1
#endif
// Output #2 ships enabled only when the board actually wired it a TX pin.
#ifndef DEF_DMX2_ENABLED
#define DEF_DMX2_ENABLED (DEF_DMX2_TX_PIN >= 0)
#endif

// ---------------------------------------------------------------------------
// DMX outputs — up to MAX_OUTPUTS independent universes, each driven by its own
// hardware UART + RS485 transceiver. Hardware ceiling is 2: the ESP32 / ESP32-S3
// expose 3 UARTs and UART0 is the serial console, leaving UART1 + UART2.
// MAX_OUTPUTS + struct DmxOutput now live in config/config_schema.h (included above).
// ---------------------------------------------------------------------------

// GPIO0 = the BOOT button (config-portal / factory-reset trigger). Named
// CFG_BOOT_PIN because arduino-esp32 v3 now defines its own global BOOT_PIN.
static constexpr int CFG_BOOT_PIN = 0;
static constexpr uint32_t   HOLD_MS     = 3000;

#ifndef DEF_LED_PIN
#define DEF_LED_PIN  2
#endif
#ifndef DEF_LED_TYPE
#define DEF_LED_TYPE 1   // 0=off, 1=plain GPIO, 2=WS2812, 3=5-LED discrete panel
#endif

// 5-LED discrete status panel (ledType 3) — the LuxDMX v4 board. Five LEDs on
// their own GPIOs, active-high (GPIO → R → LED anode, cathode → GND). -1 = absent.
#ifndef DEF_LED_R
#define DEF_LED_R -1   // red    — fault / no network
#endif
#ifndef DEF_LED_G
#define DEF_LED_G -1   // green  — network up
#endif
#ifndef DEF_LED_Y
#define DEF_LED_Y -1   // yellow — DMX activity
#endif
#ifndef DEF_LED_B
#define DEF_LED_B -1   // blue   — connecting / source conflict
#endif
#ifndef DEF_LED_W
#define DEF_LED_W -1   // white  — identify / boot
#endif

// W5500 SPI-Ethernet pin DEFAULTS — defined unconditionally so the W5500 pins are
// runtime config (cfg.eth*) on ANY board: a DIY user can wire a W5500 module to a
// plain ESP32 / ESP32-S3 and enable it in /config, not just boards that bake the
// pins in at build time. Defaults are the classic-ESP32 VSPI pins (the most common
// W5500 wiring); luxdmx_v4 overrides them via build_flags. A build without
// USE_ETH_SPI never calls ETH.begin() with these, so they cost nothing there.
#ifndef ETH_W5500_SCK
#define ETH_W5500_SCK 18
#endif
#ifndef ETH_W5500_MOSI
#define ETH_W5500_MOSI 23
#endif
#ifndef ETH_W5500_MISO
#define ETH_W5500_MISO 19
#endif
#ifndef ETH_W5500_CS
#define ETH_W5500_CS 5
#endif
#ifndef ETH_W5500_IRQ
#define ETH_W5500_IRQ 4
#endif
#ifndef ETH_W5500_RST
#define ETH_W5500_RST 25
#endif
#ifndef ETH_W5500_SPI_FREQ_MHZ
#define ETH_W5500_SPI_FREQ_MHZ 20   // W5500 SPI clock; lower (e.g. 1) to debug long/loose wiring
#endif
#ifdef USE_ETH_SPI
#ifndef ETH_W5500_SPI_HOST
#define ETH_W5500_SPI_HOST SPI3_HOST
#endif
#ifndef ETH_W5500_ADDR
#define ETH_W5500_ADDR 1
#endif
#endif  // USE_ETH_SPI

// Optional I2C status display (off by default; enable + pin it from /config)
#ifndef DEF_DISP_TYPE
#define DEF_DISP_TYPE 0  // 0=off, 1=SSD1306 128x64, 2=SSD1306 128x32, 3=SH1106 128x64
#endif
#ifndef DEF_DISP_SDA
#define DEF_DISP_SDA 21
#endif
#ifndef DEF_DISP_SCL
#define DEF_DISP_SCL 22
#endif
#ifndef DEF_DISP_ROT
#define DEF_DISP_ROT 0   // 0=normal, 1=flipped 180 deg
#endif

// Colour SPI panel pins (dispType 4). -1 = unset; a board with a display header
// pins them via build_flags so the panel only needs dispType set in /config.
#ifndef DEF_DISP_CS
#define DEF_DISP_CS -1
#endif
#ifndef DEF_DISP_DC
#define DEF_DISP_DC -1
#endif
#ifndef DEF_DISP_RST
#define DEF_DISP_RST -1
#endif
#ifndef DEF_DISP_SCK
#define DEF_DISP_SCK -1
#endif
#ifndef DEF_DISP_MOSI
#define DEF_DISP_MOSI -1
#endif

// ---------------------------------------------------------------------------
// NVS namespace + AP SSID. The per-field default VALUES (hostname/otapw/protocol/
// universe/pins/...) moved into templates/*.ini and the config engine; they are
// no longer #defined here.
// ---------------------------------------------------------------------------
static const char* PREF_NS = "dmxgw";
static const char* AP_SSID = "DMX-Gateway";   // SSID of the transient setup/config portal

// WiFi interface mode (cfg.wifiMode)
static constexpr int NET_WIFI_STA = 0;        // station / client (join an existing router)
static constexpr int NET_WIFI_AP  = 1;        // standalone access point (no router needed)

// Link-loss policy (cfg.linkLossMode): what to do when wired Ethernet is selected but
// the link is down. RETRY is the show-safe default (no AP ever); the AP modes never open
// an UNSECURED AP. A password is required (see startWiFiAP), so a show device cannot
// spontaneously broadcast an open hotspot.
#define WIRED_FB_RETRY  0   // keep retrying the wired link; recover when the cable is back
#define WIRED_FB_AP     1   // standalone WPA2 AP (needs an AP password, else stays on retry)
#define WIRED_FB_REBOOT 2   // reboot and re-attempt the wired link
// NB: there is deliberately no automatic "WiFi setup portal" fallback. An auto-portal
// would let anyone who can drop the link force the device onto their own WiFi (very bad
// on a show). The setup portal stays BOOT-button-only (initial setup = physical access).
#define WIRED_GRACE_MS  12000   // ride out brief link blips before acting on a runtime drop

// ---------------------------------------------------------------------------
// Sender tracking
// ---------------------------------------------------------------------------
static constexpr int MAX_SENDERS = 8;

// Source-merge engine (issue #10) -------------------------------------------
// Per-output merge mode (DmxOutput.mergeMode) for two+ sources on one universe.
static constexpr int MERGE_OFF = 0;   // most recent source wins (legacy behaviour)
static constexpr int MERGE_HTP = 1;   // highest takes precedence (per-channel max)
static constexpr int MERGE_LTP = 2;   // latest source wins (whole-frame arbitration)
// A source that goes silent for this long stops contributing to the merge.
static constexpr uint32_t SOURCE_TIMEOUT_MS = 2500;
// Art-Net has no per-packet priority; sACN's default is 100 (E1.31). Sources at
// the highest active priority win; equal priority falls back to the merge mode.
static constexpr uint8_t  DEFAULT_PRIORITY  = 100;

// Per-output signal-loss policy (DmxOutput.lossMode): what an output does once
// every source on its universe has been silent past SOURCE_TIMEOUT_MS. DMX512 is
// a continuously-refreshed stream, so HOLD and ZERO keep transmitting at the
// normal rate; only STOP actually idles the line.
static constexpr int LOSS_HOLD = 0;   // keep refreshing the last frame (failsafe, default)
static constexpr int LOSS_ZERO = 1;   // blackout: drive all channels to 0, keep transmitting
static constexpr int LOSS_STOP = 2;   // stop transmitting, so fixtures run their own DMX-loss failsafe

// Source state codes: WS frame byte 13 + LED/display. Keep in sync with the
// matching values documented in src/pages/index.html.
static constexpr uint8_t SRC_NORMAL   = 0;
static constexpr uint8_t SRC_CONFLICT = 1;
static constexpr uint8_t SRC_MERGING  = 2;

struct Sender {
    uint32_t ip;        // 0 = empty slot
    uint8_t  proto;     // 0=ArtNet, 1=sACN
    uint32_t lastMs;
    uint32_t winMs;     // fps window start
    uint16_t winCnt;
    float    fps;
    int16_t  universe;  // Art-Net universe this source feeds (0-32767; -1 = unknown)
    uint16_t dataLen;   // channels this source actually sends (<=512)
    uint8_t  priority;  // E1.31 priority (sACN per-packet, Art-Net = DEFAULT_PRIORITY)
    uint8_t  data[512]; // last frame from this source, for the merge engine
};
static Sender senders[MAX_SENDERS] = {};

// ---------------------------------------------------------------------------
// Change log
// ---------------------------------------------------------------------------
static constexpr int LOG_SIZE = 50;
static constexpr int LOG_TOP  = 6;   // top changed channels stored per entry

struct LogEntry {
    uint32_t ms;
    uint32_t ip;
    uint8_t  proto;
    uint8_t  uni;     // Art-Net universe this frame targeted
    uint8_t  topN;    // valid entries in top[]
    uint16_t total;   // total channels changed
    struct { uint16_t ch; uint8_t val; } top[LOG_TOP];
};
static LogEntry dmxLog[LOG_SIZE] = {};
static uint8_t  logHead  = 0;
static uint8_t  logCount = 0;
static uint32_t lastLogMs = 0;

// ---------------------------------------------------------------------------
// Network abstraction (issue #14 — runtime-selectable interface)
// ---------------------------------------------------------------------------
// Two runtime flags decide which interface the net accessors report on:
//   g_useEth  — wired Ethernet active (RMII or W5500). Only ever true on a board
//               that compiled in <ETH.h> (HAS_WIRED_ETH); set in setup() from
//               cfg.useEthernet before any net call.
//   g_apMode  — WiFi running as a standalone access point (cfg.wifiMode == AP, or
//               the automatic fallback when wired Ethernet has no link).
// With both false the device is a WiFi station (the classic client mode).
static bool g_useEth = false;
static bool g_apMode = false;
static bool g_apWiredFallback = false;   // in the AP only because the wired link dropped (return to Eth when it's back)

static bool netConnected() {
#if defined(HAS_WIRED_ETH)
    if (g_useEth) return ETH.linkUp() && ETH.localIP() != IPAddress(0,0,0,0);
#endif
    if (g_apMode) return WiFi.softAPIP() != IPAddress(0,0,0,0);   // AP is up once it has its IP
    return WiFi.status() == WL_CONNECTED;
}
static IPAddress netLocalIP() {
#if defined(HAS_WIRED_ETH)
    if (g_useEth) return ETH.localIP();
#endif
    if (g_apMode) return WiFi.softAPIP();
    return WiFi.localIP();
}
static String netSSID() {
#if defined(HAS_WIRED_ETH)
    if (g_useEth) return String("Ethernet");
#endif
    if (g_apMode) return WiFi.softAPSSID();
    return WiFi.SSID();
}
static int netRSSI() {
#if defined(HAS_WIRED_ETH)
    if (g_useEth) return 0;
#endif
    if (g_apMode) return 0;   // RSSI is meaningless for an AP
    return (int)WiFi.RSSI();
}

// Parse a dotted-quad into IPAddress; returns false (and 0.0.0.0) if invalid/empty
static bool parseIp(const String& s, IPAddress& out) {
    if (s.length() == 0) { out = IPAddress(0,0,0,0); return false; }
    return out.fromString(s);
}

// ---------------------------------------------------------------------------
// Global objects
// ---------------------------------------------------------------------------
Preferences       prefs;
AsyncWebServer    http(80);
AsyncWebSocket    ws("/ws");
ArtnetWifi        artnet;
static WiFiUDP   sacnUdp[MAX_OUTPUTS];   // one multicast socket per output universe
static Adafruit_NeoPixel neoPixel(1, 0, NEO_GRB + NEO_KHZ800);

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------
static uint8_t  dmxBuf[MAX_OUTPUTS][DMX_PACKET_SIZE] = {{0}};
static bool     outReady[MAX_OUTPUTS] = {false};   // per-output DMX driver installed
static int      monitorOut   = 0;                  // output shown/controlled by the web UI
static int      rdmOut       = -1;                 // output RDM runs on, -1 = none
static uint32_t lastFrameMs  = 0;
static uint32_t frameCount   = 0;
static float    fps          = 0.0f;
// Per-output frame rate (one universe each). The aggregate `fps` above stays the
// sum of all inputs for the WS/web UI; these drive the per-universe display.
static uint32_t outFrameCount[MAX_OUTPUTS]  = {0};
static uint32_t outLastFrameMs[MAX_OUTPUTS] = {0};
static uint32_t outLastDmxMs[MAX_OUTPUTS]   = {0};
static float    outFps[MAX_OUTPUTS]         = {0.0f};
// True while no live source feeds this output's universe. Drives the per-output
// signal-loss policy (LOSS_*). Starts true: a freshly booted node has no source
// yet, so a STOP-configured output stays dark until one appears.
static bool     outSrcLost[MAX_OUTPUTS]     = {true, true};
static float    jitterMs     = 0.0f;
static uint32_t prevFrameMs  = 0;
static uint32_t startMs      = 0;
static bool     dmxReady     = false;
static bool     manualMode   = false;
static uint32_t lastWsPush   = 0;
static uint32_t lastDmxMs    = 0;
static bool     pendingGithubOta = false;
static String   otaTarget       = "latest";   // release tag to install
static String   latestVersion   = "";
// Live OTA progress, polled by the update page via /ota/status. Written from the
// httpUpdate callbacks (loop task), read from the web handler (AsyncTCP task);
// plain aligned bytes so the cross-task read is atomic.
static volatile uint8_t otaProgPhase = 0;     // 0 idle, 1 downloading+writing, 2 finalizing, 3 error
static volatile uint8_t otaProgPct   = 0;     // 0..100 over the streamed image
static bool     updateAvailable = false;

// Identify: temporarily force one channel to full on the wire to locate a fixture
static constexpr uint32_t IDENTIFY_MS = 1500;
static uint16_t identifyCh      = 0;       // 1-512, 0 = inactive
static uint32_t identifyUntil   = 0;
static uint32_t pendingRebootAt = 0;       // 0 = none; loop() reboots when due
static bool     pendingWifiReset = false;  // clear WiFi creds before reboot

// WS binary frame: fps(2) rssi(2) heap(4) uptime(4) senders(1) srcStatus(1)
// (srcStatus: 0=normal 1=conflict 2=merging)
// jitter(2) dmx(512) + per-output fps(2 x MAX_OUTPUTS) = 528 + 2*MAX_OUTPUTS
static constexpr int WS_FRAME_LEN = 528 + 2 * MAX_OUTPUTS;
static uint8_t wsBuf[WS_FRAME_LEN];

// sACN receive buffer
static uint8_t sacnBuf[638];

// struct Config + DmxOutput are defined in config/config_schema.h (the schema's
// single source of truth, included near the top). This is the one live instance
// the engine + every handler operate on.
Config cfg;

// Channel labels — stored verbatim as a JSON blob. The browser owns the
// structure (now per output: {"0":{"1":"Front L"},"1":{...}}); the device just
// persists what it receives. Sized for labels across all outputs.
static constexpr size_t LABELS_MAX = 6000;
static String g_labels = "{}";

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------
// Per-output NVS keys are "o<i>_<field>" (e.g. "o0_tx", "o1_uni").
static String okey(int i, const char* field) {
    return String('o') + i + '_' + field;
}

// An output with no TX GPIO can't drive a line and crashes esp_dmx on init
// (tx=-1 is "no change", so the UART is left half-configured). Force any such
// "enabled but pin-less" output off so it can never brick the device.
static void sanitizeOutputs() {
    for (int i = 0; i < MAX_OUTPUTS; i++)
        if (cfg.outputs[i].enabled && cfg.outputs[i].txPin < 0)
            cfg.outputs[i].enabled = false;
}

// Config load/save are now driven by the schema engine (src/config/). The engine
// resolves neutral -> active board template -> saved NVS (same PREF_NS = "dmxgw"
// + the output-0 legacy-key fallback, so OTA never loses a device's config), and
// writes every schema field on save. The channel-label blob ("labels") lives
// outside the schema, so it's read/written here around the engine call.
static void loadConfig() {
    cfgcore::load();
    prefs.begin(PREF_NS, true);
    if (prefs.isKey("labels")) g_labels = prefs.getString("labels", "{}");   // isKey: avoid the NOT_FOUND log on a fresh device
    prefs.end();
    sanitizeOutputs();
}

static void saveConfig() {
    cfgcore::save();
}

// ---------------------------------------------------------------------------
// LED helpers
// ---------------------------------------------------------------------------
static constexpr uint32_t NEO_OFF    = 0x000000;
static constexpr uint32_t NEO_GREEN  = 0x002200;
static constexpr uint32_t NEO_AMBER  = 0x221000;
static constexpr uint32_t NEO_RED    = 0x220000;
static constexpr uint32_t NEO_BLUE   = 0x000022;   // connecting to WiFi
static constexpr uint32_t NEO_PURPLE = 0x180018;   // AP / config portal active
static constexpr uint32_t NEO_WHITE  = 0x0a0a0a;   // booting

// --- 5-LED discrete status panel (ledType 3) -------------------------------
// Drive the five GPIO LEDs (active-high). One cached write so both the boot-time
// setLedColor() path and the runtime ledTask() path share state and never clock
// a pin redundantly.
static void setLeds5(bool r, bool g, bool y, bool b, bool w) {
    static uint8_t last = 0xFF;
    uint8_t state = (r?1:0) | (g?2:0) | (y?4:0) | (b?8:0) | (w?16:0);
    if (state == last) return;
    last = state;
    if (cfg.ledR >= 0) digitalWrite(cfg.ledR, r ? HIGH : LOW);
    if (cfg.ledG >= 0) digitalWrite(cfg.ledG, g ? HIGH : LOW);
    if (cfg.ledY >= 0) digitalWrite(cfg.ledY, y ? HIGH : LOW);
    if (cfg.ledB >= 0) digitalWrite(cfg.ledB, b ? HIGH : LOW);
    if (cfg.ledW >= 0) digitalWrite(cfg.ledW, w ? HIGH : LOW);
}

// Map the single-LED status colour onto the 5-LED panel. Used for the imperative
// boot / connecting / portal phases that run before ledTask() takes over; once
// the network is up, ledTask() drives the panel directly (multi-state).
static void leds5FromColor(uint32_t c, bool& r, bool& g, bool& y, bool& b, bool& w) {
    r = g = y = b = w = false;
    switch (c) {
        case NEO_GREEN:  g = true; break;            // active
        case NEO_AMBER:  y = true; break;            // online, idle
        case NEO_RED:    r = true; break;            // fault / no network
        case NEO_BLUE:   b = true; break;            // connecting / link wait
        case NEO_PURPLE: b = true; w = true; break;  // AP / config portal
        case NEO_WHITE:  w = true; break;            // booting
        case NEO_OFF: default: break;
    }
}

static void initLed() {
    if (cfg.ledType == 1 && cfg.ledPin >= 0) {
        pinMode(cfg.ledPin, OUTPUT);
        digitalWrite(cfg.ledPin, LOW);
    } else if (cfg.ledType == 2 && cfg.ledPin >= 0) {
        neoPixel.setPin((uint16_t)cfg.ledPin);
        neoPixel.begin();
        neoPixel.setPixelColor(0, NEO_OFF);
        neoPixel.show();
    } else if (cfg.ledType == 3) {
        const int pins[5] = { cfg.ledR, cfg.ledG, cfg.ledY, cfg.ledB, cfg.ledW };
        for (int i = 0; i < 5; i++)
            if (pins[i] >= 0) { pinMode(pins[i], OUTPUT); digitalWrite(pins[i], LOW); }
    }
}

static void setLedColor(uint32_t neoColor, bool gpioOn) {
    // Skip redundant updates — repeatedly clocking the WS2812 (it sits next to
    // the antenna on the S3 DevKitC-1) injects RF noise and weakens WiFi.
    static uint32_t lastNeo = 0xFFFFFFFF;
    static int8_t   lastGpio = -1;
    if (cfg.ledType == 1 && cfg.ledPin >= 0) {
        if ((int8_t)gpioOn == lastGpio) return;
        lastGpio = gpioOn;
        digitalWrite(cfg.ledPin, gpioOn ? HIGH : LOW);
    } else if (cfg.ledType == 2 && cfg.ledPin >= 0) {
        if (neoColor == lastNeo) return;
        lastNeo = neoColor;
        neoPixel.setPixelColor(0, neoColor);
        neoPixel.show();
    } else if (cfg.ledType == 3) {
        bool r, g, y, b, w;
        leds5FromColor(neoColor, r, g, y, b, w);
        setLeds5(r, g, y, b, w);
    }
}
static void setLed(bool on) { setLedColor(on ? NEO_GREEN : NEO_OFF, on); }

// ---------------------------------------------------------------------------
// Optional status display (Adafruit_GFX family)
//   Mono I2C : SSD1306 128x64/128x32 + SH1106 128x64   — dispType 1/2/3
//   Colour SPI: SSD1351 128x128 RGB                    — dispType 4
// One Adafruit_GFX* drives them all; the renderer (Phase 3) is type-agnostic.
// ---------------------------------------------------------------------------
// Rendering always targets an off-screen buffer (gfx); dispFlush() pushes it to
// the physical panel (dispDev) in one shot so the panel never shows a partial
// frame. Mono drivers buffer internally (gfx == dispDev). The SSD1351 has no RAM
// buffer, so the colour path renders into dispCanvas and blits it whole — without
// that it would flicker, clearing then redrawing live on the SPI bus each frame.
static Adafruit_GFX* gfx        = nullptr;   // draw target (canvas for colour, device for mono)
static Adafruit_GFX* dispDev    = nullptr;   // physical panel
static GFXcanvas16*  dispCanvas = nullptr;   // off-screen buffer for the colour panel
static bool          dispReady  = false;

// Foreground "on" colour. Mono drivers want the 1-bit WHITE constant (==1);
// the colour panel wants RGB565 white. Passing 0xFFFF to a mono driver draws
// nothing (its drawPixel only matches 0/1/2), so the two must differ.
static inline uint16_t dispFg() { return cfg.dispType == 4 ? 0xFFFF : 1; }

static void dispFlush() {
    if (!dispDev) return;
    if (cfg.dispType == 4)
        static_cast<Adafruit_SSD1351*>(dispDev)->drawRGBBitmap(0, 0, dispCanvas->getBuffer(), 128, 128);
    else if (cfg.dispType == 3)
        static_cast<Adafruit_SH1106G*>(dispDev)->display();
    else
        static_cast<Adafruit_SSD1306*>(dispDev)->display();
}

static void dispSplash() {
    if (!gfx) return;
    bool big = gfx->height() >= 64;
    gfx->fillScreen(0);
    gfx->setTextColor(dispFg());
    gfx->setTextSize(big ? 2 : 1);
    gfx->setCursor(0, 0);
    gfx->print("LuxDMX");
    gfx->setTextSize(1);
    gfx->setCursor(0, big ? 22 : 12);
    gfx->print('v'); gfx->print(FIRMWARE_VERSION);
    gfx->setCursor(0, big ? 36 : 22);
    gfx->print("booting...");
    dispFlush();
}

// Build the driver that matches cfg.dispType, probe/begin it, show the splash.
// No-op when disabled; on failure logs and leaves gfx==nullptr (never hangs).
static void initDisplay() {
    if (cfg.dispType <= 0) return;

    if (cfg.dispType == 4) {
        // Colour SSD1351 over hardware SPI. DC is mandatory; CS/RST may be -1.
        if (cfg.dispDc < 0) { Serial.println("[DISP] SSD1351 needs a DC pin"); return; }
        if (cfg.dispSck >= 0 && cfg.dispMosi >= 0)
            SPI.begin(cfg.dispSck, -1, cfg.dispMosi, cfg.dispCs);
        Adafruit_SSD1351* d = new Adafruit_SSD1351(128, 128, &SPI,
                                  cfg.dispCs, cfg.dispDc, cfg.dispRst);
        d->begin();
        dispCanvas = new GFXcanvas16(128, 128);
        if (!dispCanvas->getBuffer()) {
            delete d; delete dispCanvas; dispCanvas = nullptr;
            Serial.println("[DISP] SSD1351 canvas alloc failed"); return;
        }
        dispDev = d;
        gfx     = dispCanvas;
    } else {
        // Mono OLED over I2C — probe 0x3C then 0x3D; bail if no panel answers.
        if (cfg.dispSda >= 0 && cfg.dispScl >= 0) Wire.begin(cfg.dispSda, cfg.dispScl);
        else                                      Wire.begin();
        Wire.setClock(400000);
        uint8_t addr = 0;
        Wire.beginTransmission(0x3C);
        if (Wire.endTransmission() == 0) addr = 0x3C;
        else { Wire.beginTransmission(0x3D); if (Wire.endTransmission() == 0) addr = 0x3D; }
        if (!addr) { Serial.println("[DISP] no I2C OLED found (0x3C/0x3D)"); return; }
        if (cfg.dispType == 3) {
            Adafruit_SH1106G* d = new Adafruit_SH1106G(128, 64, &Wire, -1);
            if (!d->begin(addr, true)) { delete d; Serial.println("[DISP] SH1106 init failed"); return; }
            gfx = d;
        } else {
            int h = (cfg.dispType == 2) ? 32 : 64;
            Adafruit_SSD1306* d = new Adafruit_SSD1306(128, h, &Wire, -1);
            // periphBegin=false: we already ran Wire.begin(sda,scl) above; don't let the
            // library re-init I2C, which can fall back to default pins on older ESP32 cores.
            if (!d->begin(SSD1306_SWITCHCAPVCC, addr, true, false)) { delete d; Serial.println("[DISP] SSD1306 init failed"); return; }
            gfx = d;
        }
        dispDev = gfx;
        Serial.printf("[DISP] I2C OLED at 0x%02X\n", addr);
    }

    gfx->setRotation(cfg.dispRot ? 2 : 0);
    dispReady = true;
    Serial.printf("[DISP] type=%d %dx%d ready\n", cfg.dispType, gfx->width(), gfx->height());
    dispSplash();
}

// ---------------------------------------------------------------------------
// General helpers
// ---------------------------------------------------------------------------
static uint32_t uptimeSec() { return (millis() - startMs) / 1000; }

static String uptimeStr() {
    uint32_t s = uptimeSec();
    char buf[32];
    snprintf(buf, sizeof(buf), "%02ud %02u:%02u:%02u",
             s/86400, (s%86400)/3600, (s%3600)/60, s%60);
    return String(buf);
}

static String ipStr(uint32_t ip) {
    char buf[16];
    snprintf(buf, sizeof(buf), "%u.%u.%u.%u",
             ip & 0xFF, (ip>>8)&0xFF, (ip>>16)&0xFF, (ip>>24)&0xFF);
    return String(buf);
}

// The web monitor views/controls one output. monitorOut can go stale (e.g. its
// output was later disabled), so always resolve to a currently-enabled output —
// the monitor must never show or drive an empty/disabled buffer.
static int viewOutput() {
    if (monitorOut >= 0 && monitorOut < MAX_OUTPUTS && cfg.outputs[monitorOut].enabled)
        return monitorOut;
    for (int i = 0; i < MAX_OUTPUTS; i++) if (cfg.outputs[i].enabled) return i;
    return 0;
}

static void sendDmx() {
    if (!dmxReady) return;
    bool ovActive = identifyCh && millis() < identifyUntil;
    int  vo = viewOutput();
    for (int i = 0; i < MAX_OUTPUTS; i++) {
        if (!outReady[i]) continue;
        // Identify override: force one channel to full on the wire only (on the
        // monitored output), without corrupting the stored value the UI sees.
        bool ov = ovActive && i == vo;
        // STOP-on-loss: go dark on the wire so fixtures fall back to their own
        // DMX-loss behaviour. Manual mode (the UI owns this output) and an active
        // identify are explicit user intent and keep the line clocking.
        if (cfg.outputs[i].lossMode == LOSS_STOP && outSrcLost[i]
            && !ov && !(manualMode && i == vo)) continue;
        dmx_port_t port = (dmx_port_t)cfg.outputs[i].port;
        uint8_t saved = 0;
        if (ov) { saved = dmxBuf[i][identifyCh]; dmxBuf[i][identifyCh] = 255; }
        dmx_write(port, dmxBuf[i], DMX_PACKET_SIZE);
        dmx_send(port);
        dmx_wait_sent(port, DMX_TIMEOUT_TICK);
        if (ov) dmxBuf[i][identifyCh] = saved;
    }
}

// ---------------------------------------------------------------------------
// RDM (E1.20) controller — discovery + GET/SET on the physical DMX line.
// Bound to a single output (rdmOut): the first enabled output with a direction-
// enable pin set (the esp_dmx "enable" line). All bus access runs on loop()'s
// thread — the only owner of the DMX port — so the async web/WS task just sets
// request flags.
// ---------------------------------------------------------------------------
static constexpr int RDM_MAX_SENSORS = 4;        // sensors stored per fixture
struct RdmSensor {
    char    name[20];   // SENSOR_DEFINITION description, or a type label
    char    unit[8];    // SI unit string derived from the definition
    int16_t value;      // SENSOR_VALUE present value
    bool    valid;      // a value was read
};
struct RdmDevice {
    rdm_uid_t uid;
    uint16_t  startAddr;
    uint16_t  footprint;
    uint16_t  modelId;
    uint16_t  subDeviceCount;
    uint8_t   personality;
    uint8_t   personalityCount;
    bool      identifying;
    char      swLabel[33];
    uint8_t   sensorCount;
    RdmSensor sensors[RDM_MAX_SENSORS];
};
static constexpr int RDM_MAX_DEVICES = 32;
static RdmDevice rdmDevices[RDM_MAX_DEVICES];
static int       rdmCount      = 0;
static bool      rdmScanned    = false;       // a discovery has completed at least once
static volatile bool rdmBusy   = false;       // discovery in progress
static uint32_t  rdmLastScanMs = 0;

// Single-slot request mailboxes: set by the async WS task, consumed in loop().
static volatile bool rdmDiscoverReq = false;
static volatile bool rdmSetAddrReq  = false;
static volatile bool rdmIdentifyReq = false;
static rdm_uid_t     rdmSetUid      = {0, 0};
static rdm_uid_t     rdmIdentUid    = {0, 0};
static volatile uint16_t rdmReqAddr = 1;
static volatile bool rdmReqOn       = false;

// RDM only works when the DMX driver is up AND a direction-enable pin is set.
static bool rdmAvailable() { return dmxReady && rdmOut >= 0 && outReady[rdmOut]; }

// Map E1.20 sensor unit / type enums to short display strings.
static const char* rdmUnitStr(uint8_t u) {
    switch (u) {
        case RDM_UNITS_CENTIGRADE:    return "C";
        case RDM_UNITS_VOLTS_DC:
        case RDM_UNITS_VOLTS_AC_PEAK:
        case RDM_UNITS_VOLTS_AC_RMS:  return "V";
        case RDM_UNITS_AMPERE_DC:
        case RDM_UNITS_AMPERE_AC_PEAK:
        case RDM_UNITS_AMPERE_AC_RMS: return "A";
        case RDM_UNITS_HERTZ:         return "Hz";
        case RDM_UNITS_OHM:           return "ohm";
        case RDM_UNITS_WATT:          return "W";
        case RDM_UNITS_KILOGRAM:      return "kg";
        case RDM_UNITS_METERS:        return "m";
        case RDM_UNITS_SECOND:        return "s";
        case RDM_UNITS_DEGREE:        return "deg";
        case RDM_UNITS_LUX:           return "lux";
        case RDM_UNITS_BYTE:          return "B";
        default:                      return "";
    }
}
static const char* rdmTypeStr(uint8_t t) {
    switch (t) {
        case RDM_SENSOR_TYPE_TEMPERATURE:      return "Temperature";
        case RDM_SENSOR_TYPE_VOLTAGE:          return "Voltage";
        case RDM_SENSOR_TYPE_CURRENT:          return "Current";
        case RDM_SENSOR_TYPE_FREQUENCY:        return "Frequency";
        case RDM_SENSOR_TYPE_POWER:            return "Power";
        case RDM_SENSOR_TYPE_ANGULAR_VELOCITY: return "Fan";
        case RDM_SENSOR_TYPE_TIME:             return "Time";
        case RDM_SENSOR_TYPE_HUMIDITY:         return "Humidity";
        default:                               return "Sensor";
    }
}

static RdmDevice* rdmFind(const rdm_uid_t& uid) {
    for (int i = 0; i < rdmCount; i++)
        if (rdm_uid_is_eq(&rdmDevices[i].uid, &uid)) return &rdmDevices[i];
    return nullptr;
}

// Parse a "uid":"MMMM:DDDDDDDD" field out of a small JSON control message.
static bool rdmParseUid(const String& msg, rdm_uid_t& out) {
    int k = msg.indexOf("\"uid\":\"");
    if (k < 0) return false;
    k += 7;
    int colon = msg.indexOf(':', k);
    int end   = msg.indexOf('"', k);
    if (colon < 0 || end < 0 || colon > end) return false;
    out.man_id = (uint16_t)strtoul(msg.substring(k, colon).c_str(), nullptr, 16);
    out.dev_id = (uint32_t)strtoul(msg.substring(colon + 1, end).c_str(), nullptr, 16);
    return true;
}

// Full discovery sweep + per-device GET device-info & software-version label.
// Blocks the bus for the duration (~hundreds of ms) — DMX output pauses briefly.
static void rdmDoDiscover() {
    dmx_port_t port = (dmx_port_t)cfg.outputs[rdmOut].port;
    rdmBusy = true;
    rdm_uid_t uids[RDM_MAX_DEVICES];
    int n = rdm_discover_devices_simple(port, uids, RDM_MAX_DEVICES);
    if (n > RDM_MAX_DEVICES) n = RDM_MAX_DEVICES;
    rdmCount = 0;
    for (int i = 0; i < n; i++) {
        RdmDevice d = {};
        d.uid = uids[i];
        rdm_ack_t ack;
        rdm_device_info_t info;
        if (rdm_send_get_device_info(port, &uids[i], RDM_SUB_DEVICE_ROOT, &info, &ack)
            && ack.type == RDM_RESPONSE_TYPE_ACK) {
            d.startAddr        = info.dmx_start_address;
            d.footprint        = info.footprint;
            d.modelId          = info.model_id;
            d.subDeviceCount   = info.sub_device_count;
            d.personality      = info.personality.current;
            d.personalityCount = info.personality.count;
            d.sensorCount      = info.sensor_count > RDM_MAX_SENSORS
                                     ? RDM_MAX_SENSORS : info.sensor_count;
        }
        rdm_send_get_software_version_label(port, &uids[i], RDM_SUB_DEVICE_ROOT,
                                            d.swLabel, sizeof(d.swLabel), &ack);

        // Sensors (E1.20): per sensor read its definition (name/unit) then value.
        // Sensors are numbered 0..count-1; definition and value are independent —
        // tolerate either being unsupported.
        for (uint8_t s = 0; s < d.sensorCount; s++) {
            RdmSensor& sen = d.sensors[s];
            rdm_ack_t sack;
            uint8_t   sn = s;

            rdm_sensor_definition_t def = {};
            rdm_request_t dreq = { &uids[i], RDM_SUB_DEVICE_ROOT, RDM_CC_GET_COMMAND,
                                   RDM_PID_SENSOR_DEFINITION, "b$", &sn, 1 };
            if (rdm_send_request(port, &dreq, "bbbbwwwwba$", &def, sizeof(def), &sack)
                && sack.type == RDM_RESPONSE_TYPE_ACK) {
                strlcpy(sen.name, def.description[0] ? def.description : rdmTypeStr(def.type),
                        sizeof(sen.name));
                strlcpy(sen.unit, rdmUnitStr(def.unit), sizeof(sen.unit));
            }

            rdm_sensor_value_t val = {};
            rdm_request_t vreq = { &uids[i], RDM_SUB_DEVICE_ROOT, RDM_CC_GET_COMMAND,
                                   RDM_PID_SENSOR_VALUE, "b$", &sn, 1 };
            if (rdm_send_request(port, &vreq, "bwwww$", &val, sizeof(val), &sack)
                && sack.type == RDM_RESPONSE_TYPE_ACK) {
                sen.value = val.present_value;
                sen.valid = true;
                if (!sen.name[0]) strlcpy(sen.name, "Sensor", sizeof(sen.name));
            }
        }
        rdmDevices[rdmCount++] = d;
    }
    rdmScanned    = true;
    rdmLastScanMs = millis();
    rdmBusy       = false;
    Serial.printf("[RDM] discovery: %d device(s)\n", rdmCount);
}

// Called once per loop() iteration; does work only when a request is queued.
static void rdmService() {
    if (!rdmAvailable()) return;
    dmx_port_t port = (dmx_port_t)cfg.outputs[rdmOut].port;
    rdm_ack_t ack;

    if (rdmSetAddrReq) {
        rdmSetAddrReq = false;
        if (rdm_send_set_dmx_start_address(port, &rdmSetUid, RDM_SUB_DEVICE_ROOT,
                                           rdmReqAddr, &ack)) {
            RdmDevice* d = rdmFind(rdmSetUid);
            if (d) d->startAddr = rdmReqAddr;
            Serial.printf("[RDM] set " UIDSTR " addr=%u\n", UID2STR(rdmSetUid), rdmReqAddr);
        }
    }
    if (rdmIdentifyReq) {
        rdmIdentifyReq = false;
        if (rdm_send_set_identify_device(port, &rdmIdentUid, RDM_SUB_DEVICE_ROOT,
                                         rdmReqOn ? 1 : 0, &ack)) {
            RdmDevice* d = rdmFind(rdmIdentUid);
            if (d) d->identifying = rdmReqOn;
        }
    }
    if (rdmDiscoverReq) {
        rdmDiscoverReq = false;
        rdmDoDiscover();
    }
}

// ---------------------------------------------------------------------------
// Sender tracking
// True if any enabled output listens to `universe` (so a source on it can
// actually contribute to a merge).
static bool universeMapped(int universe) {
    for (int o = 0; o < MAX_OUTPUTS; o++)
        if (cfg.outputs[o].enabled && cfg.outputs[o].universe == universe) return true;
    return false;
}

// ---------------------------------------------------------------------------
// Track a source and cache its latest frame for the merge engine. Keyed by
// ip+proto; records the target universe, priority and the raw frame (plus how
// many channels it spans) so mergeOutput() can combine every live source later.
static void updateSender(uint32_t ip, uint8_t proto, int16_t universe,
                         uint8_t priority, const uint8_t* data, uint16_t length) {
    uint32_t now = millis();
    int slot = -1;
    for (int i = 0; i < MAX_SENDERS; i++)
        if (senders[i].ip == ip && senders[i].proto == proto) { slot = i; break; }
    bool fresh = false;
    if (slot < 0) {
        for (int i = 0; i < MAX_SENDERS; i++)
            if (senders[i].ip == 0) { slot = i; break; }
    }
    if (slot < 0) {
        // Table full: prefer evicting a source whose universe no enabled output
        // listens to (it can't be a merge contributor); else least-recently-seen.
        for (int i = 0; i < MAX_SENDERS; i++)
            if (!universeMapped(senders[i].universe)) { slot = i; break; }
        if (slot < 0) {
            slot = 0;
            for (int i = 1; i < MAX_SENDERS; i++)
                if (senders[i].lastMs < senders[slot].lastMs) slot = i;
        }
    }
    Sender& s = senders[slot];
    if (s.ip != ip || s.proto != proto) fresh = true;
    if (fresh) {
        memset(s.data, 0, sizeof(s.data));
        s.ip = ip; s.proto = proto;
        s.winMs = now; s.winCnt = 0; s.fps = 0.0f;
        Serial.printf("[SND] new sender %s proto=%d\n", ipStr(ip).c_str(), proto);
    }
    s.lastMs   = now;
    s.universe = universe;
    s.priority = priority;
    s.dataLen  = length < 512 ? length : 512;
    memcpy(s.data, data, s.dataLen);   // merge reads only [0, dataLen), so a short
                                       // frame contributes only the channels it sends
    s.winCnt++;
    if (now - s.winMs >= 1000) {
        s.fps   = (float)s.winCnt * 1000.0f / (float)(now - s.winMs);
        s.winCnt = 0;
        s.winMs  = now;
    }
}

static uint8_t activeSenderCount() {
    uint32_t now = millis();
    uint8_t n = 0;
    for (int i = 0; i < MAX_SENDERS; i++)
        if (senders[i].ip != 0 && now - senders[i].lastMs < 5000) n++;
    return n;
}

// Count live sources (seen within windowMs) currently feeding `universe`.
static int sourcesOnUniverse(int universe, uint32_t windowMs) {
    uint32_t now = millis();
    int n = 0;
    for (int i = 0; i < MAX_SENDERS; i++) {
        const Sender& s = senders[i];
        if (s.ip == 0 || s.universe != universe) continue;
        if (now - s.lastMs < windowMs) n++;
    }
    return n;
}

// A real conflict = 2+ live sources on an enabled output's universe while that
// output is NOT merging (mergeMode OFF → unmanaged last-frame-wins clash). HTP/LTP
// outputs are meant to be fed by several sources, so they never raise the warning.
// Uses the same liveness window as the merge engine so the warning and the actual
// contribution agree (a source silent past SOURCE_TIMEOUT_MS stops counting).
static bool hasConflict() {
    for (int o = 0; o < MAX_OUTPUTS; o++) {
        if (!cfg.outputs[o].enabled || cfg.outputs[o].mergeMode != MERGE_OFF) continue;
        if (sourcesOnUniverse(cfg.outputs[o].universe, SOURCE_TIMEOUT_MS) > 1) return true;
    }
    return false;
}

// Merging active = 2+ live sources on an enabled output that IS merging (HTP/LTP).
static bool isMerging() {
    for (int o = 0; o < MAX_OUTPUTS; o++) {
        if (!cfg.outputs[o].enabled || cfg.outputs[o].mergeMode == MERGE_OFF) continue;
        if (sourcesOnUniverse(cfg.outputs[o].universe, SOURCE_TIMEOUT_MS) > 1) return true;
    }
    return false;
}

// Source state for the UI / LED / display. An unmanaged clash outranks merging.
static uint8_t sourceStatus() {
    if (hasConflict()) return SRC_CONFLICT;
    if (isMerging())   return SRC_MERGING;
    return SRC_NORMAL;
}

// Cached source state, recomputed on the loop task after each merge. The async
// web task, LED task and display task read this single byte instead of each
// re-scanning senders[] (avoids redundant work and cross-task torn reads of the
// sender table). A byte read/write is atomic on the ESP32.
static volatile uint8_t g_srcStatus = SRC_NORMAL;

// ---------------------------------------------------------------------------
// Change log
// ---------------------------------------------------------------------------
// Sample the MERGED output buffer (`cur` = the post-merge channels going to the
// wire) ~5x/s and log what changed since the last sample. Diffing the merged
// result — not the raw incoming source frame — keeps the change log honest under
// HTP/LTP, where the wire value is a combination of sources rather than any one
// source's frame.
static void maybeLog(int outIdx, const uint8_t* cur, uint16_t len, uint32_t ip, uint8_t proto) {
    static uint8_t prev[512];
    static int     prevOut = -1;
    uint32_t now = millis();
    if (now - lastLogMs < 200) return;
    lastLogMs = now;
    uint16_t lim = len < 512 ? len : 512;

    if (outIdx != prevOut) {        // viewed output switched → reseed, skip one sample
        memcpy(prev, cur, lim);
        prevOut = outIdx;
        return;
    }

    LogEntry e;
    e.ms    = now;
    e.ip    = ip;
    e.proto = proto;
    e.uni   = (uint8_t)cfg.outputs[outIdx].universe;
    e.total = 0;
    e.topN  = 0;
    for (int i = 0; i < lim; i++) {
        if (cur[i] != prev[i]) {
            e.total++;
            if (e.topN < LOG_TOP) {
                e.top[e.topN].ch  = (uint16_t)(i + 1);
                e.top[e.topN].val = cur[i];
                e.topN++;
            }
        }
    }
    memcpy(prev, cur, lim);         // baseline for the next sample
    if (e.total == 0) return;

    dmxLog[logHead] = e;
    logHead  = (logHead + 1) % LOG_SIZE;
    if (logCount < LOG_SIZE) logCount++;
}

// Per-output frame rate: the live value, or 0 once that output's input has
// stalled (>1.5 s), so a dead universe reads 0.0 instead of a stale rate. Used by
// the WS push, dmx.json and the status display.
static float outFpsLive(int i) {
    return (millis() - outLastDmxMs[i] < 1500) ? outFps[i] : 0.0f;
}

// ---------------------------------------------------------------------------
// WebSocket push (binary, WS_FRAME_LEN bytes)
// frame: fps(2) rssi(2) heap(4) uptime(4) senders(1) srcStatus(1) jitter(2)
//        rssi doubles as a link indicator: <=0 WiFi STA dBm | >=10 wired link
//        speed (Mbps) | 1 standalone AP  (no spare byte in the frame; see wsPush)
//        srcStatus: 0=normal 1=conflict 2=merging
//        dmx(512) + per-output fps(2 x MAX_OUTPUTS)
// ---------------------------------------------------------------------------
static void wsPush() {
    if (ws.count() == 0) return;
    if (ESP.getFreeHeap() < 40000) return;   // never push under heap pressure
    uint16_t fpsI  = (uint16_t)(fps * 10.0f);
    // rssi field carries the active link: <=0 WiFi STA dBm, >=10 wired Ethernet
    // link speed in Mbps, 1 standalone AP. Lets the navbar show WiFi/LAN/AP live.
    int16_t  rssi;
    if (g_apMode)      rssi = 1;
#if defined(HAS_WIRED_ETH)
    else if (g_useEth) { int s = ETH.linkSpeed(); rssi = (int16_t)(s >= 10 ? s : 100); }
#endif
    else               rssi = (int16_t)WiFi.RSSI();
    uint32_t heap  = ESP.getFreeHeap();
    uint32_t upS   = uptimeSec();
    uint16_t jitI  = (uint16_t)(jitterMs * 10.0f < 65535.0f ? jitterMs * 10.0f : 65535.0f);
    wsBuf[0]  = fpsI >> 8;                       wsBuf[1]  = fpsI & 0xFF;
    wsBuf[2]  = (uint8_t)((uint16_t)rssi >> 8);  wsBuf[3]  = rssi & 0xFF;
    wsBuf[4]  = heap >> 24;  wsBuf[5]  = (heap>>16)&0xFF;
    wsBuf[6]  = (heap>>8)&0xFF; wsBuf[7] = heap & 0xFF;
    wsBuf[8]  = upS >> 24;   wsBuf[9]  = (upS>>16)&0xFF;
    wsBuf[10] = (upS>>8)&0xFF; wsBuf[11] = upS & 0xFF;
    wsBuf[12] = activeSenderCount();
    wsBuf[13] = g_srcStatus;   // 0 = normal, 1 = conflict, 2 = merging
    wsBuf[14] = jitI >> 8;  wsBuf[15] = jitI & 0xFF;
    memcpy(&wsBuf[16], &dmxBuf[viewOutput()][1], 512);   // stream the viewed output
    // Per-output frame rates (one universe each) appended after the DMX block.
    for (int i = 0; i < MAX_OUTPUTS; i++) {
        uint16_t f = (uint16_t)(outFpsLive(i) * 10.0f);
        wsBuf[528 + 2 * i] = f >> 8;  wsBuf[528 + 2 * i + 1] = f & 0xFF;
    }
    // Only push if the async TCP queues have room, so a slow client never
    // backs up memory or blocks.
    if (ws.availableForWriteAll()) ws.binaryAll(wsBuf, WS_FRAME_LEN);
}

// ---------------------------------------------------------------------------
// WebSocket event (browser → ESP). Runs in the AsyncTCP task, so it only
// updates dmxBuf/flags — loop() performs the actual DMX send.
// ---------------------------------------------------------------------------
static void handleWsText(const char* payload, size_t len) {
    String msg(payload, len);
    // Manual control + the live monitor act on the viewed output (monitorOut);
    // loop()'s 40 Hz refresh outputs every buffer.
    if (msg.indexOf("\"viewout\"") >= 0) {
        int k = msg.indexOf("\"out\":");
        if (k >= 0) {
            int o = msg.substring(k + 6).toInt();
            if (o >= 0 && o < MAX_OUTPUTS && cfg.outputs[o].enabled) monitorOut = o;
        }
        return;
    }
    if (msg.indexOf("\"blackout\"") >= 0) {
        memset(&dmxBuf[viewOutput()][1], 0, 512); return;
    }
    if (msg.indexOf("\"mode\"") >= 0) {
        manualMode = (msg.indexOf("true") >= 0); return;
    }
    if (msg.indexOf("\"identify\"") >= 0) {
        int chIdx = msg.indexOf("\"ch\":");
        if (chIdx < 0) return;
        int ch = msg.substring(chIdx + 5).toInt();
        if (ch < 1 || ch > 512) return;
        identifyCh    = (uint16_t)ch;
        identifyUntil = millis() + IDENTIFY_MS;
        return;
    }
    if (msg.indexOf("\"set\"") >= 0) {
        int chIdx  = msg.indexOf("\"ch\":");
        int valIdx = msg.indexOf("\"val\":");
        if (chIdx < 0 || valIdx < 0) return;
        int ch  = msg.substring(chIdx  + 5).toInt();
        int val = msg.substring(valIdx + 6).toInt();
        if (ch < 1 || ch > 512) return;
        dmxBuf[viewOutput()][ch] = (uint8_t)constrain(val, 0, 255);
        return;
    }
    // RDM control — only set request flags here; loop() owns the bus and runs them.
    if (msg.indexOf("\"rdm_discover\"") >= 0) { rdmDiscoverReq = true; return; }
    if (msg.indexOf("\"rdm_setaddr\"") >= 0) {
        rdm_uid_t u;
        int k = msg.indexOf("\"addr\":");
        if (rdmParseUid(msg, u) && k >= 0) {
            int a = msg.substring(k + 7).toInt();
            if (a >= 1 && a <= 512) { rdmSetUid = u; rdmReqAddr = (uint16_t)a; rdmSetAddrReq = true; }
        }
        return;
    }
    if (msg.indexOf("\"rdm_identify\"") >= 0) {
        rdm_uid_t u;
        if (rdmParseUid(msg, u)) {
            rdmIdentUid = u;
            rdmReqOn    = (msg.indexOf("\"on\":true") >= 0);
            rdmIdentifyReq = true;
        }
        return;
    }
}

static volatile uint32_t httpReqCount = 0;   // [DEBUG] HTTP requests served
static volatile uint32_t wsConnCount  = 0;   // [DEBUG] WS connects
static volatile uint32_t wsDiscCount  = 0;   // [DEBUG] WS disconnects

static void onWsEvent(AsyncWebSocket*, AsyncWebSocketClient*, AwsEventType type,
                      void* arg, uint8_t* data, size_t len) {
    if (type == WS_EVT_CONNECT)    { wsConnCount++; return; }
    if (type == WS_EVT_DISCONNECT) { wsDiscCount++; return; }
    if (type != WS_EVT_DATA) return;
    AwsFrameInfo* info = (AwsFrameInfo*)arg;
    // Only handle complete, single-frame text messages (our control msgs are tiny)
    if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
        handleWsText((const char*)data, len);
    }
}

// ---------------------------------------------------------------------------
// Shared DMX frame handler
// ---------------------------------------------------------------------------
// Recompute one output's DMX buffer from every live source feeding its universe
// (issue #10). E1.31 priority is honoured first — only sources at the highest
// active priority contribute — then the per-output merge mode decides:
//   OFF — the most recently seen source wins the whole frame (legacy behaviour)
//   HTP — per channel, the maximum across the contributing sources
//   LTP — the most recently seen contributing source wins the whole frame
// A source silent for SOURCE_TIMEOUT_MS drops out. With no live source left, the
// per-output signal-loss policy (lossMode) applies: HOLD keeps the last frame,
// ZERO blacks it out, STOP idles the line (enforced in sendDmx()).
// The monitored output is frozen while manual mode is on (the web UI owns it).
static void mergeOutput(int outIdx) {
    if (manualMode && outIdx == viewOutput()) return;
    const DmxOutput& out = cfg.outputs[outIdx];
    uint32_t now = millis();

    // Pass 1: collect this universe's live sources and their highest priority.
    int     contrib[MAX_SENDERS], nc = 0;
    uint8_t topPrio = 0;
    for (int i = 0; i < MAX_SENDERS; i++) {
        const Sender& s = senders[i];
        if (s.ip == 0 || s.universe != out.universe) continue;
        if (now - s.lastMs >= SOURCE_TIMEOUT_MS) continue;
        contrib[nc++] = i;
        if (s.priority > topPrio) topPrio = s.priority;
    }
    if (nc == 0) {
        // Every source for this universe has gone silent: apply the per-output
        // signal-loss policy. ZERO blacks the buffer out (still transmitted at the
        // normal rate); HOLD leaves it as-is; STOP keeps the buffer but is enforced
        // in sendDmx(), which simply stops clocking this port out.
        outSrcLost[outIdx] = true;
        if (out.lossMode == LOSS_ZERO) memset(&dmxBuf[outIdx][1], 0, 512);
        return;
    }
    outSrcLost[outIdx] = false;   // a live source is feeding this output again

    if (out.mergeMode == MERGE_HTP && nc > 1) {
        // Per channel, the maximum across the top-priority sources. Each source
        // covers only the channels it actually sends (dataLen), so a shrinking
        // frame releases its old high channels instead of leaving ghosts.
        uint8_t merged[512];
        memset(merged, 0, sizeof(merged));
        for (int k = 0; k < nc; k++) {
            const Sender& s = senders[contrib[k]];
            if (s.priority < topPrio) continue;          // E1.31 priority gate
            for (int c = 0; c < s.dataLen; c++)
                if (s.data[c] > merged[c]) merged[c] = s.data[c];
        }
        memcpy(&dmxBuf[outIdx][1], merged, 512);
        return;
    }

    // OFF, LTP, or a single contributor: the most recently seen source wins the
    // whole frame. OFF ignores priority (legacy last-frame-wins); HTP/LTP keep
    // only the top-priority sources. Copy just the channels that source sends;
    // the rest of the output holds its last value (DMX convention).
    bool usePrio = (out.mergeMode != MERGE_OFF);
    int newest = -1; uint32_t newestMs = 0;
    for (int k = 0; k < nc; k++) {
        const Sender& s = senders[contrib[k]];
        if (usePrio && s.priority < topPrio) continue;
        if (newest < 0 || s.lastMs >= newestMs) { newest = contrib[k]; newestMs = s.lastMs; }
    }
    if (newest >= 0) memcpy(&dmxBuf[outIdx][1], senders[newest].data, senders[newest].dataLen);
}

// Route one received universe to every enabled output mapped to it (so the
// same universe on both outputs acts as a 1-in-2-out splitter), then update
// the aggregate stats/sender tracking once per input frame.
static void routeFrame(int artUniverse, const uint8_t* data, uint16_t length,
                       uint32_t senderIp, uint8_t proto, uint8_t priority) {
    uint32_t now = millis();
    // Cache this source's frame first so the merge engine sees current data.
    updateSender(senderIp, proto, (int16_t)artUniverse, priority, data, length);

    bool matched = false;
    for (int i = 0; i < MAX_OUTPUTS; i++) {
        if (!cfg.outputs[i].enabled || cfg.outputs[i].universe != artUniverse) continue;
        mergeOutput(i);
        // Log the merged result for the viewed output (what actually goes out).
        if (i == viewOutput()) maybeLog(i, &dmxBuf[i][1], 512, senderIp, proto);
        // Per-output frame rate over a 1 s window (this universe only).
        outLastDmxMs[i] = now;
        outFrameCount[i]++;
        if (now - outLastFrameMs[i] >= 1000) {
            outFps[i] = (float)outFrameCount[i] * 1000.0f / (float)(now - outLastFrameMs[i]);
            outFrameCount[i] = 0;
            outLastFrameMs[i] = now;
        }
        matched = true;
    }
    if (!matched) return;
    g_srcStatus = sourceStatus();   // refresh cached state for the UI/LED/display

    // [DEBUG] flag DMX reception gaps (input stalled)
    if (lastDmxMs && now - lastDmxMs > 300)
        Serial.printf("[GAP] dmx input gap=%lums proto=%d up=%lus\n",
            (unsigned long)(now - lastDmxMs), proto, (unsigned long)uptimeSec());

    // Jitter: deviation from expected inter-frame interval
    if (prevFrameMs > 0 && fps > 1.0f) {
        float interval = (float)(now - prevFrameMs);
        float expected = 1000.0f / fps;
        float dev = interval > expected ? interval - expected : expected - interval;
        jitterMs = jitterMs * 0.85f + dev * 0.15f;
    }
    prevFrameMs = now;

    lastDmxMs = now;
    frameCount++;
    if (now - lastFrameMs >= 1000) {
        fps         = (float)frameCount * 1000.0f / (float)(now - lastFrameMs);
        frameCount  = 0;
        lastFrameMs = now;
    }
    if (now - lastWsPush >= 40) {
        wsPush();
        lastWsPush = now;
    }
}

// ---------------------------------------------------------------------------
// Art-Net callback
// ---------------------------------------------------------------------------
static void onArtDmx(uint16_t universe, uint16_t length, uint8_t, uint8_t* data) {
    // Art-Net carries no per-packet priority, so it joins the merge at the default.
    routeFrame((int)universe, data, length, (uint32_t)artnet.getSenderIp(), 0, DEFAULT_PRIORITY);
}

// ---------------------------------------------------------------------------
// sACN / E1.31
// ---------------------------------------------------------------------------
static constexpr int SACN_ACN_ID_OFF    = 4;
static constexpr int SACN_ROOT_VEC_OFF  = 18;
static constexpr int SACN_FRAME_VEC_OFF = 40;
static constexpr int SACN_PRIORITY_OFF  = 108;   // E1.31 framing-layer priority byte
static constexpr int SACN_UNIVERSE_OFF  = 113;
static constexpr int SACN_STARTCODE_OFF = 125;
static constexpr int SACN_DATA_OFF      = 126;
static constexpr int SACN_MIN_LEN       = 638;

static const uint8_t ACN_PACKET_ID[12] = {
    0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31,
    0x37, 0x00, 0x00, 0x00
};

static void startSacn() {
    // One multicast socket per enabled output, each joined to its universe's
    // group (sACN universe = Art-Net universe + 1). Sockets share port 5568
    // (WiFiUDP sets SO_REUSEADDR); lwip delivers each group to its joiner.
    for (int i = 0; i < MAX_OUTPUTS; i++) {
        sacnUdp[i].stop();
        if (!cfg.outputs[i].enabled) continue;
        uint16_t sacnUniverse = (uint16_t)(cfg.outputs[i].universe + 1);
        uint8_t  univHigh     = (uint8_t)((sacnUniverse >> 8) & 0xFF);
        uint8_t  univLow      = (uint8_t)(sacnUniverse & 0xFF);
        IPAddress mcast(239, 255, univHigh, univLow);
        sacnUdp[i].beginMulticast(mcast, 5568);
        Serial.printf("[sACN] out%d universe %u  multicast 239.255.%u.%u:5568\n",
                      i, sacnUniverse, univHigh, univLow);
    }
}

// Validate + dispatch one sACN socket's pending packets to its output.
static void readSacnSocket(int outIdx) {
    WiFiUDP& udp = sacnUdp[outIdx];
    // Drain all packets buffered since the last call (catches up after any gap)
    for (int guard = 0; guard < 16; guard++) {
        int pktLen = udp.parsePacket();
        if (pktLen < SACN_MIN_LEN) return;
        uint32_t senderIp = (uint32_t)udp.remoteIP();
        int n = udp.read(sacnBuf, sizeof(sacnBuf));
        if (n < SACN_MIN_LEN) continue;
        if (memcmp(sacnBuf + SACN_ACN_ID_OFF, ACN_PACKET_ID, 12) != 0) continue;
        uint32_t rootVec = ((uint32_t)sacnBuf[SACN_ROOT_VEC_OFF    ] << 24)
                         | ((uint32_t)sacnBuf[SACN_ROOT_VEC_OFF + 1] << 16)
                         | ((uint32_t)sacnBuf[SACN_ROOT_VEC_OFF + 2] <<  8)
                         |  (uint32_t)sacnBuf[SACN_ROOT_VEC_OFF + 3];
        if (rootVec != 0x00000004u) continue;
        uint32_t frameVec = ((uint32_t)sacnBuf[SACN_FRAME_VEC_OFF    ] << 24)
                          | ((uint32_t)sacnBuf[SACN_FRAME_VEC_OFF + 1] << 16)
                          | ((uint32_t)sacnBuf[SACN_FRAME_VEC_OFF + 2] <<  8)
                          |  (uint32_t)sacnBuf[SACN_FRAME_VEC_OFF + 3];
        if (frameVec != 0x00000002u) continue;
        uint16_t universe = ((uint16_t)sacnBuf[SACN_UNIVERSE_OFF] << 8)
                           | sacnBuf[SACN_UNIVERSE_OFF + 1];
        if ((int)universe != cfg.outputs[outIdx].universe + 1) continue;
        if (sacnBuf[SACN_STARTCODE_OFF] != 0x00) continue;
        uint8_t priority = sacnBuf[SACN_PRIORITY_OFF];
        routeFrame((int)universe - 1, sacnBuf + SACN_DATA_OFF, 512, senderIp, 1, priority);
    }
}

static void readSacn() {
    for (int i = 0; i < MAX_OUTPUTS; i++)
        if (cfg.outputs[i].enabled) readSacnSocket(i);
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------
// Fetch a request parameter from POST body or query string
static bool argStr(AsyncWebServerRequest* req, const char* n, String& out) {
    if (req->hasParam(n, true)) { out = req->getParam(n, true)->value(); return true; }
    if (req->hasParam(n))       { out = req->getParam(n)->value();       return true; }
    return false;
}

static void handleVersionJson(AsyncWebServerRequest* req) {
    String j = "{\"current\":\"";
    j += FIRMWARE_VERSION;
    j += "\",\"latest\":\"";
    j += latestVersion.length() > 0 ? latestVersion : String(FIRMWARE_VERSION);
    j += "\",\"update\":";
    j += updateAvailable ? "true" : "false";
    j += "}";
    req->send(200, "application/json", j);
}

static String sendersJson() {
    String j = "[";
    bool first = true;
    uint32_t now = millis();
    for (int i = 0; i < MAX_SENDERS; i++) {
        if (senders[i].ip == 0) continue;
        uint32_t ago = now - senders[i].lastMs;
        if (ago > 30000) continue;
        if (!first) j += ",";
        first = false;
        char buf[72];
        snprintf(buf, sizeof(buf),
            "{\"ip\":\"%s\",\"p\":%d,\"fps\":%.1f,\"ago\":%lu}",
            ipStr(senders[i].ip).c_str(),
            (int)senders[i].proto,
            senders[i].fps,
            (unsigned long)(ago / 1000));
        j += buf;
    }
    j += "]";
    return j;
}

static String logJson() {
    String j = "[";
    bool first = true;
    for (int k = 0; k < logCount; k++) {
        // Iterate newest → oldest
        int idx = ((int)logHead - 1 - k + LOG_SIZE * 2) % LOG_SIZE;
        LogEntry& e = dmxLog[idx];
        if (!first) j += ",";
        first = false;
        char buf[80];
        snprintf(buf, sizeof(buf),
            "{\"ms\":%lu,\"ip\":\"%s\",\"p\":%d,\"u\":%d,\"n\":%d,\"ch\":[",
            (unsigned long)e.ms, ipStr(e.ip).c_str(), (int)e.proto, (int)e.uni, (int)e.total);
        j += buf;
        for (int t = 0; t < e.topN; t++) {
            if (t > 0) j += ",";
            snprintf(buf, sizeof(buf), "[%d,%d]", (int)e.top[t].ch, (int)e.top[t].val);
            j += buf;
        }
        j += "]}";
    }
    j += "]";
    return j;
}

static void handleSendersJson(AsyncWebServerRequest* req) { req->send(200, "application/json", sendersJson()); }
static void handleLogJson(AsyncWebServerRequest* req)     { req->send(200, "application/json", logJson()); }

// Push senders + log over the WebSocket (one persistent connection) so the
// browser doesn't have to poll two HTTP endpoints every 2 s.
static void wsPushMeta() {
    if (ws.count() == 0 || !ws.availableForWriteAll()) return;
    if (ESP.getFreeHeap() < 40000) return;   // never push under heap pressure
    String m = "{\"meta\":1,\"senders\":";
    m += sendersJson();
    m += ",\"log\":";
    m += logJson();
    m += "}";
    ws.textAll(m);
}

// Static pages are served straight from PROGMEM (zero heap). Dynamic values
// are fetched client-side from /info.json.
static void handleRoot(AsyncWebServerRequest* req) {
    httpReqCount++;
    AsyncWebServerResponse* r = req->beginResponse_P(200, "text/html", INDEX_HTML, INDEX_HTML_LEN);
    r->addHeader("Content-Encoding", "gzip");
    // Always revalidate the page itself after a firmware update; the versioned
    // ?v= asset URLs keep css/logo/favicon cacheable.
    r->addHeader("Cache-Control", "no-cache");
    req->send(r);
}

// Compile-time board identity. Lets the /config pin-picker auto-select the right
// board diagram and apply the correct strapping / flash / Ethernet-reserved rules
// (issue #12). BOARD_ID matches a descriptor id in web/boards/; MCU_ID is the family.
#if defined(USE_ETH_SPI)
static const char BOARD_ID[] = "luxdmx_v4";
#elif defined(USE_ETHERNET)
static const char BOARD_ID[] = "wt32eth01";
#elif defined(CONFIG_IDF_TARGET_ESP32S3)
static const char BOARD_ID[] = "esp32s3-devkitc-1";
#else
static const char BOARD_ID[] = "esp32-devkitc";
#endif
#if defined(CONFIG_IDF_TARGET_ESP32S3)
static const char MCU_ID[] = "esp32s3";
#else
static const char MCU_ID[] = "esp32";
#endif

static void handleInfoJson(AsyncWebServerRequest* req) {
    String j = "{";
    j += "\"ssid\":\"";     j += netSSID();              j += "\",";
    j += "\"ip\":\"";       j += netLocalIP().toString(); j += "\",";
    j += "\"hostname\":\""; j += cfg.hostname;           j += "\",";
    j += "\"version\":\"";  j += FIRMWARE_VERSION;       j += "\",";
    j += "\"otapw\":\"";    j += cfg.otaPassword;        j += "\",";
    j += "\"universe\":";   j += cfg.outputs[0].universe; j += ",";   // legacy/back-compat
    j += "\"protocol\":";   j += cfg.protocol;           j += ",";
    j += "\"ledType\":";    j += cfg.ledType;            j += ",";
    j += "\"ledPin\":";     j += cfg.ledPin;             j += ",";
    j += "\"ledR\":";       j += cfg.ledR;               j += ",";
    j += "\"ledG\":";       j += cfg.ledG;               j += ",";
    j += "\"ledY\":";       j += cfg.ledY;               j += ",";
    j += "\"ledB\":";       j += cfg.ledB;               j += ",";
    j += "\"ledW\":";       j += cfg.ledW;               j += ",";
    j += "\"rdmOut\":";     j += rdmOut;                 j += ",";
    j += "\"outputs\":[";
    for (int i = 0; i < MAX_OUTPUTS; i++) {
        const DmxOutput& o = cfg.outputs[i];
        if (i) j += ",";
        j += "{\"en\":";   j += o.enabled ? "true" : "false";
        j += ",\"uni\":";  j += o.universe;
        j += ",\"port\":"; j += o.port;
        j += ",\"tx\":";   j += o.txPin;
        j += ",\"rx\":";   j += o.rxPin;
        j += ",\"rts\":";  j += o.rtsPin;
        j += ",\"merge\":"; j += o.mergeMode;
        j += ",\"loss\":";  j += o.lossMode;
        j += "}";
    }
    j += "],";
    j += "\"dispType\":";   j += cfg.dispType;           j += ",";
    j += "\"dispSda\":";    j += cfg.dispSda;            j += ",";
    j += "\"dispScl\":";    j += cfg.dispScl;            j += ",";
    j += "\"dispRot\":";    j += cfg.dispRot;            j += ",";
    j += "\"dispCs\":";     j += cfg.dispCs;             j += ",";
    j += "\"dispDc\":";     j += cfg.dispDc;             j += ",";
    j += "\"dispRst\":";    j += cfg.dispRst;            j += ",";
    j += "\"dispSck\":";    j += cfg.dispSck;            j += ",";
    j += "\"dispMosi\":";   j += cfg.dispMosi;           j += ",";
    j += "\"ethCs\":";      j += cfg.ethCs;              j += ",";
    j += "\"ethSck\":";     j += cfg.ethSck;             j += ",";
    j += "\"ethMosi\":";    j += cfg.ethMosi;            j += ",";
    j += "\"ethMiso\":";    j += cfg.ethMiso;            j += ",";
    j += "\"ethInt\":";     j += cfg.ethInt;             j += ",";
    j += "\"ethRst\":";     j += cfg.ethRst;             j += ",";
    j += "\"ethFreq\":";    j += cfg.ethFreqMhz;         j += ",";
#if defined(HAS_ETH_SPI)
    j += "\"ethSpi\":true,";    // W5500 SPI compiled in → UI shows the W5500 pin card
#else
    j += "\"ethSpi\":false,";
#endif
#if defined(HAS_ETH_RMII)
    j += "\"ethRmii\":true,";   // internal-MAC RMII compiled in (classic ESP32) → offer the PHY selector
    j += "\"rmiiPhy\":";   j += cfg.rmiiPhy;            j += ",";   // RMII PHY family index (RMII_PHY_*)
    j += "\"rmiiAddr\":";  j += cfg.rmiiAddr;           j += ",";
    j += "\"rmiiMdc\":";   j += cfg.rmiiMdc;            j += ",";
    j += "\"rmiiMdio\":";  j += cfg.rmiiMdio;           j += ",";
    j += "\"rmiiPwr\":";   j += cfg.rmiiPwr;            j += ",";
    j += "\"rmiiClk\":";   j += cfg.rmiiClk;            j += ",";   // REF_CLK mode (RMII_CLK_*)
#else
    j += "\"ethRmii\":false,";
#endif
    j += "\"wiredPhy\":";  j += cfg.wiredPhy;            j += ",";   // 0=W5500, 1=LAN8720 RMII
    j += "\"ethW5500\":";  j += cfg.ethW5500 ? "true" : "false"; j += ",";   // module enabled (opt-in)
    j += "\"useEthernet\":"; j += cfg.useEthernet ? "true" : "false"; j += ",";
#if defined(HAS_WIRED_ETH)
    j += "\"hasEth\":true,";   // board has wired Ethernet → show the WiFi/Ethernet selector
#else
    j += "\"hasEth\":false,";
#endif
    j += "\"wifiMode\":";   j += cfg.wifiMode;           j += ",";
    j += "\"apFallback\":"; j += cfg.apFallback ? "true" : "false"; j += ",";
    j += "\"linkLossMode\":"; j += cfg.linkLossMode;          j += ",";   // WIRED_FB_*
    j += "\"apPassword\":\""; j += cfg.apPassword;       j += "\",";
    j += "\"staticIp\":";   j += cfg.staticIp ? "true" : "false"; j += ",";
    j += "\"sip\":\"";      j += cfg.ip;                 j += "\",";
    j += "\"gateway\":\"";  j += cfg.gateway;            j += "\",";
    j += "\"subnet\":\"";   j += cfg.subnet;             j += "\",";
    j += "\"dns\":\"";      j += cfg.dns;                j += "\",";
    j += "\"autoUpdate\":"; j += cfg.autoUpdate ? "true" : "false"; j += ",";
    j += "\"board\":\"";    j += BOARD_ID;               j += "\",";
    j += "\"mcu\":\"";      j += MCU_ID;                 j += "\"";
    j += "}";
    req->send(200, "application/json", j);
}

static void handleDmxJson(AsyncWebServerRequest* req) {
    String j;
    j.reserve(2300);
    char buf[32];
    snprintf(buf, sizeof(buf), "%.1f", fps);
    j  = "{\"fps\":";    j += buf;
    j += ",\"outfps\":[";
    for (int i = 0; i < MAX_OUTPUTS; i++) {
        snprintf(buf, sizeof(buf), "%.1f", outFpsLive(i));
        if (i) j += ',';
        j += buf;
    }
    j += "]";
    j += ",\"rssi\":";   j += netRSSI();
    j += ",\"up\":\"";   j += uptimeStr();
    j += "\",\"heap\":"; j += ESP.getFreeHeap();
    j += ",\"manual\":"; j += manualMode ? "true" : "false";
    j += ",\"ch\":[";
    for (int i = 1; i <= 512; i++) {
        j += dmxBuf[viewOutput()][i];
        if (i < 512) j += ',';
    }
    j += "]}";
    req->send(200, "application/json", j);
}

// Escape a fixture-supplied string for safe inclusion in JSON.
static String rdmJsonEsc(const char* s) {
    String o;
    for (const char* p = s; *p; p++) {
        char c = *p;
        if (c == '"' || c == '\\') { o += '\\'; o += c; }
        else if ((uint8_t)c >= 0x20)  o += c;
    }
    return o;
}

static void handleRdmJson(AsyncWebServerRequest* req) {
    String j;
    j.reserve(96 + rdmCount * 280);
    j  = "{\"available\":"; j += rdmAvailable() ? "true" : "false";
    j += ",\"busy\":";      j += rdmBusy ? "true" : "false";
    j += ",\"scanned\":";   j += rdmScanned ? "true" : "false";
    j += ",\"devices\":[";
    for (int i = 0; i < rdmCount; i++) {
        const RdmDevice& d = rdmDevices[i];
        char uid[20];
        snprintf(uid, sizeof(uid), "%04X:%08lX", d.uid.man_id, (unsigned long)d.uid.dev_id);
        if (i) j += ',';
        j += "{\"uid\":\"";     j += uid;          j += "\"";
        j += ",\"addr\":";      j += d.startAddr;
        j += ",\"footprint\":"; j += d.footprint;
        j += ",\"model\":";     j += d.modelId;
        j += ",\"pers\":";      j += d.personality;
        j += ",\"persCount\":"; j += d.personalityCount;
        j += ",\"subs\":";      j += d.subDeviceCount;
        j += ",\"identify\":";  j += d.identifying ? "true" : "false";
        j += ",\"sw\":\"";      j += rdmJsonEsc(d.swLabel); j += "\"";
        j += ",\"sensors\":[";
        bool firstSen = true;
        for (int s = 0; s < d.sensorCount; s++) {
            const RdmSensor& sn = d.sensors[s];
            if (!sn.valid) continue;
            if (!firstSen) j += ',';
            firstSen = false;
            j += "{\"name\":\"";  j += rdmJsonEsc(sn.name);
            j += "\",\"value\":"; j += sn.value;
            j += ",\"unit\":\"";  j += rdmJsonEsc(sn.unit); j += "\"}";
        }
        j += "]}";
    }
    j += "]}";
    req->send(200, "application/json", j);
}

static void handleConfigGet(AsyncWebServerRequest* req) {
    AsyncWebServerResponse* r = req->beginResponse_P(200, "text/html", CONFIG_HTML, CONFIG_HTML_LEN);
    r->addHeader("Content-Encoding", "gzip");
    r->addHeader("Cache-Control", "no-cache");   // revalidate after OTA (assets stay versioned)
    req->send(r);
}

// A web-form checkbox is "on" iff its param is present (value ignored), matching
// the old hasParam() handling for every bool field.
static bool formChecked(AsyncWebServerRequest* req, const String& name) {
    return req->hasParam(name, true) || req->hasParam(name);
}

static void handleConfigPost(AsyncWebServerRequest* req) {
    String s, e;
    // Drive every field from the schema (config_schema.cpp), preserving the old
    // web-form semantics exactly: a bool/checkbox is set from presence; an int /
    // enum / string is updated only when its param is present (and clamped to the
    // schema range inside setValue); hostname/otapw (CFG_KEEPNE) ignore a blank
    // field so they can't be wiped; CFG_NOWEB fields (autoUpdate) have their own
    // route and are skipped here.
    for (size_t k = 0; k < CONFIG_FIELD_COUNT; k++) {
        const CfgField& f = CONFIG_FIELDS[k];
        if (f.flags & CFG_NOWEB) continue;
        if (f.kind == CfgKind::Bool) {
            cfgcore::setValue(f.key, formChecked(req, f.key) ? "1" : "0", e);
        } else if (argStr(req, f.key, s)) {
            if ((f.flags & CFG_KEEPNE) && s.length() == 0) continue;
            cfgcore::setValue(f.key, s, e);
        }
    }
    for (int i = 0; i < MAX_OUTPUTS; i++)
        for (size_t k = 0; k < OUTPUT_FIELD_COUNT; k++) {
            const CfgOutputField& f = OUTPUT_FIELDS[k];
            String key = okey(i, f.suffix);
            if (f.kind == CfgKind::Bool)
                cfgcore::setValue(key, formChecked(req, key) ? "1" : "0", e);
            else if (argStr(req, key.c_str(), s))
                cfgcore::setValue(key, s, e);
        }
    cfg.apFallback = (cfg.linkLossMode == WIRED_FB_AP);   // keep the legacy mirror in sync
    sanitizeOutputs();   // never persist an enabled output with no TX pin
    dmxReady = false;
    saveConfig();
    req->send_P(200, "text/html", CONFIG_SAVED_HTML);
    pendingRebootAt = millis() + 600;
}

// ---------------------------------------------------------------------------
// Channel labels — browser owns the JSON object, device just persists it
// ---------------------------------------------------------------------------
static void handleLabelsGet(AsyncWebServerRequest* req) {
    req->send(200, "application/json", g_labels);
}

// Body handler for POST /labels (raw JSON). Accumulates chunks then persists.
static void handleLabelsBody(AsyncWebServerRequest* req, uint8_t* data, size_t len,
                             size_t index, size_t total) {
    static String buf;
    if (index == 0) { buf = ""; buf.reserve(total + 1); }
    if (total <= LABELS_MAX) buf.concat((const char*)data, len);
    if (index + len != total) return;   // wait for the full body
    if (buf.length() == 0 || buf.length() > LABELS_MAX || buf[0] != '{') {
        req->send(400, "text/plain", "Invalid labels payload");
        buf = "";
        return;
    }
    g_labels = buf;
    buf = "";
    prefs.begin(PREF_NS, false);
    prefs.putString("labels", g_labels);
    prefs.end();
    req->send(200, "application/json", "{\"ok\":true}");
}

static void handleAutoUpdatePost(AsyncWebServerRequest* req) {
    String s;
    cfg.autoUpdate = argStr(req, "enabled", s) && s == "1";
    saveConfig();
    req->send(200, "application/json",
        String("{\"autoUpdate\":") + (cfg.autoUpdate ? "true" : "false") + "}");
}

static void handleResetGet(AsyncWebServerRequest* req)  {
    AsyncWebServerResponse* r = req->beginResponse_P(200, "text/html", RESET_HTML);
    r->addHeader("Cache-Control", "no-cache");   // revalidate after OTA (assets stay versioned)
    req->send(r);
}

static void handleResetPost(AsyncWebServerRequest* req) {
    req->send_P(200, "text/html", RESET_DONE_HTML);
    // Also drop static IP so recovery always comes back up on DHCP
    cfg.staticIp = false;
    saveConfig();
    pendingWifiReset = true;
    pendingRebootAt  = millis() + 600;
}

static void handleLogo(AsyncWebServerRequest* req) {
    AsyncWebServerResponse* r = req->beginResponse_P(200, "image/png", LOGO_PNG, LOGO_PNG_LEN);
    r->addHeader("Cache-Control", "max-age=86400");
    req->send(r);
}

static void handleFavicon(AsyncWebServerRequest* req) {
    AsyncWebServerResponse* r = req->beginResponse_P(200, "image/png", FAVICON_PNG, FAVICON_PNG_LEN);
    r->addHeader("Cache-Control", "max-age=604800");
    req->send(r);
}

static void handleBootstrapCss(AsyncWebServerRequest* req) {
    AsyncWebServerResponse* r = req->beginResponse_P(200, "text/css", BOOTSTRAP_MIN_CSS, BOOTSTRAP_MIN_CSS_LEN);
    r->addHeader("Content-Encoding", "gzip");
    r->addHeader("Cache-Control", "max-age=604800");
    req->send(r);
}

// ---------------------------------------------------------------------------
// Version check (FreeRTOS task, runs once 8s after boot)
// ---------------------------------------------------------------------------
static int parseBuild(const String& v) {
    int dot = v.lastIndexOf('.');
    return dot >= 0 ? v.substring(dot + 1).toInt() : 0;
}

static bool httpsGet(const char* url, String& out, size_t maxLen) {
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient h;
    h.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
    if (!h.begin(client, url)) return false;
    bool ok = false;
    if (h.GET() == 200) {
        String s = h.getString();
        s.trim();
        if (s.length() > 0 && s.length() <= maxLen) { out = s; ok = true; }
    }
    h.end();
    return ok;
}

static void checkForUpdate() {
    String v;
    if (!httpsGet("https://luxdmx.org/firmware/version", v, 24)) return;
    latestVersion   = v;
    updateAvailable = parseBuild(v) > parseBuild(String(FIRMWARE_VERSION));
    Serial.printf("[VER] latest=%s current=%s update=%s\n",
        v.c_str(), FIRMWARE_VERSION, updateAvailable ? "yes" : "no");
}

static void versionCheckTask(void*) {
    vTaskDelay(pdMS_TO_TICKS(8000));
    for (;;) {
        checkForUpdate();
        if (cfg.autoUpdate && updateAvailable) {
            Serial.println("[OTA] auto-update enabled, installing latest...");
            otaTarget = "latest";
            pendingGithubOta = true;   // loop() performs the update
        }
        vTaskDelay(pdMS_TO_TICKS(6UL * 3600UL * 1000UL));  // re-check every 6 h
    }
}

// ---------------------------------------------------------------------------
// OTA handlers
// ---------------------------------------------------------------------------
// Firmware asset name for this build target
#if defined(USE_ETH_RMII)
#define OTA_BIN "firmware-wt32eth01.bin"
#elif defined(CONFIG_IDF_TARGET_ESP32S3)
#define OTA_BIN "firmware-esp32s3.bin"
#else
#define OTA_BIN "firmware.bin"
#endif

static void doGithubOta() {
    // luxdmx.org/firmware/ota/<target>/<file> 301-redirects to the matching GitHub
    // release asset (releases/download/<target>/<file>) -- target is "latest" or a
    // "vX.Y.Z" tag, so per-version OTA / downgrade still works through the redirect.
    String otaUrl = String("https://luxdmx.org/firmware/ota/") + otaTarget + "/" + OTA_BIN;
    Serial.printf("[OTA] Starting update from %s\n", otaUrl.c_str());
    dmxReady = false;
    // Drive /ota/status so the update page can show real progress. The ESP streams
    // the HTTP body straight into flash (download and write happen together), so
    // phase 1 covers both; phase 2 is the final verify/commit before the reboot.
    otaProgPhase = 1; otaProgPct = 0;
    httpUpdate.onProgress([](int cur, int total) {
        otaProgPct = (total > 0) ? (uint8_t)((uint32_t)cur * 100 / total) : 0;
    });
    httpUpdate.onEnd([]()      { otaProgPhase = 2; otaProgPct = 100; });
    httpUpdate.onError([](int) { otaProgPhase = 3; });
    WiFiClientSecure client;
    client.setInsecure();
    httpUpdate.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
    httpUpdate.rebootOnUpdate(true);
    httpUpdate.update(client, otaUrl);
    // Only reaches here on failure (success reboots inside update()).
    otaProgPhase = 3;
    Serial.printf("[OTA] Failed (%d): %s\n",
        httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
    dmxReady = true;
    delay(2000);
    ESP.restart();
}

static void handleOtaGithub(AsyncWebServerRequest* req) {
    // Optional version=1.0.N (POST/query) selects a specific release; default latest
    String v;
    argStr(req, "version", v);
    v.trim();
    if (v.length() == 0 || v == "latest") {
        otaTarget = "latest";
    } else {
        if (v[0] == 'v' || v[0] == 'V') v = v.substring(1);
        otaTarget = "v" + v;
    }
    Serial.printf("[OTA] Target requested: %s\n", otaTarget.c_str());
    otaProgPhase = 0; otaProgPct = 0;   // reset for this run; loop() fills it in
    req->send_P(200, "text/html", OTA_PROGRESS_HTML);
    pendingGithubOta = true;
}

// Live OTA progress for the update page. Stays reachable during the install
// because AsyncTCP runs on its own task while httpUpdate blocks loop().
static void handleOtaStatus(AsyncWebServerRequest* req) {
    char buf[48];
    snprintf(buf, sizeof(buf), "{\"phase\":%u,\"pct\":%u}",
             (unsigned)otaProgPhase, (unsigned)otaProgPct);
    AsyncWebServerResponse* r = req->beginResponse(200, "application/json", buf);
    r->addHeader("Cache-Control", "no-store");
    req->send(r);
}

static void handleOtaUploadDone(AsyncWebServerRequest* req) {
    bool ok = !Update.hasError();
    String p = FPSTR(OTA_DONE_HTML);
    p.replace("{{OTA_ICON}}",  ok ? "&#10003;" : "&#10007;");
    p.replace("{{OTA_CLASS}}", ok ? "text-success" : "text-danger");
    p.replace("{{OTA_TITLE}}", ok ? "Firmware updated" : "Update failed");
    p.replace("{{OTA_MSG}}",   ok ? "Rebooting&hellip;" :
                                    String("Error: ") + Update.errorString());
    req->send(200, "text/html", p);
    if (ok) pendingRebootAt = millis() + 800;
}

static void handleOtaUploadChunk(AsyncWebServerRequest* req, const String& filename,
                                 size_t index, uint8_t* data, size_t len, bool final) {
    if (index == 0) {
        Serial.printf("[OTA] Upload: %s\n", filename.c_str());
        dmxReady = false;
        Update.begin(UPDATE_SIZE_UNKNOWN);
    }
    if (len) Update.write(data, len);
    if (final) {
        Update.end(true);
        Serial.printf("[OTA] Upload done: %u bytes\n", (unsigned)(index + len));
    }
}

// ---------------------------------------------------------------------------
// WiFiManager (STA config portal)
// ---------------------------------------------------------------------------
static bool wm_shouldSave = false;
static char wm_universeStr[4] = "0";
static void wmSaveCallback() { wm_shouldSave = true; }

static void startWiFiManager(bool forcePortal) {
    WiFiManager wm;
    wm.setSaveConfigCallback(wmSaveCallback);
    wm.setAPCallback([](WiFiManager*) { setLedColor(NEO_PURPLE, true); }); // portal open
    wm.setConnectTimeout(60);
    wm.setConfigPortalTimeout(180);
    if (cfg.staticIp) {
        IPAddress ip, gw, sn, dns;
        parseIp(cfg.ip, ip); parseIp(cfg.gateway, gw);
        parseIp(cfg.subnet, sn); parseIp(cfg.dns, dns);
        wm.setSTAStaticIPConfig(ip, gw, sn, dns);
        Serial.printf("[WiFi] static IP %s\n", cfg.ip.c_str());
    }
    snprintf(wm_universeStr, sizeof(wm_universeStr), "%d", cfg.outputs[0].universe);
    WiFiManagerParameter param_universe("universe", "Art-Net Universe (0-15)", wm_universeStr, 3);
    wm.addParameter(&param_universe);
    // Run the captive portal NON-blocking so the serial config console stays alive
    // while it's up: a fresh / stuck board (no WiFi yet) can then be recovered over
    // USB with `wifi <ssid> <pass>`, the whole point of the serial console. The
    // saved-credential connect attempt inside autoConnect still blocks briefly (up
    // to setConnectTimeout), which is fine; only the open portal becomes non-blocking.
    wm.setConfigPortalBlocking(false);
    bool connected = forcePortal ? wm.startConfigPortal(AP_SSID)
                                 : wm.autoConnect(AP_SSID);
    if (!connected) {
        // Portal is up (or no creds): pump it + the serial console until the user
        // configures WiFi (via the portal page OR `wifi` over serial) or it times out.
        uint32_t start = millis();
        while (!WiFi.isConnected() && millis() - start < 180000) {
            wm.process();
            cfgserial::poll();
            delay(5);
        }
        connected = WiFi.isConnected();
    }
    if (!connected) ESP.restart();
    if (wm_shouldSave) {
        cfg.outputs[0].universe = constrain(atoi(param_universe.getValue()), 0, 15);
        saveConfig();
        // The captive-portal ran its own web server on port 80; it may not
        // release the socket cleanly, which would stop our AsyncWebServer from
        // binding (HTTP "connection refused" until reboot). Reboot for a clean
        // start where auto-connect succeeds and the portal never runs.
        Serial.println("[WiFi] credentials saved — rebooting for a clean start");
        delay(400);
        ESP.restart();
    }
}

// Scan every AP for our SSID, log them, and (re)connect to the strongest one.
// On mesh/multi-AP networks the ESP32's auto-connect often sticks to a distant
// node; this guarantees the closest one. Also a diagnostic: the [SCAN] log
// reveals whether the SSID has multiple BSSIDs (per-node) or a single shared
// BSSID (seamless mesh — in which case the AP, not us, chooses the node).
static void connectStrongestAP() {
    String ssid = WiFi.SSID();
    if (ssid.length() == 0) return;
    String pass = WiFi.psk();
    int curRssi = (int)WiFi.RSSI();

    int n = WiFi.scanNetworks(false /*async*/, true /*hidden*/);
    int bestIdx = -1, bestRssi = -999, bestCh = 0, matches = 0;
    uint8_t bestBssid[6] = {0};
    Serial.printf("[SCAN] %d networks total. APs for '%s':\n", n, ssid.c_str());
    for (int i = 0; i < n; i++) {
        if (WiFi.SSID(i) != ssid) continue;
        matches++;
        Serial.printf("   bssid=%s rssi=%d ch=%d\n",
            WiFi.BSSIDstr(i).c_str(), WiFi.RSSI(i), WiFi.channel(i));
        if (WiFi.RSSI(i) > bestRssi) {
            bestRssi = WiFi.RSSI(i); bestIdx = i; bestCh = WiFi.channel(i);
            memcpy(bestBssid, WiFi.BSSID(i), 6);
        }
    }
    Serial.printf("[SCAN] %d AP(s) for SSID, current rssi=%d, best rssi=%d\n",
        matches, curRssi, bestRssi);
    WiFi.scanDelete();

    // Only switch if a meaningfully stronger distinct AP exists
    if (bestIdx >= 0 && bestRssi > curRssi + 6) {
        Serial.printf("[SCAN] switching to stronger AP (rssi %d -> %d)\n", curRssi, bestRssi);
        WiFi.begin(ssid.c_str(), pass.c_str(), bestCh, bestBssid, true);
        uint32_t t = millis();
        while (WiFi.status() != WL_CONNECTED && millis() - t < 12000) {
            setLedColor((millis() % 400) < 200 ? NEO_BLUE : NEO_OFF, (millis() % 400) < 200);
            delay(100);
        }
        Serial.printf("[SCAN] reconnected rssi=%d bssid=%s\n",
            (int)WiFi.RSSI(), WiFi.BSSIDstr().c_str());
    }
}

// ---------------------------------------------------------------------------
// Peripheral init
// ---------------------------------------------------------------------------
static void initDmx() {
    dmxReady = false;
    rdmOut   = -1;
    monitorOut = 0;
    bool firstEnabled = true;
    for (int i = 0; i < MAX_OUTPUTS; i++) {
        outReady[i] = false;
        if (!cfg.outputs[i].enabled) continue;

        // A DMX output must have a real TX GPIO. esp_dmx treats tx=-1 as
        // "no change", so installing a driver with no TX pin half-configures
        // the UART and crashes on the first send — a boot loop. Skip it.
        if (cfg.outputs[i].txPin < 0) {
            Serial.printf("[DMX] out%d skipped: enabled but no TX pin (tx=%d)\n",
                          i, cfg.outputs[i].txPin);
            continue;
        }

        // Two outputs cannot share a UART port; skip the colliding one.
        bool dup = false;
        for (int j = 0; j < i; j++)
            if (outReady[j] && cfg.outputs[j].port == cfg.outputs[i].port) dup = true;
        if (dup) {
            Serial.printf("[DMX] out%d skipped: port %d already in use\n", i, cfg.outputs[i].port);
            continue;
        }

        dmx_port_t port = (dmx_port_t)cfg.outputs[i].port;
        dmx_config_t config = DMX_CONFIG_DEFAULT;
        dmx_driver_install(port, &config, nullptr, 0);
        dmx_set_pin(port, cfg.outputs[i].txPin, cfg.outputs[i].rxPin, cfg.outputs[i].rtsPin);
        dmx_write(port, dmxBuf[i], DMX_PACKET_SIZE);
        dmx_send(port);
        dmx_wait_sent(port, DMX_TIMEOUT_TICK);
        outReady[i] = true;
        dmxReady    = true;
        if (firstEnabled) { monitorOut = i; firstEnabled = false; }
        // RDM binds to the first enabled output with a direction-enable pin.
        if (rdmOut < 0 && cfg.outputs[i].rtsPin >= 0) rdmOut = i;
        Serial.printf("[DMX] out%d ready: uni=%d port=%d tx=%d rx=%d rts=%d\n",
            i, cfg.outputs[i].universe, cfg.outputs[i].port,
            cfg.outputs[i].txPin, cfg.outputs[i].rxPin, cfg.outputs[i].rtsPin);
    }
    if (!dmxReady) Serial.println("[DMX] no outputs enabled");
    else Serial.printf("[DMX] ready (monitor=out%d rdm=out%d)\n", monitorOut, rdmOut);
}

// ---------------------------------------------------------------------------
// Safe-boot guard around DMX init
// A bad port/pin can make esp_dmx panic *inside* driver install — an
// uncatchable CPU exception that would otherwise boot-loop forever. We persist
// a crash counter before touching the UART and clear it only after init
// returns. If a previous boot died mid-init the counter survives the reboot, so
// we progressively disable outputs until the device always reaches the web UI:
//   >=2 consecutive  -> disable the extra output(s), keep output A
//   >=4 consecutive  -> disable all DMX outputs
// A single transient crash is tolerated (counter clears on the next good boot).
// ---------------------------------------------------------------------------
static void dmxInitGuardBegin() {
    prefs.begin(PREF_NS, false);
    int crashes = prefs.getInt("dmxcrash", 0);
    prefs.putInt("dmxcrash", crashes + 1);   // committed before the UART is touched
    prefs.end();
    if (crashes >= 4) {
        for (int i = 0; i < MAX_OUTPUTS; i++) cfg.outputs[i].enabled = false;
        Serial.printf("[SAFE] %d DMX-init crashes — all outputs disabled\n", crashes);
        saveConfig();
    } else if (crashes >= 2) {
        for (int i = 1; i < MAX_OUTPUTS; i++) cfg.outputs[i].enabled = false;
        Serial.printf("[SAFE] %d DMX-init crashes — extra outputs disabled, keeping output A\n", crashes);
        saveConfig();
    }
}
static void dmxInitGuardEnd() {
    prefs.begin(PREF_NS, false);
    prefs.putInt("dmxcrash", 0);             // init survived — clear the counter
    prefs.end();
}

static void initOTA() {
    ArduinoOTA.setHostname(cfg.hostname.c_str());
    ArduinoOTA.setPassword(cfg.otaPassword.c_str());
    ArduinoOTA.onStart([]() { dmxReady = false; Serial.println("[OTA] start"); });
    ArduinoOTA.onEnd([]()   { Serial.println("[OTA] done"); });
    ArduinoOTA.onError([](ota_error_t e) { dmxReady = true; Serial.printf("[OTA] error[%u]\n", e); });
    ArduinoOTA.begin();
    Serial.printf("[OTA] %s.local pw:%s\n", cfg.hostname.c_str(), cfg.otaPassword.c_str());
}

// ---------------------------------------------------------------------------
// Status LED task
// LED runs independently of loop() so network blocking (serving the web UI)
// never freezes it. Very light (one pixel update every 50 ms) so it doesn't
// compete with loop() for CPU. DMX output stays in loop()/callbacks.
// ---------------------------------------------------------------------------
static void ledTask(void*) {
    const TickType_t period = pdMS_TO_TICKS(50);
    for (;;) {
        uint32_t now = millis();
        if (cfg.ledType == 3) {
            // 5-LED panel: each LED shows its own state simultaneously.
            //   R = no network (blink)        G = network up (solid)
            //   Y = DMX activity (fast blink) B = source conflict (slow blink)
            //   W = identify active (blink)
            bool up       = netConnected();
            bool dmx      = (now - lastDmxMs) < 1500;
            bool r = !up && ((now % 1000) < 500);
            bool g = up;
            bool y = up && dmx && ((now % 250) < 125);
            uint8_t ss = g_srcStatus;
            bool b = (ss == SRC_CONFLICT) ? ((now % 600) < 300)   // conflict: slow blink
                   : (ss == SRC_MERGING);                          // merging: steady on
            bool w = identifyCh && ((now % 400) < 200);
            setLeds5(r, g, y, b, w);
        } else if (!netConnected()) {
            setLedColor((now % 1000) < 120 ? NEO_RED : NEO_OFF, (now % 1000) < 120);
        } else if (now - lastDmxMs < 1500) {
            // Hold "active" green through brief input gaps (lost multicast)
            setLedColor(NEO_GREEN, true);
        } else {
            setLedColor((now % 1000) < 500 ? NEO_AMBER : NEO_OFF, (now % 1000) < 500);
        }
        vTaskDelay(period);
    }
}

// ---------------------------------------------------------------------------
// Status display rendering — own task, reads state only (like ledTask).
// Resting status screen + auto-rotate alert banners (conflict/identify/manual).
// ---------------------------------------------------------------------------
// RGB565 palette — the same status language as the WS2812 LED. col() collapses
// any non-black colour to "on" (==1) for the 1-bit mono panels.
static constexpr uint16_t C_WHITE = 0xFFFF, C_GREEN = 0x07E0, C_AMBER = 0xFD20,
                          C_RED   = 0xF800, C_BLUE  = 0x349F, C_GREY  = 0x8410;
static inline uint16_t col(uint16_t rgb) { return cfg.dispType == 4 ? rgb : (rgb ? 1 : 0); }

static const char* dispProto() {
    return cfg.protocol == 0 ? "Art-Net" : cfg.protocol == 1 ? "sACN" : "Both";
}

// Compact universe label for the status display: "0" for a single output, "0+5"
// when both outputs are enabled (each output carries its own universe). Falls
// back to output 0's universe if nothing is enabled yet. Single static buffer is
// safe: the display task is the only caller.
static const char* dispUniverseLabel() {
    static char buf[16];
    buf[0] = '\0';
    bool any = false;
    for (int i = 0; i < MAX_OUTPUTS; i++) {
        if (!cfg.outputs[i].enabled) continue;
        char part[8];
        snprintf(part, sizeof(part), "%s%d", any ? "+" : "", cfg.outputs[i].universe);
        strncat(buf, part, sizeof(buf) - strlen(buf) - 1);
        any = true;
    }
    if (!any) snprintf(buf, sizeof(buf), "%d", cfg.outputs[0].universe);
    return buf;
}

static int dispEnabledOutputs() {
    int n = 0;
    for (int i = 0; i < MAX_OUTPUTS; i++) if (cfg.outputs[i].enabled) n++;
    return n;
}

// Print s at text size ts, horizontally centred, top at y (built-in 6x8 font).
static void dispCenter(const char* s, int ts, int y) {
    int w = (int)strlen(s) * 6 * ts;
    int x = (gfx->width() - w) / 2; if (x < 0) x = 0;
    gfx->setTextSize(ts);
    gfx->setCursor(x, y);
    gfx->print(s);
}

// Compact link-status label for the status display: wired up/down, WiFi RSSI, or
// the AP SSID. Empty when WiFi is down (the "no link" line already covers that).
static void netStatusLabel(char* buf, size_t n, bool up) {
    if (g_useEth)      snprintf(buf, n, "%s", up ? "ETH up" : "ETH down");
    else if (g_apMode) snprintf(buf, n, "AP %s", WiFi.softAPSSID().c_str());
    else if (up)       snprintf(buf, n, "WiFi %ddBm", netRSSI());
    else               buf[0] = '\0';
}

static void dispDrawStatus() {
    const int W = gfx->width(), H = gfx->height();
    const bool live = (millis() - lastDmxMs) < 1500;
    const bool up   = netConnected();
    const bool dual = dispEnabledOutputs() >= 2;   // show a frame rate per universe
    const uint16_t accent = !up ? C_RED : (live ? C_GREEN : C_AMBER);
    char b[40];

    gfx->fillScreen(0);
    gfx->setTextSize(1);

    if (H <= 32) {                       // compact 3-row strip (128x32)
        gfx->setTextColor(col(C_WHITE));
        gfx->setCursor(0, 0);  gfx->print(up ? netLocalIP().toString() : String("no link"));
        gfx->setTextColor(col(accent));
        gfx->setCursor(W - 24, 0); gfx->print(live ? "LIVE" : "idle");
        gfx->setTextColor(col(C_WHITE));
        gfx->setCursor(0, 11); gfx->print('U'); gfx->print(dispUniverseLabel());
        gfx->print(' '); gfx->print(dispProto());
        if (dual)
            snprintf(b, sizeof(b), "%.1f/%.1f Sources %u",
                     outFpsLive(0), outFpsLive(1), activeSenderCount());
        else
            snprintf(b, sizeof(b), "%.1ffps Sources %u", fps, activeSenderCount());
        gfx->setCursor(0, 22); gfx->print(b);
        return;
    }

    if (H >= 96) {                       // tall colour panel (SSD1351 128x128)
        char b[24];
        gfx->setTextSize(2); gfx->setTextColor(col(accent));
        gfx->setCursor(0, 0);  gfx->print("LuxDMX");
        gfx->setTextSize(1); gfx->setTextColor(col(C_GREY));
        gfx->setCursor(0, 18); gfx->print('v'); gfx->print(FIRMWARE_VERSION);
        gfx->setTextColor(col(C_WHITE));
        gfx->setCursor(0, 30); gfx->print(up ? netLocalIP().toString() : String("no link"));
        gfx->drawFastHLine(0, 42, W, col(C_GREY));
        if (dual) {                          // one rate per universe
            gfx->setTextColor(col(C_WHITE));
            snprintf(b, sizeof(b), "A Uni %d", cfg.outputs[0].universe);
            gfx->setCursor(0, 50); gfx->print(b);
            snprintf(b, sizeof(b), "%.1f fps", outFpsLive(0));
            gfx->setTextColor(col(accent)); gfx->setCursor(0, 62); gfx->print(b);
            gfx->setTextColor(col(C_WHITE));
            snprintf(b, sizeof(b), "B Uni %d", cfg.outputs[1].universe);
            gfx->setCursor(0, 78); gfx->print(b);
            snprintf(b, sizeof(b), "%.1f fps", outFpsLive(1));
            gfx->setTextColor(col(accent)); gfx->setCursor(0, 90); gfx->print(b);
            gfx->setTextColor(col(C_GREY));
            gfx->setCursor(0, 102); gfx->print(dispProto());
            gfx->print("  Sources "); gfx->print(activeSenderCount());
        } else {
            gfx->setTextColor(col(C_GREY)); gfx->setCursor(0, 48); gfx->print("FPS");
            snprintf(b, sizeof(b), "%.1f", fps);
            gfx->setTextSize(3); gfx->setTextColor(col(accent));
            gfx->setCursor(0, 58); gfx->print(b);
            gfx->setTextSize(1); gfx->setTextColor(col(C_WHITE));
            gfx->setCursor(0, 88);  gfx->print("Uni "); gfx->print(dispUniverseLabel());
            gfx->print("  "); gfx->print(dispProto());
            gfx->setCursor(0, 100); gfx->print("Sources "); gfx->print(activeSenderCount());
        }
        gfx->setCursor(0, 114);
        netStatusLabel(b, sizeof(b), up);
        gfx->print(b);
        gfx->setTextColor(col(accent));
        const char* st2 = live ? "LIVE" : "idle";
        gfx->setCursor(W - (int)strlen(st2) * 6, 114); gfx->print(st2);
        return;
    }

    // Full layout (128x64) — rows spread to fill the height; size-1 fits 128 wide.
    int rp = (H - 8) / 5; if (rp > 20) rp = 20;
    int y = 0;
    gfx->setTextColor(col(accent));      // title lands in the yellow band on split panels
    gfx->setCursor(0, y); gfx->print("LuxDMX");
    { const char* v = FIRMWARE_VERSION; int vw = (int)strlen(v) * 6;
      gfx->setTextColor(col(C_GREY)); gfx->setCursor(W - vw, y); gfx->print(v); }
    // Dual-colour 128x64 OLEDs are yellow rows 0-15 + a ~2px gap + blue rows 16-63.
    // Keep the title alone in the yellow band and start the body at the seam, so no
    // line (especially the IP) is sliced across the colour boundary (issue #16).
    y = 16;
    gfx->setTextColor(col(C_WHITE));
    gfx->setCursor(0, y); gfx->print(up ? netLocalIP().toString() : String("no link"));
    y += rp;
    if (dual) {                          // one row per output: universe + its fps
        snprintf(b, sizeof(b), "A U%d %.1ffps", cfg.outputs[0].universe, outFpsLive(0));
        gfx->setCursor(0, y); gfx->print(b);
        y += rp;
        snprintf(b, sizeof(b), "B U%d %.1ffps", cfg.outputs[1].universe, outFpsLive(1));
        gfx->setCursor(0, y); gfx->print(b);
        { char s[12]; snprintf(s, sizeof(s), "Src %u", activeSenderCount());
          gfx->setCursor(W - (int)strlen(s) * 6, y); gfx->print(s); }
        y += rp;
    } else {
        gfx->setCursor(0, y); gfx->print("Uni "); gfx->print(dispUniverseLabel());
        gfx->print("  "); gfx->print(dispProto());
        y += rp;
        snprintf(b, sizeof(b), "FPS %.1f  Sources %u", fps, activeSenderCount());
        gfx->setCursor(0, y); gfx->print(b);
        y += rp;
    }
    netStatusLabel(b, sizeof(b), up);
    gfx->setCursor(0, y); gfx->print(b);
    gfx->setTextColor(col(accent));
    const char* st = live ? "LIVE" : "idle";
    gfx->setCursor(W - (int)strlen(st) * 6, y); gfx->print(st);
}

static void dispDrawBanner(const char* l1, const char* l2, uint16_t accent) {
    const int H = gfx->height();
    const int ts = (H >= 64) ? 2 : 1;
    gfx->fillScreen(0);
    gfx->setTextColor(col(accent));
    dispCenter(l1, ts, H >= 64 ? H / 2 - 8 * ts : 0);
    gfx->setTextColor(col(C_WHITE));
    dispCenter(l2, 1, H >= 64 ? H / 2 + 4 : 16);
}

// Priority: 1=conflict, 2=identify, 3=manual, 4=merging, 0=status.
static uint8_t dispPickScreen() {
    if (g_srcStatus == SRC_CONFLICT) return 1;
    if (identifyCh)                  return 2;
    if (manualMode)                  return 3;
    if (g_srcStatus == SRC_MERGING)  return 4;
    return 0;
}

static void dispRender(uint8_t screen) {
    char b[16];
    switch (screen) {
        case 1: dispDrawBanner("CONFLICT", "2+ sources", C_RED); break;
        case 2: snprintf(b, sizeof(b), "ch %u", identifyCh);
                dispDrawBanner("IDENTIFY", b, C_AMBER); break;
        case 3: dispDrawBanner("MANUAL", "override", C_BLUE); break;
        case 4: dispDrawBanner("MERGING", "2+ sources", C_GREEN); break;
        default: dispDrawStatus(); break;
    }
    dispFlush();
}

static void displayTask(void*) {
    const TickType_t period = pdMS_TO_TICKS(250);
    uint8_t  lastScreen  = 255;
    uint32_t screenSince = 0;
    for (;;) {
        if (dispReady && gfx) {
            uint32_t now  = millis();
            uint8_t  want = dispPickScreen();
            // Dwell: hold a banner >=1.5 s before falling back, so a blip stays readable.
            if (want == 0 && lastScreen != 0 && lastScreen != 255 && now - screenSince < 1500)
                want = lastScreen;
            if (want != lastScreen) { lastScreen = want; screenSince = now; }
            dispRender(want);
        }
        vTaskDelay(period);
    }
}

// Apply the configured static IP (if any) to the just-started wired interface.
#if defined(HAS_WIRED_ETH)
static void applyEthStaticIp() {
    if (!cfg.staticIp) return;
    IPAddress ip, gw, sn, dns;
    parseIp(cfg.ip, ip); parseIp(cfg.gateway, gw);
    parseIp(cfg.subnet, sn); parseIp(cfg.dns, dns);
    ETH.config(ip, gw, sn, dns);
    Serial.printf("[ETH] static IP %s\n", cfg.ip.c_str());
}

// Block (max 15 s) until the wired link comes up, blinking the boot LED.
static void waitEthLink() {
    Serial.print("[ETH] waiting for link");
    uint32_t t = millis();
    while (!netConnected() && millis() - t < 15000) {
        setLedColor((millis() % 600) < 300 ? NEO_BLUE : NEO_OFF, (millis() % 600) < 300);
        delay(200); Serial.print(".");
    }
    Serial.println();
    Serial.printf("[ETH] %s\n", netLocalIP().toString().c_str());
}
#endif

#if defined(HAS_ETH_SPI)
// Bring up the W5500 wired Ethernet (runtime opt-in via cfg.useEthernet/g_useEth).
// Registered as an lwIP netif, so the web/Art-Net/sACN/OTA stack runs over it
// unchanged. WiFi stays the default; this only runs when the user enabled Ethernet.
// The W5500 is software-driven (the S3 has no Ethernet MAC): its SPI interrupt + driver
// task otherwise land on whatever core calls ETH.begin (setup() runs on core 1), where
// they contend with the DMX/RDM TX-DONE ISR that performs the RDM turnaround. Run the
// bring-up from a task pinned to core 0 so the W5500's SPI ISR sits on core 0, away from
// DMX/RDM on core 1. (Investigation report 6.6: a blunt UART-interrupt priority bump
// instead just starves the whole W5500 stack; core separation is the right lever.)
static volatile bool s_ethUpDone;
static void ethUpTask(void *arg) {
    ETH.begin(ETH_PHY_W5500, ETH_W5500_ADDR, cfg.ethCs, cfg.ethInt, cfg.ethRst,
              ETH_W5500_SPI_HOST, cfg.ethSck, cfg.ethMiso, cfg.ethMosi,
              cfg.ethFreqMhz);
    applyEthStaticIp();
    waitEthLink();
    s_ethUpDone = true;
    vTaskDelete(NULL);
}
static void startEthSpi() {
    Serial.printf("[ETH] W5500 SPI cs=%d irq=%d rst=%d sck=%d miso=%d mosi=%d freq=%dMHz (bring-up on core 0)\n",
        cfg.ethCs, cfg.ethInt, cfg.ethRst, cfg.ethSck, cfg.ethMiso, cfg.ethMosi, cfg.ethFreqMhz);
    s_ethUpDone = false;
    xTaskCreatePinnedToCore(ethUpTask, "ethup", 8192, NULL, 5, NULL, 0);
    uint32_t t0 = millis();
    while (!s_ethUpDone && millis() - t0 < 30000) delay(20);
    if (!s_ethUpDone) Serial.println("[ETH] core-0 bring-up still running after 30s");
}
#endif

#if defined(HAS_ETH_RMII)
static const char* RMII_PHY_NAMES[RMII_PHY_COUNT] =
    { "LAN8720", "IP101", "RTL8201", "DP83848", "KSZ8081", "JL1101" };
// Map the stable cfg.rmiiPhy index to the arduino-esp32 ETH enum. IP101 is the
// TLK110 driver; JL1101 is the generic driver (both #defined in ETH.h).
static eth_phy_type_t rmiiPhyType(int idx) {
    switch (idx) {
        case RMII_PHY_IP101:   return ETH_PHY_IP101;     // == ETH_PHY_TLK110
        case RMII_PHY_RTL8201: return ETH_PHY_RTL8201;
        case RMII_PHY_DP83848: return ETH_PHY_DP83848;
        case RMII_PHY_KSZ8081: return ETH_PHY_KSZ8081;
        case RMII_PHY_JL1101:  return ETH_PHY_JL1101;    // == ETH_PHY_GENERIC
        default:               return ETH_PHY_LAN8720;
    }
}
static eth_clock_mode_t rmiiClkMode(int idx) {
    switch (idx) {
        case RMII_CLK_GPIO0_OUT:  return ETH_CLOCK_GPIO0_OUT;
        case RMII_CLK_GPIO16_OUT: return ETH_CLOCK_GPIO16_OUT;
        case RMII_CLK_GPIO17_OUT: return ETH_CLOCK_GPIO17_OUT;
        default:                  return ETH_CLOCK_GPIO0_IN;
    }
}
// Bring up RMII Ethernet via the ESP32 internal EMAC. The PHY family, SMI address,
// MDC/MDIO/PHY-power pins and REF_CLK mode are runtime config (cfg.rmii*); the RMII
// data lines are fixed by the EMAC. Defaults reproduce the LAN8720/WT32-ETH01 wiring.
static void startEthRmii() {
    int phy = constrain(cfg.rmiiPhy, 0, RMII_PHY_COUNT - 1);
    Serial.printf("[ETH] %s RMII addr=%d mdc=%d mdio=%d pwr=%d clk=%d\n",
        RMII_PHY_NAMES[phy], cfg.rmiiAddr, cfg.rmiiMdc, cfg.rmiiMdio, cfg.rmiiPwr, cfg.rmiiClk);
    ETH.begin(rmiiPhyType(phy), cfg.rmiiAddr, cfg.rmiiMdc, cfg.rmiiMdio,
              cfg.rmiiPwr, rmiiClkMode(cfg.rmiiClk));
    applyEthStaticIp();
    waitEthLink();
}
#endif

#if defined(HAS_WIRED_ETH)
// Dispatch to the runtime-selected wired PHY. On a build with both compiled (classic
// ESP32) cfg.wiredPhy picks; otherwise only the one compiled PHY is callable.
static void startWiredEth() {
#if defined(HAS_ETH_SPI) && defined(HAS_ETH_RMII)
    if (cfg.wiredPhy == WIRED_PHY_RMII) startEthRmii();
    else                                startEthSpi();
#elif defined(HAS_ETH_SPI)
    startEthSpi();
#elif defined(HAS_ETH_RMII)
    startEthRmii();
#endif
}
#endif

// Standalone WiFi access point (issue #14): a self-contained network for quick
// field tests with no router, and the automatic fallback when wired Ethernet has
// no link. SSID = device hostname; a passphrase of >=8 chars enables WPA2,
// anything shorter (or empty) leaves the AP open.
// requirePw = true (the wired link-loss fallback) refuses to open an UNSECURED AP, so a
// show device never spontaneously broadcasts an open hotspot. Returns whether it came up.
static bool startWiFiAP(bool requirePw = false) {
    const char* pw = cfg.apPassword.length() >= 8 ? cfg.apPassword.c_str() : nullptr;
    if (requirePw && !pw) {
        Serial.println("[WiFi] AP fallback needs an AP password (>=8 chars); not opening an open AP");
        return false;
    }
    g_apMode = true;
    g_useEth = false;
    WiFi.mode(WIFI_AP);
    bool ok = WiFi.softAP(cfg.hostname.c_str(), pw);
    WiFi.setSleep(WIFI_PS_NONE);     // keep the radio awake for reliable multicast/UDP
    setLedColor(NEO_PURPLE, true);   // purple = AP active (matches the config portal)
    Serial.printf("[WiFi] AP \"%s\" %s %s  ip=%s\n",
        cfg.hostname.c_str(), ok ? "up" : "FAILED",
        pw ? "(WPA2)" : "(open)", WiFi.softAPIP().toString().c_str());
    return ok;
}

#if defined(HAS_WIRED_ETH)
// Apply the configured link-loss policy when wired Ethernet has no link. RETRY keeps the
// wired netif (lwIP re-DHCPs when the cable returns). At boot we never reboot (it would
// loop) and the portal may block; at runtime PORTAL/REBOOT restart so the portal opens
// cleanly from setup(), while AP starts in place (non-blocking).
static void applyWiredLinkLoss(bool atBoot) {
    switch (cfg.linkLossMode) {
        case WIRED_FB_AP:
            // Stopgap AP: if it comes up, remember it was a wired fallback so we can hand
            // back to Ethernet once the link returns (needs an AP password, else stays on retry).
            if (startWiFiAP(true)) g_apWiredFallback = true;
            break;
        case WIRED_FB_REBOOT:
            if (!atBoot) { Serial.println("[NET] wired link lost -> reboot"); delay(200); ESP.restart(); }
            break;   // at boot: keep retrying (rebooting with no link would loop)
        case WIRED_FB_RETRY:
        default:
            break;   // keep the wired netif; lwIP re-DHCPs when the link is back
    }
}
#endif

// WiFi station (client) bring-up: optional BOOT-held config portal, then connect
// to the strongest AP for the stored SSID. Factored out of setup() so the network
// dispatch there reads as interface → mode.
static void startWiFiStation() {
    bool forcePortal = false;
    if (digitalRead(CFG_BOOT_PIN) == LOW) {
        Serial.print("[BOOT] button held, waiting...");
        uint32_t t = millis();
        while (digitalRead(CFG_BOOT_PIN) == LOW && millis()-t < HOLD_MS) delay(50);
        forcePortal = (digitalRead(CFG_BOOT_PIN) == LOW);
        Serial.println(forcePortal ? " → config portal" : " released");
    }
    if (forcePortal && cfg.staticIp) {   // recovery: come back on DHCP
        cfg.staticIp = false;
        saveConfig();
    }
    WiFi.mode(WIFI_STA);
    WiFi.setScanMethod(WIFI_ALL_CHANNEL_SCAN);
    WiFi.setSortMethod(WIFI_CONNECT_AP_BY_SIGNAL);
    setLedColor(NEO_BLUE, true);   // connecting to stored WiFi
#ifdef SIM_WIFI
    // Simulation only (Wokwi): the WiFiManager config portal cannot be reached
    // from the host, so join Wokwi's open virtual AP directly. Never compiled
    // into a real build — guarded by the SIM_WIFI flag set in [env:wokwi].
    (void)forcePortal;
    Serial.print("[SIM] joining Wokwi-GUEST");
    WiFi.begin("Wokwi-GUEST", "");
    { uint32_t t = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - t < 20000) {
          setLedColor((millis() % 600) < 300 ? NEO_BLUE : NEO_OFF, (millis() % 600) < 300);
          delay(200); Serial.print(".");
      } }
    Serial.println();
#else
    startWiFiManager(forcePortal);
    // The ESP32's auto-connect reliably sticks to whichever AP it used before,
    // even a distant one on a mesh. Explicitly scan and hop to the strongest
    // AP for our SSID on every boot (also logs all APs for diagnostics).
    connectStrongestAP();
#endif  // SIM_WIFI
    // Disable WiFi power save: with modem-sleep the station misses buffered
    // multicast (sACN) and IGMP queries, causing periodic ~0.3-0.5s reception
    // gaps. WIFI_PS_NONE keeps the radio awake for reliable multicast.
    WiFi.setSleep(WIFI_PS_NONE);
    Serial.printf("[WiFi] %s / %s  rssi=%d  bssid=%s\n",
        netSSID().c_str(), netLocalIP().toString().c_str(),
        (int)WiFi.RSSI(), WiFi.BSSIDstr().c_str());
}

// ---------------------------------------------------------------------------
// setup()
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Serial config console hooks — the device-side actions the console triggers.
// The console itself (config_serial) is schema-driven and transport-free; these
// wire its verbs to this firmware's persistence / reboot / WiFi.
// ---------------------------------------------------------------------------
static void cfgserialSave(bool reboot) {
    saveConfig();
    if (reboot) pendingRebootAt = millis() + 300;
}
static void cfgserialReboot() { pendingRebootAt = millis() + 300; }
static void cfgserialFactory() {
    Preferences p; p.begin(PREF_NS, false); p.clear(); p.end();   // wipe config + labels
    pendingWifiReset = true;                                       // also drop WiFi creds
    pendingRebootAt  = millis() + 300;
}
static bool cfgserialWifi(const String& ssid, const String& pass) {
    // Keep WiFiManager for the portal; this just sets STA creds persistently and
    // reconnects (the recover-a-stuck-board path). WiFi stays out of the schema.
    WiFi.persistent(true);
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid.c_str(), pass.c_str());
    return true;
}
static const cfgserial::Hooks SERIAL_HOOKS = {
    cfgserialSave, cfgserialReboot, cfgserialFactory, cfgserialWifi };

void setup() {
    // Brownout detector: on the classic ESP32 (esp32dev/wt32eth01) this register
    // write disables it. On the ESP32-S3 under arduino-esp32 v3 / IDF 5 the BOD is
    // already armed during IDF startup (before setup() runs), so this write is too
    // late there — the v3 env disables it at the sdkconfig level instead
    // (CONFIG_ESP_BROWNOUT_DET=n in platformio.ini). Harmless to keep here.
    WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
    Serial.begin(115200);
    startMs = millis();
    Serial.println("\n[BOOT] LuxDMX — Art-Net / sACN DMX Gateway");

    loadConfig();
    cfgserial::begin(Serial, SERIAL_HOOKS);   // serial config console: type 'help'
#if defined(HAS_WIRED_ETH)
    // Wired Ethernet is active when the user selected it; the W5500 path additionally
    // needs the module opt-in (cfg.ethW5500). At default cfg.wiredPhy this reduces to
    // the old per-build behavior — RMII boards: useEthernet; W5500: ethW5500 && useEthernet.
    g_useEth = cfg.useEthernet;
#if defined(HAS_ETH_SPI)
    if (cfg.wiredPhy == WIRED_PHY_SPI) g_useEth = g_useEth && cfg.ethW5500;
#endif
#endif
    initLed();
    setLedColor(NEO_WHITE, true);   // booting
    initDisplay();                  // optional status panel — shows boot splash
    pinMode(CFG_BOOT_PIN, INPUT_PULLUP);

    // ── Network bring-up (issue #14) — interface → mode, with AP fallback ────
    // Wired boards honour cfg.useEthernet (g_useEth). If wired Ethernet is chosen
    // but has no link, optionally fall back to a standalone WiFi AP so the device
    // is still reachable. Otherwise WiFi runs in the configured mode (STA or AP).
#if defined(HAS_WIRED_ETH)
    if (g_useEth) {
        startWiredEth();
        if (!netConnected()) {
            Serial.printf("[NET] wired Ethernet has no link (link-loss policy %d)\n", cfg.linkLossMode);
            applyWiredLinkLoss(true /*atBoot*/);
        }
    } else
#endif
    if (cfg.wifiMode == NET_WIFI_AP) {
        startWiFiAP();
    } else {
        startWiFiStation();
    }

    if (MDNS.begin(cfg.hostname.c_str())) {
        MDNS.addService("http",   "tcp", 80);
        if (cfg.protocol != 1) MDNS.addService("artnet", "udp", 6454);
        if (cfg.protocol != 0) MDNS.addService("e131",   "udp", 5568);
        Serial.printf("[mDNS] %s.local\n", cfg.hostname.c_str());
    }

    dmxInitGuardBegin();   // recover automatically if a bad output config panics init
    initDmx();
    dmxInitGuardEnd();
    initOTA();

    if (cfg.protocol != 1) {
        artnet.setArtDmxCallback(onArtDmx);
        artnet.begin();
        Serial.printf("[ArtNet] out0 universe %d%s\n", cfg.outputs[0].universe,
            cfg.outputs[1].enabled ? " (+out1)" : "");
    }
    if (cfg.protocol != 0) startSacn();

    http.on("/logo.png",          HTTP_GET,  handleLogo);
    http.on("/favicon.png",       HTTP_GET,  handleFavicon);
    http.on("/favicon.ico",       HTTP_GET,  handleFavicon);
    http.on("/bootstrap.min.css", HTTP_GET,  handleBootstrapCss);
    http.on("/",                  HTTP_GET,  handleRoot);
    http.on("/dmx.json",          HTTP_GET,  handleDmxJson);
    http.on("/senders.json",      HTTP_GET,  handleSendersJson);
    http.on("/log.json",          HTTP_GET,  handleLogJson);
    http.on("/config",            HTTP_GET,  handleConfigGet);
    http.on("/config",            HTTP_POST, handleConfigPost);
    http.on("/reset",             HTTP_GET,  handleResetGet);
    http.on("/reset",             HTTP_POST, handleResetPost);
    http.on("/ota/github",        HTTP_POST, handleOtaGithub);
    http.on("/ota/status",        HTTP_GET,  handleOtaStatus);
    http.on("/ota/upload",        HTTP_POST, handleOtaUploadDone, handleOtaUploadChunk);
    http.on("/version.json",      HTTP_GET,  handleVersionJson);
    http.on("/info.json",         HTTP_GET,  handleInfoJson);
    http.on("/rdm.json",          HTTP_GET,  handleRdmJson);
    http.on("/labels.json",       HTTP_GET,  handleLabelsGet);
    http.on("/labels",            HTTP_POST, [](AsyncWebServerRequest*){}, NULL, handleLabelsBody);
    http.on("/autoupdate",        HTTP_POST, handleAutoUpdatePost);
    http.onNotFound([](AsyncWebServerRequest* req) { req->send(404, "text/plain", "Not found"); });

    ws.onEvent(onWsEvent);
    http.addHandler(&ws);
    http.begin();

    lastFrameMs = millis();
    // LED on its own low-priority task so web traffic can't freeze it.
    xTaskCreate(ledTask, "led", 2048, nullptr, 1, nullptr);
    if (dispReady) xTaskCreate(displayTask, "disp", 4096, nullptr, 1, nullptr);
    xTaskCreate(versionCheckTask, "ver_chk", 12288, nullptr, 1, nullptr);
    Serial.println("[BOOT] ready.");
}

#ifdef SIM_ARTNET
// ---------------------------------------------------------------------------
// Simulation only (Wokwi): synthesize a moving Art-Net test pattern so the
// whole input pipeline — sender tracking, change log, fps/jitter, WS push and
// the 40 Hz DMX output — runs without an external console. A bright "head"
// sweeps across the universe with a soft trail; channel 1 breathes on a sine.
// Feeds the exact same routeFrame() path a real Art-Net packet would. Guarded
// by SIM_ARTNET (set in [env:wokwi]); never compiled into a real build.
// ---------------------------------------------------------------------------
static void simArtnetTick() {
    static uint32_t last = 0;
    uint32_t now = millis();
    if (now - last < 25) return;            // ~40 Hz, like a lighting console
    last = now;

    static uint8_t frame[512];
    memset(frame, 0, sizeof(frame));
    uint16_t head = (now / 40) % 512;       // sweeps ~25 channels/sec
    frame[head] = 255;
    if (head >= 1)        frame[head - 1] = 120;   // trailing edge
    if (head + 1 < 512)   frame[head + 1] = 120;   // leading edge
    frame[0] = (uint8_t)(127.0f + 127.0f * sinf(now / 500.0f));  // ch1 breathe

    routeFrame(0, frame, 512, (uint32_t)IPAddress(10, 13, 37, 1), 0, DEFAULT_PRIORITY);

    static uint32_t lastLog = 0;
    if (now - lastLog >= 1000) {            // 1 Hz proof-of-life on the console
        lastLog = now;
        Serial.printf("[SIM] artnet pattern: head=ch%u ch1=%u fps=%.1f\n",
                      head + 1, frame[0], fps);
    }
}
#endif

// ---------------------------------------------------------------------------
// loop()
// ---------------------------------------------------------------------------
void loop() {
    cfgserial::poll();   // serial config console (non-blocking line reader)

    // AsyncWebServer + AsyncWebSocket run in their own task, so loop() never
    // blocks on the network — only Art-Net/sACN input and DMX output here.
    // Only poll the UDP sockets while a link is actually up: on arduino-esp32 v3,
    // calling parsePacket() with no network spams "[E][NetworkUdp.cpp] parsePacket():
    // could not check for data" every loop (and wastes CPU) — seen with the W5500
    // link down (or before it comes up).
    if (netConnected()) {
        if (cfg.protocol != 1) artnet.read();
        if (cfg.protocol != 0) readSacn();
    }
    ArduinoOTA.handle();
#ifdef SIM_ARTNET
    simArtnetTick();
#endif

    uint32_t now = millis();

    // Re-merge outputs whose input has gone quiet, so a source that stops sending
    // drops out of the mix even without a new frame to trigger routeFrame()
    // (issue #10 source timeout). Outputs still actively receiving are already
    // merged per-frame in routeFrame(), so skip them here to avoid redundant work.
    static uint32_t lastMergeMs = 0;
    if (now - lastMergeMs >= 100) {
        for (int i = 0; i < MAX_OUTPUTS; i++)
            if (cfg.outputs[i].enabled && now - outLastDmxMs[i] >= 100) mergeOutput(i);
        g_srcStatus = sourceStatus();   // also refresh cached state when input is idle
        lastMergeMs = now;
    }

    // Continuous DMX output at ~40 Hz: holds the last frame as a failsafe so
    // brief input gaps (lost multicast on a weak link) never interrupt the
    // lights. sendDmx() applies any identify override and manual changes too.
    static uint32_t lastDmxTx = 0;
    if (identifyCh && now >= identifyUntil) identifyCh = 0;
    if (now - lastDmxTx >= 25) { sendDmx(); lastDmxTx = now; }

    // RDM discovery / GET-SET on the bus (no-op unless a request is queued and
    // the direction-enable pin is configured). A full discovery briefly pauses
    // DMX output while it sweeps the line.
    rdmService();

    if (now - lastWsPush >= 100) {
        wsPush();
        lastWsPush = now;
    }

    static uint32_t lastMetaPush = 0;
    if (now - lastMetaPush >= 2000) {
        wsPushMeta();
        lastMetaPush = now;
    }

    static uint32_t lastWsClean = 0;
    if (now - lastWsClean >= 1000) {
        ws.cleanupClients(4);   // cap clients; drop oldest beyond 4
        lastWsClean = now;
    }

    if (pendingGithubOta) {
        pendingGithubOta = false;
        doGithubOta();
    }

    // Deferred reboot (config save / reset / OTA done) so the HTTP response
    // can flush from the async task before we restart.
    if (pendingRebootAt && now >= pendingRebootAt) {
        if (pendingWifiReset) { WiFiManager wm; wm.resetSettings(); }
        ESP.restart();
    }

    // WiFi link watchdog: if the association drops, force a reconnect so the
    // device comes back without waiting/rebooting (DMX output keeps running).
    // Only in WiFi station mode — skip on wired Ethernet or when running as an AP.
    if (!g_useEth && !g_apMode) {
        static uint32_t lastWifiOk = 0;
        static uint32_t lastReconnect = 0;
        if (WiFi.status() == WL_CONNECTED) {
            lastWifiOk = now;
        } else if (now - lastWifiOk > 5000 && now - lastReconnect > 10000) {
            Serial.printf("[WiFi] link down (status=%d), re-scanning for strongest AP... up=%lus\n",
                (int)WiFi.status(), (unsigned long)uptimeSec());
            WiFi.disconnect();
            { wifi_config_t c;   // clear BSSID lock before reconnect too
              if (esp_wifi_get_config(WIFI_IF_STA, &c) == ESP_OK)
                  { c.sta.bssid_set = 0; esp_wifi_set_config(WIFI_IF_STA, &c); } }
            WiFi.begin();   // re-scans all channels, reconnects to strongest BSSID
            lastReconnect = now;
        }
    }

#if defined(HAS_WIRED_ETH)
    // Wired-link watchdog: if we were on wired Ethernet and the link drops past the grace
    // window, apply the link-loss policy so the device recovers or stays reachable (the
    // old fallback only ran once at boot, so a cable pulled mid-run stranded the device).
    if (g_useEth) {
        static bool wiredUp = false;
        static uint32_t wiredDownAt = 0;
        if (netConnected()) { wiredUp = true; wiredDownAt = 0; }
        else if (wiredUp) {
            if (!wiredDownAt) wiredDownAt = now;
            else if (now - wiredDownAt > WIRED_GRACE_MS) {
                wiredDownAt = now;                 // re-arm; RETRY just keeps waiting (lwIP recovers)
                if (cfg.linkLossMode != WIRED_FB_RETRY) {
                    Serial.printf("[NET] wired link down >%lus, applying policy %d\n",
                        (unsigned long)(WIRED_GRACE_MS / 1000), cfg.linkLossMode);
                    applyWiredLinkLoss(false /*runtime*/);
                }
            }
        }
    }
    // Return from the AP stopgap to Ethernet: if we fell back to the AP because the wired
    // link dropped, watch the link and reboot back to wired once it's restored and stable.
    // (A user-chosen AP, wifiMode==AP, never sets g_apWiredFallback, so it's left alone.)
    else if (g_apMode && g_apWiredFallback) {
        static uint32_t wiredBackAt = 0;
        if (ETH.linkUp()) {
            if (!wiredBackAt) wiredBackAt = now;
            else if (now - wiredBackAt > WIRED_GRACE_MS) {
                Serial.println("[NET] wired link restored -> reboot back to Ethernet");
                delay(200); ESP.restart();
            }
        } else wiredBackAt = 0;
    }
#endif

    // Periodic health line (leaks/uptime visible on the serial console)
    static uint32_t lastHeapLog = 0;
    if (now - lastHeapLog >= 15000) {
        lastHeapLog = now;
        Serial.printf("[HEALTH] up=%lus heap=%u minFree=%u fps=%.1f rssi=%d st=%d ws=%u req=%u wsc=%u/%u\n",
            (unsigned long)uptimeSec(), ESP.getFreeHeap(), ESP.getMinFreeHeap(),
            fps, netRSSI(), (int)WiFi.status(), ws.count(), (unsigned)httpReqCount,
            (unsigned)wsConnCount, (unsigned)wsDiscCount);
    }
}
