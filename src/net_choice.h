// ---------------------------------------------------------------------------
// net_choice.h - the "Network" entry of the on-unit menu (issue #150).
// One value stands for the two settings /config has for it, useeth and wifimode,
// so the knob can flip a travel box between WiFi, its own access point and the
// cable. Pure (no Arduino), host-tested in test/native/controls_test.cpp.
// ---------------------------------------------------------------------------
#ifndef NET_CHOICE_H
#define NET_CHOICE_H

#include "config_enums.h"   // NET_WIFI_STA / NET_WIFI_AP

enum NetChoice { NETC_WIFI = 0, NETC_AP = 1, NETC_ETH = 2 };

// What the box runs on now. Ethernet only counts when a wired PHY is set up
// (wiredOk), the same rule setup() uses before it brings the cable up.
static inline int netChoiceOf(bool useEth, bool wiredOk, int wifiMode) {
    if (useEth && wiredOk) return NETC_ETH;
    return wifiMode == NET_WIFI_AP ? NETC_AP : NETC_WIFI;
}

// Highest value the menu offers: Ethernet only on a box that has it.
static inline int netChoiceMax(bool wiredOk) { return wiredOk ? NETC_ETH : NETC_AP; }

// Writes a choice back into the two settings. Ethernet leaves wifiMode alone, so
// switching back later lands on the WiFi mode the box had before.
static inline void netChoiceApply(int c, bool& useEth, int& wifiMode) {
    if (c == NETC_ETH) { useEth = true; return; }
    useEth   = false;
    wifiMode = (c == NETC_AP) ? NET_WIFI_AP : NET_WIFI_STA;
}

static inline const char* netChoiceName(int c) {
    return c == NETC_ETH ? "Ethernet" : c == NETC_AP ? "WiFi AP" : "WiFi";
}

#endif  // NET_CHOICE_H
