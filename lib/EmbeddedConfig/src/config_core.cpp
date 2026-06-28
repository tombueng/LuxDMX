#include "config_core.h"
#include "config_enums.h"
#include <Preferences.h>
#include <string.h>
#include <stdlib.h>

// NVS namespace — MUST match main.cpp's PREF_NS ("dmxgw") so an existing device's
// saved keys are found after the engine takes over load/save. Overridable at build.
#ifndef CFG_PREF_NS
#define CFG_PREF_NS "dmxgw"
#endif

// Board template compiled into this binary (a plain build flag). Stringized.
#ifndef DEFAULT_TEMPLATE
#define DEFAULT_TEMPLATE _base
#endif
#define CFG_STR2(x) #x
#define CFG_STR(x)  CFG_STR2(x)

namespace cfgcore {

// ---- field addressing ------------------------------------------------------
static void* rootAddr(const CfgField& f)            { return (char*)&cfg + f.offset; }
static void* outAddr(int i, const CfgOutputField& f){ return (char*)&cfg.outputs[i] + f.offset; }

// neutral value for an int/enum: a pin (min == -1) disables to -1, otherwise the
// minimum (first enum / lowest valid number).
static int neutralInt(int32_t mn) { return mn <= -1 ? -1 : (int)mn; }

// ---- typed read / write ----------------------------------------------------
static void writeTyped(void* a, CfgKind kind, int32_t mn, int32_t mx, const String& val) {
    switch (kind) {
        case CfgKind::Bool:
            *(bool*)a = (val == "1" || val == "true" || val == "on" || val == "yes");
            break;
        case CfgKind::Int:
        case CfgKind::Enum: {
            long v = atol(val.c_str());
            *(int*)a = (int)constrain(v, mn, mx);   // clamp — matches today's loadConfig/post
            break;
        }
        case CfgKind::Str:
            *(String*)a = val;
            break;
    }
}

static String readTyped(void* a, CfgKind kind) {
    switch (kind) {
        case CfgKind::Bool:           return *(bool*)a ? "true" : "false";
        case CfgKind::Int:
        case CfgKind::Enum:           return String(*(int*)a);
        default:                      return *(String*)a;
    }
}

// ---- key resolution (root "ledpin" or per-output "o0_tx") ------------------
static bool resolve(const String& key, void*& a, CfgKind& kind, int32_t& mn, int32_t& mx, uint16_t& flags) {
    const char* k = key.c_str();
    if (k[0] == 'o' && k[1] >= '0' && k[1] <= '9' && k[2] == '_') {
        int i = k[1] - '0';
        if (i < 0 || i >= MAX_OUTPUTS) return false;
        const char* suf = k + 3;
        for (size_t j = 0; j < OUTPUT_FIELD_COUNT; j++)
            if (strcmp(OUTPUT_FIELDS[j].suffix, suf) == 0) {
                const CfgOutputField& f = OUTPUT_FIELDS[j];
                a = outAddr(i, f); kind = f.kind; mn = f.min; mx = f.max; flags = f.flags;
                return true;
            }
        return false;
    }
    for (size_t j = 0; j < CONFIG_FIELD_COUNT; j++)
        if (strcmp(CONFIG_FIELDS[j].key, k) == 0) {
            const CfgField& f = CONFIG_FIELDS[j];
            a = rootAddr(f); kind = f.kind; mn = f.min; mx = f.max; flags = f.flags;
            return true;
        }
    return false;
}

bool setValue(const String& key, const String& val, String& err) {
    void* a; CfgKind kind; int32_t mn, mx; uint16_t flags;
    if (!resolve(key, a, kind, mn, mx, flags)) { err = String("unknown key: ") + key; return false; }
    writeTyped(a, kind, mn, mx, val);
    return true;
}

bool getValue(const String& key, String& out) {
    void* a; CfgKind kind; int32_t mn, mx; uint16_t flags;
    if (!resolve(key, a, kind, mn, mx, flags)) return false;
    out = readTyped(a, kind);
    return true;
}

// ---- neutral + templates ---------------------------------------------------
static void applyNeutral() {
    for (size_t j = 0; j < CONFIG_FIELD_COUNT; j++) {
        const CfgField& f = CONFIG_FIELDS[j]; void* a = rootAddr(f);
        if (f.kind == CfgKind::Bool)      *(bool*)a   = false;
        else if (f.kind == CfgKind::Str)  *(String*)a = "";
        else                              *(int*)a    = neutralInt(f.min);
    }
    for (int i = 0; i < MAX_OUTPUTS; i++)
        for (size_t j = 0; j < OUTPUT_FIELD_COUNT; j++) {
            const CfgOutputField& f = OUTPUT_FIELDS[j]; void* a = outAddr(i, f);
            if (f.kind == CfgKind::Bool)      *(bool*)a   = false;
            else if (f.kind == CfgKind::Str)  *(String*)a = "";
            else                              *(int*)a    = neutralInt(f.min);
        }
}

static bool applyNamed(const String& name, String& err, int depth);

bool applyTemplateText(const char* text, String& err, int depth) {
    if (depth > 8) { err = "template nesting too deep"; return false; }
    char line[192];
    const char* p = text;
    while (*p) {
        const char* nl = strchr(p, '\n');
        size_t len = nl ? (size_t)(nl - p) : strlen(p);
        if (len >= sizeof(line)) len = sizeof(line) - 1;
        memcpy(line, p, len); line[len] = 0;
        p = nl ? nl + 1 : p + len;

        char* s = line; while (*s == ' ' || *s == '\t') s++;
        char* e = s + strlen(s);
        while (e > s && (e[-1] == ' ' || e[-1] == '\t' || e[-1] == '\r')) *--e = 0;
        if (*s == 0 || *s == '#') continue;
        char* eq = strchr(s, '='); if (!eq) continue;
        *eq = 0; char* k = s; char* v = eq + 1;
        char* ke = k + strlen(k); while (ke > k && (ke[-1] == ' ' || ke[-1] == '\t')) *--ke = 0;
        while (*v == ' ' || *v == '\t') v++;

        if (strcmp(k, "extends") == 0) { if (!applyNamed(String(v), err, depth + 1)) return false; continue; }
        String e2; if (!setValue(String(k), String(v), e2)) { err = e2; return false; }
    }
    return true;
}

static bool applyNamed(const String& name, String& err, int depth) {
    for (size_t i = 0; i < CONFIG_TEMPLATE_COUNT; i++)
        if (strcmp(CONFIG_TEMPLATES[i].name, name.c_str()) == 0)
            return applyTemplateText(CONFIG_TEMPLATES[i].text, err, depth);
    err = String("unknown template: ") + name;
    return false;
}

bool applyTemplate(const String& name, String& err) { return applyNamed(name, err, 1); }

void resetToTemplate() {
    applyNeutral();
    String err; applyTemplate(CFG_STR(DEFAULT_TEMPLATE), err);   // missing template -> stay neutral
}

bool resetTo(const String& name, String& err) {
    applyNeutral();
    return applyTemplate(name, err);
}

// ---- NVS load / save -------------------------------------------------------
void load() {
    resetToTemplate();   // neutral -> active template

    Preferences prefs; prefs.begin(CFG_PREF_NS, false);
    for (size_t j = 0; j < CONFIG_FIELD_COUNT; j++) {
        const CfgField& f = CONFIG_FIELDS[j]; void* a = rootAddr(f);
        if (f.kind == CfgKind::Bool)      *(bool*)a   = prefs.getBool(f.key, *(bool*)a);
        // Guard string reads with isKey(): the Arduino Preferences lib logs a noisy
        // "nvs_get_str len fail: <key> NOT_FOUND" error for every absent string key
        // (i.e. every string field on a fresh device). Skipping the read keeps the
        // template/neutral default already in *a and the console stays clean.
        else if (f.kind == CfgKind::Str) { if (prefs.isKey(f.key)) *(String*)a = prefs.getString(f.key, *(String*)a); }
        else { int v = prefs.getInt(f.key, *(int*)a); *(int*)a = (int)constrain(v, f.min, f.max); }
    }
    for (int i = 0; i < MAX_OUTPUTS; i++)
        for (size_t j = 0; j < OUTPUT_FIELD_COUNT; j++) {
            const CfgOutputField& f = OUTPUT_FIELDS[j]; void* a = outAddr(i, f);
            String key = String("o") + i + "_" + f.suffix;
            if (f.kind == CfgKind::Bool) { *(bool*)a = prefs.getBool(key.c_str(), *(bool*)a); continue; }
            int base = *(int*)a;
            if (f.legacyKey0 && i == 0) base = prefs.getInt(f.legacyKey0, base);   // legacy fallback
            int v = prefs.getInt(key.c_str(), base);
            *(int*)a = (int)constrain(v, f.min, f.max);
        }
    // apfb -> fbmode migration: an old device that only saved the apFallback bool
    // gets its link-loss policy derived from it (preserve loadConfig's behavior).
    if (!prefs.isKey("fbmode") && prefs.isKey("apfb"))
        cfg.linkLossMode = prefs.getBool("apfb", false) ? WIRED_FB_AP : WIRED_FB_RETRY;
    prefs.end();

    cfg.apFallback = (cfg.linkLossMode == WIRED_FB_AP);   // keep the legacy mirror in sync
}

void save() {
    Preferences prefs; prefs.begin(CFG_PREF_NS, false);
    for (size_t j = 0; j < CONFIG_FIELD_COUNT; j++) {
        const CfgField& f = CONFIG_FIELDS[j]; void* a = rootAddr(f);
        if (f.kind == CfgKind::Bool)      prefs.putBool(f.key, *(bool*)a);
        else if (f.kind == CfgKind::Str)  prefs.putString(f.key, *(String*)a);
        else                              prefs.putInt(f.key, *(int*)a);
    }
    for (int i = 0; i < MAX_OUTPUTS; i++)
        for (size_t j = 0; j < OUTPUT_FIELD_COUNT; j++) {
            const CfgOutputField& f = OUTPUT_FIELDS[j]; void* a = outAddr(i, f);
            String key = String("o") + i + "_" + f.suffix;
            if (f.kind == CfgKind::Bool) prefs.putBool(key.c_str(), *(bool*)a);
            else                         prefs.putInt(key.c_str(), *(int*)a);
        }
    prefs.putBool("apfb", cfg.linkLossMode == WIRED_FB_AP);   // derived legacy mirror
    prefs.end();
}

// ---- key=value dump --------------------------------------------------------
// One "key=value" per line over every field (per-output expanded to o<i>_<suffix>),
// secrets masked. This is exactly the format setValue / a bare "key=value" line
// accept, so reading `dump`, editing a few lines, and sending them back round-trips.
void dump(String& out, bool maskSecrets) {
    for (size_t j = 0; j < CONFIG_FIELD_COUNT; j++) {
        const CfgField& f = CONFIG_FIELDS[j];
        String v; getValue(f.key, v);
        if (maskSecrets && (f.flags & CFG_SECRET)) v = "***";
        out += f.key; out += "="; out += v; out += "\n";
    }
    for (int i = 0; i < MAX_OUTPUTS; i++)
        for (size_t j = 0; j < OUTPUT_FIELD_COUNT; j++) {
            const CfgOutputField& f = OUTPUT_FIELDS[j];
            String key = String("o") + i + "_" + f.suffix;
            String v; getValue(key, v);
            if (maskSecrets && (f.flags & CFG_SECRET)) v = "***";
            out += key; out += "="; out += v; out += "\n";
        }
}

} // namespace cfgcore
