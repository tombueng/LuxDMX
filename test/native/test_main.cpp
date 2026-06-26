// Native round-trip test for the config engine. Compiled with MSVC against the
// Arduino/Preferences shims. Proves: neutral->template->NVS resolution, template
// extends, setValue validation/clamping, save/load fidelity, the output-0 legacy
// key fallback, JSON output, secret masking, AND full per-board fresh-device
// byte-parity (every template reproduces the old loadConfig DEF_* defaults).
#include "config_core.h"
#include "Preferences.h"
#include <string>
#include <cstdio>

Config cfg;   // the one instance the engine + schema operate on

struct StringPrint : Print {
    std::string out;
    void print(const char* c) override { out += c; }
};
static bool has(const std::string& h, const char* n) { return h.find(n) != std::string::npos; }

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
    int  ledR = -1, ledG = -1, ledY = -1, ledB = -1, ledW = -1;
    int  dispCs = -1, dispDc = -1, dispRst = -1, dispSck = -1, dispMosi = -1;
    int  o0rts = -1;

    std::string b = name;
    if (b == "esp32s3dev") { ledPin = 48; ledType = 2; dispSda = 8; dispScl = 9; }
    else if (b == "wokwi") { ledPin = 48; ledType = 2; dispType = 1; dispSda = 8; dispScl = 9; }
    else if (b == "wt32eth01") { o0tx = 4; o0rx = 5; dispSda = 14; dispScl = 15; useEth = true; wiredPhy = 1; }
    else if (b == "luxdmx_v4") {
        ledType = 3; ledR = 1; ledG = 2; ledY = 6; ledB = 7; ledW = 15;
        o0tx = 17; o0rx = 18; o0rts = 8;
        o1en = true; o1tx = 16; o1rx = 21; o1rts = 47;
        ethCs = 10; ethSck = 12; ethMosi = 11; ethMiso = 13; ethInt = 14; ethRst = 9;
        dispSda = 4; dispScl = 5; dispSck = 39; dispMosi = 40; dispCs = 41; dispDc = 42; dispRst = 38;
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
    EQ(cfg.rmiiPhy, 0); EQ(cfg.rmiiAddr, 1); EQ(cfg.rmiiMdc, 23); EQ(cfg.rmiiMdio, 18); EQ(cfg.rmiiPwr, 16); EQ(cfg.rmiiClk, 0);
    EQ(cfg.wifiMode, 0); EQ(cfg.linkLossMode, 0); EQ(cfg.staticIp, false); EQ(cfg.autoUpdate, false);
    EQ(cfg.subnet, "255.255.255.0");
    // output 0
    EQ(cfg.outputs[0].enabled, true); EQ(cfg.outputs[0].universe, 0); EQ(cfg.outputs[0].port, 1);
    EQ(cfg.outputs[0].txPin, o0tx); EQ(cfg.outputs[0].rxPin, o0rx); EQ(cfg.outputs[0].rtsPin, o0rts);
    EQ(cfg.outputs[0].mergeMode, 0);
    // output 1
    EQ(cfg.outputs[1].enabled, o1en); EQ(cfg.outputs[1].universe, 1); EQ(cfg.outputs[1].port, 2);
    EQ(cfg.outputs[1].txPin, o1tx); EQ(cfg.outputs[1].rxPin, o1rx); EQ(cfg.outputs[1].rtsPin, o1rts);
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
    CHECK(cfg.ledPin == 2,                     "v4: ledPin=2 (base default, unused at type 3)");
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

    // 5) JSON output + secret masking
    nvsStore().clear();
    cfgcore::resetToTemplate();
    cfgcore::setValue("hostname", "box", err);
    cfgcore::setValue("otapw", "s3cret", err);
    StringPrint j; cfgcore::toJson(j, false);
    CHECK(has(j.out, "\"ledType\":3"),         "json: ledType");
    CHECK(has(j.out, "\"hostname\":\"box\""),  "json: hostname");
    CHECK(has(j.out, "\"outputs\":["),         "json: outputs array");
    CHECK(has(j.out, "\"tx\":17"),             "json: nested output tx");
    CHECK(has(j.out, "\"otapw\":\"s3cret\""),  "json: secret shown when unmasked");
    StringPrint jm; cfgcore::toJson(jm, true);
    CHECK(has(jm.out, "\"otapw\":\"***\""),    "json: secret masked");
    CHECK(!has(jm.out, "s3cret"),              "json: secret not leaked when masked");

    // 6) FULL per-board fresh-device byte-parity (every template vs old DEF_* defaults)
    checkBoard("esp32dev");
    checkBoard("esp32s3dev");
    checkBoard("wt32eth01");
    checkBoard("wokwi");
    checkBoard("luxdmx_v4");

    printf("\n%d passed, %d failed\n", g_pass, g_fail);
    return g_fail ? 1 : 0;
}
