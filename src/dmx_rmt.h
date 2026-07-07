// RMT-based DMX512 transmit (issue #64 hard-zero-under-load path).
//
// Why: esp_dmx clocks DMX with the UART + a GPTimer ISR for the break/MAB. Under heavy
// core-0 network DMA the timer ISR can be delayed and a frame's break comes out malformed
// (framing errors). The RMT peripheral instead clocks a precomputed (level,duration)
// symbol stream out ENTIRELY IN HARDWARE -- the CPU only fills a buffer, the timing is the
// RMT's own clock. The IDF RMT driver's ISR refills the 64-word channel memory from our
// symbol array as it drains; if that refill is ever late the RMT just idles the line (a
// benign extra mark) instead of corrupting a break. So RMT DMX is far more contention-proof.
//
// Resolution 1 MHz => 1 tick = 1 us. A DMX bit is 4 us = exactly 4 ticks (hardware-exact,
// no jitter). Break = 176 us, MAB = 12 us. Line idles HIGH (DMX mark) between frames.
#pragma once
#include "driver/rmt_tx.h"
#include "driver/rmt_encoder.h"

#define RMT_DMX_RES_HZ   1000000u   // 1 tick = 1 us
#define RMT_DMX_BIT      4          // 4 us per bit @250 kbaud
#define RMT_DMX_BREAK    176        // break low, us
#define RMT_DMX_MAB      12         // mark-after-break high, us
// Worst-case symbols: break/MAB (1 word) + 513 slots * up to 11 runs (alternating bits)
// = ~5644 runs -> ~2822 words. Round up for safety.
#define RMT_DMX_MAX_SYM  3000

struct RmtDmx {
    rmt_channel_handle_t chan = nullptr;
    rmt_encoder_handle_t enc  = nullptr;
    rmt_symbol_word_t*   sym  = nullptr;   // symbol buffer (DRAM)
    int                  nsym = 0;
};

// --- per-byte symbol lookup table -----------------------------------------------------------
// A UART byte is start(0) + 8 data(LSB) + stop(1,1). Run-length-encoded it ALWAYS starts with a
// level-0 run and ends with a level-1 run, so it has an EVEN number of runs = an integer number
// of rmt_symbol_word_t (2 runs each) -- independent of the neighbouring bytes. So we precompute
// each byte value's words once and just memcpy them per slot at encode time (no per-bit loop).
#define RMT_MAX_WORDS_PER_BYTE 6
static rmt_symbol_word_t g_byteLut[256][RMT_MAX_WORDS_PER_BYTE];
static uint8_t           g_byteLutN[256];
static rmt_symbol_word_t g_breakWord;   // break(0,176us) + MAB(1,12us) packed in one word
static bool              g_lutReady = false;

static void rmtDmxBuildLut() {
    g_breakWord.duration0 = RMT_DMX_BREAK; g_breakWord.level0 = 0;
    g_breakWord.duration1 = RMT_DMX_MAB;   g_breakWord.level1 = 1;
    for (int v = 0; v < 256; v++) {
        uint8_t bits[11]; int nb = 0;
        bits[nb++] = 0;                                  // start bit
        for (int i = 0; i < 8; i++) bits[nb++] = (v >> i) & 1;   // 8 data, LSB first
        bits[nb++] = 1; bits[nb++] = 1;                  // 2 stop bits
        struct { uint8_t lvl; uint16_t dur; } run[11]; int nr = 0;
        for (int i = 0; i < nb; i++) {
            if (nr && run[nr-1].lvl == bits[i]) run[nr-1].dur += RMT_DMX_BIT;
            else { run[nr].lvl = bits[i]; run[nr].dur = RMT_DMX_BIT; nr++; }
        }
        int nw = 0;                                      // nr is even -> whole words
        for (int i = 0; i + 1 < nr; i += 2) {
            g_byteLut[v][nw].duration0 = run[i].dur;   g_byteLut[v][nw].level0 = run[i].lvl;
            g_byteLut[v][nw].duration1 = run[i+1].dur; g_byteLut[v][nw].level1 = run[i+1].lvl;
            nw++;
        }
        g_byteLutN[v] = (uint8_t)nw;
    }
    g_lutReady = true;
}

// Build one DMX frame into rd->sym: break/MAB word + each slot's precomputed words.
static int rmtDmxEncode(RmtDmx* rd, const uint8_t* data, int nslots) {
    if (!g_lutReady) rmtDmxBuildLut();
    int wi = 0;
    rd->sym[wi++] = g_breakWord;
    for (int s = 0; s < nslots; s++) {
        uint8_t b = data[s]; uint8_t n = g_byteLutN[b];
        if (wi + n >= RMT_DMX_MAX_SYM) break;
        for (uint8_t k = 0; k < n; k++) rd->sym[wi++] = g_byteLut[b][k];
    }
    rd->nsym = wi;
    return wi;
}

static bool rmtDmxInit(RmtDmx* rd, int gpio) {
    if (!rd->sym)   // keep the buffer across a deinit/re-init (dynamic RMT<->UART RDM switch)
        rd->sym = (rmt_symbol_word_t*)heap_caps_malloc(sizeof(rmt_symbol_word_t) * RMT_DMX_MAX_SYM,
                                                       MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL);
    if (!rd->sym) return false;
    rmt_tx_channel_config_t txc = {};
    txc.gpio_num          = (gpio_num_t)gpio;
    txc.clk_src           = RMT_CLK_SRC_DEFAULT;
    txc.resolution_hz     = RMT_DMX_RES_HZ;
    txc.trans_queue_depth = 4;
    txc.flags.invert_out  = false;
#if defined(SOC_RMT_SUPPORT_DMA) && SOC_RMT_SUPPORT_DMA
    // S2/S3 and newer: use RMT-DMA so the whole frame streams from RAM with NO refill ISR at all
    // -- fully autonomous. A big mem window keeps the DMA fed.
    txc.flags.with_dma    = true;
    txc.mem_block_symbols = 1024;
#else
    // Classic ESP32: no RMT-DMA -> one channel memory block; the driver's ISR refills it. One
    // whole channel's worth (SOC_RMT_MEM_WORDS_PER_CHANNEL) minimises how often that refill runs.
    txc.flags.with_dma    = false;
    txc.mem_block_symbols = SOC_RMT_MEM_WORDS_PER_CHANNEL;
#endif
    if (rmt_new_tx_channel(&txc, &rd->chan) != ESP_OK) return false;
    rmt_copy_encoder_config_t cec = {};
    if (rmt_new_copy_encoder(&cec, &rd->enc) != ESP_OK) return false;
    if (rmt_enable(rd->chan) != ESP_OK) return false;
    // Prime the channel with one throwaway all-zero frame so the DMX task's first real
    // transmit doesn't log a spurious "flush timeout" on a never-yet-transmitted channel.
    static const uint8_t priming[513] = {0};
    rmtDmxEncode(rd, priming, 513);
    rmt_transmit_config_t tc = {};
    tc.loop_count = 0; tc.flags.eot_level = 1;
    rmt_transmit(rd->chan, rd->enc, rd->sym, rd->nsym * sizeof(rmt_symbol_word_t), &tc);
    rmt_tx_wait_all_done(rd->chan, 200);   // absorb first-frame latency; result intentionally ignored
    return true;
}

// Encode this frame and KICK the transmission (async — the RMT driver streams it out in the
// background from rd->sym). Returns immediately, so multiple channels can be started back-to-back
// and then all run CONCURRENTLY. rd->sym must stay valid until rmtDmxWait() returns.
static void rmtDmxKick(RmtDmx* rd, const uint8_t* data, int nslots) {
    if (!rd->chan) return;
    rmtDmxEncode(rd, data, nslots);
    rmt_transmit_config_t tc = {};
    tc.loop_count      = 0;               // one-shot
    tc.flags.eot_level = 1;               // idle HIGH (DMX mark) between frames
    rmt_transmit(rd->chan, rd->enc, rd->sym, rd->nsym * sizeof(rmt_symbol_word_t), &tc);
}
// Block until this channel's frame is fully out (~23 ms + margin).
static void rmtDmxWait(RmtDmx* rd) {
    if (!rd->chan) return;
    rmt_tx_wait_all_done(rd->chan, 100);
}
// Release the RMT channel + encoder (frees the GPIO so esp_dmx can take it for an RDM
// transaction). Keeps rd->sym so a following rmtDmxInit() reuses the buffer. After this,
// rd->chan == nullptr, so rmtDmxKick/Wait become no-ops until re-init.
static void rmtDmxDeinit(RmtDmx* rd) {
    if (rd->chan) { rmt_tx_wait_all_done(rd->chan, 50); rmt_disable(rd->chan); }
    if (rd->enc)  { rmt_del_encoder(rd->enc); rd->enc = nullptr; }
    if (rd->chan) { rmt_del_channel(rd->chan); rd->chan = nullptr; }
}
// Convenience: encode + transmit + wait (blocking).
static inline void rmtDmxSend(RmtDmx* rd, const uint8_t* data, int nslots) {
    rmtDmxKick(rd, data, nslots); rmtDmxWait(rd);
}
