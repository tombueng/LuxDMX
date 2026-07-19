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
#include <esp_task_wdt.h>  // reconfigure the task WDT to not reboot the gateway under a network flood
#include <esp_chip_info.h> // chip model detection for the RDM device-table auto-sizing (rdmAllocTables)
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
// Which SPI Ethernet chip the WIRED_PHY_SPI path drives (cfg.ethSpiPhy). Both are external
// modules on the SAME CS/INT/RST/SCK/MISO/MOSI wiring and use the same ETH.begin() SPI
// signature; only the PHY enum differs. DM9051 is a W5500 alternative (issue #36), UNTESTED
// on real hardware so far. Default W5500, so an OTA changes nothing for existing devices.
#define ETH_SPI_PHY_W5500  0   // Wiznet W5500
#define ETH_SPI_PHY_DM9051 1   // Davicom DM9051
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
#include <DNSServer.h>    // captive-portal DNS for the first-run setup portal
#include <ESPAsyncWebServer.h>
#include <ESPmDNS.h>
#include <ArduinoOTA.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <Update.h>
#include <ArtnetWifi.h>
#include <esp_dmx.h>
#ifdef DMX_RMT
#include "dmx_rmt.h"
static RmtDmx g_rmt[MAX_OUTPUTS];      // RMT-based DMX TX per output (issue #64 hard-zero path)
#include "rdm_rmt.h"                    // RDM controller on RMT-TX + UART-RX (no esp_dmx, no interrupt leak)
#endif
#include <rdm/controller.h>             // RDM controller: discovery + GET/SET
#include <rdm/controller/include/utils.h>  // rdm_send_request() for sensor PIDs
#include <rdm/include/uid.h>            // rdm_uid_is_eq() and friends

// Auto-generated asset headers (produced by extra_scripts.py before each build)
#include "generated/version.h"
#include "generated/index_html.h"
#include "generated/config_html.h"
#include "generated/rdm_html.h"
#include "generated/config_saved_html.h"
#include "generated/setup_html.h"
#include "generated/setup_done_html.h"
#include "generated/reset_html.h"
#include "generated/reset_done_html.h"
#include "generated/ota_progress_html.h"
#include "generated/ota_done_html.h"
#include "generated/logo_webp.h"
#include "generated/favicon_png.h"
#include "generated/bootstrap_min_css.h"

// On-unit controls (issue #24): rotary encoder + buttons -> a small display menu.
// Pure, host-tested decode/mapping/menu logic (no Arduino); main.cpp only samples
// the pins, renders the menu, and applies the result.
#include "input_map.h"
#include "menu.h"

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

// 5-LED discrete status panel (ledType 3) — the LuxDMX v6 board. Five LEDs on
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
// W5500 wiring); the luxdmx_v6 template overrides them. A build without
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
// SSID of the transient first-run setup portal (its own SoftAP). Deliberately NOT the
// hostname: the standalone AP mode (startWiFiAP) broadcasts the hostname, so a distinct
// name here keeps the two from colliding when you're looking for the right network.
static const char* AP_SSID = "LuxDMX-setup";

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
#define WIRED_FB_WIFI   3   // no wired link -> join the stored WiFi network (STA), if creds are set
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
// Must comfortably outlast a console's KEEP-ALIVE interval, not just its streaming rate: on a
// static look both E1.31 (mandated, sec 6.6.2: "a single keep-alive packet ... at intervals of
// between 800mS and 1000mS") and every console we checked (MagicQ "Changes only", grandMA over
// the network) throttle down to roughly 1 packet/second. At the old 2500 ms a single held look
// plus TWO dropped UDP packets was enough to declare the source lost -- which on lossMode=ZERO
// means the rig blacks out mid-show. 4000 ms rides out three consecutive lost keep-alives and
// matches Art-Net's own 4-second convention. The cost is that a real cable pull now takes ~1.5 s
// longer to register; a held look going black is the far worse failure.
static constexpr uint32_t SOURCE_TIMEOUT_MS = 4000;
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
    uint16_t uni;     // Art-Net/sACN universe this frame targeted (0-32767)
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
static bool g_ethFallback     = false;   // wired Ethernet configured but running on the WiFi/AP fallback (status LED = orange)

// First-run setup portal (replaces the old WiFiManager config portal). Brought up only
// when there are no stored STA credentials, or when BOOT is held at power-on. While it's
// active the device runs an open SoftAP (AP_SSID) + a captive DNS that points everything
// at the on-brand setup page, and loop() pumps dnsServer.processNextRequest().
static bool      g_setupPortal = false;   // setup portal is the active "network" (no real link)
static DNSServer dnsServer;

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
static void rdmLoadPoll();   // fwd decl (defined with the RDM sensor-poll persistence, below)
static bool rdmAllocTables();   // fwd decl: allocates the RDM tables; loadConfig() must call it before rdmLoadPoll()
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
static int      rdmOut       = -1;                 // primary RDM output (first RDM line), -1 = none
static int      rdmLineForOut[MAX_OUTPUTS];        // output index -> RDM engine line, -1 if not RDM-capable
static int      rdmOutForLine[MAX_OUTPUTS];        // RDM engine line -> the output index it reaches
static uint32_t lastFrameMs  = 0;
static uint32_t frameCount   = 0;
static float    fps          = 0.0f;
// Incoming Art-Net/sACN frame rate per output-universe (for the navbar's "In FPS"). Counted in
// updateSender() (once per packet, so a multi-universe source is attributed right) and closed to a
// rate each second in wsPush() so a stopped universe decays to 0.
static uint32_t inFrameCnt[MAX_OUTPUTS] = {0};
static uint32_t inWinMs[MAX_OUTPUTS]    = {0};
static float    inFpsOut[MAX_OUTPUTS]   = {0.0f};
// Per-output frame rate (one universe each). The aggregate `fps` above stays the
// sum of all inputs for the WS/web UI; these drive the per-universe display.
static uint32_t outFrameCount[MAX_OUTPUTS]  = {0};
static uint32_t outLastFrameMs[MAX_OUTPUTS] = {0};
static uint32_t outLastDmxMs[MAX_OUTPUTS]   = {0};
static float    outFps[MAX_OUTPUTS]         = {0.0f};
// Real DMX OUTPUT (transmit) rate per output, counted in sendDmx (the DMX task) and rolled up
// once a second. This is what "outfps" should report -- the rate we actually clock onto the
// wire (a steady ~40 Hz), independent of the input frame rate.
static volatile uint32_t txFrames[MAX_OUTPUTS] = {0};
static float    outTxFps[MAX_OUTPUTS]       = {0.0f};
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
static String   otaTarget       = "latest";   // release tag to install
// How many boots a scheduled update may fail before it is abandoned. The brake on any retry
// loop is NVS "otatries" + loop() only zeroing it after 60 s of stable uptime: a device stuck
// retrying never gets there, so this really is a hard cap, not a suggestion.
static constexpr uint8_t OTA_BOOT_TRIES = 3;
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
// 528 header+dmx, then per-output OUTPUT fps (2*N) and per-output INPUT fps (2*N), then a fixed
// 10-byte tail (fixtures + RDM tx + RDM rx). Every tab's navbar reads its stats off this one frame.
static constexpr int WS_NAV_TAIL  = 10;
static constexpr int WS_FRAME_LEN = 528 + 4 * MAX_OUTPUTS + WS_NAV_TAIL;
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
    // Allocate the RDM device tables NOW: cfgcore::load() has populated cfg.rdmMaxDev
    // (which sizes them) and rdmLoadPoll() below writes into g_savedPoll[], so the tables
    // must exist first. Doing it here (not later in setup) closed a null-write crash-loop
    // that hit as soon as a saved sensor-poll list (NVS "rdmpoll") was non-empty.
    rdmAllocTables();
    rdmLoadPoll();   // restore which sensors are enabled for live polling + graphing
    sanitizeOutputs();
}

static void saveConfig() {
    cfgcore::save();
}

// ---------------------------------------------------------------------------
// LED helpers
// ---------------------------------------------------------------------------
static constexpr uint32_t NEO_OFF    = 0x000000;
static constexpr uint32_t NEO_GREEN  = 0x002200;   // up + idle (solid) / DMX coming in (slow blink)
static constexpr uint32_t NEO_AMBER  = 0x221000;   // orange: Ethernet configured but on the WiFi/AP fallback
static constexpr uint32_t NEO_RED    = 0x220000;   // no network at all
static constexpr uint32_t NEO_BLUE   = 0x000022;   // RDM discovery / identify / RDM traffic
static constexpr uint32_t NEO_PURPLE = 0x180018;   // setup portal / config AP active
static constexpr uint32_t NEO_WHITE  = 0x0a0a0a;   // booting / connecting

// --- 5-LED discrete status panel (ledType 3) -------------------------------
// The five LEDs are driven with LEDC PWM (not plain on/off) so each colour has its
// own brightness: green + white are far brighter per mA than blue/yellow, so they run
// at a much lower duty to look balanced. Per-colour duty is cfg.ledBr* (0-255), tunable
// live via /led/bright. One cached write so the boot-time setLedColor() path and the
// runtime ledTask() path share state and never clock a pin redundantly; g_ledDirty
// forces a re-apply when the brightness changes without the on/off state changing.
static constexpr uint32_t LED_PWM_FREQ = 5000;  // 5 kHz -> no visible flicker
static constexpr uint8_t  LED_PWM_RES  = 8;     // 8-bit duty (0-255)
static volatile bool g_ledDirty = false;        // set when a brightness edit needs re-applying
static volatile bool g_led5Ready = false;       // true once initLed() has ledcAttach'd the panel pins
static volatile uint32_t g_ledTestUntil = 0;    // >now: force all 5 panel LEDs on (brightness calibration, /led/bright?test=1)
static void setLeds5(bool r, bool g, bool y, bool b, bool w) {
    if (!g_led5Ready) return;   // never ledcWrite() a pin before initLed() attached its LEDC channel
    static uint8_t last = 0xFF;
    uint8_t state = (r?1:0) | (g?2:0) | (y?4:0) | (b?8:0) | (w?16:0);
    if (state == last && !g_ledDirty) return;
    last = state; g_ledDirty = false;
    if (cfg.ledR >= 0) ledcWrite(cfg.ledR, r ? cfg.ledBrR : 0);
    if (cfg.ledG >= 0) ledcWrite(cfg.ledG, g ? cfg.ledBrG : 0);
    if (cfg.ledY >= 0) ledcWrite(cfg.ledY, y ? cfg.ledBrY : 0);
    if (cfg.ledB >= 0) ledcWrite(cfg.ledB, b ? cfg.ledBrB : 0);
    if (cfg.ledW >= 0) ledcWrite(cfg.ledW, w ? cfg.ledBrW : 0);
}

// Map the single-LED status colour onto the 5-LED panel. Used for the imperative
// boot / connecting / portal phases that run before ledTask() takes over; once
// the network is up, ledTask() drives the panel directly (multi-state).
static void leds5FromColor(uint32_t c, bool& r, bool& g, bool& y, bool& b, bool& w) {
    r = g = y = b = w = false;
    switch (c) {
        case NEO_GREEN:  g = true; break;            // up / idle
        case NEO_AMBER:  y = true; break;            // Ethernet on WiFi/AP fallback (orange)
        case NEO_RED:    r = true; break;            // no network
        case NEO_BLUE:   b = true; break;            // RDM / identify
        case NEO_PURPLE: b = true; w = true; break;  // setup portal / config AP
        case NEO_WHITE:  w = true; break;            // booting / connecting
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
        // PWM each panel LED so cfg.ledBr* sets a per-colour brightness (green/white
        // run dimmer to match blue/yellow). ledcAttach auto-assigns an LEDC channel.
        const int pins[5] = { cfg.ledR, cfg.ledG, cfg.ledY, cfg.ledB, cfg.ledW };
        for (int i = 0; i < 5; i++)
            if (pins[i] >= 0) { ledcAttach((uint8_t)pins[i], LED_PWM_FREQ, LED_PWM_RES); ledcWrite((uint8_t)pins[i], 0); }
        g_led5Ready = true;   // panel PWM ready -> setLeds5() may now drive it
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

// Boot/connecting indicator. On the 5-LED panel it's a Knight-Rider sweep bouncing back and
// forth across R-G-Y-B-W (each position at its own calibrated brightness, so the sweep looks
// even); on a single LED it's a white "working" blink (blue is reserved for RDM now). Call it
// in a loop while waiting for the network to come up.
static void bootConnectingLed() {
    if (cfg.ledType == 3) {
        static uint8_t ph = 0;                           // advances one position per call
        int pos = (ph < 5) ? (int)ph : (int)(8 - ph);    // 0,1,2,3,4,3,2,1 bounce across R-G-Y-B-W
        ph = (uint8_t)((ph + 1) % 8);
        setLeds5(pos == 0, pos == 1, pos == 2, pos == 3, pos == 4);
    } else {
        bool on = (millis() % 600) < 300;
        setLedColor(on ? NEO_WHITE : NEO_OFF, on);
    }
}

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

// Clock every enabled output out for one DMX frame. The two DMX UARTs are independent
// hardware, so we fire ALL of them first (dmx_write + dmx_send) and only THEN wait for
// them to finish -- both frames transmit CONCURRENTLY. With two outputs that is ~one
// frame time (~23 ms) instead of ~46 ms, so each output holds ~40 Hz instead of dropping
// to ~20 Hz (issue #64). Runs from the dedicated high-priority dmxTxTask (see below), the
// sole owner of the DMX ports, so its break/MAB timing is never preempted by loop().
static void sendDmx() {
    if (!dmxReady) return;
    bool ovActive = identifyCh && millis() < identifyUntil;
    int  vo = viewOutput();
    dmx_port_t sentPort[MAX_OUTPUTS]; int nSent = 0;
#ifdef DMX_RMT
    int rmtSent[MAX_OUTPUTS]; int nRmt = 0;
#endif
    // Phase 1: write + kick off every output that should clock this frame.
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
        uint8_t saved = 0;
        if (ov) { saved = dmxBuf[i][identifyCh]; dmxBuf[i][identifyCh] = 255; }
#ifdef DMX_RMT
        {   // RMT-driven output -> kick (async), streams out in hardware. The RDM output stays on
            // RMT too: RDM requests go out via RMT and responses come back on a RX-only UART, so
            // there is never a switch and DMX output on this pin is uninterrupted between RDM ops.
            rmtDmxKick(&g_rmt[i], dmxBuf[i], DMX_PACKET_SIZE);
            if (ov) dmxBuf[i][identifyCh] = saved;
            rmtSent[nRmt++] = i;
            txFrames[i]++;                 // count real transmitted frames for the output-fps stat
            continue;
        }
#endif
        dmx_port_t port = (dmx_port_t)cfg.outputs[i].port;
        dmx_write(port, dmxBuf[i], DMX_PACKET_SIZE);
        dmx_send(port);
        if (ov) dmxBuf[i][identifyCh] = saved;
        sentPort[nSent++] = port;
        txFrames[i]++;                         // count real transmitted frames for the output-fps stat
    }
    // Phase 2: wait for the concurrent transmissions to complete.
    for (int k = 0; k < nSent; k++) dmx_wait_sent(sentPort[k], DMX_TIMEOUT_TICK);
#ifdef DMX_RMT
    for (int k = 0; k < nRmt; k++) rmtDmxWait(&g_rmt[rmtSent[k]]);
#endif
}

// The DMX transmit cadence. dmxTxTask free-runs at this period, deliberately decoupled from the
// input rate (Art-Net sanctions continuous re-transmission, and a console on a static look drops
// to ~1 packet/s, so we cannot simply relay). Declared here rather than buried in the task because
// ArtPollReply has to advertise this exact number as RefreshRate: a gateway that claims a rate it
// does not deliver invites controllers to oversend, and every surplus frame is silently dropped.
// NOTE: free-running also means any input rate that is not DMX_TX_RATE_HZ gets resampled, so some
// frames go out twice (issue #93). Making this per-output configurable is the next step.
static constexpr uint32_t DMX_TX_PERIOD_MS = 25;
static constexpr uint8_t  DMX_TX_RATE_HZ   = (uint8_t)(1000UL / DMX_TX_PERIOD_MS);   // 40 Hz

// Dedicated DMX transmit task -- THE fix for issue #64 rock-solid output. It runs on a
// strict 25 ms cadence (vTaskDelayUntil, 40 Hz) at high priority pinned to core 1, so a
// burst of Art-Net/sACN packet processing in loop() (also core 1) can NEVER delay or jitter
// the DMX break/frame timing. Combined with the EMAC bring-up moved to core 0 (ethRmiiUpTask),
// nothing on core 1 -- neither tasks nor the wired-Ethernet ISR -- can disturb the transmit.
// This task is the SOLE owner of the DMX ports: it also services RDM (a no-op unless a
// direction-enable pin is configured), so loop() never touches the bus.
static TaskHandle_t g_dmxTask = nullptr;
static void rdmService();   // fwd decl (defined below, next to the RDM controller)
static void netRxTask(void*);   // fwd decl (defined below, next to loop() -- runs on core 0)
static void routeFrame(int artUniverse, const uint8_t* data, uint16_t length,
                       uint32_t senderIp, uint8_t proto, uint8_t priority);   // fwd decl for artnet_rdm.h

// (No RMT<->esp_dmx switch: in the DMX_RMT build the RDM output stays on RMT permanently. RDM
// requests are sent via RMT and responses read on a RX-only UART -- see rdm_rmt.h. Nothing is
// ever installed/deleted at runtime, so the esp_dmx interrupt-leak path is gone entirely.)

static void dmxTxTask(void*) {
    const TickType_t period = pdMS_TO_TICKS(DMX_TX_PERIOD_MS);   // 40 Hz
    TickType_t next = xTaskGetTickCount();
    uint32_t fpsWin = millis();
    for (;;) {
        vTaskDelayUntil(&next, period);                 // precise period, immune to loop() load
        if (identifyCh && millis() >= identifyUntil) identifyCh = 0;
        rdmService();                                   // queued RDM request (bus owner); no-op otherwise
        sendDmx();                                      // clock outputs out, concurrently
        // Roll up the real transmitted-frame rate once a second (for the "outfps" stat).
        const uint32_t now = millis();
        if (now - fpsWin >= 1000) {
            for (int i = 0; i < MAX_OUTPUTS; i++) {
                outTxFps[i] = txFrames[i] * 1000.0f / (float)(now - fpsWin);
                txFrames[i] = 0;
            }
            fpsWin = now;
        }
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
    int16_t lowest;     // lowest detected (min)
    int16_t highest;    // highest detected (max)
    int16_t recorded;   // recorded value
    uint8_t type;       // RDM sensor type enum (SENSOR_DEFINITION)
    bool    valid;      // a value was read
    bool    poll;       // include this sensor in live polling + the graph (per-UID, persisted)
    uint32_t pollMs;    // millis() of the last live read (rate-limits polling to ~1 Hz/sensor)
};
struct RdmDevice {
    rdm_uid_t uid;
    uint16_t  universe;          // DMX universe (output) this fixture lives on
    uint8_t   rdmLine;           // RDM engine line index (which transceiver output) to reach it on
    uint16_t  startAddr;
    uint16_t  footprint;
    uint16_t  modelId;
    uint16_t  productCategory;   // DEVICE_INFO product category
    uint32_t  swVersionId;       // DEVICE_INFO software version id (numeric)
    uint16_t  subDeviceCount;
    uint8_t   personality;
    uint8_t   personalityCount;
    bool      identifying;
    char      swLabel[33];       // SOFTWARE_VERSION_LABEL
    char      mfgLabel[33];      // MANUFACTURER_LABEL
    char      modelDesc[33];     // DEVICE_MODEL_DESCRIPTION
    char      deviceLabel[33];   // DEVICE_LABEL (user-assignable)
    uint8_t   sensorCount;
    RdmSensor sensors[RDM_MAX_SENSORS];
    // Art-Net BackgroundQueue harvest: last STATUS_MESSAGE seen for this device (0 type = healthy).
    // The message data values are parsed but not stored: the UI shows only type/id/count, and this
    // struct is arrayed x64 twice, so each byte here costs ~128 B of DRAM (tight on the classic ESP32).
    uint8_t   statusType;        // RDM_STATUS_* of the highest-severity queued message (0 = none)
    uint16_t  statusMsgId;       // STATUS_MESSAGE_ID of that message
    uint8_t   statusCount;       // number of messages in the last harvest
};
// RDM device tables are dynamically allocated at boot (rdmAllocTables), sized to the RAM the
// board actually has. This is the single biggest RAM consumer in the firmware: each RdmDevice
// is ~350 B and there are TWO full tables (rdmDevices here + g_adTab in artnet_rdm.h) plus
// g_savedPoll, so 64 devices is ~45 KB of DRAM -- most of the free heap on a classic ESP32.
// rdmAllocTables() auto-detects: PSRAM present -> full cap from PSRAM; big internal RAM (S3)
// -> full cap; a plain classic ESP32 -> a small cap so the web server keeps its headroom.
// cfg.rdmMaxDev overrides the auto value (0 = auto). RDM_HW_MAX is the hard ceiling and also
// sizes the couple of small fixed discovery buffers (uids[], the ArtTod packet).
static constexpr int RDM_HW_MAX = 64;
static int        g_rdmMaxDev = RDM_HW_MAX;   // effective cap, set in rdmAllocTables() (1..RDM_HW_MAX)
static RdmDevice* rdmDevices  = nullptr;      // [g_rdmMaxDev], allocated in rdmAllocTables()
static int       rdmCount      = 0;
static bool      rdmScanned    = false;       // a discovery has completed at least once
static volatile bool rdmBusy   = false;       // discovery in progress
static uint32_t  rdmLastScanMs = 0;

// Single-slot request mailboxes: set by the async WS task, consumed in loop().
static volatile bool rdmDiscoverReq = false;
static volatile int  rdmDiscReqLine = -1;          // discovery target: -1 = every line, >=0 = one line
static volatile bool rdmSetAddrReq  = false;
static volatile bool rdmIdentifyReq = false;
static rdm_uid_t     rdmSetUid      = {0, 0};
static rdm_uid_t     rdmIdentUid    = {0, 0};
static volatile uint16_t rdmReqAddr = 1;
static volatile bool rdmReqOn       = false;
// Extended controls (RDM tab): set personality, set device label, toggle live sensor polling.
static volatile bool rdmSetPersReq  = false;
static rdm_uid_t     rdmPersUid     = {0, 0};
static volatile uint8_t rdmReqPers  = 1;
static volatile bool rdmSetLabelReq = false;
static rdm_uid_t     rdmLabelUid    = {0, 0};
static char          rdmReqLabel[33] = {0};

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

// ── per-sensor live-poll selection, persisted in NVS (the RDM tab switches) ──
// Each (device UID, sensor) can be enabled individually for background polling + graphing.
// The enabled set is stored as "UID:mask" entries so it survives reboots and re-discovery.
struct RdmPollSave { uint64_t uid; uint8_t mask; };
static RdmPollSave*  g_savedPoll  = nullptr;   // [g_rdmMaxDev], allocated in rdmAllocTables()
static int           g_savedPollN = 0;
static volatile bool g_pollAny    = false;   // any sensor enabled -> the round-robin runs
static volatile bool rdmPollDirty = false;   // a switch changed -> loop() persists

static inline uint64_t uidPack64(const rdm_uid_t& u) { return ((uint64_t)u.man_id << 32) | u.dev_id; }

static void rdmRecalcPollAny() {
    for (int i = 0; i < rdmCount; i++)
        for (int s = 0; s < rdmDevices[i].sensorCount; s++)
            if (rdmDevices[i].sensors[s].poll) { g_pollAny = true; return; }
    g_pollAny = false;
}
static void rdmLoadPoll() {
    if (!g_savedPoll) return;   // tables not allocated yet -> nothing to restore into (guards the null write that crash-looped boot)
    prefs.begin(PREF_NS, true);
    String s = prefs.isKey("rdmpoll") ? prefs.getString("rdmpoll", "") : "";
    prefs.end();
    g_savedPollN = 0;
    for (int i = 0; i < (int)s.length() && g_savedPollN < g_rdmMaxDev; ) {
        int c = s.indexOf(',', i); if (c < 0) c = s.length();
        int col = s.indexOf(':', i);
        if (col > i && col < c) {
            g_savedPoll[g_savedPollN].uid  = strtoull(s.substring(i, col).c_str(), nullptr, 16);
            g_savedPoll[g_savedPollN].mask = (uint8_t)strtoul(s.substring(col + 1, c).c_str(), nullptr, 16);
            g_savedPollN++;
        }
        i = c + 1;
    }
}
// Restore each discovered device's sensor.poll from the saved mask (run after a discovery).
static void rdmApplySavedPoll() {
    for (int i = 0; i < rdmCount; i++) {
        uint8_t mask = 0;
        uint64_t u = uidPack64(rdmDevices[i].uid);
        for (int k = 0; k < g_savedPollN; k++) if (g_savedPoll[k].uid == u) { mask = g_savedPoll[k].mask; break; }
        for (int s = 0; s < RDM_MAX_SENSORS; s++) rdmDevices[i].sensors[s].poll = (mask >> s) & 1;
    }
    rdmRecalcPollAny();
}
// Rebuild the saved map from the live flags and persist it (called from loop() on dirty).
static void rdmSavePoll() {
    g_savedPollN = 0;
    String out;
    for (int i = 0; i < rdmCount; i++) {
        uint8_t mask = 0;
        for (int s = 0; s < rdmDevices[i].sensorCount && s < 8; s++)
            if (rdmDevices[i].sensors[s].poll) mask |= (1 << s);
        if (!mask) continue;
        if (g_savedPollN < g_rdmMaxDev) {
            g_savedPoll[g_savedPollN].uid  = uidPack64(rdmDevices[i].uid);
            g_savedPoll[g_savedPollN].mask = mask; g_savedPollN++;
        }
        char buf[24];
        snprintf(buf, sizeof(buf), "%012llX:%X", (unsigned long long)uidPack64(rdmDevices[i].uid), mask);
        if (out.length()) out += ",";
        out += buf;
    }
    prefs.begin(PREF_NS, false);
    prefs.putString("rdmpoll", out);
    prefs.end();
}

#ifdef DMX_RMT
// Art-Net 4 RDM bridge (ArtPoll/ArtTod*/ArtRdm). Uses rdm_rmt.h's raw relay + discovery
// primitives and the RdmDevice table / rdmDevices[] declared above. See docs/rdm.md.
#include "artnet_rdm.h"
#endif

// Allocate the RDM device tables sized to the RAM this board actually has. Called once at boot
// (setup, right after loadConfig). PSRAM present -> full cap from PSRAM; an S3-class chip -> full
// cap; a plain classic ESP32 -> a small cap so the WiFi/web stack keeps its heap headroom. A
// non-zero cfg.rdmMaxDev forces a specific cap. The two big RdmDevice tables (rdmDevices + g_adTab)
// plus g_savedPoll are the firmware's largest RAM users, so this is the main heap lever.
static bool rdmAllocTables() {
    const bool   psram = heap_caps_get_total_size(MALLOC_CAP_SPIRAM) > 0;
    esp_chip_info_t chip; esp_chip_info(&chip);
    // Auto-size on the CHIP, not on free internal RAM. heap_caps_get_total_size(INTERNAL)
    // is what's left after the firmware's static .bss/.data, so it SHRINKS as the image
    // grows -- an ESP32-S3 (512 KB SRAM) dropped below a fixed 380 KB threshold once the
    // firmware got big enough and silently fell back to the 16-device cap (found 16 instead
    // of 64 fixtures). The chip model is footprint-independent: classic ESP32 (~300 KB, tight
    // once WiFi+web+DMX are up) keeps the small table; every S3-class part gets the full cap.
    int cap; const char* how;
    if      (cfg.rdmMaxDev > 0)         { cap = cfg.rdmMaxDev; how = "manual"; }
    else if (psram)                    { cap = RDM_HW_MAX;    how = "auto/psram"; }
    else if (chip.model != CHIP_ESP32) { cap = RDM_HW_MAX;    how = "auto/s3"; }    // S3 & other large-SRAM parts
    else                               { cap = 16;            how = "auto/esp32"; } // classic ESP32 (~300 KB)
    if (cap < 1) cap = 1;
    if (cap > RDM_HW_MAX) cap = RDM_HW_MAX;
    g_rdmMaxDev = cap;

    // Prefer PSRAM for the big tables, fall back to internal when there is none.
    auto grab = [](int n, size_t sz) -> void* {
        void* p = heap_caps_calloc(n, sz, MALLOC_CAP_SPIRAM);
        return p ? p : heap_caps_calloc(n, sz, MALLOC_CAP_8BIT);
    };
    rdmDevices  = (RdmDevice*)  grab(cap, sizeof(RdmDevice));
    g_savedPoll = (RdmPollSave*)grab(cap, sizeof(RdmPollSave));
    bool ok = rdmDevices && g_savedPoll;
    size_t bytes = (size_t)cap * (sizeof(RdmDevice) + sizeof(RdmPollSave));
#ifdef DMX_RMT
    g_adTab = (RdmDevice*)grab(cap, sizeof(RdmDevice));
    ok = ok && g_adTab;
    bytes += (size_t)cap * sizeof(RdmDevice);
#endif
    Serial.printf("[RDM] device cap=%d (%s), tables ~%u B %s%s\n",
        cap, how, (unsigned)bytes, psram ? "in PSRAM" : "internal",
        ok ? "" : "  -- ALLOC FAILED, RDM disabled");
    if (!ok) g_rdmMaxDev = 0;   // no memory -> RDM stays inert (every loop is bounded by g_rdmMaxDev)
    return ok;
}

// ---- RDM transport adapter -------------------------------------------------------------
// The DMX_RMT build talks RDM over RMT-TX + a RX-only UART (rdm_rmt.h); other builds use the
// esp_dmx controller. Both back ends present this same small op-set to the app layer below, so
// dropping esp_dmx later is just deleting the #else half.
#ifdef DMX_RMT
static int  rdmOpDiscover(rdm_uid_t* u, int max)                                      { return rdmRmtDiscover(u, max); }
static bool rdmOpDeviceInfo(const rdm_uid_t& uid, rdm_device_info_t* i, rdm_ack_t* a) { return rdmRmtGetDeviceInfo(uid, i, a); }
static bool rdmOpSwLabel(const rdm_uid_t& uid, char* b, size_t n, rdm_ack_t* a)       { return rdmRmtGetSwLabel(uid, b, n, a); }
static bool rdmOpSensorDef(const rdm_uid_t& uid, uint8_t s, rdm_sensor_definition_t* d, rdm_ack_t* a) { return rdmRmtGetSensorDef(uid, s, d, a); }
static bool rdmOpSensorVal(const rdm_uid_t& uid, uint8_t s, rdm_sensor_value_t* v, rdm_ack_t* a)      { return rdmRmtGetSensorValue(uid, s, v, a); }
static bool rdmOpSetAddr(const rdm_uid_t& uid, uint16_t addr, rdm_ack_t* a)           { return rdmRmtSetStartAddr(uid, addr, a); }
static bool rdmOpSetIdentify(const rdm_uid_t& uid, bool on, rdm_ack_t* a)             { return rdmRmtSetIdentify(uid, on, a); }
#else
static dmx_port_t rdmPort() { return (dmx_port_t)cfg.outputs[rdmOut].port; }
static int  rdmOpDiscover(rdm_uid_t* u, int max)                                      { return rdm_discover_devices_simple(rdmPort(), u, max); }
static bool rdmOpDeviceInfo(const rdm_uid_t& uid, rdm_device_info_t* i, rdm_ack_t* a) { return rdm_send_get_device_info(rdmPort(), (rdm_uid_t*)&uid, RDM_SUB_DEVICE_ROOT, i, a); }
static bool rdmOpSwLabel(const rdm_uid_t& uid, char* b, size_t n, rdm_ack_t* a)       { return rdm_send_get_software_version_label(rdmPort(), (rdm_uid_t*)&uid, RDM_SUB_DEVICE_ROOT, b, n, a); }
static bool rdmOpSensorDef(const rdm_uid_t& uid, uint8_t s, rdm_sensor_definition_t* d, rdm_ack_t* a) {
    rdm_request_t req = { (rdm_uid_t*)&uid, RDM_SUB_DEVICE_ROOT, RDM_CC_GET_COMMAND, RDM_PID_SENSOR_DEFINITION, "b$", &s, 1 };
    return rdm_send_request(rdmPort(), &req, "bbbbwwwwba$", d, sizeof(*d), a);
}
static bool rdmOpSensorVal(const rdm_uid_t& uid, uint8_t s, rdm_sensor_value_t* v, rdm_ack_t* a) {
    rdm_request_t req = { (rdm_uid_t*)&uid, RDM_SUB_DEVICE_ROOT, RDM_CC_GET_COMMAND, RDM_PID_SENSOR_VALUE, "b$", &s, 1 };
    return rdm_send_request(rdmPort(), &req, "bwwww$", v, sizeof(*v), a);
}
static bool rdmOpSetAddr(const rdm_uid_t& uid, uint16_t addr, rdm_ack_t* a)           { return rdm_send_set_dmx_start_address(rdmPort(), (rdm_uid_t*)&uid, RDM_SUB_DEVICE_ROOT, addr, a); }
static bool rdmOpSetIdentify(const rdm_uid_t& uid, bool on, rdm_ack_t* a)             { return rdm_send_set_identify_device(rdmPort(), (rdm_uid_t*)&uid, RDM_SUB_DEVICE_ROOT, on ? 1 : 0, a); }
#endif

// Full discovery sweep + per-device GET device-info & software-version label.
// Blocks the bus for the duration (~hundreds of ms) — DMX output pauses briefly.
// (DMX_RMT builds run discovery incrementally instead — see artnet_rdm.h — so this
// blocking sweep is only compiled for the esp_dmx back end.)
#ifndef DMX_RMT
static void rdmDoDiscover() {
    rdmBusy = true;
    rdm_uid_t uids[RDM_HW_MAX];
    int n = rdmOpDiscover(uids, g_rdmMaxDev);
    if (n > g_rdmMaxDev) n = g_rdmMaxDev;
    rdmCount = 0;
    for (int i = 0; i < n; i++) {
        RdmDevice d = {};
        d.uid = uids[i];
        rdm_ack_t ack;
        rdm_device_info_t info;
        if (rdmOpDeviceInfo(uids[i], &info, &ack) && ack.type == RDM_RESPONSE_TYPE_ACK) {
            d.startAddr        = info.dmx_start_address;
            d.footprint        = info.footprint;
            d.modelId          = info.model_id;
            d.subDeviceCount   = info.sub_device_count;
            d.personality      = info.personality.current;
            d.personalityCount = info.personality.count;
            d.sensorCount      = info.sensor_count > RDM_MAX_SENSORS
                                     ? RDM_MAX_SENSORS : info.sensor_count;
        }
        rdmOpSwLabel(uids[i], d.swLabel, sizeof(d.swLabel), &ack);

        // Sensors (E1.20): per sensor read its definition (name/unit) then value.
        // Sensors are numbered 0..count-1; definition and value are independent —
        // tolerate either being unsupported.
        for (uint8_t s = 0; s < d.sensorCount; s++) {
            RdmSensor& sen = d.sensors[s];
            rdm_ack_t sack;
            uint8_t   sn = s;

            rdm_sensor_definition_t def = {};
            if (rdmOpSensorDef(uids[i], sn, &def, &sack) && sack.type == RDM_RESPONSE_TYPE_ACK) {
                strlcpy(sen.name, def.description[0] ? def.description : rdmTypeStr(def.type),
                        sizeof(sen.name));
                strlcpy(sen.unit, rdmUnitStr(def.unit), sizeof(sen.unit));
            }

            rdm_sensor_value_t val = {};
            if (rdmOpSensorVal(uids[i], sn, &val, &sack) && sack.type == RDM_RESPONSE_TYPE_ACK) {
                sen.value = val.present_value;
                sen.valid = true;
                if (!sen.name[0]) strlcpy(sen.name, "Sensor", sizeof(sen.name));
            }
        }
        rdmDevices[rdmCount++] = d;
    }
    rdmApplySavedPoll();     // restore each fixture's per-sensor poll switches
    rdmScanned    = true;
    rdmLastScanMs = millis();
    rdmBusy       = false;
    Serial.printf("[RDM] discovery: %d device(s)\n", rdmCount);
}
#endif  // !DMX_RMT

// Called once per DMX cycle from the DMX task (the sole bus owner); does work only when a
// request is queued. On the DMX_RMT build this runs the whole RDM transaction over RMT-TX +
// UART-RX inline -- no peripheral switch, the RDM output never leaves RMT.
// Point the RDM engine at a fixture's line before a per-device transaction (no-op on the esp_dmx
// build, which has a single RDM port).
static inline void rdmSelectLine(const RdmDevice* d) {
#ifdef DMX_RMT
    if (d) rdmRmtSelect(d->rdmLine);
#endif
}
static void rdmService() {
    if (!rdmAvailable()) return;
    rdm_ack_t ack;

    if (rdmSetAddrReq) {
        rdmSetAddrReq = false;
        RdmDevice* d = rdmFind(rdmSetUid); rdmSelectLine(d);
        if (rdmOpSetAddr(rdmSetUid, rdmReqAddr, &ack)) {
            if (d) d->startAddr = rdmReqAddr;
            Serial.printf("[RDM] set " UIDSTR " addr=%u\n", UID2STR(rdmSetUid), rdmReqAddr);
        }
    }
    if (rdmIdentifyReq) {
        rdmIdentifyReq = false;
        RdmDevice* d = rdmFind(rdmIdentUid); rdmSelectLine(d);
        if (rdmOpSetIdentify(rdmIdentUid, rdmReqOn, &ack)) {
            if (d) d->identifying = rdmReqOn;
        }
    }
#ifdef DMX_RMT
    // Art-Net RDM relay + INCREMENTAL discovery: one bus transaction per DMX frame so RDM
    // (background discovery, ArtTodRequest, ArtRdm GET/SET) never stalls the 40 Hz output.
    // Also consumes rdmDiscoverReq, so the web "Discover" button runs incrementally too.
    artRdmService();
#else
    if (rdmDiscoverReq) {
        rdmDiscoverReq = false;
        rdmDoDiscover();   // blocking sweep (esp_dmx build; pauses DMX for the duration)
    }
#endif
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
    // Count this frame against every output listening on its universe (for per-output input fps).
    for (int o = 0; o < MAX_OUTPUTS; o++)
        if (cfg.outputs[o].enabled && cfg.outputs[o].universe == universe) inFrameCnt[o]++;
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
    e.uni   = (uint16_t)cfg.outputs[outIdx].universe;
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
// The rate we actually clock onto the DMX wire (steady ~40 Hz while an output is ready),
// counted from the transmit side -- not the input frame rate. 0 when the output isn't running.
static float outFpsLive(int i) {
    return (i >= 0 && i < MAX_OUTPUTS && outReady[i]) ? outTxFps[i] : 0.0f;
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
    // Skip under heap pressure. getFreeHeap() alone is not enough: the async WS send copies
    // the frame into a make_shared<vector> that needs ONE CONTIGUOUS block, so a fragmented
    // heap (heavy under a packet flood) can throw bad_alloc even with lots of total free.
    if (ESP.getFreeHeap() < 40000 || ESP.getMaxAllocHeap() < 12000) return;
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
    // Per-output INPUT fps: close each output's 1 s input-frame window (so a universe that stops
    // being sent decays to 0), then write it. Counted per output-universe in updateSender().
    uint32_t nowMs = millis();
    for (int i = 0; i < MAX_OUTPUTS; i++) {
        if (nowMs - inWinMs[i] >= 1000) {
            inFpsOut[i] = (float)inFrameCnt[i] * 1000.0f / (float)(nowMs - inWinMs[i]);
            inFrameCnt[i] = 0; inWinMs[i] = nowMs;
        }
        uint16_t inI = (uint16_t)(inFpsOut[i] * 10.0f < 65535.0f ? inFpsOut[i] * 10.0f : 65535.0f);
        wsBuf[528 + 2 * MAX_OUTPUTS + 2 * i]     = inI >> 8;
        wsBuf[528 + 2 * MAX_OUTPUTS + 2 * i + 1] = inI & 0xFF;
    }
    // Fixed tail: fixtures(2) rdmTx(4) rdmRx(4)
    int t = 528 + 4 * MAX_OUTPUTS;
    uint16_t nf = (uint16_t)rdmCount;
    uint32_t rtx = 0, rrx = 0;
#ifdef DMX_RMT
    rtx = g_rdmSent; rrx = g_rdmRecv;
#endif
    wsBuf[t]   = nf >> 8;   wsBuf[t+1] = nf & 0xFF;
    wsBuf[t+2] = rtx >> 24; wsBuf[t+3] = (rtx>>16)&0xFF; wsBuf[t+4] = (rtx>>8)&0xFF; wsBuf[t+5] = rtx & 0xFF;
    wsBuf[t+6] = rrx >> 24; wsBuf[t+7] = (rrx>>16)&0xFF; wsBuf[t+8] = (rrx>>8)&0xFF; wsBuf[t+9] = rrx & 0xFF;
    // Only push if the async TCP queues have room, so a slow client never
    // backs up memory or blocks.
    // Belt-and-suspenders: a failed async allocation inside the WS stack throws std::bad_alloc;
    // catching it degrades a push to a no-op instead of letting the uncaught throw abort() the CPU.
    if (ws.availableForWriteAll()) {
        try { ws.binaryAll(wsBuf, WS_FRAME_LEN); } catch (...) {}
    }
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
    if (msg.indexOf("\"rdm_discover\"") >= 0) {   // optional "line":N (else -1 = every universe)
        int k = msg.indexOf("\"line\":");
        rdmDiscReqLine = (k >= 0) ? msg.substring(k + 7).toInt() : -1;
        rdmDiscoverReq = true;
        return;
    }
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
    if (msg.indexOf("\"rdm_setpers\"") >= 0) {
        rdm_uid_t u;
        int k = msg.indexOf("\"pers\":");
        if (rdmParseUid(msg, u) && k >= 0) {
            int p = msg.substring(k + 7).toInt();
            if (p >= 1 && p <= 255) { rdmPersUid = u; rdmReqPers = (uint8_t)p; rdmSetPersReq = true; }
        }
        return;
    }
    if (msg.indexOf("\"rdm_setlabel\"") >= 0) {
        rdm_uid_t u;
        int k = msg.indexOf("\"label\":\"");
        if (rdmParseUid(msg, u) && k >= 0) {
            int s = k + 9, e = msg.indexOf('"', s);
            if (e > s) {
                strlcpy(rdmReqLabel, msg.substring(s, e).c_str(), sizeof(rdmReqLabel));
                rdmLabelUid = u; rdmSetLabelReq = true;
            }
        }
        return;
    }
    if (msg.indexOf("\"rdm_sensorpoll\"") >= 0) {   // master switch: enable/disable every sensor
        bool on = (msg.indexOf("\"on\":true") >= 0);
        for (int i = 0; i < rdmCount; i++)
            for (int s = 0; s < rdmDevices[i].sensorCount; s++) rdmDevices[i].sensors[s].poll = on;
        rdmRecalcPollAny();
        rdmPollDirty = true;
        return;
    }
    if (msg.indexOf("\"rdm_sensorsel\"") >= 0) {    // a sensor switch (poll + graph); sensor=-1 -> whole fixture
        rdm_uid_t u;
        int k = msg.indexOf("\"sensor\":");
        if (rdmParseUid(msg, u) && k >= 0) {
            int sn = msg.substring(k + 9).toInt();
            bool on = (msg.indexOf("\"on\":true") >= 0);
            RdmDevice* d = rdmFind(u);
            if (d) {
                if (sn < 0) { for (int s = 0; s < d->sensorCount; s++) d->sensors[s].poll = on; }  // all of this fixture
                else if (sn < d->sensorCount) d->sensors[sn].poll = on;
                rdmRecalcPollAny();
                rdmPollDirty = true;
            }
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
// Art-Net callback (esp_dmx builds; the DMX_RMT build parses Art-Net itself in
// artnet_rdm.h so it can also handle the RDM opcodes on the same 6454 socket).
// ---------------------------------------------------------------------------
#ifndef DMX_RMT
static void onArtDmx(uint16_t universe, uint16_t length, uint8_t, uint8_t* data) {
    // Art-Net carries no per-packet priority, so it joins the merge at the default.
    routeFrame((int)universe, data, length, (uint32_t)artnet.getSenderIp(), 0, DEFAULT_PRIORITY);
}
#endif

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
        if (pktLen <= 0) return;                          // nothing pending
        // A runt packet (stray multicast, IGMP artefact, port scan) must still be CONSUMED, else it
        // lingers in the socket and every subsequent parsePacket() re-logs a NetworkUdp error -> flood.
        if (pktLen < SACN_MIN_LEN) { udp.read(sacnBuf, sizeof(sacnBuf)); continue; }
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
        // Do NOT reject by this socket's output universe. All the per-output sACN sockets share
        // port 5568 (SO_REUSEADDR), and lwIP hands a UNICAST sACN packet to just one of them --
        // often not the socket whose multicast group matches. Rejecting here dropped unicast sACN
        // whenever >1 output was enabled (uni-1 landing on the uni-2 socket, etc.). Route by the
        // packet's own universe instead: routeFrame() maps universe -> the matching output(s), and
        // ignores a universe no output listens to. Multicast still works (each group -> its joiner).
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

// Sending a dynamically-built JSON body allocates a response buffer of ~body.length(); under heap
// pressure that operator new throws std::bad_alloc, and an uncaught throw inside the AsyncTCP task
// aborts the board. That rebooted the gateway when the web UI polled /rdm.json (which grows with the
// number of discovered fixtures) or /dmx.json while the heap was low under load. Guard on the largest
// free block, and catch as a hard backstop, so a status poll degrades to a 503 instead of a reboot.
static void sendJsonSafe(AsyncWebServerRequest* req, const String& body) {
    if ((int)ESP.getMaxAllocHeap() < (int)body.length() + 12000) {
        try { req->send(503, "application/json", "{\"busy\":1}"); } catch (...) {}
        return;
    }
    try {
        req->send(200, "application/json", body);
    } catch (...) {
        try { req->send(503, "application/json", "{\"busy\":1}"); } catch (...) {}
    }
}

// Minimal JSON string escaper for values that can legally contain quotes/backslashes
// (WiFi SSIDs). Keeps the hand-rolled JSON in handleInfoJson / the scan endpoint valid.
static String jsonEsc(const String& s) {
    String o; o.reserve(s.length() + 4);
    for (size_t i = 0; i < s.length(); i++) {
        char c = s[i];
        if (c == '"' || c == '\\') { o += '\\'; o += c; }
        else if (c == '\n') o += "\\n";
        else if (c == '\r') o += "\\r";
        else if (c == '\t') o += "\\t";
        else if ((uint8_t)c < 0x20) continue;   // drop other control chars
        else o += c;
    }
    return o;
}

// Escape a value for interpolation into HTML text (the setup-done page shows the SSID /
// hostname the user typed). Covers the five HTML-significant characters.
static String htmlEsc(const String& s) {
    String o; o.reserve(s.length() + 8);
    for (size_t i = 0; i < s.length(); i++) {
        char c = s[i];
        switch (c) {
            case '&': o += "&amp;";  break;
            case '<': o += "&lt;";   break;
            case '>': o += "&gt;";   break;
            case '"': o += "&quot;"; break;
            case '\'':o += "&#39;";  break;
            default:  o += c;
        }
    }
    return o;
}

static void handleVersionJson(AsyncWebServerRequest* req) {
    // latest is null when the check has not succeeded yet -- NOT current. It used to fall back to
    // FIRMWARE_VERSION, which made "I couldn't find out" indistinguishable from "you're up to
    // date" and silently hid real updates (a device sat on 1.0.166 reporting latest=1.0.166 while
    // 1.0.171 was out). Unknown is its own state; say so. Nothing in the UI reads this field --
    // index.html gets the release list straight from the GitHub API -- it is here for API users.
    String j = "{\"current\":\"";
    j += FIRMWARE_VERSION;
    j += "\",\"latest\":";
    if (latestVersion.length() > 0) { j += "\""; j += latestVersion; j += "\""; }
    else                            { j += "null"; }
    j += ",\"update\":";
    j += updateAvailable ? "true" : "false";
    j += "}";
    sendJsonSafe(req, j);
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

static void handleSendersJson(AsyncWebServerRequest* req) { sendJsonSafe(req, sendersJson()); }
static void handleLogJson(AsyncWebServerRequest* req)     { sendJsonSafe(req, logJson()); }

// Push senders + log over the WebSocket (one persistent connection) so the
// browser doesn't have to poll two HTTP endpoints every 2 s.
static void wsPushMeta() {
    if (ws.count() == 0 || !ws.availableForWriteAll()) return;
    // The meta JSON is several KB and the WS send needs a contiguous block for it, so guard on
    // the LARGEST free block, not just total free: under a flood the heap fragments and total
    // free (~100 KB) stays high while the biggest block shrinks, which is how ws.textAll() threw
    // bad_alloc and abort()ed the board. try/catch is the hard backstop against that reboot.
    if (ESP.getFreeHeap() < 40000 || ESP.getMaxAllocHeap() < 24000) return;
    try {
        String m = "{\"meta\":1,\"senders\":";
        m += sendersJson();
        m += ",\"log\":";
        m += logJson();
        m += "}";
        ws.textAll(m);
    } catch (...) {}
}

// Static pages are served straight from PROGMEM (zero heap). Dynamic values
// are fetched client-side from /info.json.
// setup.html is small and served plain (not gzipped — see GZIP_PAGES in extra_scripts.py).
static void handleSetupGet(AsyncWebServerRequest* req) {
    httpReqCount++;
    AsyncWebServerResponse* r = req->beginResponse_P(200, "text/html", SETUP_HTML);
    r->addHeader("Cache-Control", "no-cache");
    req->send(r);
}

static void handleRoot(AsyncWebServerRequest* req) {
    httpReqCount++;
    // During first-run setup the device has no real network, so "/" is the setup page —
    // that way a phone joining the LuxDMX-setup AP lands straight on it (captive portal).
    if (g_setupPortal) return handleSetupGet(req);
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
// BOARD_LUXDMX_V6 is NOT set by any shipped env — the board has no dedicated build, it is the
// esp32s3dev build plus the "LuxDMX v6" board template applied in /config (see platformio.ini).
// So a released board reports "esp32s3-devkitc-1" like any S3, and the copper-pin locks come from
// picking the board in /config, which sticks across reboots (cfg.boardSel). This branch is the
// source-build escape hatch: build esp32s3dev with -DBOARD_LUXDMX_V6 for a firmware that reports
// "luxdmx_v6" directly.
// USE_ETH_SPI alone is too coarse to key the id on — esp32dev/esp32s3dev set it too so a DIY user
// can add a W5500 — which is why the id needs the explicit flag, not the presence of the W5500 path.
#if defined(BOARD_LUXDMX_V6)
static const char BOARD_ID[] = "luxdmx_v6";
#elif defined(USE_ETH_RMII) || defined(USE_ETHERNET)
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
    j += "\"ledBrR\":";     j += cfg.ledBrR;             j += ",";   // 5-LED panel per-colour brightness (0-255 PWM)
    j += "\"ledBrG\":";     j += cfg.ledBrG;             j += ",";
    j += "\"ledBrY\":";     j += cfg.ledBrY;             j += ",";
    j += "\"ledBrB\":";     j += cfg.ledBrB;             j += ",";
    j += "\"ledBrW\":";     j += cfg.ledBrW;             j += ",";
    j += "\"rdmOut\":";     j += rdmOut;                 j += ",";
    j += "\"chip\":\"";     j += ESP.getChipModel();     j += "\",";  // e.g. "ESP32" / "ESP32-S3" (RDM cap auto-sizes off this)
    j += "\"rdmMax\":";     j += g_rdmMaxDev;            j += ",";   // effective RDM device cap (auto-sized to the chip's RAM)
    j += "\"artnetRdm\":";  j += cfg.artnetRdm ? "true" : "false"; j += ",";
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
    // On-unit controls (issue #24): rotary encoder + buttons that drive the display menu.
    j += "\"encA\":";       j += cfg.encA;               j += ",";
    j += "\"encB\":";       j += cfg.encB;               j += ",";
    j += "\"encSw\":";      j += cfg.encSw;              j += ",";
    j += "\"encSteps\":";   j += cfg.encSteps;           j += ",";
    j += "\"encReverse\":"; j += cfg.encReverse ? "true" : "false"; j += ",";
    j += "\"btn1Pin\":";    j += cfg.btn1Pin;            j += ",";
    j += "\"btn1Act\":";    j += cfg.btn1Act;            j += ",";
    j += "\"btn2Pin\":";    j += cfg.btn2Pin;            j += ",";
    j += "\"btn2Act\":";    j += cfg.btn2Act;            j += ",";
    j += "\"btn3Pin\":";    j += cfg.btn3Pin;            j += ",";
    j += "\"btn3Act\":";    j += cfg.btn3Act;            j += ",";
    j += "\"btn4Pin\":";    j += cfg.btn4Pin;            j += ",";
    j += "\"btn4Act\":";    j += cfg.btn4Act;            j += ",";
    j += "\"btnActiveHigh\":"; j += cfg.btnActiveHigh ? "true" : "false"; j += ",";
    j += "\"ctlUniMax\":";  j += cfg.ctlUniMax;          j += ",";
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
    // MUST be published: /config round-trips this through a hidden field. Without it the page
    // reads undefined, shows W5500, and writes 0 back on the next save — silently converting a
    // DM9051 box to W5500 and killing its wired link. See the wired selector in config.html.
    j += "\"ethSpiPhy\":"; j += cfg.ethSpiPhy;           j += ",";   // SPI chip: 0=W5500, 1=DM9051
    j += "\"ethW5500\":";  j += cfg.ethW5500 ? "true" : "false"; j += ",";   // module enabled (opt-in)
    j += "\"useEthernet\":"; j += cfg.useEthernet ? "true" : "false"; j += ",";
    j += "\"ethFallback\":"; j += g_ethFallback ? "true" : "false"; j += ",";   // wired configured but running on WiFi/AP fallback (status LED = orange)
#if defined(HAS_WIRED_ETH)
    j += "\"hasEth\":true,";   // board has wired Ethernet → show the WiFi/Ethernet selector
#else
    j += "\"hasEth\":false,";
#endif
    j += "\"wifiMode\":";   j += cfg.wifiMode;           j += ",";
    j += "\"wifiSsid\":\""; j += jsonEsc(cfg.wifiSsid);  j += "\",";   // password is never exposed
    j += "\"apFallback\":"; j += cfg.apFallback ? "true" : "false"; j += ",";
    j += "\"linkLossMode\":"; j += cfg.linkLossMode;          j += ",";   // WIRED_FB_*
    j += "\"apPassword\":\""; j += cfg.apPassword;       j += "\",";
    j += "\"staticIp\":";   j += cfg.staticIp ? "true" : "false"; j += ",";
    j += "\"sip\":\"";      j += cfg.ip;                 j += "\",";
    j += "\"gateway\":\"";  j += cfg.gateway;            j += "\",";
    j += "\"subnet\":\"";   j += cfg.subnet;             j += "\",";
    j += "\"dns\":\"";      j += cfg.dns;                j += "\",";
    j += "\"autoUpdate\":"; j += cfg.autoUpdate ? "true" : "false"; j += ",";
    j += "\"board\":\"";    j += BOARD_ID;               j += "\",";   // DETECTED (compile-time) board id
    j += "\"boardSel\":\""; j += jsonEsc(cfg.boardSel);  j += "\",";   // board the user PICKED in /config ("" = never picked)
    j += "\"mcu\":\"";      j += MCU_ID;                 j += "\"";
    j += "}";
    sendJsonSafe(req, j);
}

// /dmx.json is ~2.3 KB (the 512-channel array dominates). Building it as one String and letting
// AsyncWebServer copy that into a single contiguous send buffer needs a big contiguous block -- which
// fails on a fragmented heap (the ESP32-S3 allocator keeps lots of total free but a small largest
// block, esp-idf #13588) and used to abort the board. So stream it instead: only the small header is
// a String; the channel array is generated on demand straight into AsyncWebServer's own ~1.4 KB
// segment buffer. No large contiguous allocation is ever needed, so the endpoint stays up even when
// the heap is badly fragmented (and never has to fall back to a 503).
static void handleDmxJson(AsyncWebServerRequest* req) {
    struct DmxJson {
        String head;                     // everything up to and including `"ch":[`  (~150 bytes)
        int    out    = 0;
        size_t headOff = 0;
        int    ch     = 1;               // 1..512
        char   cur[8]; size_t curLen = 0, curOff = 0;
        int    phase  = 0;               // 0 head, 1 channels, 2 footer, 3 done
        size_t footOff = 0;
    };
    std::shared_ptr<DmxJson> s;
    try { s = std::make_shared<DmxJson>(); } catch (...) {}
    if (!s) { try { req->send(503, "application/json", "{\"busy\":1}"); } catch (...) {} return; }
    s->out = viewOutput();
    char buf[32];
    snprintf(buf, sizeof(buf), "%.1f", fps);
    s->head  = "{\"fps\":"; s->head += buf; s->head += ",\"outfps\":[";
    for (int i = 0; i < MAX_OUTPUTS; i++) {
        snprintf(buf, sizeof(buf), "%.1f", outFpsLive(i));
        if (i) s->head += ',';
        s->head += buf;
    }
    s->head += "],\"rssi\":";  s->head += netRSSI();
    s->head += ",\"up\":\"";   s->head += uptimeStr();
    s->head += "\",\"heap\":"; s->head += ESP.getFreeHeap();
    s->head += ",\"manual\":"; s->head += manualMode ? "true" : "false";
    s->head += ",\"ch\":[";
    req->sendChunked("application/json", [s](uint8_t* b, size_t maxLen, size_t) -> size_t {
        size_t n = 0;
        if (s->phase == 0) {                         // stream the small header
            while (s->headOff < s->head.length() && n < maxLen) b[n++] = (uint8_t)s->head[s->headOff++];
            if (s->headOff < s->head.length()) return n;
            s->phase = 1;
        }
        if (s->phase == 1) {                         // stream the 512 channel values
            while (n < maxLen) {
                if (s->curOff >= s->curLen) {        // load the next channel token
                    if (s->ch > 512) { s->phase = 2; break; }
                    s->curLen = snprintf(s->cur, sizeof(s->cur), s->ch < 512 ? "%d," : "%d",
                                         dmxBuf[s->out][s->ch]);
                    s->curOff = 0; s->ch++;
                }
                while (s->curOff < s->curLen && n < maxLen) b[n++] = (uint8_t)s->cur[s->curOff++];
            }
            if (s->phase == 1) return n;             // buffer full mid-array; resume next call
        }
        if (s->phase == 2) {                         // closing "]}"
            static const char foot[] = "]}";
            while (s->footOff < 2 && n < maxLen) b[n++] = (uint8_t)foot[s->footOff++];
            if (s->footOff < 2) return n;
            s->phase = 3;
        }
        return n;                                    // phase 3: next call returns 0 -> complete
    });
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

// Live-tune the 5-LED panel per-colour brightness (0-255 PWM duty). Applies immediately
// (setLeds5 re-drives the PWM on the next ledTask tick); persists to NVS only with
// &save=1. Lets you balance the panel by eye without a reboot -- green/white are much
// brighter per mA than blue/yellow, so they want a lower duty.
//   GET /led/bright?r=180&g=45&y=200&b=255&w=45[&save=1]  (any subset of r/g/y/b/w)
static void handleLedBright(AsyncWebServerRequest* req) {
    auto grab = [&](const char* n, int& dst) {
        if (req->hasParam(n)) {
            int v = req->getParam(n)->value().toInt();
            dst = v < 0 ? 0 : (v > 255 ? 255 : v);
        }
    };
    grab("r", cfg.ledBrR); grab("g", cfg.ledBrG); grab("y", cfg.ledBrY);
    grab("b", cfg.ledBrB); grab("w", cfg.ledBrW);
    // test=1 lights ALL five LEDs at their brightness for calibration (10-min window,
    // so you can see and balance every colour at once); test=0 returns to normal.
    if (req->hasParam("test"))
        g_ledTestUntil = req->getParam("test")->value().toInt() != 0
                       ? (uint32_t)millis() + 600000u : 0;
    g_ledDirty = true;   // force setLeds5 to re-apply the new duty on the next tick
    if (req->hasParam("save") && req->getParam("save")->value().toInt() != 0)
        g_artCfgDirty = true;   // loop() persists via saveConfig
    int test = (g_ledTestUntil && (int32_t)(g_ledTestUntil - (uint32_t)millis()) > 0) ? 1 : 0;
    char buf[128];
    snprintf(buf, sizeof(buf),
             "{\"ok\":true,\"r\":%d,\"g\":%d,\"y\":%d,\"b\":%d,\"w\":%d,\"test\":%d}",
             cfg.ledBrR, cfg.ledBrG, cfg.ledBrY, cfg.ledBrB, cfg.ledBrW, test);
    req->send(200, "application/json", buf);
}

// HTTP trigger for RDM ops -- a reliable, scriptable alternative to the WS control channel (the WS
// path drops triggers under load; this never does). Used by the e2e tests and bench tooling.
//   GET /rdm/discover
//   GET /rdm/setaddr?uid=MMMM:DDDDDDDD&addr=N
//   GET /rdm/identify?uid=MMMM:DDDDDDDD&on=1
static void handleRdmTrigger(AsyncWebServerRequest* req) {
    const String path = req->url();
    if (path.endsWith("/discover")) {
        rdmDiscReqLine = req->hasParam("line") ? req->getParam("line")->value().toInt() : -1;
        rdmDiscoverReq = true;
        req->send(200, "application/json", "{\"ok\":true,\"op\":\"discover\"}");
        return;
    }
    if (path.endsWith("/bqp")) {   // Art-Net BackgroundQueuePolicy (0..3 severity, 4 = off)
        int p = req->hasParam("p") ? req->getParam("p")->value().toInt() : 4;
        if (p < 0) p = 0; if (p > 15) p = 15;
        g_bqPolicy = (uint8_t)p; g_bqDirty = true;
        req->send(200, "application/json", "{\"ok\":true,\"op\":\"bqp\"}");
        return;
    }
    if (path.endsWith("/merge")) {   // set an output's merge mode (off/HTP/LTP), live + persisted
        int out  = req->hasParam("out")  ? req->getParam("out")->value().toInt()  : -1;
        int mode = req->hasParam("mode") ? req->getParam("mode")->value().toInt() : -1;
        if (out >= 0 && out < MAX_OUTPUTS && mode >= MERGE_OFF && mode <= MERGE_LTP) {
            cfg.outputs[out].mergeMode = mode; g_artCfgDirty = true;   // loop() persists via saveConfig
            req->send(200, "application/json", "{\"ok\":true,\"op\":\"merge\"}");
            return;
        }
        req->send(400, "application/json", "{\"ok\":false}");
        return;
    }
    if (req->hasParam("uid")) {
        String us = req->getParam("uid")->value();
        int colon = us.indexOf(':');
        if (colon > 0) {
            rdm_uid_t u;
            u.man_id = (uint16_t)strtoul(us.substring(0, colon).c_str(), nullptr, 16);
            u.dev_id = (uint32_t)strtoul(us.substring(colon + 1).c_str(), nullptr, 16);
            if (path.endsWith("/setaddr") && req->hasParam("addr")) {
                int a = req->getParam("addr")->value().toInt();
                if (a >= 1 && a <= 512) {
                    rdmSetUid = u; rdmReqAddr = (uint16_t)a; rdmSetAddrReq = true;
                    req->send(200, "application/json", "{\"ok\":true,\"op\":\"setaddr\"}"); return;
                }
            } else if (path.endsWith("/identify")) {
                rdmIdentUid = u;
                rdmReqOn = req->hasParam("on") && req->getParam("on")->value().toInt() != 0;
                rdmIdentifyReq = true;
                req->send(200, "application/json", "{\"ok\":true,\"op\":\"identify\"}"); return;
            }
        }
    }
    req->send(400, "application/json", "{\"ok\":false}");
}

// One RDM device as a JSON object (~420 bytes). Built on demand so /rdm.json can be *streamed*
// device-by-device: at 64 fixtures the whole document is ~27 KB, which sendJsonSafe() refuses to
// send in one piece on the fragmented S3 heap (largest contiguous block < 39 KB). Streaming never
// needs more than one device's worth of contiguous heap.
static String rdmDeviceJson(const RdmDevice& d) {
    String j; j.reserve(440);
    char uid[20];
    snprintf(uid, sizeof(uid), "%04X:%08lX", d.uid.man_id, (unsigned long)d.uid.dev_id);
    j += "{\"uid\":\"";     j += uid;          j += "\"";
    j += ",\"uni\":";       j += d.universe;
    j += ",\"addr\":";      j += d.startAddr;
    j += ",\"footprint\":"; j += d.footprint;
    j += ",\"model\":";     j += d.modelId;
    j += ",\"pers\":";      j += d.personality;
    j += ",\"persCount\":"; j += d.personalityCount;
    j += ",\"subs\":";      j += d.subDeviceCount;
    j += ",\"identify\":";  j += d.identifying ? "true" : "false";
    j += ",\"sw\":\"";      j += rdmJsonEsc(d.swLabel); j += "\"";
    j += ",\"mfg\":\"";     j += rdmJsonEsc(d.mfgLabel); j += "\"";
    j += ",\"modelName\":\""; j += rdmJsonEsc(d.modelDesc); j += "\"";
    j += ",\"label\":\"";   j += rdmJsonEsc(d.deviceLabel); j += "\"";
    j += ",\"cat\":";       j += d.productCategory;
    j += ",\"swVer\":";     j += (uint32_t)d.swVersionId;
    j += ",\"sensors\":[";
    bool firstSen = true;
    for (int s = 0; s < d.sensorCount; s++) {
        const RdmSensor& sn = d.sensors[s];
        if (!sn.valid) continue;
        if (!firstSen) j += ',';
        firstSen = false;
        j += "{\"name\":\"";  j += rdmJsonEsc(sn.name);
        j += "\",\"value\":"; j += sn.value;
        j += ",\"lo\":";      j += sn.lowest;
        j += ",\"hi\":";      j += sn.highest;
        j += ",\"rec\":";     j += sn.recorded;
        j += ",\"type\":";    j += sn.type;
        j += ",\"poll\":";    j += sn.poll ? "true" : "false";
        j += ",\"unit\":\"";  j += rdmJsonEsc(sn.unit); j += "\"}";
    }
    j += "]";
    // Art-Net BackgroundQueue harvest: last status message severity/id/count (0 = healthy).
    j += ",\"stType\":";  j += d.statusType;
    j += ",\"stId\":";    j += d.statusMsgId;
    j += ",\"stCount\":"; j += d.statusCount;
    j += "}";
    return j;
}

static void handleRdmJson(AsyncWebServerRequest* req) {
    struct RdmGen {
        String head; size_t headOff = 0;      // header up to and including `"devices":[`
        int    dev = 0;                       // next device index
        String cur; size_t curOff = 0, curLen = 0;  // current device (with its leading comma)
        int    phase = 0;                     // 0 head, 1 devices, 2 footer, 3 done
        size_t footOff = 0;
    };
    auto s = std::make_shared<RdmGen>();
    s->head  = "{\"available\":"; s->head += rdmAvailable() ? "true" : "false";
    s->head += ",\"busy\":";      s->head += rdmBusy ? "true" : "false";
    s->head += ",\"scanned\":";   s->head += rdmScanned ? "true" : "false";
#ifdef DMX_RMT
    s->head += ",\"artnetRdm\":"; s->head += g_artRdmEnabled ? "true" : "false";
    s->head += ",\"artPort\":";   s->head += artRdmPortAddr();
    s->head += ",\"discovering\":"; s->head += g_artDiscovering ? "true" : "false";
    s->head += ",\"discStage\":"; s->head += (int)g_discStage;   // 0 idle 1 search 2 enrich 3 publish
    s->head += ",\"discFound\":"; s->head += (int)g_discFound;   // devices seen so far
    s->head += ",\"discCur\":";   s->head += (int)g_discCur;     // enrich: current device (0-based)
    s->head += ",\"discSub\":";   s->head += (int)g_discSub;     // enrich: PID sub-step 0..7
    s->head += ",\"artTodReqs\":"; s->head += (uint32_t)g_artTodReqs;
    s->head += ",\"artRdmReqs\":"; s->head += (uint32_t)g_artRdmReqs;
    s->head += ",\"artFlushes\":"; s->head += (uint32_t)g_artFlushes;
    s->head += ",\"artPolls\":";   s->head += (uint32_t)g_artPolls;
    s->head += ",\"sensorPoll\":"; s->head += g_pollAny ? "true" : "false";   // any sensor switch enabled
    s->head += ",\"bqPolicy\":"; s->head += (int)g_bqPolicy;   // Art-Net BackgroundQueuePolicy (4 = off)
    s->head += ",\"rdmTx\":"; s->head += (uint32_t)g_rdmSent;   // RDM frames sent on the bus
    s->head += ",\"rdmRx\":"; s->head += (uint32_t)g_rdmRecv;   // valid RDM responses received
    s->head += ",\"discLine\":"; s->head += g_adLine;          // line currently being discovered
    s->head += ",\"rdmLines\":[";                              // the RDM-capable universes (per line)
    {
        bool firstL = true;
        for (int L = 0; L < MAX_OUTPUTS; L++) {
            int o = rdmOutForLine[L];
            if (o < 0) continue;
            if (!firstL) s->head += ",";
            firstL = false;
            s->head += "{\"line\":"; s->head += L; s->head += ",\"uni\":"; s->head += cfg.outputs[o].universe; s->head += "}";
        }
    }
    s->head += "]";
    s->head += ",\"outputs\":[";                               // per-output merge mode (for the RDM tab)
    {
        bool firstO = true;
        for (int i = 0; i < MAX_OUTPUTS; i++) {
            if (!cfg.outputs[i].enabled) continue;
            if (!firstO) s->head += ",";
            firstO = false;
            s->head += "{\"i\":"; s->head += i;
            s->head += ",\"uni\":"; s->head += cfg.outputs[i].universe;
            s->head += ",\"merge\":"; s->head += cfg.outputs[i].mergeMode; s->head += "}";
        }
    }
    s->head += "]";
#endif
    s->head += ",\"devices\":[";
    req->sendChunked("application/json", [s](uint8_t* b, size_t maxLen, size_t) -> size_t {
        size_t n = 0;
        if (s->phase == 0) {                         // small header
            while (s->headOff < s->head.length() && n < maxLen) b[n++] = (uint8_t)s->head[s->headOff++];
            if (s->headOff < s->head.length()) return n;
            s->phase = 1;
        }
        if (s->phase == 1) {                         // one device object at a time
            while (n < maxLen) {
                if (s->curOff >= s->curLen) {         // load the next device
                    if (s->dev >= rdmCount) { s->phase = 2; break; }
                    s->cur  = s->dev ? "," : "";
                    s->cur += rdmDeviceJson(rdmDevices[s->dev]);
                    s->curLen = s->cur.length(); s->curOff = 0; s->dev++;
                }
                while (s->curOff < s->curLen && n < maxLen) b[n++] = (uint8_t)s->cur[s->curOff++];
            }
            if (s->phase == 1) return n;              // buffer full mid-array; resume next call
        }
        if (s->phase == 2) {                         // closing "]}"
            static const char foot[] = "]}";
            while (s->footOff < 2 && n < maxLen) b[n++] = (uint8_t)foot[s->footOff++];
            if (s->footOff < 2) return n;
            s->phase = 3;
        }
        return n;                                    // phase 3: next call returns 0 -> complete
    });
}

static void handleConfigGet(AsyncWebServerRequest* req) {
    AsyncWebServerResponse* r = req->beginResponse_P(200, "text/html", CONFIG_HTML, CONFIG_HTML_LEN);
    r->addHeader("Content-Encoding", "gzip");
    r->addHeader("Cache-Control", "no-cache");   // revalidate after OTA (assets stay versioned)
    req->send(r);
}

// The dedicated RDM tab (fixture list + per-fixture detail, live sensors, controls).
static void handleRdmPage(AsyncWebServerRequest* req) {
    AsyncWebServerResponse* r = req->beginResponse_P(200, "text/html", RDM_HTML, RDM_HTML_LEN);
    r->addHeader("Content-Encoding", "gzip");
    r->addHeader("Cache-Control", "no-cache");
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
    sendJsonSafe(req, g_labels);
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
    // Forget the WiFi network so the next boot drops into the setup portal. Clearing
    // cfg.wifiSsid is what flips startWiFiStation() into setup mode; loop() additionally
    // wipes the WiFi NVS (pendingWifiReset). Also drop static IP + force STA so recovery
    // always comes back on DHCP, on WiFi, at the setup page.
    cfg.wifiSsid  = "";
    cfg.wifiPsk   = "";
    cfg.wifiMode  = NET_WIFI_STA;
    cfg.staticIp  = false;
    saveConfig();
    pendingWifiReset = true;
    pendingRebootAt  = millis() + 600;
}

// ---------------------------------------------------------------------------
// First-run setup portal (issue #45) — replaces the WiFiManager config portal
// ---------------------------------------------------------------------------
// GET /setup/scan — scan for nearby APs and return them as JSON for the "Join my WiFi"
// list. De-duplicates by SSID (keeps the strongest), drops hidden/empty SSIDs, sorts by
// signal. Shape: {"nets":[{"ssid":"Foo","rssi":-52,"lock":true}, ...]}.
static void handleSetupScan(AsyncWebServerRequest* req) {
    int n = WiFi.scanNetworks(false /*sync*/, false /*hidden*/);
    String j = "{\"nets\":[";
    bool first = true;
    for (int i = 0; i < n; i++) {
        String ssid = WiFi.SSID(i);
        if (ssid.length() == 0) continue;
        bool dup = false;                       // skip a weaker copy of an SSID we already listed
        for (int k = 0; k < i; k++) if (WiFi.SSID(k) == ssid) { dup = true; break; }
        if (dup) continue;
        if (!first) j += ",";
        first = false;
        j += "{\"ssid\":\""; j += jsonEsc(ssid); j += "\",\"rssi\":";
        j += (int)WiFi.RSSI(i);
        j += ",\"lock\":"; j += (WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "false" : "true");
        j += "}";
    }
    j += "]}";
    WiFi.scanDelete();
    req->send(200, "application/json", j);
}

// POST /setup — write the chosen network into the SAME cfg the normal config uses, then
// reboot into it. mode=sta stores SSID + password and selects STA; mode=ap selects the
// standalone AP and stores its optional password. We never validate the WiFi password
// here (no router to test against during setup); a wrong password just bounces the device
// back into this portal on next boot (cfg.wifiSsid stays set, but it can't associate — so
// the BOOT-button forces the portal, or "Reset WiFi" clears it).
static void handleSetupPost(AsyncWebServerRequest* req) {
    String mode, ssid, pw;
    argStr(req, "mode", mode);
    // Where to send the user after the reboot, and how to describe it. STA joins their
    // router, so the device lands on a router-assigned IP we can't predict — point them at
    // the mDNS name (<hostname>.local). AP mode comes back as its own network at 192.168.4.1.
    String title, msg, url, urlLabel, hint;
    if (mode == "ap") {
        cfg.wifiMode  = NET_WIFI_AP;
        if (argStr(req, "appw", pw)) cfg.apPassword = pw;   // empty = open AP, >=8 = WPA2
        title    = "Access point ready";
        msg      = "LuxDMX is restarting as its own WiFi network \"" + htmlEsc(cfg.hostname) +
                   "\". Join that network on this device, then open:";
        url      = "http://192.168.4.1";
        urlLabel = "192.168.4.1";
        hint     = cfg.apPassword.length() >= 8 ? "The network is WPA2-protected with the password you set."
                                                : "The network is open, no password needed.";
    } else {                                                 // default to STA ("Join my WiFi")
        cfg.wifiMode = NET_WIFI_STA;
        argStr(req, "ssid", ssid);
        argStr(req, "pw", pw);
        cfg.wifiSsid = ssid;
        cfg.wifiPsk  = pw;
        title    = "Joining your WiFi";
        msg      = "LuxDMX is restarting and connecting to \"" + htmlEsc(ssid) +
                   "\". Reconnect this device to that network, then it opens automatically at:";
        url      = "http://" + cfg.hostname + ".local";     // hostname is [a-z0-9-]; safe in href/JS
        urlLabel = htmlEsc(cfg.hostname) + ".local";
        hint     = "If the name doesn't resolve on your network, check your router for the device's IP.";
    }
    saveConfig();
    Serial.printf("[SETUP] saved: mode=%s ssid='%s' — rebooting\n",
        cfg.wifiMode == NET_WIFI_AP ? "AP" : "STA", cfg.wifiSsid.c_str());
    String p = FPSTR(SETUP_DONE_HTML);
    p.replace("{{TITLE}}",    title);
    p.replace("{{MSG}}",      msg);
    p.replace("{{URL}}",      url);
    p.replace("{{URLLABEL}}", urlLabel);
    p.replace("{{HINT}}",     hint);
    req->send(200, "text/html", p);
    pendingRebootAt = millis() + 800;
}

static void handleLogo(AsyncWebServerRequest* req) {
    AsyncWebServerResponse* r = req->beginResponse_P(200, "image/webp", LOGO_WEBP, LOGO_WEBP_LEN);
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

// Plain HTTP, deliberately. This runs 8 s after boot and then every 6 h in the fully-booted
// system, where the heap is fragmented -- and a TLS handshake wants a ~40 KB *contiguous* block
// that simply isn't there (seen in the field: "largest free block 34804 too small for TLS"). The
// check then skipped itself, and because latest fell back to current it reported "up to date",
// hiding real updates. HTTP needs almost none of that, so the check just works.
//
// Nothing is given up by dropping TLS here: the old code called setInsecure(), i.e. it did no
// certificate validation whatsoever. It never authenticated anything -- it encrypted a version
// string that is public on a public GitHub release. Against a man-in-the-middle that is worth
// exactly as much as plain HTTP, at ~40 KB of contiguous heap. (If OTA authenticity ever matters,
// the answer is signing the image, not the transport: a signature is checked regardless of how
// the bytes arrived. Verifying certs on-device instead would mean shipping and rotating a CA
// bundle in flash.)
//
// The URL is a real file on luxdmx.org, not the /firmware/version redirect: that rule is anchored
// (^firmware/version/?$) so it does not catch .txt, and it stays pointed at GitHub so older
// firmware in the field keeps working unchanged.
static bool httpGet(const char* url, String& out, size_t maxLen) {
    // Still a floor, just a realistic one: without TLS this needs single-digit KB, not 50.
    if (ESP.getMaxAllocHeap() < 12000) {
        Serial.printf("[VER] skipped: largest free block %u too small\n", ESP.getMaxAllocHeap());
        return false;
    }
    bool ok = false;
    try {
        WiFiClient client;              // no WiFiClientSecure -> no mbedTLS buffers at all
        HTTPClient h;
        h.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
        h.setTimeout(8000);
        if (!h.begin(client, url)) return false;
        if (h.GET() == 200) {
            String s = h.getString();
            s.trim();
            if (s.length() > 0 && s.length() <= maxLen) { out = s; ok = true; }
        }
        h.end();
    } catch (...) {
        // Kept as a hard backstop: an uncaught throw abort()s the board, and this runs on a timer.
        Serial.println("[VER] check threw under memory pressure, skipped");
        return false;
    }
    return ok;
}

static void checkForUpdate() {
    String v;
    if (!httpGet("http://luxdmx.org/firmware/version.txt", v, 24)) return;
    latestVersion   = v;
    updateAvailable = parseBuild(v) > parseBuild(String(FIRMWARE_VERSION));
    Serial.printf("[VER] latest=%s current=%s update=%s\n",
        v.c_str(), FIRMWARE_VERSION, updateAvailable ? "yes" : "no");
}

// Persist the update target and reboot into it. A firmware self-update pulls the image
// over HTTPS, and TLS needs a big contiguous heap block. Once DMX/RDM/Art-Net/web/WS are
// running the heap is too fragmented to allocate it (worse with RDM, worse still on the
// classic ESP32), so the update is refused -- that is the bug that broke OTA on the RDM
// release. Instead of updating in place, we stash the target in NVS and reboot; early in
// setup() (before any of those subsystems start) otaBootUpdate() runs the download against
// a pristine heap. The flag is one-shot and cleared before the attempt, so a failed or
// interrupted update just falls through to a normal boot -- never a reboot loop.
static void scheduleOtaReboot(const String& target) {
    prefs.begin(PREF_NS, false);
    prefs.putString("otatgt", target);
    prefs.putUChar("otapend", 1);
    prefs.end();
    Serial.printf("[OTA] scheduled clean-heap update to %s, rebooting\n", target.c_str());
    pendingRebootAt = millis() + 1200;   // let the progress page load + the response flush first
}

static void versionCheckTask(void*) {
    vTaskDelay(pdMS_TO_TICKS(8000));
    for (;;) {
        checkForUpdate();
        if (cfg.autoUpdate && updateAvailable) {
            // Can't install in place (fragmented heap -> no room for TLS), so schedule a
            // clean-heap update on reboot -- but only within a small retry budget so a
            // download that keeps failing can't become a reboot loop. loop() clears the
            // budget once the device has stayed up a while (a real loop never gets there).
            prefs.begin(PREF_NS, true);
            uint8_t tries = prefs.getUChar("otatries", 0);
            prefs.end();
            if (tries < OTA_BOOT_TRIES) {
                Serial.println("[OTA] auto-update available, scheduling clean-heap update on reboot");
                scheduleOtaReboot("latest");
            } else {
                Serial.println("[OTA] auto-update available but retry budget spent; will retry later");
            }
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
    // TLS + the OTA download need a big contiguous block; if the heap is fragmented (e.g. a flood
    // is in progress) defer rather than throw bad_alloc and abort. No restart here, so this can't
    // become a reboot loop while an auto-update keeps retrying under load.
    if (ESP.getMaxAllocHeap() < 50000) {
        Serial.printf("[OTA] deferred: largest free block %u too small\n", ESP.getMaxAllocHeap());
        otaProgPhase = 3; dmxReady = true; return;
    }
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
    try {
        WiFiClientSecure client;
        client.setInsecure();
        httpUpdate.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
        // We reboot ourselves rather than letting httpUpdate do it, because the pending flag
        // has to be cleared FIRST. otaBootUpdate() now keeps otapend set across an attempt so a
        // failure can retry; if the new image booted with it still set it would reinstall the
        // same target on every boot until the retry budget ran out.
        httpUpdate.rebootOnUpdate(false);
        if (httpUpdate.update(client, otaUrl) == HTTP_UPDATE_OK) {
            prefs.begin(PREF_NS, false);
            prefs.putUChar("otapend", 0);    // installed -> stop asking
            prefs.putUChar("otatries", 0);   // and hand the next update a full budget
            prefs.end();
            otaProgPhase = 2; otaProgPct = 100;
            Serial.println("[OTA] installed, rebooting into the new image");
            delay(200);
            ESP.restart();
        }
    } catch (...) {
        Serial.println("[OTA] update threw under memory pressure");
    }
    // Only reaches here on failure (success restarts above).
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
    Serial.printf("[OTA] Target requested: %s (reboot into clean-heap update)\n", otaTarget.c_str());
    otaProgPhase = 0; otaProgPct = 0;
    req->send_P(200, "text/html", OTA_PROGRESS_HTML);
    scheduleOtaReboot(otaTarget);   // persist target + reboot; otaBootUpdate() installs it next boot
}

// Runs early in setup() -- after the network is up but BEFORE DMX/RDM/Art-Net/web/WS start,
// so the heap is pristine and the TLS download has all the contiguous room it needs. It only
// acts on the one-shot NVS flag set by scheduleOtaReboot() (from the manual /ota/github button
// or the auto-update task), so a normal boot returns immediately at no cost. doGithubOta()
// reboots into the new image on success and only returns here on failure, after which we fall
// through into the normal boot.
static void otaBootUpdate() {
    prefs.begin(PREF_NS, false);
    bool    pend  = prefs.getUChar("otapend", 0) == 1;
    String  tgt   = pend ? prefs.getString("otatgt", "latest") : String();
    uint8_t tries = prefs.getUChar("otatries", 0);
    if (!pend) { prefs.end(); return; }   // no scheduled update -> a normal boot costs nothing
    tries++;
    prefs.putUChar("otatries", tries);
    // otapend deliberately stays SET across the attempt now. It used to be cleared here, one-shot,
    // before even trying -- so a single bad moment (no link yet, a download that died) dropped the
    // update on the floor for good: no retry, no error, the web UI had already said "updating,
    // rebooting", and the device just quietly came back on the old version. That is exactly how a
    // a bench unit stayed on 1.0.166 while reporting itself up to date.
    //
    // Looping is capped by the existing budget, not by throwing the request away: every attempt
    // increments otatries, and loop() only resets it after 60 s of stable uptime -- which a device
    // stuck retrying never reaches. So a genuinely broken update gets OTA_BOOT_TRIES shots and then
    // stops for good; a transient one survives. doGithubOta() clears otapend the moment the image
    // is actually installed, or the new firmware would reinstall itself on every boot.
    const bool giveUp = tries > OTA_BOOT_TRIES;
    if (giveUp) prefs.putUChar("otapend", 0);
    prefs.end();
    if (giveUp) {
        Serial.printf("[OTA] update to %s failed %u times, giving up (ask again to retry)\n",
                      tgt.c_str(), (unsigned)OTA_BOOT_TRIES);
        return;
    }

    // The Ethernet link comes up asynchronously; give it a moment before we need the network.
    uint32_t t0 = millis();
    while (!netConnected() && millis() - t0 < 20000) delay(100);
    if (!netConnected()) {
        // Keep it pending: no network at THIS boot says nothing about the next one. This is the
        // case that silently ate updates.
        Serial.printf("[OTA] no network at boot; update to %s still pending (attempt %u/%u)\n",
                      tgt.c_str(), (unsigned)tries, (unsigned)OTA_BOOT_TRIES);
        return;
    }

    otaTarget = tgt;
    Serial.printf("[OTA] clean-heap update to %s (attempt %u), largest free block=%u\n",
                  tgt.c_str(), (unsigned)(tries + 1), ESP.getMaxAllocHeap());
    setLedColor(NEO_BLUE, true);
    doGithubOta();        // reboots into the new image on success; returns here only on failure
    Serial.println("[OTA] update did not complete, continuing normal boot");
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

// Upload-OTA state, tracked across the chunk callbacks.
//
// Every Update.* call reports failure through a return value, and an upload can also just
// stop mid-stream (dropped link, client abort, W5500 RX glitch) in which case the `final`
// chunk never arrives at all. Both used to be invisible here: no return value was checked,
// and the done-handler only asked Update.hasError() -- which is false for a stream that was
// never finished, because writing a partial image isn't an error, it's just incomplete. So
// a truncated upload rendered "Firmware updated", rebooted, and the box came back on the
// OLD image. Observed in the wild: 2 of 4 uploads cut off at 8-20% and all of them reported
// success. Nothing was bricked only because Update.end() never ran, so the boot partition
// was never switched. Track the whole chain explicitly instead of inferring it.
static bool   otaUpBegun = false;   // Update.begin() succeeded for this request
static bool   otaUpDone  = false;   // saw the final chunk AND Update.end() accepted the image
static bool   otaUpDmxWas = false;  // dmxReady as it was before we muted DMX for the upload
static size_t otaUpBytes = 0;
static String otaUpError;           // first failure; shown to the browser

static void otaUploadFail(const char* what) {
    if (otaUpError.length()) return;      // keep the FIRST failure, later ones are fallout
    otaUpError = what;
    if (Update.hasError()) { otaUpError += " ("; otaUpError += Update.errorString(); otaUpError += ")"; }
    Serial.printf("[OTA] upload failed: %s\n", otaUpError.c_str());
}

static void handleOtaUploadDone(AsyncWebServerRequest* req) {
    // Success needs the entire chain: begin, every write, the final chunk, and end(). A
    // connection that dies mid-upload never delivers `final`, so otaUpDone stays false --
    // that is the truncated-upload case that used to report success.
    if (!otaUpError.length() && !otaUpDone)
        otaUploadFail(otaUpBegun ? "upload ended early (connection lost?)" : "no firmware received");
    bool ok = otaUpDone && !otaUpError.length();
    if (!ok) {
        Update.abort();     // drop the half-written image rather than leave it staged
        dmxReady = otaUpDmxWas;   // restore DMX exactly as it was; a box with no outputs
                                  // enabled boots dmxReady=false and must stay that way
        Serial.printf("[OTA] upload aborted after %u bytes\n", (unsigned)otaUpBytes);
    }
    String p = FPSTR(OTA_DONE_HTML);
    p.replace("{{OTA_ICON}}",  ok ? "&#10003;" : "&#10007;");
    p.replace("{{OTA_CLASS}}", ok ? "text-success" : "text-danger");
    p.replace("{{OTA_TITLE}}", ok ? "Firmware updated" : "Update failed");
    p.replace("{{OTA_MSG}}",   ok ? "Rebooting&hellip;" : String("Error: ") + otaUpError);
    // 500 on failure so curl/scripts can tell too; a browser form post still renders the body.
    req->send(ok ? 200 : 500, "text/html", p);
    if (ok) pendingRebootAt = millis() + 800;
}

static void handleOtaUploadChunk(AsyncWebServerRequest* req, const String& filename,
                                 size_t index, uint8_t* data, size_t len, bool final) {
    if (index == 0) {
        Serial.printf("[OTA] Upload: %s\n", filename.c_str());
        otaUpBegun = false; otaUpDone = false; otaUpBytes = 0; otaUpError = "";
        // An ESP32 app image starts with the 0xE9 magic byte. Rejecting a wrong file here
        // gives a real message instead of "successfully" flashing something unbootable.
        if (len && data[0] != 0xE9) { otaUploadFail("not an ESP32 firmware image"); return; }
        otaUpDmxWas = dmxReady; dmxReady = false;   // mute DMX while we write flash
        if (!Update.begin(UPDATE_SIZE_UNKNOWN)) { otaUploadFail("could not start the update"); return; }
        otaUpBegun = true;
    }
    if (!otaUpBegun || otaUpError.length()) return;   // already failed: swallow the rest of the stream
    if (len && Update.write(data, len) != len) { otaUploadFail("write to flash failed"); return; }
    otaUpBytes += len;
    if (final) {
        if (!Update.end(true)) { otaUploadFail("image rejected on finalize"); return; }
        otaUpDone = true;
        Serial.printf("[OTA] Upload done: %u bytes\n", (unsigned)otaUpBytes);
    }
}

// ---------------------------------------------------------------------------
// First-run setup portal (issue #45) — on-brand, served from our own web stack
// ---------------------------------------------------------------------------
// Replaces tzapu/WiFiManager. Instead of a separate blocking captive portal with its
// own web server (which used to fight ours for port 80 and force a reboot), this brings
// up our own open SoftAP + a captive DNS, sets g_setupPortal, and lets setup() register
// the normal AsyncWebServer routes. "/" then serves setup.html, /setup/scan lists nearby
// networks, and POST /setup writes the chosen mode/creds and reboots. loop() pumps the DNS
// while g_setupPortal so the page pops automatically when a phone joins the AP.
//
// It is ONLY entered at first run (STA selected but no stored SSID) or when BOOT is held
// at power-on — never as a runtime fallback, so it can't open mid-show (see startWiFiAP /
// applyWiredLinkLoss for the wired link-loss policy, which is unchanged).
static void startSetupPortal() {
    g_setupPortal = true;
    g_apMode      = true;     // reuse the AP net-accessors (softAPIP/SSID); there's no real link
    g_useEth      = false;
    WiFi.mode(WIFI_AP);
    // Open AP on purpose: first-run setup needs physical access to the device anyway, and a
    // pre-shared password you'd have to print on the box helps nobody. The user picks a real
    // password for their network (or the standalone AP) inside the portal.
    bool ok = WiFi.softAP(AP_SSID);
    WiFi.setSleep(WIFI_PS_NONE);
    IPAddress apIp = WiFi.softAPIP();
    dnsServer.setErrorReplyCode(DNSReplyCode::NoError);
    dnsServer.start(53, "*", apIp);    // answer every lookup with our IP → captive portal
    setLedColor(NEO_PURPLE, true);     // purple = portal active (matches the old config portal)
    Serial.printf("[SETUP] portal AP \"%s\" %s  ip=%s  (open captive portal)\n",
        AP_SSID, ok ? "up" : "FAILED", apIp.toString().c_str());
}

// Scan every AP for our SSID, log them, and (re)connect to the strongest one.
// On mesh/multi-AP networks the ESP32's auto-connect often sticks to a distant
// node; this guarantees the closest one. Also a diagnostic: the [SCAN] log
// reveals whether the SSID has multiple BSSIDs (per-node) or a single shared
// BSSID (seamless mesh — in which case the AP, not us, chooses the node).
static void connectStrongestAP() {
    String ssid = cfg.wifiSsid;          // we own the creds now (no WiFiManager WiFi-NVS copy)
    if (ssid.length() == 0) return;
    String pass = cfg.wifiPsk;
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
            bootConnectingLed();   // 5-LED: Knight-Rider sweep; single LED: blue blink
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
    for (int i = 0; i < MAX_OUTPUTS; i++) { rdmLineForOut[i] = -1; rdmOutForLine[i] = -1; }
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

#ifdef DMX_RMT
        // Every output starts on the RMT peripheral -- hardware-sequenced frames, immune to
        // core-0 network-DMA contention (issue #64 hard-zero). An RDM-capable output (has a DE
        // pin, rtsPin >= 0) is switched RMT->esp_dmx on demand ONLY for an RDM transaction and
        // back to RMT afterwards (see the DMX task), so it gets both immune DMX and RDM.
        {
            if (rmtDmxInit(&g_rmt[i], cfg.outputs[i].txPin)) {
                outReady[i] = true; dmxReady = true;
                if (firstEnabled) { monitorOut = i; firstEnabled = false; }
                if (cfg.outputs[i].rtsPin >= 0) {                 // RDM-capable output (has a transceiver)
                    // RDM reuses this output's RMT channel for TX + a RX-only UART for responses.
                    // Every such output becomes its own RDM line so RDM can run on both universes.
                    int line = rdmRmtInit(&g_rmt[i], cfg.outputs[i].rtsPin, cfg.outputs[i].rxPin);
                    if (line >= 0) {
                        rdmLineForOut[i] = line;
                        rdmOutForLine[line] = i;
                        if (rdmOut < 0) rdmOut = i;              // primary (first line) for legacy paths
                    }
                }
                Serial.printf("[DMX] out%d ready (RMT%s): uni=%d tx=%d\n",
                    i, cfg.outputs[i].rtsPin >= 0 ? "+RDM" : "", cfg.outputs[i].universe, cfg.outputs[i].txPin);
            } else Serial.printf("[DMX] out%d RMT init FAILED\n", i);
            continue;
        }
#endif
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
// One status language, spoken identically by the single WS2812/GPIO LED and the 5-LED
// discrete panel (the LuxDMX board). Boot/connecting is handled separately by bootConnectingLed()
// (Knight-Rider sweep on the panel, white "working" blink on a single LED) until the network
// is up and this task takes over.
//
//   green, solid           board up and idle — running normally, no DMX coming in
//   green, slow 2 s blink   DMX arriving over Art-Net/sACN
//   blue,  solid            RDM discovery / identify, or RDM traffic in the last second
//   orange, solid           Ethernet configured but no link — running on the WiFi/AP fallback
//   red    (green off)      no network at all (neither Ethernet nor WiFi came up)
//   purple, solid           setup portal / config AP active
//
// DMX *output* is deliberately not signalled: a gateway transmits continuously, so a DMX-out
// blink told you nothing. Blue is RDM's; the panel has no discrete orange LED, so its amber
// (Y) LED carries the orange fallback state.
static constexpr uint32_t DMX_LIVE_MS   = 1500;  // treat DMX as "coming in" this long after the last frame
static constexpr uint32_t RDM_ACTIVE_MS = 1000;  // blue stays on this long after the last RDM event

// True while an RDM identify or discovery is in flight, or RDM frames moved on the wire in the
// last second. Keeps the blue LED on across a whole discovery, not just per-frame.
static bool rdmLedActive(uint32_t now) {
    if (identifyCh) return true;                                         // DMX identify (a channel forced to full)
    if (rdmBusy)    return true;                                         // RDM discovery in progress
#ifdef DMX_RMT
    if (g_rdmSentMs && now - g_rdmSentMs < RDM_ACTIVE_MS) return true;   // a discovery/poll request went out
    if (g_rdmRecvMs && now - g_rdmRecvMs < RDM_ACTIVE_MS) return true;   // a fixture answered
#endif
    return false;
}

// Status LED. Green means "up and running" and STAYS ON whenever the network is healthy — RDM
// does not replace it, it adds blue on top: separate LEDs light together on the panel, a
// green+blue = cyan mix on the single RGB LED. Only the network-health states replace green
// (red = no network, orange = Ethernet configured but on the WiFi/AP fallback). Incoming DMX
// pulses the green (slow 2 s blink). DMX *output* is not signalled.
static void ledTask(void*) {
    const TickType_t period = pdMS_TO_TICKS(50);
    for (;;) {
        uint32_t now = millis();
        // Calibration override (/led/bright?test=1): light all five panel LEDs so the per-colour
        // brightness can be balanced by eye. Auto-reverts after its 10-min window.
        if (cfg.ledType == 3 && g_ledTestUntil && (int32_t)(g_ledTestUntil - now) > 0) {
            setLeds5(true, true, true, true, true);
            vTaskDelay(period); continue;
        }
        // Setup portal / config AP: purple until the device is configured (a pre-network state,
        // not one of the running states below).
        if (g_setupPortal) { setLedColor(NEO_PURPLE, true); vTaskDelay(period); continue; }

        // Green is a persistent "up" base; blue overlays it for RDM; red/orange replace it.
        const bool up       = netConnected();
        const bool fb       = g_ethFallback;
        const bool dmxLive  = lastDmxMs && (now - lastDmxMs < DMX_LIVE_MS);
        const bool rdm      = up && rdmLedActive(now);
        const bool dmxBlink = (now % 2000) < 1000;                 // slow 2 s green pulse while DMX arrives
        const bool green    = up && !fb && (dmxLive ? dmxBlink : true);

        if (cfg.ledType == 3) {
            // Panel: independent LEDs, so green (up) and blue (RDM) light TOGETHER.
            setLeds5(!up,        // red   : no network at all (green off)
                     green,      // green : up + running (pulses while DMX arrives)
                     up && fb,   // orange: Ethernet on the WiFi/AP fallback (green off)
                     rdm,        // blue  : RDM / identify, ADDED on top of green
                     false);
        } else {
            // One LED can't show two states, so it MIXES: green (up) + blue (RDM) = cyan. A plain
            // GPIO LED has no colour, so it just tracks "up" (green/cyan/orange -> on, red -> off).
            uint32_t c; bool on;
            if (!up)     { c = NEO_RED;   on = false; }            // red / GPIO off
            else if (fb) { c = NEO_AMBER; on = true;  }            // orange / GPIO on
            else         { c = (green ? NEO_GREEN : NEO_OFF) | (rdm ? NEO_BLUE : 0);   // green + blue = cyan
                           on = green || rdm; }
            setLedColor(c, on);
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

// ---------------------------------------------------------------------------
// On-unit controls state (issue #24). Shared between the input task (the writer:
// it owns all navigation) and the display task (a reader: it only draws the menu/
// overlay). A one-frame-stale read just redraws next tick and nothing is ever
// freed, so plain volatiles are enough — no lock on the DMX path.
// ---------------------------------------------------------------------------
enum { CTL_ID_UNI_A = 1, CTL_ID_UNI_B = 2, CTL_ID_PROTO = 3, CTL_ID_EXIT = 9 };

static bool        ctlEnabled = false;   // any control wired -> input task runs
static bool        ctlUseMenu = false;   // an ENTER-capable input exists -> full menu (else direct nudge)
static InputMapper ctlMapper;
static Menu        ctlMenu;

// Direct fallback (no ENTER-capable input, or no display): rotation just nudges
// one output's universe and auto-saves after a short idle.
static volatile bool     ctlDirectEditing = false;
static volatile int      ctlDirectOut     = 0;
static volatile int      ctlDirectUni     = 0;

static volatile uint32_t ctlFlashUntil = 0;      // brief SAVED/REBOOT banner deadline
static char              ctlFlashMsg[10] = "SAVED";
static volatile bool     g_sacnRejoin  = false;  // ask netRxTask (the socket owner) to re-join sACN

// The display shows the controls overlay/menu whenever it's open, being edited, or
// a just-committed banner is still up.
static bool ctlOverlayActive() {
    return ctlEnabled && (ctlMenu.isOpen() || ctlDirectEditing ||
                          (int32_t)(millis() - ctlFlashUntil) < 0);
}

// Human label for a menu item's value (protocol names; everything else numeric).
static void ctlItemValue(const MenuItem& it, int32_t v, char* buf, size_t n) {
    if (it.kind == MI_ACTION)       buf[0] = '\0';
    else if (it.id == CTL_ID_PROTO) snprintf(buf, n, "%s", v == 0 ? "Art-Net" : v == 1 ? "sACN" : "Both");
    else                            snprintf(buf, n, "%d", (int)v);
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
    // Mirror the status-LED language: red = no network, orange = Ethernet on the WiFi/AP
    // fallback, blue = RDM/identify, green = up (idle or live; the "LIVE/idle" label carries
    // the DMX distinction that the LED shows as a green blink).
    const uint16_t accent = !up ? C_RED
                          : g_ethFallback        ? C_AMBER
                          : rdmLedActive(millis()) ? C_BLUE
                          : C_GREEN;
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

// On-unit controls menu / edit overlay (issue #24). Adapts to the panel size:
// the tall panels show a scrolling item list; the 128x32 strip shows just the
// selected item. A ">" caret marks the highlight (the only cue that survives the
// 1-bit mono collapse); editing wraps the value in <angle brackets> and tints it
// amber on the colour panel.
static void dispDrawControls() {
    const int H = gfx->height(), W = gfx->width();
    const bool editing = (ctlMenu.mode == MENU_EDIT);
    gfx->fillScreen(0);
    gfx->setTextSize(1);

    // Just-committed banner (SAVED / REBOOT) takes the whole screen for a moment.
    if (!ctlMenu.isOpen() && !ctlDirectEditing && (int32_t)(millis() - ctlFlashUntil) < 0) {
        dispDrawBanner(ctlFlashMsg, "", C_GREEN);
        return;
    }

    // Direct fallback overlay: one output's universe, big and centred.
    if (!ctlMenu.isOpen()) {
        if (!ctlDirectEditing) return;
        const bool dual = dispEnabledOutputs() >= 2;
        char l1[12], l2[14];
        if (dual) snprintf(l1, sizeof(l1), "OUT %c", (char)('A' + ctlDirectOut));
        else      snprintf(l1, sizeof(l1), "UNIVERSE");
        snprintf(l2, sizeof(l2), "Uni %d", ctlDirectUni);
        gfx->setTextColor(col(C_AMBER)); dispCenter(l1, 1, H >= 64 ? 16 : 0);
        gfx->setTextColor(col(C_WHITE)); dispCenter(l2, H >= 64 ? 3 : 2, H >= 64 ? H / 2 - 4 : 12);
        if (H >= 64) { gfx->setTextColor(col(C_GREY)); dispCenter("turn=set  wait=save", 1, H - 10); }
        return;
    }

    // Disabled items (e.g. Uni B on a single-output unit) are hidden, so work over
    // the enabled ones only: no blank rows, and the "n/total" counter is honest.
    int order[MENU_MAX_ITEMS], nEn = 0, selPos = 0;
    for (int i = 0; i < ctlMenu.count; i++) {
        if (!ctlMenu.items[i].enabled) continue;
        if (i == ctlMenu.sel) selPos = nEn;
        order[nEn++] = i;
    }
    if (nEn == 0) return;

    char val[16], shown[20];
    // Compact 128x32 strip: header + the selected item only.
    if (H <= 32) {
        const MenuItem& it = ctlMenu.items[ctlMenu.sel];
        int32_t v = editing ? ctlMenu.edit : it.value;
        ctlItemValue(it, v, val, sizeof(val));
        gfx->setTextColor(col(C_GREY));
        gfx->setCursor(0, 0); gfx->print("MENU");
        char pos[8]; snprintf(pos, sizeof(pos), "%d/%d", selPos + 1, nEn);
        gfx->setCursor(W - (int)strlen(pos) * 6, 0); gfx->print(pos);
        gfx->setTextColor(col(editing ? C_AMBER : C_WHITE));
        gfx->setCursor(0, 12); gfx->print(it.label);
        if (it.kind != MI_ACTION) {
            if (editing) snprintf(shown, sizeof(shown), "<%s>", val);
            else         snprintf(shown, sizeof(shown), "%s", val);
            gfx->setCursor(W - (int)strlen(shown) * 6, 12); gfx->print(shown);
        }
        return;
    }

    // Tall panels: title, a scrolling list window (over enabled items), and a hint.
    gfx->setTextColor(col(C_AMBER));
    gfx->setCursor(0, 0); gfx->print(editing ? "EDIT" : "MENU");
    const int top = 16, hintY = H - 10;
    const int rowH = (H >= 96) ? 14 : 12;
    int maxRows = (hintY - top) / rowH; if (maxRows < 1) maxRows = 1;
    int start = 0;
    if (nEn > maxRows) {
        start = selPos - maxRows / 2;
        if (start < 0) start = 0;
        if (start > nEn - maxRows) start = nEn - maxRows;
    }
    int y = top;
    for (int r = start; r < nEn && r < start + maxRows; r++) {
        const MenuItem& it = ctlMenu.items[order[r]];
        const bool selRow = (order[r] == ctlMenu.sel);
        int32_t v = (selRow && editing) ? ctlMenu.edit : it.value;
        ctlItemValue(it, v, val, sizeof(val));
        gfx->setTextColor(col(selRow ? (editing ? C_AMBER : C_WHITE) : C_GREY));
        gfx->setCursor(0, y);
        gfx->print(selRow ? ">" : " ");
        gfx->print(it.label);
        if (it.kind != MI_ACTION) {
            if (selRow && editing) snprintf(shown, sizeof(shown), "<%s>", val);
            else                   snprintf(shown, sizeof(shown), "%s", val);
            gfx->setCursor(W - (int)strlen(shown) * 6, y); gfx->print(shown);
        }
        y += rowH;
    }
    gfx->setTextColor(col(C_GREY));
    dispCenter(editing ? "turn=value  press=ok" : "turn=move  press=select", 1, hintY);
}

// Priority: 5=controls menu, 1=conflict, 2=identify, 3=manual, 4=merging, 0=status.
static uint8_t dispPickScreen() {
    if (ctlOverlayActive())          return 5;
    if (g_srcStatus == SRC_CONFLICT) return 1;
    if (identifyCh)                  return 2;
    if (manualMode)                  return 3;
    if (g_srcStatus == SRC_MERGING)  return 4;
    return 0;
}

static void dispRender(uint8_t screen) {
    char b[16];
    switch (screen) {
        case 5: dispDrawControls(); break;
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
    uint8_t  lastScreen  = 255;
    uint32_t screenSince = 0;
    for (;;) {
        TickType_t period = pdMS_TO_TICKS(250);
        if (dispReady && gfx) {
            uint32_t now  = millis();
            uint8_t  want = dispPickScreen();
            // Dwell: hold a banner >=1.5 s before falling back, so a blip stays readable.
            // Skip the dwell for the controls menu (5) so a turn shows instantly and the
            // menu vanishes the moment it closes.
            if (want == 0 && lastScreen != 0 && lastScreen != 5 && lastScreen != 255
                && now - screenSince < 1500)
                want = lastScreen;
            if (want != lastScreen) { lastScreen = want; screenSince = now; }
            dispRender(want);
            if (want == 5) period = pdMS_TO_TICKS(60);   // responsive while the menu is up
        }
        vTaskDelay(period);
    }
}

// ---------------------------------------------------------------------------
// On-unit controls input task (issue #24)
// ---------------------------------------------------------------------------
// Samples the encoder + buttons, turns them into nav events (input_map.h) and
// drives either the display menu (menu.h) or, when there's no ENTER-capable input
// or no display, a direct "nudge the universe" fallback. Runs in its own low-prio
// task off the DMX timing path, and is a complete no-op unless something's wired.

static int ctlFirstEnabledOut() {
    for (int i = 0; i < MAX_OUTPUTS; i++) if (cfg.outputs[i].enabled) return i;
    return 0;
}

static void ctlFlash(const char* msg, uint32_t ms) {
    strncpy(ctlFlashMsg, msg, sizeof(ctlFlashMsg) - 1);
    ctlFlashMsg[sizeof(ctlFlashMsg) - 1] = 0;
    ctlFlashUntil = millis() + ms;
}

// Persist one output's universe live. Art-Net re-routes by the packet's own
// universe on the next frame, so it needs nothing; sACN listens on a per-universe
// multicast group that must be re-joined, and only the socket-owning netRxTask may
// touch the sockets — so raise a flag and let it re-join.
static void ctlApplyUniverse(int out, int uni) {
    if (out < 0 || out >= MAX_OUTPUTS) return;
    if (cfg.outputs[out].universe == uni) return;      // no real change (rolled back to start)
    cfg.outputs[out].universe = uni;
    saveConfig();
    if (cfg.protocol != 0) g_sacnRejoin = true;
    Serial.printf("[CTL] out%d universe -> %d (saved)\n", out, uni);
}

static void ctlBuildMenu() {
    ctlMenu.clear();
    const int  mx   = cfg.ctlUniMax > 0 ? cfg.ctlUniMax : 15;
    const bool dual = dispEnabledOutputs() >= 2;
    const bool a0   = cfg.outputs[0].enabled || dispEnabledOutputs() == 0;   // keep at least one universe item
    ctlMenu.addValue(CTL_ID_UNI_A, dual ? "Uni A" : "Universe", cfg.outputs[0].universe, 0, mx, a0);
    if (MAX_OUTPUTS > 1)
        ctlMenu.addValue(CTL_ID_UNI_B, "Uni B", cfg.outputs[1].universe, 0, mx, cfg.outputs[1].enabled);
    ctlMenu.addValue(CTL_ID_PROTO, "Protocol", cfg.protocol, 0, 2, true);
    ctlMenu.addAction(CTL_ID_EXIT, "Exit", true);
}

static void ctlApplyCommit(int id, int value) {
    switch (id) {
        case CTL_ID_UNI_A: ctlApplyUniverse(0, value); ctlFlash("SAVED", 900); break;
        case CTL_ID_UNI_B: ctlApplyUniverse(1, value); ctlFlash("SAVED", 900); break;
        case CTL_ID_PROTO:
            if (cfg.protocol != value) {
                cfg.protocol = value; saveConfig();
                // The Art-Net / sACN listeners are wired up at boot; a clean restart
                // is the safe way to switch protocol, matching the web form.
                ctlMenu.close();
                ctlFlash("REBOOT", 1500);
                pendingRebootAt = millis() + 1500;
                Serial.printf("[CTL] protocol -> %d (save + reboot)\n", value);
            }
            break;
    }
}

static void ctlHandleMenu(NavEvent e) {
    if (!ctlMenu.isOpen()) { ctlBuildMenu(); ctlMenu.open(); return; }   // first input just wakes it
    MenuResult r = ctlMenu.handle(e);
    if (r.committedId >= 0) ctlApplyCommit(r.committedId, r.value);
    if (r.actionId == CTL_ID_EXIT) ctlMenu.close();
    // r.closed (a BACK in browse) already left the menu closed.
}

static void ctlHandleDirect(NavEvent e) {
    const int mx = cfg.ctlUniMax > 0 ? cfg.ctlUniMax : 15;
    if (!ctlDirectEditing) {                       // first input wakes the overlay
        ctlDirectOut = ctlFirstEnabledOut();
        ctlDirectUni = cfg.outputs[ctlDirectOut].universe;
        ctlDirectEditing = true;
        return;
    }
    switch (e) {
        case NAV_INC: ctlDirectUni = Menu::wrap(ctlDirectUni + 1, 0, mx); break;
        case NAV_DEC: ctlDirectUni = Menu::wrap(ctlDirectUni - 1, 0, mx); break;
        case NAV_ENTER:                            // explicit confirm (if any enter input exists)
            ctlApplyUniverse(ctlDirectOut, ctlDirectUni);
            ctlDirectEditing = false; ctlFlash("SAVED", 900);
            break;
        case NAV_BACK:                             // cancel without saving
            ctlDirectEditing = false;
            break;
        default: break;
    }
}

static InputSample ctlSample() {
    InputSample s;
    if (cfg.encA >= 0 && cfg.encB >= 0) {
        s.encPresent = true;
        s.a = (uint8_t)digitalRead(cfg.encA);
        s.b = (uint8_t)digitalRead(cfg.encB);
    }
    if (cfg.encSw >= 0) { s.swPresent = true; s.swLevel = digitalRead(cfg.encSw); }
    const int bp[INPUT_MAX_BTN] = { cfg.btn1Pin, cfg.btn2Pin, cfg.btn3Pin, cfg.btn4Pin };
    for (int i = 0; i < INPUT_MAX_BTN; i++)
        if (bp[i] >= 0) { s.btnPresent[i] = true; s.btnLevel[i] = digitalRead(bp[i]); }
    return s;
}

static void controlsTask(void*) {
    const TickType_t period = pdMS_TO_TICKS(2);    // ~500 Hz: catches the fastest human twist
    uint32_t lastInputMs = millis();
    for (;;) {
        uint32_t now = millis();
        ctlMapper.poll(ctlSample(), now);
        NavEvent e; bool acted = false;
        while ((e = ctlMapper.next()) != NAV_NONE) {
            acted = true;
            if (ctlUseMenu) ctlHandleMenu(e);
            else            ctlHandleDirect(e);
        }
        if (acted) lastInputMs = now;

        // Idle: the menu auto-closes (discarding a half-made edit so a stray nudge
        // never persists); the direct overlay auto-saves the shown value, which is
        // the only way an encoder-with-no-button unit can commit.
        if (ctlUseMenu) {
            if (ctlMenu.isOpen() && now - lastInputMs > 12000) ctlMenu.close();
        } else if (ctlDirectEditing && now - lastInputMs > 1500) {
            ctlApplyUniverse(ctlDirectOut, ctlDirectUni);
            ctlDirectEditing = false; ctlFlash("SAVED", 900);
        }
        vTaskDelay(period);
    }
}

// Configure the control pins and start the input task. A no-op unless at least one
// control is wired, so it costs nothing on a board without any. The menu needs both
// an ENTER-capable input and a display; otherwise we fall back to direct nudge mode.
static void initControls() {
    InputConfig ic;
    ic.hasEncoder = (cfg.encA >= 0 && cfg.encB >= 0);
    ic.encSteps   = (uint8_t)(cfg.encSteps >= 1 ? cfg.encSteps : 4);
    ic.encReverse = cfg.encReverse;
    ic.hasSw      = (cfg.encSw >= 0);
    const int bp[INPUT_MAX_BTN] = { cfg.btn1Pin, cfg.btn2Pin, cfg.btn3Pin, cfg.btn4Pin };
    const int ba[INPUT_MAX_BTN] = { cfg.btn1Act, cfg.btn2Act, cfg.btn3Act, cfg.btn4Act };
    for (int i = 0; i < INPUT_MAX_BTN; i++) {
        ic.btnPresent[i] = (bp[i] >= 0);
        ic.role[i]       = (BtnRole)ba[i];
    }
    ic.activeHigh = cfg.btnActiveHigh;
    ctlMapper.begin(ic);
    ctlEnabled = ctlMapper.hasAnyInput();
    if (!ctlEnabled) return;
    ctlUseMenu = ctlMapper.canSelect() && dispReady;   // menu needs a way to select AND a screen

    const uint8_t pull = cfg.btnActiveHigh ? INPUT_PULLDOWN : INPUT_PULLUP;
    if (cfg.encA >= 0)  pinMode(cfg.encA,  pull);
    if (cfg.encB >= 0)  pinMode(cfg.encB,  pull);
    if (cfg.encSw >= 0) pinMode(cfg.encSw, pull);
    for (int i = 0; i < INPUT_MAX_BTN; i++) if (bp[i] >= 0) pinMode(bp[i], pull);

    xTaskCreate(controlsTask, "ctls", 3584, nullptr, 1, nullptr);
    Serial.printf("[CTL] on: enc A=%d B=%d SW=%d steps=%d rev=%d | btn=%d/%d/%d/%d | activeHigh=%d menu=%d\n",
                  cfg.encA, cfg.encB, cfg.encSw, cfg.encSteps, cfg.encReverse,
                  cfg.btn1Pin, cfg.btn2Pin, cfg.btn3Pin, cfg.btn4Pin, cfg.btnActiveHigh, ctlUseMenu);
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
        bootConnectingLed();   // 5-LED: Knight-Rider sweep; single LED: blue blink
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

// Give the W5500 a reset that actually meets its datasheet, because nothing else does.
//
// hardware/VALIDATION_REPORT.md, from the datasheet: "RSTn must be held >=500us (firmware)".
// The IDF W5500 PHY driver pulses RSTn for ~100us (measured on the board: 80us), 6x short of
// spec. A short pulse resets the chip *most* of the time; the misses leave it wedged with no
// link, and a warm reset never recovers it because the driver just re-issues the same short
// pulse -- only pulling the power does. That is the "red LED, no link, reset button doesn't
// help, unplugging does" failure, and because it is a marginal timing violation it is
// intermittent rather than reproducible.
//
// Two things matter here:
//   * length: hold it low well past the 500us minimum.
//   * order: the LAST pulse decides the chip's state, so ETH.begin() must NOT be allowed to
//     follow this with its out-of-spec one -- the caller passes rst=-1 for that.
// It also drives the pin from the first instant, closing the window where RSTn floats at an
// undefined level (measured 2.63V, above V_IH, while the ESP is in reset; the net has no
// pull-up -- ETH_RST reaches only ESP GPIO9 and the W5500).
static void w5500HardReset() {
    if (cfg.ethRst < 0) return;          // no reset line wired -> nothing we can do
    pinMode(cfg.ethRst, OUTPUT);
    digitalWrite(cfg.ethRst, LOW);
    delayMicroseconds(600);              // >= 500us datasheet minimum, with margin
    digitalWrite(cfg.ethRst, HIGH);
    delay(2);                            // let the PLL settle before the driver talks SPI
    Serial.printf("[ETH] W5500 hard reset on GPIO%d (600us, datasheet min 500us)\n", cfg.ethRst);
}

static void ethUpTask(void *arg) {
    // W5500 and DM9051 share the same SPI wiring + ETH.begin() signature; only the PHY enum
    // changes. DM9051 is gated behind its IDF SPI-Ethernet driver (CONFIG_ETH_SPI_ETHERNET_
    // DM9051, the same macro that gates the enum in ETH.h): if the framework wasn't built
    // with it we fall back to W5500 so the build can never break (issue #36).
    eth_phy_type_t phy = ETH_PHY_W5500;
#if defined(CONFIG_ETH_SPI_ETHERNET_DM9051)
    if (cfg.ethSpiPhy == ETH_SPI_PHY_DM9051) phy = ETH_PHY_DM9051;
#else
    if (cfg.ethSpiPhy == ETH_SPI_PHY_DM9051)
        Serial.println("[ETH] DM9051 not in this build, using W5500");
#endif
    // W5500: reset it ourselves to spec, then hand ETH.begin() rst=-1 so the PHY driver
    // cannot undo that with its own ~100us pulse (see w5500HardReset). DM9051 keeps the
    // driver's reset handling -- this is a W5500 erratum, not a shared one.
    const bool isW5500 = (phy == ETH_PHY_W5500);
    if (isW5500) w5500HardReset();
    ETH.begin(phy, ETH_W5500_ADDR, cfg.ethCs, cfg.ethInt,
              isW5500 ? -1 : cfg.ethRst,
              ETH_W5500_SPI_HOST, cfg.ethSck, cfg.ethMiso, cfg.ethMosi,
              cfg.ethFreqMhz);
    ETH.setHostname(cfg.hostname.c_str());   // DHCP hostname (option 12) for the wired link
    applyEthStaticIp();
    waitEthLink();
    s_ethUpDone = true;
    vTaskDelete(NULL);
}
static void startEthSpi() {
    Serial.printf("[ETH] %s SPI cs=%d irq=%d rst=%d sck=%d miso=%d mosi=%d freq=%dMHz (bring-up on core 0)\n",
        cfg.ethSpiPhy == ETH_SPI_PHY_DM9051 ? "DM9051" : "W5500",
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
//
// The internal EMAC's RX interrupt is allocated on whichever core calls ETH.begin(), so
// we bring it up from a task pinned to core 0 -- exactly like the W5500 path (ethUpTask)
// -- to keep the EMAC interrupt off core 1, where the DMX transmit (sendDmx/dmx_send in
// loop()) runs. Brought up inline in setup() the EMAC ISR lands on core 1, and a busy
// wired link (Art-Net flood) then preempts the DMX break/frame timing enough to put
// framing errors on the output (issue #64). Measured on the bench: idle 0 framing
// errors, ~4.4/min under a heavy flood with the inline (core-1) bring-up.
static volatile bool s_ethRmiiUpDone;
static void ethRmiiUpTask(void *arg) {
    int phy = constrain(cfg.rmiiPhy, 0, RMII_PHY_COUNT - 1);
    ETH.begin(rmiiPhyType(phy), cfg.rmiiAddr, cfg.rmiiMdc, cfg.rmiiMdio,
              cfg.rmiiPwr, rmiiClkMode(cfg.rmiiClk));
    ETH.setHostname(cfg.hostname.c_str());   // DHCP hostname (option 12) for the wired link
    applyEthStaticIp();
    waitEthLink();
    s_ethRmiiUpDone = true;
    vTaskDelete(NULL);
}
static void startEthRmii() {
    int phy = constrain(cfg.rmiiPhy, 0, RMII_PHY_COUNT - 1);
    Serial.printf("[ETH] %s RMII addr=%d mdc=%d mdio=%d pwr=%d clk=%d (bring-up on core 0)\n",
        RMII_PHY_NAMES[phy], cfg.rmiiAddr, cfg.rmiiMdc, cfg.rmiiMdio, cfg.rmiiPwr, cfg.rmiiClk);
    s_ethRmiiUpDone = false;
    xTaskCreatePinnedToCore(ethRmiiUpTask, "ethrmii", 8192, NULL, 5, NULL, 0);
    uint32_t t0 = millis();
    while (!s_ethRmiiUpDone && millis() - t0 < 30000) delay(20);
    if (!s_ethRmiiUpDone) Serial.println("[ETH] RMII core-0 bring-up still running after 30s");
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
static void startWiFiStation();   // fwd decl: WIRED_FB_WIFI joins WiFi when the wired link is down
static void applyWiredLinkLoss(bool atBoot) {
    switch (cfg.linkLossMode) {
        case WIRED_FB_AP:
            // Stopgap AP: if it comes up, remember it was a wired fallback so we can hand
            // back to Ethernet once the link returns (needs an AP password, else stays on retry).
            if (startWiFiAP(true)) { g_apWiredFallback = true; g_ethFallback = true; }
            break;
        case WIRED_FB_WIFI:
            // No wired link -> join the stored WiFi network (STA). Needs credentials; without
            // them there is nothing to join, so keep retrying the wired link instead. At boot we
            // join directly; a link drop while running reboots (a clean boot then joins WiFi with
            // no mid-show blocking connect). The next boot prefers wired again if the cable is back.
            if (!cfg.wifiSsid.length()) break;
            if (atBoot) {
                Serial.println("[NET] no wired link at boot -> joining stored WiFi");
                g_useEth = false;
                g_ethFallback = true;   // Ethernet configured but coming up on WiFi -> status LED shows orange
                startWiFiStation();
            } else {
                Serial.println("[NET] wired link lost -> reboot to join WiFi");
                delay(200); ESP.restart();
            }
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

// One-time migration for devices upgrading from a WiFiManager build: those kept the STA
// SSID/password in the ESP32 WiFi NVS, not in our cfg, so cfg.wifiSsid is empty after the
// OTA even though the user has a working network. Recover the persisted creds from the WiFi
// NVS and save them into our keys, so the upgrade joins the same network instead of dropping
// into the setup portal. Returns true if it recovered something. Runs only when cfg has no
// SSID yet (a fresh first-run device has nothing in the WiFi NVS either, so this is a no-op).
static bool migrateWifiCredsFromNvs() {
    // Genuinely one-time: mark it done in our NVS the first time it's attempted, whether or
    // not it finds anything. Without this, "Reset WiFi" (which only clears cfg.wifiSsid) would
    // re-recover the same old creds from the ESP32 WiFi NVS on the next boot and never open
    // the portal — the WiFi NVS itself is not reliably wipeable from here (WiFi.disconnect /
    // esp_wifi_restore both left a stale SSID behind on the rig). Once the flag is set,
    // cfg.wifiSsid is the single source of truth, so clearing it always reopens the portal.
    prefs.begin(PREF_NS, false);
    bool alreadyDone = prefs.getBool("wifimig", false);
    if (!alreadyDone) prefs.putBool("wifimig", true);
    prefs.end();
    if (alreadyDone) return false;

    wifi_config_t wc;
    if (esp_wifi_get_config(WIFI_IF_STA, &wc) != ESP_OK) return false;
    String ssid = String((const char*)wc.sta.ssid);
    if (ssid.length() == 0) return false;
    cfg.wifiSsid = ssid;
    cfg.wifiPsk  = String((const char*)wc.sta.password);
    saveConfig();
    Serial.printf("[SETUP] migrated WiFi creds from WiFiManager NVS: ssid='%s'\n", ssid.c_str());
    return true;
}

// Apply a static IP to the WiFi station before WiFi.begin(), or fall back to DHCP.
// WiFiManager used to do this for us; now we own it.
static void applyStaStaticIp() {
    if (!cfg.staticIp) { WiFi.config((uint32_t)0, (uint32_t)0, (uint32_t)0); return; }  // DHCP
    IPAddress ip, gw, sn, dns;
    parseIp(cfg.ip, ip); parseIp(cfg.gateway, gw);
    parseIp(cfg.subnet, sn); parseIp(cfg.dns, dns);
    WiFi.config(ip, gw, sn, dns);
    Serial.printf("[WiFi] static IP %s\n", cfg.ip.c_str());
}

// WiFi station (client) bring-up: connect to the strongest AP for the stored SSID.
// If BOOT is held at power-on, or there are no stored credentials yet (first run), open
// the on-brand setup portal instead (issue #45). Factored out of setup() so the network
// dispatch there reads as interface → mode.
static void startWiFiStation() {
    bool forcePortal = false;
    if (digitalRead(CFG_BOOT_PIN) == LOW) {
        Serial.print("[BOOT] button held, waiting...");
        uint32_t t = millis();
        while (digitalRead(CFG_BOOT_PIN) == LOW && millis()-t < HOLD_MS) delay(50);
        forcePortal = (digitalRead(CFG_BOOT_PIN) == LOW);
        Serial.println(forcePortal ? " → setup portal" : " released");
    }
    if (forcePortal && cfg.staticIp) {   // recovery: come back on DHCP
        cfg.staticIp = false;
        saveConfig();
    }
    WiFi.mode(WIFI_STA);   // also brings up the WiFi driver so esp_wifi_get_config() works
    WiFi.setHostname(cfg.hostname.c_str());   // DHCP hostname (option 12) so the router resolves the name
#ifndef SIM_WIFI
    // Upgrade path: pull creds out of the old WiFiManager WiFi-NVS into our cfg, once.
    if (cfg.wifiSsid.length() == 0) migrateWifiCredsFromNvs();
    // First-run / BOOT-held → the setup portal (open SoftAP + captive page). Never opens
    // by itself mid-run: only here, and only with no creds or the button physically held.
    if (forcePortal || cfg.wifiSsid.length() == 0) {
        Serial.println(cfg.wifiSsid.length() == 0 ? "[SETUP] no WiFi configured — opening setup portal"
                                                  : "[SETUP] BOOT held — opening setup portal");
        startSetupPortal();
        return;   // setup() registers the web routes; the portal serves them
    }
#endif
    WiFi.setScanMethod(WIFI_ALL_CHANNEL_SCAN);
    WiFi.setSortMethod(WIFI_CONNECT_AP_BY_SIGNAL);
    setLedColor(NEO_WHITE, true);   // connecting to stored WiFi (white = working; blue is RDM)
#ifdef SIM_WIFI
    // Simulation only (Wokwi): the setup portal can't be reached from the host, so join
    // Wokwi's open virtual AP directly. Never compiled into a real build — guarded by the
    // SIM_WIFI flag set in [env:wokwi].
    (void)forcePortal;
    Serial.print("[SIM] joining Wokwi-GUEST");
    WiFi.begin("Wokwi-GUEST", "");
    { uint32_t t = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - t < 20000) {
          bootConnectingLed();   // 5-LED: Knight-Rider sweep; single LED: blue blink
          delay(200); Serial.print(".");
      } }
    Serial.println();
#else
    // Join the stored network. We keep our own creds (cfg.wifiSsid/wifiPsk) now — the old
    // build let WiFiManager stash them in the ESP32 WiFi NVS.
    applyStaStaticIp();
    Serial.printf("[WiFi] joining '%s'\n", cfg.wifiSsid.c_str());
    WiFi.begin(cfg.wifiSsid.c_str(), cfg.wifiPsk.c_str());
    { uint32_t t = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - t < 30000) {
          bootConnectingLed();   // 5-LED: Knight-Rider sweep; single LED: blue blink
          delay(200);
      } }
    // If the stored creds simply don't work (wrong password, AP gone), reboot into the
    // setup portal so the device stays reachable instead of silently spinning. We DON'T
    // wipe the creds — the loop() watchdog also keeps retrying — but a fresh boot with no
    // association lands the user back on the setup page to fix it.
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("[WiFi] could not join stored network — opening setup portal");
        startSetupPortal();
        return;
    }
    // The ESP32's auto-connect reliably sticks to whichever AP it used before, even a
    // distant one on a mesh. Explicitly scan and hop to the strongest AP for our SSID on
    // every boot (also logs all APs for diagnostics).
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
    // Recover-a-stuck-board path over USB: persist the creds into OUR config (SSID/psk are
    // schema fields now, wifissid/wifipsk) and switch to STA, then reconnect. Persisting to
    // cfg means the next boot joins this network from startWiFiStation() instead of the
    // setup portal — same as if you'd typed it on the setup page.
    cfg.wifiMode = NET_WIFI_STA;
    cfg.wifiSsid = ssid;
    cfg.wifiPsk  = pass;
    saveConfig();
    WiFi.mode(WIFI_STA);
    WiFi.setHostname(cfg.hostname.c_str());
    WiFi.begin(ssid.c_str(), pass.c_str());
    return true;
}
static const cfgserial::Hooks SERIAL_HOOKS = {
    cfgserialSave, cfgserialReboot, cfgserialFactory, cfgserialWifi };

void setup() {
    // Brownout detector. The ESP32-S3 disables it at the sdkconfig level (its BOD arms during
    // IDF startup, before setup() runs, so a register write here is too late). The WT32-ETH01
    // keeps it disabled via this write (its RMII PHY has its own inrush and it is not retested
    // with the BOD on). On the generic classic ESP32 (esp32dev) we now LEAVE THE BOD ON: a board
    // whose 3.3V rail cannot supply the WiFi RF turn-on will reboot with a clear
    // "Brownout detector was triggered" instead of hanging silently at WiFi.mode(), so a user
    // knows it is a power problem (weak regulator / missing decoupling), not a dead board. See
    // docs/hardware notes: such boards need a solid 3.3V supply or a bulk cap near the module.
#if defined(USE_ETH_RMII)
    WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);   // WT32-ETH01 only
#endif
    Serial.begin(115200);
    startMs = millis();
    Serial.println("\n[BOOT] LuxDMX — Art-Net / sACN DMX Gateway");

    loadConfig();   // also allocates the RDM tables (rdmAllocTables) before rdmLoadPoll uses them
    if (heap_caps_get_total_size(MALLOC_CAP_SPIRAM))
        Serial.printf("[MEM] PSRAM %u KB total / %u KB free; internal heap %u KB free\n",
            (unsigned)(heap_caps_get_total_size(MALLOC_CAP_SPIRAM) / 1024),
            (unsigned)(heap_caps_get_free_size(MALLOC_CAP_SPIRAM)  / 1024),
            (unsigned)(heap_caps_get_free_size(MALLOC_CAP_INTERNAL) / 1024));
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

    // Clean-heap OTA: install a pending (or auto-) update now, while only the network stack
    // is up and the heap is unfragmented. A self-update needs a big contiguous block for TLS
    // that the fully-booted system (DMX/RDM/Art-Net/web/WS) no longer leaves free. Reboots
    // into the new image on success; returns here (and boots normally) on nothing-to-do/failure.
    otaBootUpdate();

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
#ifndef DMX_RMT
        artnet.setArtDmxCallback(onArtDmx);
        artnet.begin();
#endif
        Serial.printf("[ArtNet] out0 universe %d%s\n", cfg.outputs[0].universe,
            cfg.outputs[1].enabled ? " (+out1)" : "");
    }
#ifdef DMX_RMT
    // The Art-Net RDM bridge owns the 6454 socket (Art-Net DMX + ArtPoll/ArtTod*/ArtRdm)
    // and does incremental, bus-friendly RDM discovery. Replaces artnet.begin() here.
    artRdmInit();
#endif
    if (cfg.protocol != 0) startSacn();

    http.on("/logo.webp",         HTTP_GET,  handleLogo);
    http.on("/favicon.png",       HTTP_GET,  handleFavicon);
    http.on("/favicon.ico",       HTTP_GET,  handleFavicon);
    http.on("/bootstrap.min.css", HTTP_GET,  handleBootstrapCss);
    http.on("/",                  HTTP_GET,  handleRoot);
    http.on("/dmx.json",          HTTP_GET,  handleDmxJson);
    http.on("/senders.json",      HTTP_GET,  handleSendersJson);
    http.on("/log.json",          HTTP_GET,  handleLogJson);
    http.on("/config",            HTTP_GET,  handleConfigGet);
    http.on("/config",            HTTP_POST, handleConfigPost);
    // Register /setup/scan BEFORE /setup: this AsyncWebServer matches a plain-string route
    // as a prefix (^/setup(/.*)?$), so a /setup handler registered first would also swallow
    // /setup/scan and serve the HTML page instead of the JSON. Most-specific route first.
    http.on("/setup/scan",        HTTP_GET,  handleSetupScan);
    http.on("/setup",             HTTP_GET,  handleSetupGet);
    http.on("/setup",             HTTP_POST, handleSetupPost);
    http.on("/reset",             HTTP_GET,  handleResetGet);
    http.on("/reset",             HTTP_POST, handleResetPost);
    http.on("/ota/github",        HTTP_POST, handleOtaGithub);
    http.on("/ota/status",        HTTP_GET,  handleOtaStatus);
    http.on("/ota/upload",        HTTP_POST, handleOtaUploadDone, handleOtaUploadChunk);
    http.on("/version.json",      HTTP_GET,  handleVersionJson);
    http.on("/info.json",         HTTP_GET,  handleInfoJson);
    http.on("/rdm.json",          HTTP_GET,  handleRdmJson);
    http.on("/rdm/discover",      HTTP_GET,  handleRdmTrigger);
    http.on("/rdm/setaddr",       HTTP_GET,  handleRdmTrigger);
    http.on("/rdm/identify",      HTTP_GET,  handleRdmTrigger);
    http.on("/rdm/bqp",           HTTP_GET,  handleRdmTrigger);
    http.on("/rdm/merge",         HTTP_GET,  handleRdmTrigger);
    http.on("/led/bright",        HTTP_GET,  handleLedBright);   // live-tune the 5-LED panel brightness
    // The page route matches "/rdm" and prefix "/rdm/…", so register it AFTER the /rdm/* handlers
    // (first match wins) or it would swallow /rdm/discover etc.
    http.on("/rdm",               HTTP_GET,  handleRdmPage);
    http.on("/labels.json",       HTTP_GET,  handleLabelsGet);
    http.on("/labels",            HTTP_POST, [](AsyncWebServerRequest*){}, NULL, handleLabelsBody);
    http.on("/autoupdate",        HTTP_POST, handleAutoUpdatePost);
    http.onNotFound([](AsyncWebServerRequest* req) {
        // While the setup portal is up, send every unknown URL (incl. the OS captive-portal
        // probes like /generate_204 and /hotspot-detect.html) to "/", so the phone shows the
        // "sign in to network" sheet and lands on the setup page.
        if (g_setupPortal) {
            AsyncWebServerResponse* r = req->beginResponse(302, "text/plain", "");
            r->addHeader("Location", "/");
            req->send(r);
            return;
        }
        req->send(404, "text/plain", "Not found");
    });

    ws.onEvent(onWsEvent);
    http.addHandler(&ws);
    http.begin();

    lastFrameMs = millis();
    // LED on its own low-priority task so web traffic can't freeze it.
    xTaskCreate(ledTask, "led", 2048, nullptr, 1, nullptr);
    if (dispReady) xTaskCreate(displayTask, "disp", 4096, nullptr, 1, nullptr);
    initControls();   // optional on-unit rotary encoder + buttons -> display menu (issue #24); no-op unless wired
    xTaskCreate(versionCheckTask, "ver_chk", 12288, nullptr, 1, nullptr);
    // issue #64 core separation: DMX transmit on core 1, Art-Net/sACN receive on core 0.
    // dmxTxTask: high priority (19, above loop()=1), pinned core 1, strict 40 Hz cadence,
    //   sole owner of the DMX ports; self-gates on dmxReady so it is safe to start early.
    // netRxTask: moderate priority (5, below lwIP/WiFi so it can't starve them), pinned
    //   core 0, drains the UDP sockets and re-merges idle sources. With receive on core 0
    //   nothing on core 1 can disturb esp_dmx's break/MAB timer ISR -> rock-solid frames.
    xTaskCreatePinnedToCore(dmxTxTask, "dmxtx", 4096, nullptr, 19, &g_dmxTask, 1);
    xTaskCreatePinnedToCore(netRxTask, "netrx", 8192, nullptr, 5,  nullptr,   0);

    // Survive a network flood without resetting. Under heavy inbound traffic (e.g. an Art-Net
    // storm on the wired link) the lwIP task pegs core 0, so core 0's idle task can't feed the
    // task watchdog and the default handler PANICS -> SW_CPU_RESET. On the HIL bench a sustained
    // ~6k+ pkt/s Art-Net flood crash-looped the WT32 every ~15 s (task_wdt: IDLE0, CPU 0: tiT).
    // That is not a hang -- core 0 is just busy -- and a gateway must keep clocking DMX through it
    // (DMX lives on core 1 and is unaffected). So reconfigure the task WDT to LOG a warning on
    // starvation instead of rebooting. The idle tasks stay subscribed (arduino-esp32's idle hook
    // keeps feeding them, so no "esp_task_wdt_reset: task not found" spam that disableCore0WDT()
    // caused), the timeout is widened, and a real hang is still reported on the console + backtrace
    // -- we just don't self-reset a busy-but-alive gateway mid-show. (This is what the analyzer saw
    // as the DMX "freeze": the controller was rebooting, not the wire.)
    {
        esp_task_wdt_config_t twdt = {
            .timeout_ms     = 10000,
            .idle_core_mask  = (1u << portNUM_PROCESSORS) - 1,   // keep both idle tasks watched (no hook spam)
            .trigger_panic  = false,                            // log-and-continue, don't reboot under load
        };
        esp_task_wdt_reconfigure(&twdt);
    }
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
// Network receive task -- runs on CORE 0, the network core. This is the other half
// of the issue #64 fix: it takes Art-Net / sACN receive (artnet.read / readSacn) and
// source-timeout re-merge OFF core 1, so the DMX transmit on core 1 (dmxTxTask) runs
// with NOTHING else competing for the core. esp_dmx sequences its break/MAB with a
// hardware-timer ISR on core 1; any lwIP/packet work on core 1 (as loop() used to do)
// can delay that ISR and corrupt a frame while the DMX task is between frames. Moving
// receive to core 0 removes that entirely: core 1 = DMX only. Receive writes dmxBuf,
// the DMX task reads it -- a plain byte array, so a rare torn frame is harmless (the
// next frame 25 ms later is consistent) and no lock is needed (a lock would risk
// priority-inverting the high-priority DMX task).
static void netRxTask(void*) {
    for (;;) {
        // The on-unit controls menu changed a universe -> re-join the sACN multicast
        // groups here, where this task owns the sockets (issue #24). Art-Net needs
        // nothing: routeFrame() already dispatches by each packet's own universe.
        if (g_sacnRejoin) { g_sacnRejoin = false; if (cfg.protocol != 0) startSacn(); }
        if (netConnected()) {
#ifdef DMX_RMT
            // Art-Net on our own 6454 socket: ArtDmx -> routeFrame, and the RDM opcodes
            // (ArtPoll/ArtTodRequest/ArtTodControl/ArtRdm) queued to the DMX task. Then flush
            // any ArtTodData / ArtRdm replies the DMX task produced. Bounded per call.
            artRdmPollRx();
            artRdmDrainResponses();
#else
            // Drain all queued Art-Net packets (bounded) so a socket backlog catches up
            // to the newest frame. read() runs onArtDmx per ART_DMX, returns 0 when empty.
            if (cfg.protocol != 1)
                for (int n = 0; n < 64 && artnet.read(); ++n) { }
#endif
            if (cfg.protocol != 0) readSacn();
        }
        ArduinoOTA.handle();

        uint32_t now = millis();
        // Re-merge outputs whose input has gone quiet so a stopped source drops out of
        // the mix even without a new frame (issue #10 source timeout).
        static uint32_t lastMergeMs = 0;
        if (now - lastMergeMs >= 100) {
            for (int i = 0; i < MAX_OUTPUTS; i++)
                if (cfg.outputs[i].enabled && now - outLastDmxMs[i] >= 100) mergeOutput(i);
            g_srcStatus = sourceStatus();
            lastMergeMs = now;
        }
        vTaskDelay(1);   // yield ~1 ms; the 64-packet drain + lwIP buffering keep up easily
    }
}

// ---------------------------------------------------------------------------
// loop()  (core 1) -- DMX (dmxTxTask) and receive (netRxTask) run in their own tasks now;
// loop() only does the non-time-critical housekeeping (serial console, WS pushes).
// ---------------------------------------------------------------------------
void loop() {
    cfgserial::poll();   // serial config console (non-blocking line reader)

    // First-run setup portal: pump the captive DNS so every lookup resolves to our IP and
    // the phone captive-portal sheet opens on the setup page.
    if (g_setupPortal) dnsServer.processNextRequest();

    if (rdmPollDirty) { rdmPollDirty = false; rdmSavePoll(); }   // persist sensor switch changes
    if (g_artCfgDirty) { g_artCfgDirty = false; saveConfig(); }  // ArtAddress changed a merge mode
    if (g_bqDirty) {                                             // ArtAddress changed the queue policy
        g_bqDirty = false;
        prefs.begin(PREF_NS, false); prefs.putUChar("bqpolicy", g_bqPolicy); prefs.end();
    }

#ifdef SIM_ARTNET
    simArtnetTick();
#endif

    uint32_t now = millis();

    // Art-Net/sACN receive + source-timeout re-merge -> netRxTask (core 0).
    // DMX output + RDM bus service -> dmxTxTask (core 1, high priority).
    // Keeping both off this loop is the issue #64 fix: core 1 does only DMX, so no
    // packet processing can delay/jitter the break/frame timing. loop() just does the
    // non-time-critical housekeeping below.

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

    // Once the device has run stably for a minute, clear the OTA retry budget so the next
    // update starts fresh. A device stuck reboot-looping on a failing update would never
    // reach this point, so the budget only resets on a genuinely stable boot -- that caps it.
    static bool otaBudgetReset = false;
    if (!otaBudgetReset && millis() - startMs > 60000) {
        otaBudgetReset = true;
        prefs.begin(PREF_NS, false);
        if (prefs.getUChar("otatries", 0)) prefs.putUChar("otatries", 0);
        prefs.end();
    }

    // Deferred reboot (config save / reset / OTA done) so the HTTP response
    // can flush from the async task before we restart.
    if (pendingRebootAt && now >= pendingRebootAt) {
        // handleResetPost / the serial factory hook already cleared cfg.wifiSsid/wifiPsk and
        // saved; also drop the live association. The next boot reopens the setup portal
        // because cfg.wifiSsid is empty AND the one-time migration flag is set (see
        // migrateWifiCredsFromNvs) — so stale creds still sitting in the ESP32 WiFi NVS from
        // an old WiFiManager build are NOT re-recovered.
        if (pendingWifiReset) WiFi.disconnect(true /*wifioff*/, true /*eraseap*/);
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

    // Yield one tick so IDLE1 runs (feeds its task watchdog) and core 1 keeps genuine idle
    // slack. loop() is only housekeeping, so 1 ms latency here is irrelevant; without it
    // loopTask (prio 1) can monopolise core 1 under load and trip the IDLE1 watchdog.
    delay(1);
}
