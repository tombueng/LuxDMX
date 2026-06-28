// Minimal NVS (Preferences) shim backed by an in-memory map, so save()/load()
// round-trip exactly like the device. Header-only single store.
#pragma once
#include <map>
#include <string>
#include "Arduino.h"

inline std::map<std::string, std::string>& nvsStore() {
    static std::map<std::string, std::string> m;
    return m;
}

class Preferences {
public:
    bool begin(const char*, bool) { return true; }
    void end() {}
    bool clear() { nvsStore().clear(); return true; }
    bool isKey(const char* k) { return nvsStore().count(std::string("k:") + k) > 0; }

    String getString(const char* k, const String& d) {
        auto it = nvsStore().find(std::string("s:") + k);
        return it == nvsStore().end() ? d : String(it->second.c_str());
    }
    void putString(const char* k, const String& v) {
        nvsStore()[std::string("s:") + k] = v.c_str();
        nvsStore()[std::string("k:") + k] = "1";
    }
    int getInt(const char* k, int d) {
        auto it = nvsStore().find(std::string("i:") + k);
        return it == nvsStore().end() ? d : atoi(it->second.c_str());
    }
    void putInt(const char* k, int v) {
        char b[16]; snprintf(b, sizeof(b), "%d", v);
        nvsStore()[std::string("i:") + k] = b;
        nvsStore()[std::string("k:") + k] = "1";
    }
    bool getBool(const char* k, bool d) {
        auto it = nvsStore().find(std::string("b:") + k);
        return it == nvsStore().end() ? d : (it->second == "1");
    }
    void putBool(const char* k, bool v) {
        nvsStore()[std::string("b:") + k] = v ? "1" : "0";
        nvsStore()[std::string("k:") + k] = "1";
    }
};
