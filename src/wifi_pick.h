#pragma once
// Which saved WiFi network to join (issue #120). Pure logic, no Arduino: the firmware hands in
// what a scan saw, the host test hands in made-up scans.
//
// The saved networks are a list in priority order (slot 0 = the one the setup portal stores).
// The rule is the one the issue asks for: of the networks actually on the air right now, take
// the highest-priority one. A slot that already failed this round (wrong password, AP that
// vanished between scan and join) is skipped so the next one gets its turn. Signal strength
// only decides between access points of the SAME network, never between networks: a weak home
// WiFi still beats a strong phone hotspot further down the list.
#include <stdint.h>
#include <string.h>

static constexpr int WIFI_SLOTS = 4;

struct WifiSeen {
    const char* ssid;
    int         rssi;
};

// stored[i] = SSID of slot i ("" or nullptr = unused). Returns the slot to try next, or -1 when
// no unused, untried slot is visible. *seenIdx gets the index of that network's strongest AP in
// `seen` (for a BSSID-locked join), or -1.
static inline int wifiPick(const char* const stored[WIFI_SLOTS], const WifiSeen* seen, int nSeen,
                           uint32_t triedMask, int* seenIdx) {
    if (seenIdx) *seenIdx = -1;
    for (int s = 0; s < WIFI_SLOTS; s++) {
        if (!stored[s] || !stored[s][0] || (triedMask & (1u << s))) continue;
        int best = -1;
        for (int i = 0; i < nSeen; i++)
            if (seen[i].ssid && strcmp(seen[i].ssid, stored[s]) == 0 && (best < 0 || seen[i].rssi > seen[best].rssi))
                best = i;
        if (best >= 0) { if (seenIdx) *seenIdx = best; return s; }
    }
    return -1;
}

// The next saved slot not tried yet, visible or not: the scan can't see a hidden network, so
// once every visible one has had its go the rest get a blind attempt, in order. -1 when done.
static inline int wifiNextBlind(const char* const stored[WIFI_SLOTS], uint32_t triedMask) {
    for (int s = 0; s < WIFI_SLOTS; s++)
        if (stored[s] && stored[s][0] && !(triedMask & (1u << s))) return s;
    return -1;
}

// Apply a reorder from the /config form: order[k] = the slot that row k came from (each 0..3
// exactly once). Moves SSID and password together, so a password the browser never saw (it is
// never sent to the page) follows its network. Returns false and changes nothing if `order` is
// not a permutation. T is whatever string type the caller stores.
template <typename T>
static inline bool wifiReorder(T ssid[WIFI_SLOTS], T psk[WIFI_SLOTS], const int order[WIFI_SLOTS]) {
    bool seen[WIFI_SLOTS] = {false, false, false, false};
    for (int k = 0; k < WIFI_SLOTS; k++) {
        if (order[k] < 0 || order[k] >= WIFI_SLOTS || seen[order[k]]) return false;
        seen[order[k]] = true;
    }
    T s2[WIFI_SLOTS], p2[WIFI_SLOTS];
    for (int k = 0; k < WIFI_SLOTS; k++) { s2[k] = ssid[order[k]]; p2[k] = psk[order[k]]; }
    for (int k = 0; k < WIFI_SLOTS; k++) { ssid[k] = s2[k]; psk[k] = p2[k]; }
    return true;
}
