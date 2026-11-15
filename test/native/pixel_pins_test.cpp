// Host test for src/pixel_pins.h (issue #165): which GPIO a pixel port may not have. Only what is
// on owns a pin: the WT32-ETH01 keeps the W5500's default pins (CS = GPIO5) although it runs its
// LAN8720 over RMII, and that turned a pixel port on GPIO5 off on every save.
#include "pixel_pins.h"
#include <cstdio>
#include <cstring>

static int g_pass = 0, g_fail = 0;
#define CHECK(cond, msg) do { if (cond) { g_pass++; } else { g_fail++; printf("  FAIL: %s\n", msg); } } while (0)

static bool owned(const PixPinUse& u, int pin, const char* want = nullptr) {
    char why[48] = "";
    bool o = pixPinOwned(u, pin, why, sizeof(why));
    if (o && want && strcmp(why, want)) printf("  (GPIO%d said \"%s\", wanted \"%s\")\n", pin, why, want);
    return o && (!want || !strcmp(why, want));
}

int main() {
    // The WT32-ETH01 as its template sets it up: RMII Ethernet, the W5500 pins left at the base
    // defaults, an I2C OLED on 14/15, the LED on GPIO2, DMX output A on 4 (TX) and 5 (RX).
    PixPinUse wt;
    wt.ledType = 1; wt.ledPin = 2;
    wt.spiEth = false;
    const int eth[6] = {5, 18, 23, 19, 4, 25};
    for (int i = 0; i < 6; i++) wt.eth[i] = eth[i];
    wt.dispType = 1; wt.dispI2c[0] = 14; wt.dispI2c[1] = 15;
    wt.nOut = 3;
    wt.out[0] = {true, 4, 5, -1};
    wt.out[1] = {false, 12, -1, -1};
    CHECK(!owned(wt, 12), "WT32: GPIO12 is free (output B, which would use it, is off)");
    CHECK(!owned(wt, 18) && !owned(wt, 23) && !owned(wt, 25), "WT32: the W5500's pins are free while RMII is the wired PHY");
    CHECK(owned(wt, 5, "DMX output A"), "WT32: GPIO5 is output A's RX, not the W5500's");
    wt.out[0].rx = -1;
    CHECK(!owned(wt, 5), "WT32: GPIO5 free once output A has no RX");
    CHECK(owned(wt, 14, "the display's SDA") && owned(wt, 15, "the display's SCL"), "WT32: the OLED's pins while it's on");
    CHECK(owned(wt, 2, "the status LED"), "WT32: the LED's pin");

    // the W5500 as the wired PHY owns its pins
    PixPinUse w5 = wt;
    w5.spiEth = true;
    CHECK(owned(w5, 5, "the W5500 CS") && owned(w5, 19, "the W5500 MISO"), "W5500 on: its CS and MISO are taken");

    // a display that's off owns nothing; an SPI one owns its five, not the I2C two
    PixPinUse d = wt;
    d.dispType = 0;
    CHECK(!owned(d, 14) && !owned(d, 15), "display off: its pins are free");
    d.dispType = 4;
    const int dspi[5] = {35, 36, 37, 38, 39};
    for (int i = 0; i < 5; i++) d.dispSpi[i] = dspi[i];
    CHECK(!owned(d, 14) && owned(d, 38, "the display's SCK"), "SPI display: its SCK, not the I2C pins");

    // the 5-LED panel owns its five pins, not the single LED pin; an LED that's off owns none
    PixPinUse l = wt;
    l.ledType = 3;
    const int panel[5] = {10, 11, 12, 14, 16};
    for (int i = 0; i < 5; i++) l.ledPanel[i] = panel[i];
    CHECK(!owned(l, 2) && owned(l, 16, "the LED panel's white"), "LED panel: its pins, not the single LED's");
    l.ledType = 0;
    CHECK(!owned(l, 2) && !owned(l, 16), "LED off: none of its pins");

    // controls: set pins only
    PixPinUse c;
    c.enc[2] = 21; c.btn[1] = 33;
    CHECK(owned(c, 21, "the encoder's push") && owned(c, 33, "button 2") && !owned(c, -1), "encoder and buttons, set ones only");

    printf("pixel pins: %d passed, %d failed\n", g_pass, g_fail);
    return g_fail ? 1 : 0;
}
