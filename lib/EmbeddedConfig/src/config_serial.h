#pragma once
#include <Arduino.h>
#include "config_core.h"

// ---------------------------------------------------------------------------
// Minimal serial config interface, deliberately machine-first (the main user is a
// script/agent driving a device on the bench; for full interactive setup, get the
// board on the network and use its web UI). The whole grammar:
//
//   dump                 print every setting as key=value (secrets masked)
//   <key>=<value> ...    set one or more fields (PARTIAL: only listed keys change)
//   get <key>            -> key=value
//   set <key> <value>    -> OK | ERR <reason> (validated + clamped via the schema)
//   save [reboot]        persist to NVS; reboot if asked
//   wifi <ssid> [pass]   set WiFi STA credentials and (re)connect (recovery)
//   reboot | factory     restart / wipe + restart
//   help
//
// `dump` and the bare "key=value" write round-trip: read dump, change a few lines,
// send them back. The read/parse verbs are pure (unit-testable); the device-side
// actions (save/reboot/factory/wifi) are injected as Hooks so this module carries
// no WiFi / ESP / NVS-reboot dependency (keeps the library reusable).
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
