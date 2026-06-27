#include "config_serial.h"
#include "config_types.h"
#include "config_schema.h"
#include <stdlib.h>
#include <string.h>

namespace cfgserial {

static Stream* g_io = nullptr;
static Hooks   g_hooks;
static String  g_line;
static bool    g_announced = false;

void begin(Stream& io, const Hooks& hooks) {
    g_io        = &io;
    g_hooks     = hooks;
    g_line      = "";
    g_announced = false;
}

static void prompt() { if (g_io) g_io->print("cfg> "); }

// Printed once, the first time the console is polled (so it lands after the boot
// log), telling a human how to drive it.
static void announce() {
    if (!g_io) return;
    g_io->println();
    g_io->println("== LuxDMX serial config console ==");
    g_io->println("Type 'help' for commands.  e.g.  list  |  get o0_tx  |  set hostname studio  |  save");
    prompt();
}

// ---- formatting helpers ----------------------------------------------------
static void appendChar(String& s, char c) { char b[2] = {c, 0}; s += b; }

// One "  key = value   (enum label)" line for the human `list`.
static void appendFieldLine(String& out, const char* key, const String& val,
                            const char* const* labels, uint8_t count, uint16_t flags) {
    out += "  ";
    out += key;
    out += " = ";
    if (flags & CFG_SECRET) out += val.length() ? "***" : "";
    else                    out += val;
    if (labels && count) {                       // annotate enums with the label
        int v = atoi(val.c_str());
        if (v >= 0 && v < (int)count) { out += "  ("; out += labels[v]; out += ")"; }
    }
    out += "\n";
}

static bool groupMatches(const char* group, const String& filter) {
    if (filter.length() == 0) return true;
    String g = group;  g.toLowerCase();
    String f = filter; f.toLowerCase();
    return strstr(g.c_str(), f.c_str()) != nullptr;   // case-insensitive substring
}

static String listText(const String& filter) {
    String out;
    const char* curGroup = nullptr;
    for (size_t j = 0; j < CONFIG_FIELD_COUNT; j++) {
        const CfgField& f = CONFIG_FIELDS[j];
        if (!groupMatches(f.group, filter)) continue;
        if (curGroup != f.group) { out += "["; out += f.group; out += "]\n"; curGroup = f.group; }
        String v; cfgcore::getValue(f.key, v);
        appendFieldLine(out, f.key, v, f.enumLabels, f.enumCount, f.flags);
    }
    // Per-output fields grouped as their own sections.
    for (int i = 0; i < MAX_OUTPUTS; i++) {
        char grp[16]; snprintf(grp, sizeof(grp), "Output %d", i);
        if (!groupMatches(grp, filter)) continue;
        out += "["; out += grp; out += "]\n";
        for (size_t j = 0; j < OUTPUT_FIELD_COUNT; j++) {
            const CfgOutputField& f = OUTPUT_FIELDS[j];
            String key = String("o") + i + "_" + f.suffix;
            String v; cfgcore::getValue(key, v);
            appendFieldLine(out, key.c_str(), v, f.enumLabels, f.enumCount, f.flags);
        }
    }
    if (out.length() == 0) out = "ERR no matching group";
    return out;
}

static String helpText() {
    return
        "commands:\n"
        "  help                 this list\n"
        "  list [group]         show fields + values (optionally one section)\n"
        "  get <id>             read one field  -> id=value\n"
        "  set <id> <value>     write one field -> OK | ERR\n"
        "  json                 full config dump (secrets masked)\n"
        "  schema               field metadata as JSON (types/groups/ranges/options)\n"
        "  load <k=v> [k=v ...] batch-apply key=value pairs\n"
        "  template <name>      apply a board preset in memory (then save)\n"
        "  save [reboot]        persist to NVS; reboot if asked\n"
        "  reboot               restart\n"
        "  factory              wipe config + restart\n"
        "  wifi <ssid> [pass]   set WiFi credentials and reconnect";
}

// ---- command dispatch ------------------------------------------------------
String execute(const String& line) {
    String l = line; l.trim();
    if (l.length() == 0) return "";

    int sp = l.indexOf(' ');
    String verb = sp < 0 ? l : l.substring(0, sp);
    String rest = sp < 0 ? String("") : l.substring(sp + 1);
    rest.trim();
    verb.toLowerCase();

    if (verb == "help" || verb == "?") return helpText();

    if (verb == "list") return listText(rest);

    if (verb == "get") {
        String v;
        if (rest.length() && cfgcore::getValue(rest, v)) return rest + "=" + v;
        return String("ERR unknown key: ") + rest;
    }

    if (verb == "set") {
        int s2 = rest.indexOf(' ');
        if (s2 < 0) return "ERR usage: set <id> <value>";
        String id = rest.substring(0, s2);
        String val = rest.substring(s2 + 1); val.trim();
        String e;
        if (cfgcore::setValue(id, val, e)) return "OK";
        return String("ERR ") + e;
    }

    if (verb == "json") {
        String j = "{"; cfgcore::toJson(j, true); j += "}";
        return j;
    }

    if (verb == "schema") {            // self-describing field metadata (for UIs)
        String s; cfgcore::schemaJson(s);
        return s;
    }

    if (verb == "load") {
        if (rest.length() == 0) return "ERR usage: load <key=value> [key=value ...]";
        // Turn the space/comma separated pairs into the engine's newline format.
        String text;
        for (size_t i = 0; i < rest.length(); i++) {
            char c = rest[i];
            appendChar(text, (c == ' ' || c == ',' || c == '\t') ? '\n' : c);
        }
        text += "\n";
        String e;
        if (cfgcore::applyTemplateText(text.c_str(), e)) return "OK";
        return String("ERR ") + e;
    }

    if (verb == "template") {
        if (rest.length() == 0) return "ERR usage: template <name>";
        String e;
        if (cfgcore::resetTo(rest, e)) return String("OK applied '") + rest + "' (not saved; use 'save')";
        return String("ERR ") + e;
    }

    if (verb == "save") {
        bool rb = (rest == "reboot");
        if (g_hooks.save) g_hooks.save(rb);
        return rb ? "OK saved, rebooting" : "OK saved";
    }

    if (verb == "reboot") {
        if (g_hooks.reboot) g_hooks.reboot();
        return "OK rebooting";
    }

    if (verb == "factory") {
        if (g_hooks.factory) g_hooks.factory();
        return "OK factory reset, rebooting";
    }

    if (verb == "wifi") {
        int s2 = rest.indexOf(' ');
        String ssid = s2 < 0 ? rest : rest.substring(0, s2);
        String pass = s2 < 0 ? String("") : rest.substring(s2 + 1);
        pass.trim();
        if (ssid.length() == 0) return "ERR usage: wifi <ssid> [password]";
        if (g_hooks.wifi && g_hooks.wifi(ssid, pass)) return String("OK wifi set, connecting to ") + ssid;
        return "ERR wifi not available";
    }

    return String("ERR unknown command: ") + verb + " (try 'help')";
}

// ---- non-blocking line reader ----------------------------------------------
void poll() {
    if (!g_io) return;
    if (!g_announced) { g_announced = true; announce(); }   // greet once, after the boot log
    while (g_io->available() > 0) {
        int c = g_io->read();
        if (c < 0) break;
        if (c == '\n' || c == '\r') {
            if (g_line.length() == 0) continue;
            String resp = execute(g_line);
            g_line = "";
            if (resp.length()) g_io->println(resp);
            prompt();
        } else if (g_line.length() < 600) {
            appendChar(g_line, (char)c);
        }
    }
}

}  // namespace cfgserial
