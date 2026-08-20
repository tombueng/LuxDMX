// LCD_CAM backend for pixel_out.h — the carrier's five-port path.
//
// The ESP32-S3's parallel-LCD peripheral clocked at 2.4 MHz, fed by GDMA. It is meant to
// drive a display; we use only its data bus, and it neither knows nor cares that the other
// end is LED strip.
//
// The trick is that a WS281x bit is a 1.25 us pulse that divides into three equal slots:
//
//     slot:      1        2        3
//     bit = 0:  HIGH     low      low     -> 417 ns high  (spec 400 +/-150)
//     bit = 1:  HIGH     HIGH     low     -> 833 ns high  (spec 800 +/-150)
//
// Slot 1 is always high, slot 3 always low, and slot 2 IS the data bit. So any peripheral
// that shifts a byte out at 2.4 MHz produces valid WS281x with no timing logic at all -- the
// waveform is just data. And because the bus is 8 bits wide, **bit k of each byte is strip k**:
// one byte per slot drives every port at once, 24 bits x 3 slots = 72 bytes per pixel TOTAL,
// however many ports there are. A sixth or seventh port is free in both time and memory.
//
// Why this exists at all: an S3 has 4 RMT TX channels and they are shared with DMX TX and the
// status LED, so a board with three DMX outputs has one left for pixels and a board with five
// pixel ports has run out whatever else it does. This backend uses no RMT channel and ~0 CPU
// for the transmission, and since every port rides the same expanded frame it gets cheaper in
// RAM the more ports there are.
//
// It is also the fix for a problem RMT has and this one cannot: an RMT lane without a DMA
// channel is refilled from an ISR, and a late refill under load stretches the bit being clocked
// at fixed offsets in the stream, so the same few LEDs flicker every frame. There is no refill
// here. That is why forcing this backend (cfg.pixBackend) is worth having on a board with the
// PSRAM to pay for it, even when RMT would technically fit.
//
// STATUS: the data path is proven on the carrier -- 5 ports at 30 px, Art-Net on 5 universes,
// 39.6 fps in and ~39 fps out per port, 318 latches, 0 partials, DMX output 1 unaffected.
// What is NOT verified is the electrical side: the slot timings below are arithmetic, so
// T0H/T1H and the reset gap have never been measured on a scope with a strip attached.
#include "pixel_out.h"
#include "config_enums.h"
#include "pixel_map.h"

#include <Arduino.h>
#include <string.h>
#include "esp_heap_caps.h"
#include "soc/soc_caps.h"

#if SOC_LCD_I80_SUPPORTED
#include "esp_lcd_panel_io.h"
#include "esp_lcd_io_i80.h"

namespace {

// 3 slots per bit at 1.25 us per bit = 416.67 ns per slot = 2.4 MHz.
constexpr uint32_t PIXLCD_PCLK_HZ = 2400000;
// WS2812B latches after 50 us of low; the newer V5 parts want 280 us. Pad the frame rather
// than rely on the gap between transfers, which is scheduler-dependent.
constexpr int PIXLCD_RESET_SLOTS = 700;          // 700 x 417 ns = 292 us
constexpr int PIXLCD_SLOTS_PER_PIXEL = 24 * 3;   // 3-channel; RGBW is 32 * 3, handled below

esp_lcd_i80_bus_handle_t   g_bus = nullptr;
esp_lcd_panel_io_handle_t  g_io  = nullptr;
uint8_t*                   g_buf[2] = {nullptr, nullptr};   // double buffered
int                        g_cur = 0;
size_t                     g_bufLen = 0;
volatile bool              g_sending = false;
PixOutPort                 g_ports[8];
int                        g_n = 0;
int                        g_maxCount = 0;
int                        g_bpp = 3;
uint8_t                    g_laneMask = 0;       // which data lines are real ports

bool IRAM_ATTR onDone(esp_lcd_panel_io_handle_t, esp_lcd_panel_io_event_data_t*, void*) {
    g_sending = false;
    return false;
}

}  // namespace

PixBackend pixLcdBegin(const PixOutPort* ports, int n) {
    if (n <= 0 || n > 8) return PIXBK_NONE;
    // One clock for every lane means one chip family for every lane: the slot rate IS the bit
    // rate. Mixing an 800 kHz and a 400 kHz strip on one bus is not expressible.
    for (int i = 1; i < n; i++)
        if (pixKhz(ports[i].chip) != pixKhz(ports[0].chip) ||
            pixBytesPerPixel(ports[i].chip) != pixBytesPerPixel(ports[0].chip)) {
            Serial.println("[PIX] LCD backend: every port must be the same LED chip (one shared clock)");
            return PIXBK_NONE;
        }

    g_bpp = pixBytesPerPixel(ports[0].chip);
    g_maxCount = 0;
    g_laneMask = 0;
    for (int i = 0; i < n; i++) {
        g_ports[i] = ports[i];
        if (ports[i].count > g_maxCount) g_maxCount = ports[i].count;
        g_laneMask |= (uint8_t)(1u << i);
    }
    g_n = n;

    const int slotsPerPixel = g_bpp * 8 * 3;
    g_bufLen = (size_t)g_maxCount * slotsPerPixel + PIXLCD_RESET_SLOTS;

    esp_lcd_i80_bus_config_t bc = {};
    // The DC and WR lines are required by the i80 API because a real display needs them. We
    // do not, so they go to a pin nothing is connected to. This is the "ghost pin" the
    // reference implementations put on GPIO 0 -- which on our boards is the BOOT button, used
    // for config reset and the setup portal, so it must not be that. IO45 is a strapping pin
    // that the carrier leaves unrouted, which makes it harmless here.
    bc.dc_gpio_num = PIXLCD_GHOST_PIN;
    bc.wr_gpio_num = PIXLCD_GHOST_PIN;
    bc.clk_src     = LCD_CLK_SRC_DEFAULT;
    bc.bus_width   = 8;
    bc.max_transfer_bytes = g_bufLen;
    bc.dma_burst_size = 64;
    for (int i = 0; i < 8; i++) bc.data_gpio_nums[i] = (i < n) ? ports[i].pin : PIXLCD_GHOST_PIN;

    if (esp_lcd_new_i80_bus(&bc, &g_bus) != ESP_OK) {
        Serial.println("[PIX] LCD backend: esp_lcd_new_i80_bus failed");
        g_bus = nullptr;
        return PIXBK_NONE;
    }

    esp_lcd_panel_io_i80_config_t ioc = {};
    ioc.cs_gpio_num = -1;
    ioc.pclk_hz     = PIXLCD_PCLK_HZ;
    ioc.trans_queue_depth = 2;
    ioc.lcd_cmd_bits   = 0;
    ioc.lcd_param_bits = 0;
    ioc.on_color_trans_done = onDone;
    if (esp_lcd_new_panel_io_i80(g_bus, &ioc, &g_io) != ESP_OK) {
        Serial.println("[PIX] LCD backend: esp_lcd_new_panel_io_i80 failed");
        esp_lcd_del_i80_bus(g_bus); g_bus = nullptr;
        return PIXBK_NONE;
    }

    // The expanded frame is the big allocation: 72 bytes per pixel for 3-channel strip
    // (96 for RGBW), double buffered so the next frame is built while this one clocks out.
    // PSRAM is where this belongs and, on the carrier's N16R8, where there is room for it.
    for (int b = 0; b < 2; b++) {
        g_buf[b] = (uint8_t*)heap_caps_aligned_alloc(64, g_bufLen, MALLOC_CAP_SPIRAM | MALLOC_CAP_DMA);
        if (!g_buf[b]) g_buf[b] = (uint8_t*)heap_caps_aligned_alloc(64, g_bufLen, MALLOC_CAP_DMA);
        if (!g_buf[b]) {
            Serial.printf("[PIX] LCD backend: cannot allocate %u B of frame buffer\n", (unsigned)g_bufLen);
            pixLcdEnd();
            return PIXBK_NONE;
        }
        memset(g_buf[b], 0, g_bufLen);
    }
    g_sending = false;
    Serial.printf("[PIX] LCD_CAM backend up: %d port(s), %u B x2 expanded frame\n",
                  n, (unsigned)g_bufLen);
    return PIXBK_LCD;
}

void pixLcdEnd() {
    if (g_io)  { esp_lcd_panel_io_del(g_io);  g_io  = nullptr; }
    if (g_bus) { esp_lcd_del_i80_bus(g_bus);  g_bus = nullptr; }
    for (int b = 0; b < 2; b++) if (g_buf[b]) { heap_caps_free(g_buf[b]); g_buf[b] = nullptr; }
    g_bufLen = 0; g_n = 0; g_sending = false;
}

bool pixLcdBusy() { return g_sending; }

void pixLcdPush(const uint8_t* const* bufs, const uint16_t* counts) {
    if (!g_io || g_sending) return;
    uint8_t* out = g_buf[g_cur];
    const int bits = g_bpp * 8;

    // Bit-slice every port's pixel into the slot stream. Slot 1 is all lanes high, slot 3 all
    // low, and slot 2 carries one bit of every port at once -- which is why adding ports costs
    // nothing here: the loop is over PIXELS and BITS, never over ports-times-pixels.
    size_t o = 0;
    for (int px = 0; px < g_maxCount; px++) {
        for (int b = 0; b < bits; b++) {
            const int chan = b >> 3;                 // which colour byte
            const int bit  = 7 - (b & 7);            // MSB first, as WS281x expects
            uint8_t data = 0;
            for (int lane = 0; lane < g_n; lane++) {
                if (px >= counts[lane] || !bufs[lane]) continue;   // shorter strip: leave low
                const PixOrder om = pixOrderMap(g_ports[lane].order);
                const uint8_t v = bufs[lane][(size_t)px * g_bpp + om.idx[chan]];
                if ((v >> bit) & 1) data |= (uint8_t)(1u << lane);
            }
            out[o++] = g_laneMask;   // slot 1: every lane high
            out[o++] = data;         // slot 2: the data bit
            out[o++] = 0;            // slot 3: every lane low
        }
    }
    memset(out + o, 0, g_bufLen - o);   // reset/latch tail

    g_sending = true;
    if (esp_lcd_panel_io_tx_color(g_io, -1, out, g_bufLen) != ESP_OK) g_sending = false;
    g_cur ^= 1;
}

bool pixLcdPreferred() {
    return heap_caps_get_total_size(MALLOC_CAP_SPIRAM) > 0;
}

#else   // no LCD_CAM on this chip (classic ESP32): the RMT backend is the only one

PixBackend pixLcdBegin(const PixOutPort*, int) { return PIXBK_NONE; }
bool       pixLcdPreferred() { return false; }
void       pixLcdEnd() {}
bool       pixLcdBusy() { return false; }
void       pixLcdPush(const uint8_t* const*, const uint16_t*) {}

#endif
