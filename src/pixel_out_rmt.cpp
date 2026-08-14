// RMT backend for pixel_out.h.
//
// One RMT TX channel per port, driven by the IDF's bytes-encoder: we hand it the port's
// framebuffer and a description of what a 0 and a 1 bit look like, and the peripheral
// clocks the stream out in hardware, refilling its 64-word channel memory from an ISR. The
// CPU cost is the colour-order permutation into a small staging buffer, and the RAM cost is
// roughly three bytes a pixel plus a few hundred bytes of channel state.
//
// That frugality is the point: this is the backend for the boards that cannot spare
// anything. A WROOM-32 has all 8 RMT TX channels and can drive 8 strips of several hundred
// pixels inside a few KB of heap. DMX does not compete for them -- it is a UART peripheral --
// so what decides RMT-vs-LCD is simply how many pixel ports are asked for. Measured on an S3
// that is THREE (see the block-borrowing note below); the carrier's 4th port tips it over.
#include "pixel_out.h"
#include "config_enums.h"
#include "pixel_map.h"

#include <Arduino.h>
#include <string.h>
#include "driver/rmt_tx.h"
#include "driver/rmt_encoder.h"
#include "esp_heap_caps.h"

// 1 tick = 100 ns. WS2812 timings land on exact tick counts at this resolution, and it is
// well inside what the RMT's source clock can divide to on every chip we build for.
#define PIXRMT_RES_HZ 10000000u

namespace {

struct Lane {
    volatile bool        sending = false;   // set on transmit, cleared by the done callback
    rmt_channel_handle_t chan = nullptr;
    rmt_encoder_handle_t enc  = nullptr;
    uint8_t*             stage = nullptr;   // colour-ordered copy handed to the encoder
    size_t               stageLen = 0;
    PixOutPort           cfg{};
    bool                 up = false;
};

// Runs in ISR context: clear the lane's busy flag so the next service tick can push again.
bool IRAM_ATTR laneDone(rmt_channel_handle_t, const rmt_tx_done_event_data_t*, void* ud) {
    ((Lane*)ud)->sending = false;
    return false;   // no task woken
}

Lane       g_lane[8];
int        g_laneN = 0;
PixBackend g_backend = PIXBK_NONE;

// Build the bit symbols for a chip family. WS2812 at 800 kHz: a 0 is 0.4 us high / 0.85 us
// low, a 1 is 0.8 us high / 0.45 us low. WS2811 in its slow mode doubles both halves.
rmt_bytes_encoder_config_t bytesCfgFor(int chip) {
    const bool slow = (pixKhz(chip) == 400);
    const uint16_t t0h = slow ? 8  : 4;     // x100 ns
    const uint16_t t0l = slow ? 17 : 9;
    const uint16_t t1h = slow ? 16 : 8;
    const uint16_t t1l = slow ? 9  : 5;
    rmt_bytes_encoder_config_t c = {};
    c.bit0.level0 = 1; c.bit0.duration0 = t0h;
    c.bit0.level1 = 0; c.bit0.duration1 = t0l;
    c.bit1.level0 = 1; c.bit1.duration0 = t1h;
    c.bit1.level1 = 0; c.bit1.duration1 = t1l;
    c.flags.msb_first = 1;                  // WS281x clocks the MSB of each byte first
    return c;
}

void laneDown(Lane& L) {
    if (L.chan) { rmt_disable(L.chan); rmt_del_channel(L.chan); L.chan = nullptr; }
    if (L.enc)  { rmt_del_encoder(L.enc); L.enc = nullptr; }
    if (L.stage){ heap_caps_free(L.stage); L.stage = nullptr; L.stageLen = 0; }
    L.up = false;
}

bool laneUp(Lane& L, const PixOutPort& p) {
    L.cfg = p;
    const int bpp = pixBytesPerPixel(p.chip);
    L.stageLen = (size_t)p.count * bpp;
    if (L.stageLen == 0 || p.pin < 0) return false;

    // Internal RAM only: the RMT encoder reads this buffer from an ISR.
    L.stage = (uint8_t*)heap_caps_calloc(L.stageLen, 1, MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL);
    if (!L.stage) return false;

    rmt_tx_channel_config_t cc = {};
    cc.gpio_num          = (gpio_num_t)p.pin;
    cc.clk_src           = RMT_CLK_SRC_DEFAULT;
    cc.resolution_hz     = PIXRMT_RES_HZ;
    cc.trans_queue_depth = 2;
    // Ask for DMA first: the whole frame then streams from RAM with no refill ISR at all,
    // which is the nicest thing for a protocol with no resync. DMA channels are scarce
    // though (on an S3 the first DMX output usually has it), so fall back to a channel that
    // occupies exactly ONE memory block.
    //
    // That single-block fallback matters more than it looks. An RMT channel asking for more
    // than one block's worth of symbols borrows the NEXT channel's memory, so it consumes two
    // of the four slots on an S3. With DMX out0 on DMA and out1 on a 2-block channel, three
    // slots are already gone and a 2-block pixel request simply cannot be satisfied -- which
    // is exactly how this failed the first time, reporting "backend none" on a board that had
    // a free channel all along.
#if SOC_RMT_SUPPORT_DMA
    cc.flags.with_dma    = true;
    cc.mem_block_symbols = 1024;
    if (rmt_new_tx_channel(&cc, &L.chan) != ESP_OK) {
        cc.flags.with_dma    = false;
        cc.mem_block_symbols = SOC_RMT_MEM_WORDS_PER_CHANNEL;
        if (rmt_new_tx_channel(&cc, &L.chan) != ESP_OK) { laneDown(L); return false; }
    }
#else
    cc.flags.with_dma    = false;
    cc.mem_block_symbols = SOC_RMT_MEM_WORDS_PER_CHANNEL;
    if (rmt_new_tx_channel(&cc, &L.chan) != ESP_OK) { laneDown(L); return false; }
#endif

    rmt_bytes_encoder_config_t bc = bytesCfgFor(p.chip);
    if (rmt_new_bytes_encoder(&bc, &L.enc) != ESP_OK) { laneDown(L); return false; }
    rmt_tx_event_callbacks_t cbs = {};
    cbs.on_trans_done = laneDone;
    rmt_tx_register_event_callbacks(L.chan, &cbs, &L);
    if (rmt_enable(L.chan) != ESP_OK) { laneDown(L); return false; }
    L.sending = false;
    L.up = true;
    return true;
}

}  // namespace


// Try RMT first: it is the cheaper backend and the only one a classic ESP32 has. If it cannot
// serve every requested port -- on an S3 that means from the 4th on, one fewer again with a
// WS2812 status LED -- fall back to LCD_CAM, which uses no RMT channel at all and clocks every
// lane together. Partial success is deliberately not an option: running 2 of 5 ports would look
// like a wiring fault rather than a configuration limit.
PixBackend pixOutBegin(const PixOutPort* ports, int n) {
    pixOutEnd();
    if (n <= 0) return PIXBK_NONE;
    if (n > (int)(sizeof(g_lane) / sizeof(g_lane[0]))) n = sizeof(g_lane) / sizeof(g_lane[0]);

    bool rmtOk = true;
    for (int i = 0; i < n && rmtOk; i++)
        if (!laneUp(g_lane[i], ports[i])) rmtOk = false;

    if (rmtOk) {
        g_laneN = n;
        g_backend = PIXBK_RMT;
        Serial.printf("[PIX] RMT backend up: %d port(s)\n", n);
        return g_backend;
    }
    for (int j = 0; j < n; j++) laneDown(g_lane[j]);
    g_laneN = 0;

    Serial.printf("[PIX] RMT cannot serve %d port(s) (only %d TX channels on this chip, minus "
                  "a WS2812 status LED) - trying LCD_CAM\n", n, SOC_RMT_TX_CANDIDATES_PER_GROUP);
    if (pixLcdBegin(ports, n) == PIXBK_LCD) { g_backend = PIXBK_LCD; return g_backend; }
    return PIXBK_NONE;
}

void pixOutEnd() {
    if (g_backend == PIXBK_LCD) pixLcdEnd();
    for (int i = 0; i < g_laneN; i++) laneDown(g_lane[i]);
    g_laneN = 0;
    g_backend = PIXBK_NONE;
}

PixBackend pixOutBackend()     { return g_backend; }
const char* pixOutBackendName(){
    return g_backend == PIXBK_RMT ? "rmt" : g_backend == PIXBK_LCD ? "lcd" : "none";
}

bool pixOutBusy() {
    if (g_backend == PIXBK_LCD) return pixLcdBusy();
    // A plain flag, not rmt_tx_wait_all_done(chan, 0): that call logs an ESP_ERR_TIMEOUT
    // error line every time it finds a channel still busy, and this is polled every 2 ms.
    for (int i = 0; i < g_laneN; i++)
        if (g_lane[i].up && g_lane[i].sending) return true;
    return false;
}

void pixOutPush(const uint8_t* const* bufs, const uint16_t* counts) {
    if (g_backend == PIXBK_LCD) { pixLcdPush(bufs, counts); return; }
    rmt_transmit_config_t tc = {};
    tc.loop_count = 0;
    for (int i = 0; i < g_laneN; i++) {
        Lane& L = g_lane[i];
        if (!L.up || !bufs[i]) continue;
        const int bpp = pixBytesPerPixel(L.cfg.chip);
        size_t n = (size_t)counts[i] * bpp;
        if (n > L.stageLen) n = L.stageLen;

        // Colour order is applied here, on the way out, so the framebuffer stays in the
        // order the console sent and every readback (/pixels.json, the live view) shows
        // what was received rather than what the strip happens to want.
        const PixOrder om = pixOrderMap(L.cfg.order);
        for (size_t p = 0; p + bpp <= n; p += bpp)
            for (int c = 0; c < bpp; c++) L.stage[p + c] = bufs[i][p + om.idx[c]];

        L.sending = true;
        if (rmt_transmit(L.chan, L.enc, L.stage, n, &tc) != ESP_OK) L.sending = false;
    }
}
