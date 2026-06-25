// Native round-trip test for the config engine. Compiled with MSVC against the
// Arduino/Preferences shims. Proves: neutral->template->NVS resolution, template
// extends, setValue validation/clamping, save/load fidelity, the output-0 legacy
// key fallback, JSON output, and secret masking.
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

int main() {
    String err;

    // 1) neutral -> template (+ extends _base)
    cfgcore::resetToTemplate();
    CHECK(cfg.ledType == 3,                   "template: ledType=3");
    CHECK(cfg.ledR == 1 && cfg.ledW == 15,    "template: 5-LED pins");
    CHECK(cfg.outputs[0].txPin == 17,         "template: o0_tx=17");
    CHECK(cfg.outputs[0].rtsPin == 8,         "template: o0_rts=8");
    CHECK(cfg.outputs[1].enabled,             "template: o1 enabled");
    CHECK(cfg.outputs[1].txPin == 16,         "template: o1_tx=16");
    CHECK(cfg.ethCs == 10,                     "template: ethCs=10");
    CHECK(std::string(cfg.subnet.c_str()) == "255.255.255.0", "extends: _base subnet");
    CHECK(cfg.outputs[0].enabled,             "extends: _base o0_en");
    CHECK(cfg.outputs[1].universe == 1,       "extends: _base o1_uni=1");
    // neutral for fields no template sets
    CHECK(cfg.ledPin == -1,                    "neutral: ledPin=-1 (pin disabled)");
    CHECK(cfg.dispRot == 0,                    "neutral: dispRot=0 (min)");
    CHECK(cfg.ethFreqMhz == 1,                 "neutral: ethFreq=1 (min, untouched)");
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
    cfgcore::resetToTemplate();               // back to template (hostname="", o0_rts=8, ledType=3)
    CHECK(std::string(cfg.hostname.c_str()) == "", "pre-load: hostname back to neutral");
    cfgcore::load();                          // neutral -> template -> NVS
    CHECK(std::string(cfg.hostname.c_str()) == "testbox", "load: hostname from NVS");
    CHECK(cfg.outputs[0].rtsPin == 21,        "load: o0_rts from NVS (overrode template)");
    CHECK(cfg.ledType == 2,                    "load: ledType from NVS");
    CHECK(cfg.outputs[0].txPin == 17,          "load: o0_tx still template (saved+restored)");

    // 4) output-0 legacy key fallback
    nvsStore().clear();
    { Preferences p; p.begin("config", false); p.putInt("dmxtx", 7); p.end(); }
    cfgcore::load();
    CHECK(cfg.outputs[0].txPin == 7,           "legacy: dmxtx=7 used when o0_tx absent");
    { Preferences p; p.begin("config", false); p.putInt("o0_tx", 12); p.end(); }
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

    printf("\n%d passed, %d failed\n", g_pass, g_fail);
    return g_fail ? 1 : 0;
}
