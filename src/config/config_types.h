#pragma once
#include <Arduino.h>
#include <stddef.h>

// ---------------------------------------------------------------------------
// Config schema descriptors — the SINGLE SOURCE OF TRUTH for every persisted
// setting's STRUCTURE (name, type, constraint). NVS load/save, /info.json, the
// /config web form, and the serial console all iterate these tables.
//
// Defaults do NOT live here. They come from board TEMPLATES (embedded key=value
// data files, see templates/). Resolution order at load() is:
//     neutral (from the constraint) -> active template -> saved NVS value
// "neutral" is derived from the field, not stored: a pin (min == -1) -> -1
// (disabled); an int/enum -> its min (e.g. first/off option); bool -> false;
// string -> "". So a field no template touches is always safe.
// ---------------------------------------------------------------------------

enum class CfgKind : uint8_t { Int, Bool, Str, Enum };

enum CfgFlags : uint16_t {
    CFG_NONE     = 0,
    CFG_SECRET   = 1 << 0,  // mask the value in serial dumps (passwords); /info.json still shows it
    CFG_REBOOT   = 1 << 1,  // takes effect only after a reboot (true for all of ours today)
    CFG_READONLY = 1 << 2,  // shown but not settable (runtime/derived)
    CFG_NOWEB    = 1 << 3,  // not part of the /config form (has its own route)
};

// A root (scalar) config field. `offset` is offsetof(Config, member); the engine
// reads/writes the live struct through it, so there's no per-field accessor code.
struct CfgField {
    const char*        key;       // NVS key == /config web param == serial id (lowercase)
    const char*        jsonKey;   // /info.json output key (camelCase — UI contract)
    CfgKind            kind;
    uint16_t           offset;    // offsetof(Config, member)
    int32_t            min, max;  // constraint for Int / Enum (also yields the neutral value)
    const char*        label;     // human label (menu + UI hint)
    const char*        group;     // section heading
    uint16_t           flags;
    const char* const* enumLabels;
    uint8_t            enumCount;
};

// A per-output field, expanded by the engine over outputs[0..MAX_OUTPUTS-1]:
// the real NVS/web key becomes "o<i>_<suffix>", and on load output 0 falls back
// to legacyKey0 (the old single-universe keys) so OTA never loses a config.
struct CfgOutputField {
    const char*        suffix;     // -> "o<i>_<suffix>"   (e.g. "tx")
    const char*        jsonKey;    // key inside outputs[i] in /info.json (e.g. "tx")
    CfgKind            kind;
    uint16_t           offset;     // offsetof(DmxOutput, member)
    const char*        legacyKey0; // output-0 legacy NVS fallback (nullptr if none)
    int32_t            min, max;
    const char*        label;
    uint16_t           flags;
    const char* const* enumLabels;
    uint8_t            enumCount;
};

extern const CfgField       CONFIG_FIELDS[];
extern const size_t         CONFIG_FIELD_COUNT;
extern const CfgOutputField OUTPUT_FIELDS[];
extern const size_t         OUTPUT_FIELD_COUNT;
