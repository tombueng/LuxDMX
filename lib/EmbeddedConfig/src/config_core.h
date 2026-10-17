#pragma once
#include <Arduino.h>
#include "config_schema.h"
#include "config_types.h"

// ---------------------------------------------------------------------------
// The transport-agnostic config engine. Everything below is driven by the
// schema tables (CONFIG_FIELDS / OUTPUT_FIELDS) and knows nothing about HTTP or
// Serial. The web handlers and the serial console are thin adapters over this.
// ---------------------------------------------------------------------------
namespace cfgcore {

// Populate cfg: neutral (from each field's constraint) -> active board template
// (DEFAULT_TEMPLATE) -> saved NVS values. Existing NVS always wins.
void load();

// Persist cfg to NVS (and the derived apFallback legacy mirror).
void save();

// Set / get one field by its canonical key ("ledpin" or per-output "o0_tx").
// setValue validates against the schema (range / type); returns false + err on
// a bad key or value. Writes to the live cfg struct (call save() to persist).
bool setValue(const String& key, const String& val, String& err);
bool getValue(const String& key, String& out);   // false if the key is unknown

// Append one "key=value" line per field to `out` (per-output expanded to
// o<i>_<suffix>), secrets masked when maskSecrets. Same format setValue / a bare
// "key=value" line accept, so dump -> edit a few lines -> send back round-trips.
void dump(String& out, bool maskSecrets);

// ---- backup / restore (issue #108) ----
// The whole config as one flat JSON object {"key":value,...}, typed: numbers, true/false,
// strings. Same keys as dump(). CFG_READONLY fields are left out, CFG_SECRET ones unless
// includeSecrets (a file without them restores everything else and leaves the passwords be).
void exportJson(String& out, bool includeSecrets);
// Strict check of one value against the schema: known key, settable, right type, inside the
// range. Unlike setValue it does NOT clamp: a number out of range is an error. Writes nothing.
bool checkValue(const String& key, const String& val, String& err);
// Apply a flat JSON object of key -> value to the live cfg (call save() to persist).
// All or nothing: every pair is checked first and nothing is written unless all pass. A key
// that is absent is left alone, booleans included -- deliberately NOT the /config form's
// checkbox rule, where a missing box means false. Returns the number of keys written.
bool importJson(const char* json, size_t len, String& err, int& applied);

// Apply a board template by name from the embedded registry (resolves extends=).
bool applyTemplate(const String& name, String& err);
// Apply one template's raw "key=value" text (used by applyTemplate + tests).
bool applyTemplateText(const char* text, String& err, int depth = 0);

// Reset cfg to neutral + the active template (no NVS) — the "factory" baseline.
void resetToTemplate();
// Reset cfg to neutral + a named board template (the "apply board preset" action
// and the per-board parity tests). Returns false + err on an unknown template.
bool resetTo(const String& name, String& err);

} // namespace cfgcore

// Embedded template registry. Defined in src/generated/config_templates.cpp,
// generated from templates/*.ini by tools/gen_config_templates.py (run from
// extra_scripts.py at build time, and from test/native/run.bat for the host test).
struct CfgTemplate { const char* name; const char* text; };
extern const CfgTemplate CONFIG_TEMPLATES[];
extern const size_t      CONFIG_TEMPLATE_COUNT;
