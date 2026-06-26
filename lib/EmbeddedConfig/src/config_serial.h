#pragma once
#include <Arduino.h>
#include "config_core.h"

// ---------------------------------------------------------------------------
// Serial configuration console. One line grammar that serves both a human at a
// terminal and a machine/AI client, all rendered from the same schema the web
// form + NVS use (no field details duplicated here):
//
//   help                 list the commands
//   list [group]         human-readable fields + values (optionally one section)
//   get <id>             -> id=value          (machine)
//   set <id> <value>     -> OK | ERR <reason> (validated + clamped via the schema)
//   json                 full config dump (secrets masked) — paired with `load`
//   load <k=v> [k=v ...] batch-apply key=value pairs (reuses the template engine)
//   template <name>      apply a board preset in memory (then `save` to persist)
//   save [reboot]        persist to NVS; reboot if asked
//   reboot               restart the device
//   factory              wipe config + restart
//   wifi <ssid> [pass]   set WiFi STA credentials and (re)connect
//
// The engine verbs (help/list/get/set/json/load/template) are pure and need no
// device APIs; the device-side actions are injected as Hooks so this module
// carries no WiFi / ESP / NVS-reboot dependency (keeps it library-clean).
// ---------------------------------------------------------------------------
namespace cfgserial {

struct Hooks {
    void (*save)(bool reboot)                           = nullptr;
    void (*reboot)()                                    = nullptr;
    void (*factory)()                                   = nullptr;
    bool (*wifi)(const String& ssid, const String& pass) = nullptr;
};

// Wire up the console: the stream to read/write (usually Serial) + the hooks.
void begin(Stream& io, const Hooks& hooks);

// Call every loop(): reads complete lines from the stream and runs them. Non-blocking.
void poll();

// Run one already-assembled command line; returns the response text. Pure for the
// engine verbs (no I/O), so it's unit-testable natively and reusable over any
// transport. Hook-backed verbs (save/reboot/factory/wifi) need begin()'s hooks.
String execute(const String& line);

}  // namespace cfgserial
