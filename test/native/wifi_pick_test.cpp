// Host test for src/wifi_pick.h (issue #120): which saved WiFi network gets joined.
#include "wifi_pick.h"
#include <cstdio>
#include <string>

static int g_pass = 0, g_fail = 0;
#define CHECK(cond, msg) do { if (cond) { g_pass++; } else { g_fail++; printf("  FAIL: %s\n", msg); } } while (0)

int main() {
    const char* stored[WIFI_SLOTS] = {"home", "venue", "", "hotspot"};
    int at = -2;

    WifiSeen all[] = {{"neighbour", -40}, {"hotspot", -30}, {"venue", -70}, {"home", -80}};
    CHECK(wifiPick(stored, all, 4, 0, &at) == 0 && at == 3, "all visible: slot 0 wins even at -80 dBm");
    CHECK(wifiPick(stored, all, 4, 1u << 0, &at) == 1 && at == 2, "slot 0 failed: next visible slot");
    CHECK(wifiPick(stored, all, 4, (1u << 0) | (1u << 1), &at) == 3, "empty slot 2 skipped");
    CHECK(wifiPick(stored, all, 4, 0xF, &at) == -1 && at == -1, "everything tried: -1");

    WifiSeen away[] = {{"venue", -60}, {"hotspot", -50}};
    CHECK(wifiPick(stored, away, 2, 0, &at) == 1 && at == 0, "home not there: venue, not the louder hotspot");

    WifiSeen mesh[] = {{"home", -85}, {"home", -48}, {"home", -70}};
    CHECK(wifiPick(stored, mesh, 3, 0, &at) == 0 && at == 1, "same SSID on 3 APs: strongest AP");

    WifiSeen none[] = {{"neighbour", -40}};
    CHECK(wifiPick(stored, none, 1, 0, &at) == -1, "nothing saved is visible: -1");
    CHECK(wifiPick(stored, nullptr, 0, 0, &at) == -1, "empty scan: -1");

    // blind fallback for hidden networks: every saved slot, in order, empty ones skipped
    CHECK(wifiNextBlind(stored, 0) == 0, "blind: slot 0 first");
    CHECK(wifiNextBlind(stored, 1u << 0) == 1, "blind: then slot 1");
    CHECK(wifiNextBlind(stored, (1u << 0) | (1u << 1)) == 3, "blind: skips the empty slot");
    CHECK(wifiNextBlind(stored, 0xB) == -1, "blind: done");
    const char* nothing[WIFI_SLOTS] = {"", nullptr, "", ""};
    CHECK(wifiNextBlind(nothing, 0) == -1 && wifiPick(nothing, all, 4, 0, &at) == -1, "no saved networks at all");

    // reorder moves SSID and password together
    std::string ssid[WIFI_SLOTS] = {"home", "venue", "", "hotspot"};
    std::string psk[WIFI_SLOTS]  = {"pw-home", "pw-venue", "", "pw-hot"};
    const int up[WIFI_SLOTS] = {3, 0, 1, 2};   // hotspot moved to the top
    CHECK(wifiReorder(ssid, psk, up), "reorder accepted");
    CHECK(ssid[0] == "hotspot" && psk[0] == "pw-hot", "reorder: hotspot + its password now slot 0");
    CHECK(ssid[1] == "home" && psk[1] == "pw-home", "reorder: home + password slot 1");
    CHECK(ssid[3] == "" && psk[3] == "", "reorder: the empty slot moved too");
    const int bad[WIFI_SLOTS] = {0, 0, 1, 2};
    CHECK(!wifiReorder(ssid, psk, bad) && ssid[0] == "hotspot", "not a permutation: refused, nothing moved");
    const int range[WIFI_SLOTS] = {0, 1, 2, 4};
    CHECK(!wifiReorder(ssid, psk, range), "index out of range refused");

    printf("\nwifi_pick: %d passed, %d failed\n", g_pass, g_fail);
    return g_fail ? 1 : 0;
}
