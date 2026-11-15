// Who owns a GPIO, for a pixel port's data pin (sanitizePixels() in main.cpp, issue #165).
//
// A pixel port drives its pin hard from an RMT or LCD channel, so it must not land on a pin
// something else uses. But only what is actually ON uses a pin: /config keeps the numbers of
// features that are off (the W5500's pins on a WT32-ETH01 that runs its LAN8720 over RMII,
// an I2C display's pins with the display off, the 5-LED panel's pins with a single LED).
// Counting those turned a pixel port off after every save on the WT32 (GPIO5 is the default
// W5500 CS) while the page, which only counts what's on, said "Saved".
//
// Kept pure (no Arduino) so the rule runs on the host in test/native/pixel_pins_test.cpp, and
// kept the same as activeRoles() in src/pages/config.html: change one, change the other.
#pragma once
#include <cstdio>
#include <cstddef>

struct PixPinUse {
    int ledType = 0;                 // 0 off, 1 plain GPIO, 2 WS2812, 3 5-LED panel
    int ledPin = -1;                 // types 1 and 2
    int ledPanel[5] = {-1, -1, -1, -1, -1};   // type 3: R G Y B W
    bool spiEth = false;             // the W5500/DM9051 module is the wired PHY
    int eth[6] = {-1, -1, -1, -1, -1, -1};    // CS SCK MOSI MISO INT RST
    int dispType = 0;                // 0 off, 1..3 I2C, 4 SPI colour
    int dispI2c[2] = {-1, -1};       // SDA SCL
    int dispSpi[5] = {-1, -1, -1, -1, -1};    // CS DC RST SCK MOSI
    int enc[3] = {-1, -1, -1};       // A B push
    int btn[4] = {-1, -1, -1, -1};
    static constexpr int MAX_OUT = 4;
    int nOut = 0;
    struct { bool en; int tx, rx, rts; } out[MAX_OUT] = {};
};

// What owns `pin`, written into `why` ("the W5500 CS", "DMX output A"): true when owned.
inline bool pixPinOwned(const PixPinUse& u, int pin, char* why, size_t n) {
    if (pin < 0) return false;
    auto said = [&](const char* what) { snprintf(why, n, "%s", what); return true; };
    if ((u.ledType == 1 || u.ledType == 2) && u.ledPin == pin) return said("the status LED");
    if (u.ledType == 3) {
        static const char* const L[5] = {"the LED panel's red", "the LED panel's green", "the LED panel's yellow", "the LED panel's blue", "the LED panel's white"};
        for (int i = 0; i < 5; i++) if (u.ledPanel[i] == pin) return said(L[i]);
    }
    if (u.spiEth) {
        static const char* const E[6] = {"the W5500 CS", "the W5500 SCK", "the W5500 MOSI", "the W5500 MISO", "the W5500 INT", "the W5500 RST"};
        for (int i = 0; i < 6; i++) if (u.eth[i] == pin) return said(E[i]);
    }
    if (u.dispType >= 1 && u.dispType <= 3) {
        if (u.dispI2c[0] == pin) return said("the display's SDA");
        if (u.dispI2c[1] == pin) return said("the display's SCL");
    }
    if (u.dispType == 4) {
        static const char* const D[5] = {"the display's CS", "the display's DC", "the display's RST", "the display's SCK", "the display's MOSI"};
        for (int i = 0; i < 5; i++) if (u.dispSpi[i] == pin) return said(D[i]);
    }
    static const char* const C[3] = {"encoder A", "encoder B", "the encoder's push"};
    for (int i = 0; i < 3; i++) if (u.enc[i] == pin) return said(C[i]);
    for (int i = 0; i < 4; i++) if (u.btn[i] == pin) { snprintf(why, n, "button %d", i + 1); return true; }
    for (int o = 0; o < u.nOut && o < PixPinUse::MAX_OUT; o++) {
        if (!u.out[o].en) continue;
        if (u.out[o].tx == pin || u.out[o].rx == pin || u.out[o].rts == pin) { snprintf(why, n, "DMX output %c", 'A' + o); return true; }
    }
    return false;
}
