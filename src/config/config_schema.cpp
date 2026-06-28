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
static const char* const ENUM_PROTOCOL[] = {"Art-Net", "sACN", "Art-Net + sACN"};
static const char* const ENUM_LEDTYPE[]  = {"off", "plain GPIO", "WS2812 RGB", "5-LED panel"};
static const char* const ENUM_DISPTYPE[] = {"off", "SSD1306 128x64", "SSD1306 128x32", "SH1106", "SSD1351 colour"};
static const char* const ENUM_WIREDPHY[] = {"W5500 (SPI)", "LAN8720 (RMII)"};
static const char* const ENUM_WIFIMODE[] = {"STA (client)", "AP (standalone)"};
static const char* const ENUM_FBMODE[]   = {"keep retrying", "open WPA2 AP", "reboot"};

// ---- compact row builders (no defaults — neutral is derived from min) -------
#define IFIELD(key, json, member, mn, mx, label, group) \
    { key, json, CfgKind::Int,  offsetof(Config, member), mn, mx, label, group, CFG_REBOOT, nullptr, 0 }
#define BFIELD(key, json, member, label, group, flags) \
    { key, json, CfgKind::Bool, offsetof(Config, member), 0, 1, label, group, (CFG_REBOOT | (flags)), nullptr, 0 }
#define SFIELD(key, json, member, label, group, flags) \
    { key, json, CfgKind::Str,  offsetof(Config, member), 0, 0, label, group, (CFG_REBOOT | (flags)), nullptr, 0 }
#define EFIELD(key, json, member, label, group, labels) \
    { key, json, CfgKind::Enum, offsetof(Config, member), 0, (int32_t)ARRSZ(labels) - 1, label, group, CFG_REBOOT, labels, (uint8_t)ARRSZ(labels) }

const CfgField CONFIG_FIELDS[] = {
    // --- Identity / general -------------------------------------------------
    SFIELD("hostname", "hostname", hostname,    "Hostname",       "Identity", CFG_KEEPNE),
    SFIELD("otapw",    "otapw",    otaPassword, "OTA password",   "Identity", CFG_SECRET | CFG_KEEPNE),
    EFIELD("protocol", "protocol", protocol,    "Input protocol", "Identity", ENUM_PROTOCOL),

    // --- Status LED ---------------------------------------------------------
    IFIELD("ledpin",  "ledPin",  ledPin,  -1, 48, "LED pin",           "Status LED"),
    EFIELD("ledtype", "ledType", ledType,        "LED type",          "Status LED", ENUM_LEDTYPE),
    IFIELD("ledr",    "ledR",    ledR,    -1, 48, "5-LED panel R pin", "Status LED"),
    IFIELD("ledg",    "ledG",    ledG,    -1, 48, "5-LED panel G pin", "Status LED"),
    IFIELD("ledy",    "ledY",    ledY,    -1, 48, "5-LED panel Y pin", "Status LED"),
    IFIELD("ledb",    "ledB",    ledB,    -1, 48, "5-LED panel B pin", "Status LED"),
    IFIELD("ledw",    "ledW",    ledW,    -1, 48, "5-LED panel W pin", "Status LED"),

    // --- Display ------------------------------------------------------------
    EFIELD("disptype", "dispType", dispType,        "Display type", "Display", ENUM_DISPTYPE),
    IFIELD("dispsda",  "dispSda",  dispSda,  -1, 48, "I2C SDA",     "Display"),
    IFIELD("dispscl",  "dispScl",  dispScl,  -1, 48, "I2C SCL",     "Display"),
    IFIELD("disprot",  "dispRot",  dispRot,   0,  1, "Rotate 180",  "Display"),
    IFIELD("dispcs",   "dispCs",   dispCs,   -1, 48, "SPI CS",      "Display"),
    IFIELD("dispdc",   "dispDc",   dispDc,   -1, 48, "SPI DC",      "Display"),
    IFIELD("disprst",  "dispRst",  dispRst,  -1, 48, "SPI RST",     "Display"),
    IFIELD("dispsck",  "dispSck",  dispSck,  -1, 48, "SPI SCK",     "Display"),
    IFIELD("dispmosi", "dispMosi", dispMosi, -1, 48, "SPI MOSI",    "Display"),

    // --- Wired Ethernet: W5500 (SPI) ---------------------------------------
    BFIELD("ethon",   "ethW5500", ethW5500,           "W5500 module enabled", "Ethernet (W5500)", CFG_NONE),
    IFIELD("ethcs",   "ethCs",    ethCs,      -1, 48, "W5500 CS",   "Ethernet (W5500)"),
    IFIELD("ethsck",  "ethSck",   ethSck,     -1, 48, "W5500 SCK",  "Ethernet (W5500)"),
    IFIELD("ethmosi", "ethMosi",  ethMosi,    -1, 48, "W5500 MOSI", "Ethernet (W5500)"),
    IFIELD("ethmiso", "ethMiso",  ethMiso,    -1, 48, "W5500 MISO", "Ethernet (W5500)"),
    IFIELD("ethint",  "ethInt",   ethInt,     -1, 48, "W5500 INT",  "Ethernet (W5500)"),
    IFIELD("ethrst",  "ethRst",   ethRst,     -1, 48, "W5500 RST",  "Ethernet (W5500)"),
    IFIELD("ethfreq", "ethFreq",  ethFreqMhz,  1, 80, "W5500 SPI MHz", "Ethernet (W5500)"),

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
    EFIELD("fbmode",   "linkLossMode", linkLossMode, "Link-loss policy",   "Network", ENUM_FBMODE),
    SFIELD("appw",     "apPassword",   apPassword,   "AP password",        "Network", CFG_SECRET),
    BFIELD("staticip", "staticIp",     staticIp,     "Static IP",          "Network", CFG_NONE),
    SFIELD("ip",       "ip",           ip,           "IP address",         "Network", CFG_NONE),
    SFIELD("gateway",  "gateway",      gateway,      "Gateway",            "Network", CFG_NONE),
    SFIELD("subnet",   "subnet",       subnet,       "Subnet mask",        "Network", CFG_NONE),
    SFIELD("dns",      "dns",          dns,          "DNS server",         "Network", CFG_NONE),

    // --- Updates (own route, not the /config form) -------------------------
    BFIELD("autoupd", "autoUpdate", autoUpdate, "Auto-update firmware", "Updates", CFG_NOWEB),
};
const size_t CONFIG_FIELD_COUNT = ARRSZ(CONFIG_FIELDS);

// ---- per-output sub-schema (expanded over outputs[0..MAX_OUTPUTS-1]) -------
// legacyKey0 = old single-universe NVS key used only for output 0's load fallback.
#define OINT(suffix, json, member, legacy, mn, mx, label) \
    { suffix, json, CfgKind::Int,  offsetof(DmxOutput, member), legacy, mn, mx, label, CFG_REBOOT, nullptr, 0 }
#define OBOOL(suffix, json, member, legacy, label) \
    { suffix, json, CfgKind::Bool, offsetof(DmxOutput, member), legacy, 0, 1, label, CFG_REBOOT, nullptr, 0 }

const CfgOutputField OUTPUT_FIELDS[] = {
    OBOOL("en",    "en",    enabled,   nullptr,             "Enabled"),
    OINT ("uni",   "uni",   universe,  "universe", 0, 15,   "Universe"),
    OINT ("port",  "port",  port,      "dmxport",  1,  2,   "UART port"),
    OINT ("tx",    "tx",    txPin,     "dmxtx",   -1, 48,   "TX pin"),
    OINT ("rx",    "rx",    rxPin,     "dmxrx",   -1, 48,   "RX pin"),
    OINT ("rts",   "rts",   rtsPin,    "dmxrts",  -1, 48,   "RTS / DE-RE pin"),
    OINT ("merge", "merge", mergeMode, nullptr, MERGE_OFF, MERGE_LTP, "Merge mode"),
    OINT ("loss",  "loss",  lossMode,  nullptr, LOSS_HOLD, LOSS_STOP, "Signal-loss policy"),
};
const size_t OUTPUT_FIELD_COUNT = ARRSZ(OUTPUT_FIELDS);
