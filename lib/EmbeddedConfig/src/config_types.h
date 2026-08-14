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
    CFG_REBOOT   = 1 << 1,  // takes effect only after a reboot
    CFG_LIVE     = 1 << 5,  // applies the instant it is saved (no reboot, nothing to re-init)
    CFG_READONLY = 1 << 2,  // shown but not settable (runtime/derived)
    CFG_NOWEB    = 1 << 3,  // not part of the /config form (has its own route)
    CFG_KEEPNE   = 1 << 4,  // a blank web field is ignored, never blanks the value (hostname/otapw)
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

// A field of an ARRAY element, expanded by the engine over that array's entries:
// the real NVS/web key becomes "<prefix><i>_<suffix>" (e.g. "o0_tx", "p2_count").
// On load, element 0 falls back to legacyKey0 (the old single-universe keys) so an
// OTA from a pre-array build never loses a config.
struct CfgArrayField {
    const char*        suffix;     // -> "<prefix><i>_<suffix>"   (e.g. "tx")
    const char*        jsonKey;    // key inside the element's object in /info.json
    CfgKind            kind;
    uint16_t           offset;     // offsetof(DmxOutput / PixelPort, member)
    const char*        legacyKey0; // element-0 legacy NVS fallback (nullptr if none)
    int32_t            min, max;
    const char*        label;
    uint16_t           flags;
    const char* const* enumLabels;
    uint8_t            enumCount;
};
// The original name, kept so the schema's row-builder macros and every existing
// declaration read unchanged. Outputs were simply the first array of this kind.
using CfgOutputField = CfgArrayField;

// One entry per array in Config. The engine walks this table instead of hard-coding
// `cfg.outputs[i]`, so adding an array (pixels[]) is one table row rather than six
// edits scattered through load/save/dump/neutral/resolve.
struct CfgArray {
    char                 prefix;      // key prefix: 'o' = DMX outputs, 'p' = pixel ports
    uint8_t              count;       // MAX_OUTPUTS / MAX_PIXEL_PORTS
    uint16_t             baseOffset;  // offsetof(Config, outputs)
    uint16_t             stride;      // sizeof(DmxOutput)
    const CfgArrayField* fields;
    size_t               fieldCount;
    const char*          name;        // for messages ("output", "pixel port")
};

extern const CfgField       CONFIG_FIELDS[];
extern const size_t         CONFIG_FIELD_COUNT;
extern const CfgOutputField OUTPUT_FIELDS[];
extern const size_t         OUTPUT_FIELD_COUNT;
extern const CfgArrayField  PIXEL_FIELDS[];
extern const size_t         PIXEL_FIELD_COUNT;
extern const CfgArray       CONFIG_ARRAYS[];
extern const size_t         CONFIG_ARRAY_COUNT;
