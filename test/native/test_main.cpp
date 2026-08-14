// Native round-trip test for the config engine. Compiled with MSVC against the
// Arduino/Preferences shims. Proves: neutral->template->NVS resolution, template
// extends, setValue validation/clamping, save/load fidelity, the output-0 legacy
// key fallback, JSON output, secret masking, AND full per-board fresh-device
// byte-parity (every template reproduces the old loadConfig DEF_* defaults).
#include "config_core.h"
#include "config_serial.h"
#include "Preferences.h"
#include <string>
#include <cstdio>

Config cfg;   // the one instance the engine + schema operate on

static bool hasS(const String& h, const char* n) { return strstr(h.c_str(), n) != nullptr; }

// stub serial-console hooks (record that the device-side actions were invoked)
static int g_saveCalls = 0, g_rebootCalls = 0, g_factoryCalls = 0;
static String g_wifiSsid, g_wifiPass;
static void hSave(bool reboot)  { g_saveCalls++; (void)reboot; }
static void hReboot()           { g_rebootCalls++; }
static void hFactory()          { g_factoryCalls++; }
static bool hWifi(const String& ssid, const String& pass) { g_wifiSsid = ssid; g_wifiPass = pass; return true; }

static int g_pass = 0, g_fail = 0;
#define CHECK(cond, msg) do { if (cond) { g_pass++; } else { g_fail++; \
    printf("  FAIL: %s\n", msg); } } while (0)

// ---- per-board fresh-device defaults (must equal the OLD loadConfig DEF_*) ----
// Asserts every persisted field, so a missing/incorrect template entry is caught.
static void checkBoard(const char* name) {
    String err;
    bool ok = cfgcore::resetTo(name, err);
    CHECK(ok, name);
    if (!ok) return;

    // Defaults common to all boards (from _base / neutral), then per-board deltas.
    const char* host = "dmx-gateway";
    int  ledPin = 2, ledType = 1, dispType = 0, dispSda = 21, dispScl = 22;
    int  ethCs = 5, ethSck = 18, ethMosi = 23, ethMiso = 19, ethInt = 4, ethRst = 25;
    int  o0tx = 17, o0rx = 16;
    bool useEth = false; int wiredPhy = 0;
    bool o1en = false; int o1tx = -1, o1rx = -1, o1rts = -1;
    bool o2en = false; int o2tx = -1, o2rx = -1, o2rts = -1;
    int  ledR = -1, ledG = -1, ledY = -1, ledB = -1, ledW = -1;
    int  dispCs = -1, dispDc = -1, dispRst = -1, dispSck = -1, dispMosi = -1;
    int  o0rts = -1;
    int  encA = -1, encB = -1, encSw = -1;

    std::string b = name;
    if (b == "esp32s3dev") { ledPin = 48; ledType = 2; dispSda = 8; dispScl = 9; }
    else if (b == "wt32eth01") { o0tx = 4; o0rx = 5; dispSda = 14; dispScl = 15; useEth = true; wiredPhy = 1; }
    else if (b == "luxdmx_v6") {
        ledType = 3; ledR = 1; ledG = 2; ledY = 6; ledB = 7; ledW = 15;
        o0tx = 17; o0rx = 18; o0rts = 8;
        o1en = true; o1tx = 16; o1rx = 21; o1rts = 47;
        ethCs = 10; ethSck = 12; ethMosi = 11; ethMiso = 13; ethInt = 14; ethRst = 9;
        dispSda = 4; dispScl = 5; dispSck = 39; dispMosi = 40; dispCs = 41; dispDc = 42; dispRst = 38;
    }
    else if (b == "luxdmx_carrier") {
        // Status LED off on purpose: the module's own WS2812 sits on IO48, which is pixel
        // port 5 on this board (see PIXEL_PLAN / templates/luxdmx_carrier.ini).
        ledType = 0; ledPin = -1;
        o0tx = 17; o0rx = 18; o0rts = 16;
        o1tx = 15; o1rx = 7;  o1rts = 6;   // ports 2 and 3 are wired but stay disabled:
        o2tx = 5;  o2rx = 4;  o2rts = 8;   // a fresh board has no transceiver modules on it
        ethCs = 10; ethSck = 12; ethMosi = 11; ethMiso = 13; ethInt = 14; ethRst = 9;
        dispSda = 1; dispScl = 2;
        encA = 42; encB = 41; encSw = 21;
    }

    char m[64];
    #define EQ(field, expect) do { snprintf(m, sizeof(m), "%s: %s", name, #field); CHECK((field) == (expect), m); } while (0)
    EQ(cfg.hostname, host);
    EQ(cfg.otaPassword, "dmxota");
    EQ(cfg.protocol, 2);
    EQ(cfg.ledPin, ledPin);  EQ(cfg.ledType, ledType);
    EQ(cfg.ledR, ledR); EQ(cfg.ledG, ledG); EQ(cfg.ledY, ledY); EQ(cfg.ledB, ledB); EQ(cfg.ledW, ledW);
    EQ(cfg.dispType, dispType); EQ(cfg.dispSda, dispSda); EQ(cfg.dispScl, dispScl); EQ(cfg.dispRot, 0);
    EQ(cfg.dispCs, dispCs); EQ(cfg.dispDc, dispDc); EQ(cfg.dispRst, dispRst); EQ(cfg.dispSck, dispSck); EQ(cfg.dispMosi, dispMosi);
    EQ(cfg.ethCs, ethCs); EQ(cfg.ethSck, ethSck); EQ(cfg.ethMosi, ethMosi);
    EQ(cfg.ethMiso, ethMiso); EQ(cfg.ethInt, ethInt); EQ(cfg.ethRst, ethRst); EQ(cfg.ethFreqMhz, 20);
    EQ(cfg.ethW5500, false); EQ(cfg.wiredPhy, wiredPhy); EQ(cfg.useEthernet, useEth);
    EQ(cfg.ethSpiPhy, 0);   // SPI Ethernet chip defaults to W5500 on every board (issue #36)
    EQ(cfg.rmiiPhy, 0); EQ(cfg.rmiiAddr, 1); EQ(cfg.rmiiMdc, 23); EQ(cfg.rmiiMdio, 18); EQ(cfg.rmiiPwr, 16); EQ(cfg.rmiiClk, 0);
    EQ(cfg.wifiMode, 0); EQ(cfg.linkLossMode, 0); EQ(cfg.staticIp, false); EQ(cfg.autoUpdate, false);
    EQ(cfg.subnet, "255.255.255.0");
    // output 0
    EQ(cfg.outputs[0].enabled, true); EQ(cfg.outputs[0].universe, 0); EQ(cfg.outputs[0].port, 1);
    EQ(cfg.outputs[0].txPin, o0tx); EQ(cfg.outputs[0].rxPin, o0rx); EQ(cfg.outputs[0].rtsPin, o0rts);
    EQ(cfg.outputs[0].mergeMode, 0); EQ(cfg.outputs[0].lossMode, 0);
    EQ(cfg.encA, encA); EQ(cfg.encB, encB); EQ(cfg.encSw, encSw);
    // output 1
    EQ(cfg.outputs[1].enabled, o1en); EQ(cfg.outputs[1].universe, 1); EQ(cfg.outputs[1].port, 2);
    EQ(cfg.outputs[1].txPin, o1tx); EQ(cfg.outputs[1].rxPin, o1rx); EQ(cfg.outputs[1].rtsPin, o1rts);
    EQ(cfg.outputs[1].mergeMode, 0); EQ(cfg.outputs[1].lossMode, 0);
    // output 2 (the third DMX port; _base gives it uni=2 / port=3, boards fill in pins)
    EQ(cfg.outputs[2].enabled, o2en); EQ(cfg.outputs[2].universe, 2); EQ(cfg.outputs[2].port, 3);
    EQ(cfg.outputs[2].txPin, o2tx); EQ(cfg.outputs[2].rxPin, o2rx); EQ(cfg.outputs[2].rtsPin, o2rts);
    EQ(cfg.outputs[2].mergeMode, 0); EQ(cfg.outputs[2].lossMode, 0);
    #undef EQ
}

int main() {
    String err;

    // 1) neutral -> template (+ extends _base) for the build's DEFAULT_TEMPLATE
    cfgcore::resetToTemplate();
    CHECK(cfg.ledType == 3,                   "template: ledType=3");
    CHECK(cfg.ledR == 1 && cfg.ledW == 15,    "template: 5-LED pins");
    CHECK(cfg.outputs[0].txPin == 17,         "template: o0_tx=17");
    CHECK(cfg.outputs[0].rtsPin == 8,         "template: o0_rts=8");
    CHECK(cfg.outputs[1].enabled,             "template: o1 enabled");
    CHECK(cfg.outputs[1].txPin == 16,         "template: o1_tx=16");
    CHECK(cfg.ethCs == 10,                     "template: ethCs=10");
    CHECK(cfg.subnet == "255.255.255.0",       "extends: _base subnet");
    CHECK(cfg.outputs[0].enabled,             "extends: _base o0_en");
    CHECK(cfg.outputs[1].universe == 1,       "extends: _base o1_uni=1");
    CHECK(cfg.ledPin == 2,                     "luxdmx: ledPin=2 (base default, unused at type 3)");
    CHECK(cfg.dispRot == 0,                    "neutral: dispRot=0 (min)");
    CHECK(cfg.ethFreqMhz == 20,                "base: ethFreq=20");
    CHECK(cfg.outputs[0].mergeMode == 0,       "neutral: merge=OFF");

    // 2) setValue / getValue + clamping + unknown key
    CHECK(cfgcore::setValue("o0_tx", "9", err), "set o0_tx ok");
    CHECK(cfg.outputs[0].txPin == 9,            "set o0_tx=9 applied");
    String got; CHECK(cfgcore::getValue("o0_tx", got) && got == "9", "get o0_tx==9");
    cfgcore::setValue("o0_tx", "99", err);
    CHECK(cfg.outputs[0].txPin == 48,           "set clamps high (99->48)");
    cfgcore::setValue("o0_tx", "-5", err);
    CHECK(cfg.outputs[0].txPin == -1,           "set clamps low (-5->-1)");
    CHECK(!cfgcore::setValue("nope_key", "1", err), "unknown key rejected");
    cfgcore::setValue("ethon", "true", err); CHECK(cfg.ethW5500, "set bool true");
    cfgcore::setValue("ethon", "0", err);    CHECK(!cfg.ethW5500, "set bool false");

    // 3) save -> wipe in-memory -> load fidelity
    nvsStore().clear();
    cfgcore::resetToTemplate();
    cfgcore::setValue("hostname", "testbox", err);
    cfgcore::setValue("o0_rts", "21", err);   // override template's 8
    cfgcore::setValue("ledtype", "2", err);
    cfgcore::save();
    cfgcore::resetToTemplate();               // back to template (hostname=dmx-gateway, o0_rts=8, ledType=3)
    CHECK(cfg.hostname == "dmx-gateway",       "pre-load: hostname back to template");
    cfgcore::load();                          // neutral -> template -> NVS
    CHECK(cfg.hostname == "testbox",           "load: hostname from NVS");
    CHECK(cfg.outputs[0].rtsPin == 21,        "load: o0_rts from NVS (overrode template)");
    CHECK(cfg.ledType == 2,                    "load: ledType from NVS");
    CHECK(cfg.outputs[0].txPin == 17,          "load: o0_tx still template (saved+restored)");

    // 4) output-0 legacy key fallback
    nvsStore().clear();
    { Preferences p; p.begin("dmxgw", false); p.putInt("dmxtx", 7); p.end(); }
    cfgcore::load();
    CHECK(cfg.outputs[0].txPin == 7,           "legacy: dmxtx=7 used when o0_tx absent");
    { Preferences p; p.begin("dmxgw", false); p.putInt("o0_tx", 12); p.end(); }
    cfgcore::load();
    CHECK(cfg.outputs[0].txPin == 12,          "legacy: o0_tx wins over dmxtx");

    // 5) key=value dump + secret masking
    nvsStore().clear();
    cfgcore::resetToTemplate();
    cfgcore::setValue("hostname", "box", err);
    cfgcore::setValue("otapw", "s3cret", err);
    String d; cfgcore::dump(d, false);
    CHECK(hasS(d, "ledtype=3"),     "dump: ledtype");
    CHECK(hasS(d, "hostname=box"),  "dump: hostname");
    CHECK(hasS(d, "o0_tx=17"),      "dump: per-output key");
    CHECK(hasS(d, "otapw=s3cret"),  "dump: secret shown when unmasked");
    String dm; cfgcore::dump(dm, true);
    CHECK(hasS(dm, "otapw=***"),    "dump: secret masked");
    CHECK(!hasS(dm, "s3cret"),      "dump: secret not leaked when masked");

    // 6) FULL per-board fresh-device byte-parity (every template vs old DEF_* defaults)
    checkBoard("esp32dev");
    checkBoard("esp32s3dev");
    checkBoard("wt32eth01");
    checkBoard("luxdmx_v6");
    checkBoard("luxdmx_carrier");

    // 6b) pixels[] — the engine's SECOND array. Proves CONFIG_ARRAYS is walked for
    // neutral, template, key resolution, dump and NVS, not just outputs[].
    cfgcore::resetTo("luxdmx_carrier", err);
    CHECK(cfg.pixels[0].pin == 38 && cfg.pixels[4].pin == 48, "pixels: carrier pins from template");
    CHECK(!cfg.pixels[0].enabled,                  "pixels: disabled until asked for");
    CHECK(cfg.pixels[0].universe == 0 && cfg.pixels[3].universe == 3, "pixels: universes chained");
    CHECK(cfg.pixels[2].mAPerCh == 570,            "pixels: carrier defaults to 12V WS2815 current");
    // These four must NOT land on their schema minimum, or a freshly enabled strip is
    // black, reports no power draw and has no gamma. _base carries them for every port.
    CHECK(cfg.pixels[1].bright == 255,             "pixels: brightness defaults to full");
    CHECK(cfg.pixels[1].gamma == 220,              "pixels: gamma defaults to 2.2");
    CHECK(cfg.pixels[1].quiesMa == 100,            "pixels: idle current default");
    CHECK(cfg.pixels[1].count == 170,              "pixels: one universe's worth by default");
    CHECK(cfg.railMa == 9200,                      "pixels: rail rating default (2-layer)");
    // A board with no pixel hardware still gets a coherent (all-off, pin-less) array.
    cfgcore::resetTo("luxdmx_v6", err);
    CHECK(cfg.pixels[0].pin == -1 && !cfg.pixels[0].enabled, "pixels: v6 has none, stays neutral");
    // key resolution / clamping / dump on the second array
    CHECK(cfgcore::setValue("p2_count", "300", err), "pixels: set p2_count");
    CHECK(cfg.pixels[2].count == 300,               "pixels: p2_count applied");
    cfgcore::setValue("p2_count", "99999", err);
    CHECK(cfg.pixels[2].count == 4096,              "pixels: p2_count clamps to max");
    CHECK(!cfgcore::setValue("p9_count", "1", err), "pixels: index past the array is unknown");
    CHECK(!cfgcore::setValue("p0_bogus", "1", err), "pixels: unknown suffix is rejected");
    String pd; cfgcore::dump(pd, false);
    CHECK(hasS(pd, "p0_pin="),                      "pixels: dump carries the pixel array");
    CHECK(hasS(pd, "railma="),                      "pixels: dump carries railMa");

    // 7) serial console grammar (cfgserial::execute), all schema-driven
    using cfgserial::execute;
    cfgserial::Hooks hk; hk.save = hSave; hk.reboot = hReboot; hk.factory = hFactory; hk.wifi = hWifi;
    static Stream dummy; cfgserial::begin(dummy, hk);
    cfgcore::resetTo("luxdmx_v6", err);

    CHECK(execute("get o0_tx") == "o0_tx=17",          "serial: get o0_tx");
    CHECK(execute("GET o0_rts") == "o0_rts=8",          "serial: verb case-insensitive");
    CHECK(hasS(execute("get nope"), "ERR unknown key"), "serial: get unknown -> ERR");
    CHECK(execute("set o0_tx 9") == "OK",               "serial: set ok");
    CHECK(cfg.outputs[0].txPin == 9,                     "serial: set applied");
    CHECK(execute("set o0_tx 999") == "OK",             "serial: set high still OK");
    CHECK(cfg.outputs[0].txPin == 48,                    "serial: set clamped to 48");
    CHECK(hasS(execute("set bogus 1"), "ERR"),          "serial: set unknown -> ERR");
    CHECK(hasS(execute("dump"), "o0_tx="),              "serial: dump key=value");
    CHECK(hasS(execute("dump"), "otapw=***"),           "serial: dump masks secret");
    // bare "key=value" partial write (single, then multiple space/comma separated)
    CHECK(hasS(execute("ledtype=2"), "OK"),             "serial: bare key=value");
    CHECK(cfg.ledType == 2,                              "serial: bare kv applied");
    CHECK(hasS(execute("o1_uni=5, o0_rx=7"), "OK"),     "serial: bare multi kv");
    CHECK(cfg.outputs[1].universe == 5 && cfg.outputs[0].rxPin == 7, "serial: bare multi applied");
    CHECK(hasS(execute("bogus=1"), "ERR"),              "serial: bare kv unknown -> ERR");
    CHECK(execute("help").length() > 0,                  "serial: help");
    execute("save");        CHECK(g_saveCalls == 1,      "serial: save hook");
    execute("save reboot"); CHECK(g_saveCalls == 2,      "serial: save reboot hook");
    execute("reboot");      CHECK(g_rebootCalls == 1,    "serial: reboot hook");
    execute("factory");     CHECK(g_factoryCalls == 1,   "serial: factory hook");
    CHECK(hasS(execute("wifi dropsnet s3cret"), "OK"),  "serial: wifi ok");
    CHECK(g_wifiSsid == "dropsnet" && g_wifiPass == "s3cret", "serial: wifi creds parsed");
    CHECK(hasS(execute("wifi"), "ERR"),                 "serial: wifi no-ssid -> ERR");
    CHECK(hasS(execute("frobnicate"), "unknown command"), "serial: unknown command");

    printf("\n%d passed, %d failed\n", g_pass, g_fail);
    return g_fail ? 1 : 0;
}
