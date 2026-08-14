// Host tests for src/pixel_map.h — the universe->framebuffer arithmetic, colour order,
// power model and gamma. No hardware, no Arduino: this is exactly the part where an
// off-by-one start channel or a universe boundary landing mid-pixel hides, and exactly the
// part that is cheap to pin down properly.
#include "pixel_map.h"

#include <cstdio>
#include <cstring>
#include <vector>

static int g_pass = 0, g_fail = 0;
#define CHECK(cond, msg) do { if (cond) { g_pass++; } else { g_fail++; \
    printf("  FAIL: %s\n", msg); } } while (0)
#define EQI(got, want, msg) do { long _g = (long)(got), _w = (long)(want); \
    if (_g == _w) { g_pass++; } else { g_fail++; \
    printf("  FAIL: %s (got %ld, want %ld)\n", msg, _g, _w); } } while (0)

static std::vector<PixSlice> slices(int chip, int uniMode, int count, int startCh) {
    std::vector<PixSlice> v(80);
    int n = pixBuildSlices(chip, uniMode, count, startCh, v.data(), (int)v.size());
    v.resize(n < 0 ? 0 : n);
    return v;
}

int main() {
    // ---- bytes per pixel / frame time ------------------------------------------------
    EQI(pixBytesPerPixel(PIX_CHIP_WS2812), 3, "bpp: WS2812 is RGB");
    EQI(pixBytesPerPixel(PIX_CHIP_SK6812), 4, "bpp: SK6812 is RGBW");
    EQI(pixKhz(PIX_CHIP_WS2811), 400,          "khz: WS2811 slow mode");
    // 24 bits x 1.25 us = 30 us a pixel, so 1000 px is 30 ms and cannot beat ~33 fps.
    CHECK(pixMaxFps(PIX_CHIP_WS2812, 1000) >= 32 && pixMaxFps(PIX_CHIP_WS2812, 1000) <= 34,
          "fps: 1000 RGB pixels is about 33 fps");
    CHECK(pixMaxFps(PIX_CHIP_WS2812, 170) > 150, "fps: one universe is fast");
    CHECK(pixMaxFps(PIX_CHIP_SK6812, 1000) < pixMaxFps(PIX_CHIP_WS2812, 1000),
          "fps: RGBW is slower than RGB at the same count");

    // ---- aligned mapping, the default ------------------------------------------------
    {   // exactly one universe of RGB
        auto s = slices(PIX_CHIP_WS2812, PIX_UNI_ALIGNED, 170, 1);
        EQI(s.size(), 1,      "aligned: 170 RGB px is one universe");
        EQI(s[0].srcOff, 0,   "aligned: starts at channel 1");
        EQI(s[0].dstOff, 0,   "aligned: first slice at buffer 0");
        EQI(s[0].len, 510,    "aligned: 170 x 3 = 510 channels");
    }
    {   // one pixel more spills into a second universe
        auto s = slices(PIX_CHIP_WS2812, PIX_UNI_ALIGNED, 171, 1);
        EQI(s.size(), 2,      "aligned: 171 px needs two universes");
        EQI(s[1].uniSlot, 1,  "aligned: second slice is slot 1");
        EQI(s[1].srcOff, 0,   "aligned: later universes start at channel 1");
        EQI(s[1].dstOff, 510, "aligned: continues where the first left off");
        EQI(s[1].len, 3,      "aligned: one pixel in the second universe");
    }
    {   // a start channel shortens ONLY the first universe, and never splits a pixel
        auto s = slices(PIX_CHIP_WS2812, PIX_UNI_ALIGNED, 200, 151);
        EQI(s[0].srcOff, 150,       "aligned: start channel 151 is offset 150");
        EQI(s[0].len, 120 * 3,      "aligned: (512-150)/3 = 120 whole pixels fit");
        EQI(s[1].srcOff, 0,         "aligned: the next universe restarts at 1");
        EQI(s[1].len, (200 - 120) * 3, "aligned: the remaining 80 pixels follow");
    }
    {   // RGBW packs 128 to a universe, and 4 divides 512 exactly
        auto s = slices(PIX_CHIP_SK6812, PIX_UNI_ALIGNED, 128, 1);
        EQI(s.size(), 1,   "aligned: 128 RGBW px is one universe");
        EQI(s[0].len, 512, "aligned: RGBW uses all 512 channels");
    }
    {   // total bytes must always equal count * bpp, whatever the start channel
        for (int start = 1; start <= 500; start += 37)
            for (int count = 1; count <= 700; count += 97) {
                auto s = slices(PIX_CHIP_WS2812, PIX_UNI_ALIGNED, count, start);
                int total = 0; for (auto& x : s) total += x.len;
                EQI(total, count * 3, "aligned: slices always cover exactly count*bpp");
            }
    }
    {   // a start channel with no room for a whole pixel yields nothing rather than garbage
        auto s = slices(PIX_CHIP_WS2812, PIX_UNI_ALIGNED, 10, 512);
        EQI(s.size(), 0, "aligned: start 512 leaves no room for an RGB pixel");
    }

    // ---- packed mapping ---------------------------------------------------------------
    {
        auto s = slices(PIX_CHIP_WS2812, PIX_UNI_PACKED, 200, 1);
        EQI(s[0].len, 512,          "packed: fills the whole universe");
        EQI(s[1].srcOff, 0,         "packed: continues at channel 1");
        EQI(s[1].len, 200 * 3 - 512,"packed: remainder in the next universe");
        int total = 0; for (auto& x : s) total += x.len;
        EQI(total, 200 * 3,         "packed: covers exactly count*bpp");
    }
    {   // packed genuinely straddles: 512 is not a multiple of 3
        auto s = slices(PIX_CHIP_WS2812, PIX_UNI_PACKED, 171, 1);
        EQI(s.size(), 2,            "packed: 171 px spans two universes");
        CHECK(s[0].len % 3 != 0,    "packed: a pixel is allowed to straddle the boundary");
    }

    // ---- universe span ---------------------------------------------------------------
    EQI(pixUniverseSpan(PIX_CHIP_WS2812, PIX_UNI_ALIGNED, 170, 1), 1,  "span: 170 -> 1");
    EQI(pixUniverseSpan(PIX_CHIP_WS2812, PIX_UNI_ALIGNED, 1020, 1), 6, "span: 1020 -> 6");
    EQI(pixUniverseSpan(PIX_CHIP_SK6812, PIX_UNI_ALIGNED, 1024, 1), 8, "span: 1024 RGBW -> 8");
    EQI(pixUniverseSpan(PIX_CHIP_WS2812, PIX_UNI_ALIGNED, 0, 1), 0,    "span: no pixels, no universes");

    // ---- colour order ----------------------------------------------------------------
    {
        // The framebuffer holds what the console sent (R,G,B). GRB strip wants G first, so
        // wire byte 0 must come from buffer index 1.
        PixOrder g = pixOrderMap(PIX_ORDER_GRB);
        EQI(g.idx[0], 1, "order: GRB takes G first");
        EQI(g.idx[1], 0, "order: then R");
        EQI(g.idx[2], 2, "order: then B");
        PixOrder r = pixOrderMap(PIX_ORDER_RGB);
        EQI(r.idx[0], 0, "order: RGB is identity");
        PixOrder w = pixOrderMap(PIX_ORDER_GRBW);
        EQI(w.idx[3], 3, "order: W stays last on RGBW");
        // every order must be a permutation, or a channel would be dropped/duplicated
        for (int o = 0; o < PIX_ORDER_COUNT; o++) {
            PixOrder m = pixOrderMap(o);
            bool seen[4] = {false, false, false, false};
            for (int i = 0; i < 4; i++) seen[m.idx[i] & 3] = true;
            CHECK(seen[0] && seen[1] && seen[2] && seen[3], "order: is a permutation");
        }
    }

    // ---- power ------------------------------------------------------------------------
    {
        // 100 RGB pixels, all black. The lit term is zero but the controllers still draw
        // their idle current -- the term every online calculator forgets.
        std::vector<uint8_t> fb(300, 0);
        uint32_t ma = pixEstimateMa(fb.data(), fb.size(), 100, 2000, 100);
        EQI(ma, 100, "power: 100 black pixels still draw 100 mA idle");

        // all channels at 255 with 20.00 mA per channel = 100 * 3 * 20 + idle
        std::fill(fb.begin(), fb.end(), 255);
        ma = pixEstimateMa(fb.data(), fb.size(), 100, 2000, 100);
        EQI(ma, 100 * 3 * 20 + 100, "power: full white is 6.1 A for 100 5V pixels");
        EQI(pixWorstCaseMa(100, 3, 2000, 100), 100 * 3 * 20 + 100,
            "power: worst case matches an all-255 frame");

        // 12 V strip draws far less for the same count, which is the whole argument for it
        CHECK(pixWorstCaseMa(100, 3, 570, 100) < pixWorstCaseMa(100, 3, 2000, 100) / 3,
              "power: 12V WS2815 is under a third of 5V WS2812B");
    }
    {
        // The cap scales only the LIT term: idle is there whatever we do, so scaling the
        // total would under-dim and still miss the cap on a long strip.
        EQI(pixPowerScale(1000, 100, 0), 256,    "cap: 0 means off");
        EQI(pixPowerScale(1000, 100, 2000), 256, "cap: under budget, no scaling");
        EQI(pixPowerScale(1100, 100, 600),  128, "cap: half the lit budget is half scale");
        EQI(pixPowerScale(1000, 500, 400),  0,   "cap: idle alone over budget -> full off");
    }

    // ---- gamma / brightness -----------------------------------------------------------
    {
        uint8_t t[256];
        pixBuildGamma(t, 0, 255);                 // gamma off, full brightness = identity
        EQI(t[0], 0,     "gamma: off keeps 0");
        EQI(t[255], 255, "gamma: off keeps 255");
        EQI(t[128], 128, "gamma: off is identity");

        pixBuildGamma(t, 220, 255);               // 2.2
        EQI(t[0], 0,     "gamma: 2.2 keeps black");
        EQI(t[255], 255, "gamma: 2.2 keeps full");
        CHECK(t[128] < 128, "gamma: 2.2 pulls the midpoint down");
        bool mono = true;
        for (int i = 1; i < 256; i++) if (t[i] < t[i - 1]) mono = false;
        CHECK(mono, "gamma: curve is monotonic");

        pixBuildGamma(t, 0, 128);                 // brightness only
        EQI(t[255], 128, "brightness: half scales the top");
        EQI(t[0], 0,     "brightness: black stays black");
    }

    printf("\n%d passed, %d failed\n", g_pass, g_fail);
    return g_fail ? 1 : 0;
}
