// RMT-based DMX512 transmit (issue #64 hard-zero-under-load path).
//
// Why: esp_dmx clocks DMX with the UART + a GPTimer ISR for the break/MAB. Under heavy
// core-0 network DMA the timer ISR can be delayed and a frame's break comes out malformed
// (framing errors). The RMT peripheral instead clocks a (level,duration) symbol stream out
// ENTIRELY IN HARDWARE -- the timing is the RMT's own clock. The IDF RMT driver's ISR refills
// the channel memory as it drains, asking our encoder (dmx_rmt_enc.h) for the next symbols; if
// that refill is ever late the RMT just idles the line (a benign extra mark) instead of
// corrupting a break. So RMT DMX is far more contention-proof.
//
// Resolution 1 MHz => 1 tick = 1 us. A DMX bit is 4 us = exactly 4 ticks (hardware-exact,
// no jitter). Break = 176 us, MAB = 12 us. Line idles HIGH (DMX mark) between frames.
#pragma once
#include "driver/rmt_tx.h"
#include "driver/rmt_encoder.h"
#include "dmx_rmt_enc.h"

#define RMT_DMX_RES_HZ   1000000u   // 1 tick = 1 us
#define RMT_DMX_SLOTS    513        // start code + 512; also the longest RDM packet fits

struct RmtDmx {
    rmt_channel_handle_t chan  = nullptr;
    rmt_encoder_handle_t enc   = nullptr;
    uint8_t*             frame = nullptr;   // the bytes going out right now (DRAM)
    DmxEncPos            at    = {0, 0};    // where the encoder is in the frame
};

// The RMT driver's encoder callback (IRAM, it runs in the refill interrupt). `data` is rd->frame.
static IRAM_ATTR size_t rmtDmxEncCb(const void* data, size_t n, size_t written, size_t room,
                                    rmt_symbol_word_t* out, bool* done, void* arg) {
    return dmxEncStep((const uint8_t*)data, n, written, room, out, done, &((RmtDmx*)arg)->at);
}

// Copy the frame into rd->frame and start sending it. The RMT reads rd->frame until the frame is
// out, which is why the caller's buffer is copied: the DMX task reuses its staging buffer for the
// next output straight away.
static void rmtDmxStart(RmtDmx* rd, const uint8_t* data, int nslots) {
    if (nslots > RMT_DMX_SLOTS) nslots = RMT_DMX_SLOTS;
    if (nslots < 1) return;
    memcpy(rd->frame, data, nslots);
    rmt_transmit_config_t tc = {};
    tc.loop_count      = 0;               // one-shot
    tc.flags.eot_level = 1;               // idle HIGH (DMX mark) between frames
    rmt_transmit(rd->chan, rd->enc, rd->frame, nslots, &tc);
}

static bool rmtDmxInit(RmtDmx* rd, int gpio) {
    if (!g_lutReady) rmtDmxBuildLut();   // before any transmit: the encoder only reads the table
    if (!rd->frame)  // keep the buffer across a re-init
        rd->frame = (uint8_t*)heap_caps_malloc(RMT_DMX_SLOTS, MALLOC_CAP_8BIT | MALLOC_CAP_INTERNAL);
    if (!rd->frame) return false;
    rmt_tx_channel_config_t txc = {};
    txc.gpio_num          = (gpio_num_t)gpio;
    txc.clk_src           = RMT_CLK_SRC_DEFAULT;
    txc.resolution_hz     = RMT_DMX_RES_HZ;
    txc.trans_queue_depth = 4;
    txc.flags.invert_out  = false;
#if defined(SOC_RMT_SUPPORT_DMA) && SOC_RMT_SUPPORT_DMA
    // The S3 (and S2/C-series) has exactly ONE DMA-capable RMT TX channel -- the IDF driver comment
    // is blunt about it: "Only the last channel has the DMA capability". So the FIRST output claims
    // DMA (whole frame streams from RAM, zero refill ISR, fully autonomous); any FURTHER output can't
    // get a second DMA channel ("no free tx channels") and falls back to the non-DMA refill-ISR path.
    // That is fine here: this build separates cores (DMX on core 1, network on core 0), so the refill
    // ISR on core 1 isn't exposed to the issue-#64 network-DMA contention that made DMA necessary in
    // the first place. Without this fallback, out1 failed to init on the S3 and the 2nd universe was dead.
    //
    // One memory block each, like the classic ESP32. A block is a whole channel's worth: the S3 has
    // four, and the DMA output already holds one. This used to ask for two (half the refill rate),
    // which left out2 only one block, so it never started on the carrier, and broke the RMT budget
    // pixel_out.h counts on (one channel per DMX output: 3 DMX + 1 RMT pixel port fits).
    txc.flags.with_dma    = true;
    txc.mem_block_symbols = 1024;
    if (rmt_new_tx_channel(&txc, &rd->chan) != ESP_OK) {
        txc.flags.with_dma    = false;
        txc.mem_block_symbols = SOC_RMT_MEM_WORDS_PER_CHANNEL;
        if (rmt_new_tx_channel(&txc, &rd->chan) != ESP_OK) return false;
    }
#else
    // Classic ESP32: no RMT-DMA -> one channel memory block; the driver's ISR refills it. One
    // whole channel's worth (SOC_RMT_MEM_WORDS_PER_CHANNEL) minimises how often that refill runs.
    txc.flags.with_dma    = false;
    txc.mem_block_symbols = SOC_RMT_MEM_WORDS_PER_CHANNEL;
    if (rmt_new_tx_channel(&txc, &rd->chan) != ESP_OK) return false;
#endif
    rmt_simple_encoder_config_t sec = {};
    sec.callback       = rmtDmxEncCb;
    sec.arg            = rd;
    sec.min_chunk_size = RMT_MAX_WORDS_PER_BYTE;   // only sizes the driver's overflow buffer, which dmxEncStep never needs
    if (rmt_new_simple_encoder(&sec, &rd->enc) != ESP_OK) return false;
    if (rmt_enable(rd->chan) != ESP_OK) return false;
    // Prime the channel with one throwaway all-zero frame so the DMX task's first real
    // transmit doesn't log a spurious "flush timeout" on a never-yet-transmitted channel.
    static const uint8_t priming[RMT_DMX_SLOTS] = {0};
    rmtDmxStart(rd, priming, RMT_DMX_SLOTS);
    rmt_tx_wait_all_done(rd->chan, 200);   // absorb first-frame latency; result intentionally ignored
    return true;
}

// KICK this frame's transmission (async — the RMT driver streams it out in the background,
// encoding as it goes). Returns immediately, so multiple channels can be started back-to-back
// and then all run CONCURRENTLY.
static void rmtDmxKick(RmtDmx* rd, const uint8_t* data, int nslots) {
    if (!rd->chan) return;
    rmtDmxStart(rd, data, nslots);
}
// Block until this channel's frame is fully out (~23 ms + margin).
static void rmtDmxWait(RmtDmx* rd) {
    if (!rd->chan) return;
    rmt_tx_wait_all_done(rd->chan, 100);
}
// Non-blocking "is the previous frame fully clocked out?". The transmit task uses this instead of
// blocking, so two outputs running at DIFFERENT rates (issue #93) never delay each other: waiting
// ~23 ms for port A would push port B's due time and hand it exactly the timing jitter we are trying
// to remove. Must be checked before every kick, because a kick rewrites rd->frame in place and
// the RMT is still encoding out of that buffer until it reports done.
static bool rmtDmxIdle(RmtDmx* rd) {
    if (!rd->chan) return false;
    return rmt_tx_wait_all_done(rd->chan, 0) == ESP_OK;
}
// (rmtDmxDeinit() lived here to hand the GPIO back for an esp_dmx RDM transaction. RDM runs on
// RMT-TX + a RX-only UART now, so the channel is never released and the helper had no callers.)
// Convenience: encode + transmit + wait (blocking).
static inline void rmtDmxSend(RmtDmx* rd, const uint8_t* data, int nslots) {
    rmtDmxKick(rd, data, nslots); rmtDmxWait(rd);
}
