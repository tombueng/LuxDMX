// ---------------------------------------------------------------------------
// THE field table. Single source of truth for every persisted setting's
// structure: name, type, constraint, label, group. NO defaults live here, they
// come from the active board template (templates/*.ini). The only constants
// referenced are STRUCTURAL (how many merge modes / RMII PHY families the
// compiled code supports), not board defaults.
// ---------------------------------------------------------------------------
#include "config_types.h"
#include "config_schema.h"
#include "config_enums.h"   // MERGE_OFF/_LTP, RMII_PHY_COUNT — structural, not defaults

#define ARRSZ(a) (sizeof(a) / sizeof((a)[0]))

// ---- enum value labels (for menus + UI hints; order == stored int value) ----
static const char* const ENUM_PIXBK[]   = {"automatic", "RMT (one channel per port)",
                                           "LCD_CAM (parallel, DMA only)"};
static const char* const ENUM_PROTOCOL[] = {"Art-Net", "sACN", "Art-Net + sACN"};
static const char* const ENUM_LEDTYPE[]  = {"off", "plain GPIO", "WS2812 RGB", "5-LED panel"};
static const char* const ENUM_DISPTYPE[] = {"off", "SSD1306 128x64", "SSD1306 128x32", "SH1106", "SSD1351 colour"};
static const char* const ENUM_WIREDPHY[] = {"W5500 (SPI)", "LAN8720 (RMII)"};
static const char* const ENUM_ETHSPIPHY[] = {"W5500", "DM9051"};
static const char* const ENUM_WIFIMODE[] = {"STA (client)", "AP (standalone)"};
static const char* const ENUM_FBMODE[]   = {"keep retrying", "open WPA2 AP", "reboot", "join WiFi"};
// On-unit controls button roles — order == stored value == BtnRole in input_map.h.
static const char* const ENUM_BTNROLE[]  = {"off", "Enter / Select", "Back", "Next (+)", "Prev (-)"};
// DMX transmit rate per output (issue #93). Index 0 MUST stay 40 fps: the config engine derives a
// missing key's neutral value from the field's min, so a device upgrading from a build without this
// key has to land on the rate it already had. Order is therefore "default first", not fastest first.
// A full 513-slot frame occupies 22.76 ms on the wire, so 24 ms is the fastest period we offer -- the
// E1.11 ceiling of 44 Hz (22.68 ms) would leave no headroom at all for the RMT refill.
static const char* const ENUM_TXRATE[]  = {"40 fps (25 ms)", "41.7 fps (24 ms)", "33.3 fps (30 ms)",
                                           "25 fps (40 ms)", "20 fps (50 ms)"};
static const char* const ENUM_TXSTYLE[] = {"Continuous (free-run)", "Delta (follow the input)"};
static const char* const ENUM_TXSRC[]   = {"set here", "set over Art-Net"};

// ---- compact row builders (no defaults — neutral is derived from min) -------
#define IFIELD(key, json, member, mn, mx, label, group) \
    { key, json, CfgKind::Int,  offsetof(Config, member), mn, mx, label, group, CFG_REBOOT, nullptr, 0 }
#define BFIELD(key, json, member, label, group, flags) \
    { key, json, CfgKind::Bool, offsetof(Config, member), 0, 1, label, group, (CFG_REBOOT | (flags)), nullptr, 0 }
#define SFIELD(key, json, member, label, group, flags) \
    { key, json, CfgKind::Str,  offsetof(Config, member), 0, 0, label, group, (CFG_REBOOT | (flags)), nullptr, 0 }
#define EFIELD(key, json, member, label, group, labels) \
    { key, json, CfgKind::Enum, offsetof(Config, member), 0, (int32_t)ARRSZ(labels) - 1, label, group, CFG_REBOOT, labels, (uint8_t)ARRSZ(labels) }
// ---- the same four, but CFG_LIVE -------------------------------------------------------------
// A field is LIVE when the running firmware re-reads it (or applyLiveConfig() can re-apply it)
// without anything having to be torn down. Everything bound to a GPIO or to a driver installed at
// boot stays CFG_REBOOT, because changing those under a running driver is how you get a half-
// configured UART. handleConfigPost reboots only when a REBOOT field actually CHANGED value, so
// the common case -- fixing a universe, a merge mode, an output rate -- no longer costs a restart.
#define IFIELD_L(key, json, member, mn, mx, label, group) \
    { key, json, CfgKind::Int,  offsetof(Config, member), mn, mx, label, group, CFG_LIVE, nullptr, 0 }
#define BFIELD_L(key, json, member, label, group, flags) \
    { key, json, CfgKind::Bool, offsetof(Config, member), 0, 1, label, group, (uint16_t)(CFG_LIVE | (flags)), nullptr, 0 }
#define SFIELD_L(key, json, member, label, group, flags) \
    { key, json, CfgKind::Str,  offsetof(Config, member), 0, 0, label, group, (uint16_t)(CFG_LIVE | (flags)), nullptr, 0 }
#define EFIELD_L(key, json, member, label, group, labels) \
    { key, json, CfgKind::Enum, offsetof(Config, member), 0, (int32_t)ARRSZ(labels) - 1, label, group, CFG_LIVE, labels, (uint8_t)ARRSZ(labels) }

const CfgField CONFIG_FIELDS[] = {
    // --- Identity / general -------------------------------------------------
    SFIELD("hostname", "hostname", hostname,    "Hostname",       "Identity", CFG_KEEPNE),
    // The /config board selector's choice ("luxdmx_v6", "custom", a catalog id, ...). UI state,
    // not something the firmware reads, but it must survive a reboot/OTA, since the board a
    // build reports is compile-time and a v6 runs the generic esp32s3dev build.
    SFIELD_L("board",    "boardSel", boardSel,    "Board",          "Identity", CFG_NONE),
    SFIELD("otapw",    "otapw",    otaPassword, "OTA password",   "Identity", CFG_SECRET | CFG_KEEPNE),
    EFIELD_L("protocol", "protocol", protocol,    "Input protocol", "Identity", ENUM_PROTOCOL),

    // --- Status LED ---------------------------------------------------------
    IFIELD("ledpin",  "ledPin",  ledPin,  -1, 48, "LED pin",           "Status LED"),
    EFIELD("ledtype", "ledType", ledType,        "LED type",          "Status LED", ENUM_LEDTYPE),
    IFIELD("ledr",    "ledR",    ledR,    -1, 48, "5-LED panel R pin", "Status LED"),
    IFIELD("ledg",    "ledG",    ledG,    -1, 48, "5-LED panel G pin", "Status LED"),
    IFIELD("ledy",    "ledY",    ledY,    -1, 48, "5-LED panel Y pin", "Status LED"),
    IFIELD("ledb",    "ledB",    ledB,    -1, 48, "5-LED panel B pin", "Status LED"),
    IFIELD("ledw",    "ledW",    ledW,    -1, 48, "5-LED panel W pin", "Status LED"),
    IFIELD_L("ledbrr",  "ledBrR",  ledBrR,   0, 255, "5-LED panel R brightness", "Status LED"),
    IFIELD_L("ledbrg",  "ledBrG",  ledBrG,   0, 255, "5-LED panel G brightness", "Status LED"),
    IFIELD_L("ledbry",  "ledBrY",  ledBrY,   0, 255, "5-LED panel Y brightness", "Status LED"),
    IFIELD_L("ledbrb",  "ledBrB",  ledBrB,   0, 255, "5-LED panel B brightness", "Status LED"),
    IFIELD_L("ledbrw",  "ledBrW",  ledBrW,   0, 255, "5-LED panel W brightness", "Status LED"),

    // --- Display ------------------------------------------------------------
    EFIELD("disptype", "dispType", dispType,        "Display type", "Display", ENUM_DISPTYPE),
    IFIELD("dispsda",  "dispSda",  dispSda,  -1, 48, "I2C SDA",     "Display"),
    IFIELD("dispscl",  "dispScl",  dispScl,  -1, 48, "I2C SCL",     "Display"),
    IFIELD_L("disprot",  "dispRot",  dispRot,   0,  1, "Rotate 180",  "Display"),
    IFIELD("dispcs",   "dispCs",   dispCs,   -1, 48, "SPI CS",      "Display"),
    IFIELD("dispdc",   "dispDc",   dispDc,   -1, 48, "SPI DC",      "Display"),
    IFIELD("disprst",  "dispRst",  dispRst,  -1, 48, "SPI RST",     "Display"),
    IFIELD("dispsck",  "dispSck",  dispSck,  -1, 48, "SPI SCK",     "Display"),
    IFIELD("dispmosi", "dispMosi", dispMosi, -1, 48, "SPI MOSI",    "Display"),

    // --- On-unit controls: rotary encoder + buttons + display menu (issue #24) ---
    IFIELD("enca",     "encA",     encA,      -1, 48, "Encoder A pin",        "Controls"),
    IFIELD("encb",     "encB",     encB,      -1, 48, "Encoder B pin",        "Controls"),
    IFIELD("encsw",    "encSw",    encSw,     -1, 48, "Encoder push pin",     "Controls"),
    IFIELD_L("encsteps", "encSteps", encSteps,   1,  4, "Encoder steps/detent", "Controls"),
    BFIELD_L("encrev",   "encReverse", encReverse,     "Reverse encoder dir",  "Controls", CFG_NONE),
    IFIELD("btn1pin",  "btn1Pin",  btn1Pin,   -1, 48, "Button 1 pin",         "Controls"),
    EFIELD_L("btn1act",  "btn1Act",  btn1Act,           "Button 1 action",      "Controls", ENUM_BTNROLE),
    IFIELD("btn2pin",  "btn2Pin",  btn2Pin,   -1, 48, "Button 2 pin",         "Controls"),
    EFIELD_L("btn2act",  "btn2Act",  btn2Act,           "Button 2 action",      "Controls", ENUM_BTNROLE),
    IFIELD("btn3pin",  "btn3Pin",  btn3Pin,   -1, 48, "Button 3 pin",         "Controls"),
    EFIELD_L("btn3act",  "btn3Act",  btn3Act,           "Button 3 action",      "Controls", ENUM_BTNROLE),
    IFIELD("btn4pin",  "btn4Pin",  btn4Pin,   -1, 48, "Button 4 pin",         "Controls"),
    EFIELD_L("btn4act",  "btn4Act",  btn4Act,           "Button 4 action",      "Controls", ENUM_BTNROLE),
    BFIELD_L("btnah",    "btnActiveHigh", btnActiveHigh, "Buttons active-high", "Controls", CFG_NONE),
    IFIELD_L("ctlunimax","ctlUniMax", ctlUniMax,  1, 511, "Menu max universe",  "Controls"),

    // --- Wired Ethernet: W5500 (SPI) ---------------------------------------
    BFIELD("ethon",   "ethW5500", ethW5500,           "W5500 module enabled", "Ethernet (W5500)", CFG_NONE),
    IFIELD("ethcs",   "ethCs",    ethCs,      -1, 48, "W5500 CS",   "Ethernet (W5500)"),
    IFIELD("ethsck",  "ethSck",   ethSck,     -1, 48, "W5500 SCK",  "Ethernet (W5500)"),
    IFIELD("ethmosi", "ethMosi",  ethMosi,    -1, 48, "W5500 MOSI", "Ethernet (W5500)"),
    IFIELD("ethmiso", "ethMiso",  ethMiso,    -1, 48, "W5500 MISO", "Ethernet (W5500)"),
    IFIELD("ethint",  "ethInt",   ethInt,     -1, 48, "W5500 INT",  "Ethernet (W5500)"),
    IFIELD("ethrst",  "ethRst",   ethRst,     -1, 48, "W5500 RST",  "Ethernet (W5500)"),
    IFIELD("ethfreq", "ethFreq",  ethFreqMhz,  1, 80, "W5500 SPI MHz", "Ethernet (W5500)"),
    EFIELD("ethspiphy", "ethSpiPhy", ethSpiPhy, "SPI Ethernet chip", "Ethernet (W5500)", ENUM_ETHSPIPHY),

    // --- Wired Ethernet: PHY select + LAN8720 (RMII) -----------------------
    EFIELD("wiredphy", "wiredPhy", wiredPhy,                       "Wired PHY",       "Ethernet (RMII)", ENUM_WIREDPHY),
    IFIELD("rmiiphy",  "rmiiPhy",  rmiiPhy,  0, RMII_PHY_COUNT - 1, "RMII PHY family", "Ethernet (RMII)"),
    IFIELD("rmiiaddr", "rmiiAddr", rmiiAddr, 0, 31, "RMII SMI addr",  "Ethernet (RMII)"),
    IFIELD("rmiimdc",  "rmiiMdc",  rmiiMdc,  0, 48, "RMII MDC",       "Ethernet (RMII)"),
    IFIELD("rmiimdio", "rmiiMdio", rmiiMdio, 0, 48, "RMII MDIO",      "Ethernet (RMII)"),
    IFIELD("rmiipwr",  "rmiiPwr",  rmiiPwr, -1, 48, "RMII PHY power", "Ethernet (RMII)"),
    IFIELD("rmiiclk",  "rmiiClk",  rmiiClk,  0,  3, "RMII REF_CLK",   "Ethernet (RMII)"),

    // --- Network / WiFi -----------------------------------------------------
    BFIELD("useeth",   "useEthernet",  useEthernet,  "Use wired Ethernet", "Network", CFG_NONE),
    EFIELD("wifimode", "wifiMode",     wifiMode,     "WiFi mode",          "Network", ENUM_WIFIMODE),
    // STA credentials: we own these now (the old WiFiManager kept them in the ESP32 WiFi NVS).
    // wifissid: a blank web field clears it -> the device drops into the setup portal next boot.
    // wifipsk: CFG_KEEPNE so saving other settings with the (never-echoed) password field left
    // blank doesn't wipe it; CFG_SECRET masks it in serial dumps. /info.json only ever emits the
    // SSID, never the password.
    SFIELD("wifissid", "wifiSsid",     wifiSsid,     "WiFi SSID",          "Network", CFG_NONE),
    SFIELD("wifipsk",  "wifiPsk",      wifiPsk,      "WiFi password",      "Network", CFG_SECRET | CFG_KEEPNE),
    EFIELD("fbmode",   "linkLossMode", linkLossMode, "Link-loss policy",   "Network", ENUM_FBMODE),
    SFIELD("appw",     "apPassword",   apPassword,   "AP password",        "Network", CFG_SECRET),
    BFIELD("staticip", "staticIp",     staticIp,     "Static IP",          "Network", CFG_NONE),
    SFIELD("ip",       "ip",           ip,           "IP address",         "Network", CFG_NONE),
    SFIELD("gateway",  "gateway",      gateway,      "Gateway",            "Network", CFG_NONE),
    SFIELD("subnet",   "subnet",       subnet,       "Subnet mask",        "Network", CFG_NONE),
    SFIELD("dns",      "dns",          dns,          "DNS server",         "Network", CFG_NONE),
    // Remote IP programming over Art-Net (ArtIpProg, issue #110). OFF by default: the Art-Net spec has
    // no auth, rate limit or ownership, so with this on any unicast packet on the network can change
    // the node's address. Off means we don't reply at all, which is the spec's own opt-out for a node
    // that doesn't support the feature. LIVE: flipping it just gates the reply, so no reboot needed.
    BFIELD_L("ipprog", "ipProg",       ipProg,       "Art-Net remote IP config (ArtIpProg)", "Network", CFG_NONE),

    // --- RDM ----------------------------------------------------------------
    BFIELD_L("artrdm", "artnetRdm", artnetRdm, "RDM over Art-Net", "RDM", CFG_NONE),
    IFIELD("rdmmaxdev", "rdmMaxDev", rdmMaxDev, 0, 64, "RDM device limit (0 = auto)", "RDM"),

    // --- Pixels -------------------------------------------------------------
    // What the board's power pour can carry, so the pixel budget has a ceiling to show
    // against. Informational only: the firmware limits per port (p<i>_maxma), never on this.
    IFIELD_L("railma", "railMa", railMa, 0, 60000, "Pixel rail rating (mA)", "Pixels"),
    EFIELD_L("pixbk",  "pixBackend", pixBackend, "Pixel driver", "Pixels", ENUM_PIXBK),

    // --- Updates (own route, not the /config form) -------------------------
    BFIELD("autoupd", "autoUpdate", autoUpdate, "Auto-update firmware", "Updates", CFG_NOWEB),
};
const size_t CONFIG_FIELD_COUNT = ARRSZ(CONFIG_FIELDS);

// ---- per-output sub-schema (expanded over outputs[0..MAX_OUTPUTS-1]) -------
// legacyKey0 = old single-universe NVS key used only for output 0's load fallback.
#define OINT(suffix, json, member, legacy, mn, mx, label) \
    { suffix, json, CfgKind::Int,  offsetof(DmxOutput, member), legacy, mn, mx, label, CFG_REBOOT, nullptr, 0 }
// Live variant: universe / merge / loss are re-read by the merge engine on every frame, so they
// take effect the moment they are saved. Nothing to tear down, no reboot.
#define OINT_L(suffix, json, member, legacy, mn, mx, label) \
    { suffix, json, CfgKind::Int,  offsetof(DmxOutput, member), legacy, mn, mx, label, CFG_LIVE, nullptr, 0 }
#define OBOOL(suffix, json, member, legacy, label) \
    { suffix, json, CfgKind::Bool, offsetof(DmxOutput, member), legacy, 0, 1, label, CFG_REBOOT, nullptr, 0 }
// Enum per output. CFG_LIVE: the DMX task re-reads these every tick, so they take effect the moment
// they are saved -- no reboot, no driver re-init, nothing to tear down.
#define OENUM(suffix, json, member, label, labels) \
    { suffix, json, CfgKind::Enum, offsetof(DmxOutput, member), nullptr, 0, (int32_t)ARRSZ(labels) - 1, \
      label, CFG_LIVE, labels, (uint8_t)ARRSZ(labels) }
// Same, but never rendered into the /config form: the firmware owns the value. Without CFG_NOWEB the
// form loop would rewrite it from a field that isn't there and wipe it on every save.
#define OENUM_RO(suffix, json, member, label, labels) \
    { suffix, json, CfgKind::Enum, offsetof(DmxOutput, member), nullptr, 0, (int32_t)ARRSZ(labels) - 1, \
      label, (uint16_t)(CFG_LIVE | CFG_NOWEB), labels, (uint8_t)ARRSZ(labels) }

const CfgOutputField OUTPUT_FIELDS[] = {
    OBOOL("en",    "en",    enabled,   nullptr,             "Enabled"),
    OINT_L("uni",   "uni",   universe,  "universe", 0, 32767, "Universe"),
    // Legacy from the esp_dmx era: TX now runs on RMT and RDM's RX UART is assigned per line
    // (rdm_rmt.h), so nothing reads this to pick a peripheral any more. Kept because it is part
    // of the persisted config and the /info.json shape; the range follows MAX_OUTPUTS so a
    // third output can hold a distinct value.
    OINT ("port",  "port",  port,      "dmxport",  1,  MAX_OUTPUTS, "UART port (legacy)"),
    OINT ("tx",    "tx",    txPin,     "dmxtx",   -1, 48,   "TX pin"),
    OINT ("rx",    "rx",    rxPin,     "dmxrx",   -1, 48,   "RX pin"),
    OINT ("rts",   "rts",   rtsPin,    "dmxrts",  -1, 48,   "RTS / DE-RE pin"),
    OINT_L("merge", "merge", mergeMode, nullptr, MERGE_OFF, MERGE_LTP, "Merge mode"),
    OINT_L("loss",  "loss",  lossMode,  nullptr, LOSS_HOLD, LOSS_STOP, "Signal-loss policy"),
    OENUM("rate",  "rate",  txRate,     "DMX output rate",  ENUM_TXRATE),
    OENUM("style", "style", txStyle,    "Transmit style",   ENUM_TXSTYLE),
    OENUM_RO("stylesrc", "styleSrc", txStyleSrc, "Transmit style set by", ENUM_TXSRC),
};
const size_t OUTPUT_FIELD_COUNT = ARRSZ(OUTPUT_FIELDS);

// ---- pixel ports -----------------------------------------------------------
// Same row builders, a different struct. Everything here is CFG_LIVE: applying a
// pixel config rebuilds buffers and re-inits the driver in place (build-then-swap,
// see pixel.h), so nothing about a strip needs a reboot -- not even the data pin.
#define POINT(key, json, member, mn, mx, label) \
    { key, json, CfgKind::Int,  offsetof(PixelPort, member), nullptr, mn, mx, label, CFG_LIVE, nullptr, 0 }
#define PBOOL(key, json, member, label) \
    { key, json, CfgKind::Bool, offsetof(PixelPort, member), nullptr, 0, 1, label, CFG_LIVE, nullptr, 0 }
#define PENUM(key, json, member, label, labels) \
    { key, json, CfgKind::Enum, offsetof(PixelPort, member), nullptr, 0, (int32_t)ARRSZ(labels) - 1, \
      label, CFG_LIVE, labels, (uint8_t)ARRSZ(labels) }

static const char* const ENUM_PIXCHIP[]  = {"WS2812 / WS2815 (800 kHz, RGB)",
                                            "WS2811 (400 kHz, RGB)",
                                            "SK6812 / WS2814 (800 kHz, RGBW)"};
static const char* const ENUM_PIXORDER[] = {"GRB", "RGB", "BRG", "RBG", "GBR", "BGR",
                                            "GRBW", "RGBW"};
static const char* const ENUM_PIXLATCH[] = {"On complete (follow the source)",
                                            "On sync (ArtSync / E1.31)",
                                            "Free-run at a fixed rate"};
static const char* const ENUM_PIXUNI[]   = {"Whole pixels per universe",
                                            "Packed across universes (512)"};

const CfgArrayField PIXEL_FIELDS[] = {
    PBOOL ("en",     "en",     enabled,             "Enabled"),
    POINT ("pin",    "pin",    pin,      -1, 48,    "Data pin"),
    // The ceiling is the wire, not us: 2040 px is 61 ms a frame = 16 fps. The UI shows the
    // resulting rate live so the number means something while you type it.
    POINT ("count",  "count",  count,     0, 4096,  "Pixels"),
    PENUM ("chip",   "chip",   chip,                "LED chip",      ENUM_PIXCHIP),
    PENUM ("order",  "order",  order,               "Colour order",  ENUM_PIXORDER),
    POINT ("uni",    "uni",    universe,  0, 32767, "First universe"),
    POINT ("start",  "start",  startCh,   1, 512,   "Start channel"),
    PENUM ("unimode","uniMode",uniMode,             "Universe packing", ENUM_PIXUNI),
    PENUM ("latch",  "latch",  latch,               "Latch policy",  ENUM_PIXLATCH),
    POINT ("fpscap", "fpsCap", fpsCap,    0, 200,   "Max output rate"),
    POINT ("bright", "bright", bright,    0, 255,   "Brightness"),
    POINT ("gamma",  "gamma",  gamma,     0, 400,   "Gamma x100 (0 = off)"),
    POINT ("maxma",  "maxMa",  maxMa,     0, 60000, "Power cap (mA, 0 = off)"),
    POINT ("machan", "mAPerCh",mAPerCh,   0, 10000, "mA per channel at 255, x100"),
    POINT ("quiesma","quiesMa",quiesMa,   0, 10000, "Idle mA per pixel, x100"),
    POINT ("loss",   "loss",   lossMode,  LOSS_HOLD, LOSS_ZERO, "Signal-loss policy"),
    PBOOL ("statid", "statusIdle", statusIdle,      "Show status colour when idle"),
    POINT ("vcols",  "viewCols", viewCols, 0, 512,  "Live view columns"),
    POINT ("vrows",  "viewRows", viewRows, 0, 512,  "Live view rows"),
    PBOOL ("vserp",  "viewSerp", viewSerp,          "Live view serpentine"),
};
const size_t PIXEL_FIELD_COUNT = ARRSZ(PIXEL_FIELDS);

// ---- the array registry ----------------------------------------------------
// Adding an array to Config is one row here; the engine (config_core.cpp) walks this
// for neutral / template / NVS load / save / dump / key resolution.
const CfgArray CONFIG_ARRAYS[] = {
    { 'o', (uint8_t)MAX_OUTPUTS,     (uint16_t)offsetof(Config, outputs), (uint16_t)sizeof(DmxOutput),
      OUTPUT_FIELDS, ARRSZ(OUTPUT_FIELDS), "output" },
    { 'p', (uint8_t)MAX_PIXEL_PORTS, (uint16_t)offsetof(Config, pixels),  (uint16_t)sizeof(PixelPort),
      PIXEL_FIELDS,  ARRSZ(PIXEL_FIELDS),  "pixel port" },
};
const size_t CONFIG_ARRAY_COUNT = ARRSZ(CONFIG_ARRAYS);
