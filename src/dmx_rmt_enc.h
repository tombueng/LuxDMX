#pragma once
// DMX512 / RDM frame -> RMT symbols, produced while the frame is going out (issue #135).
// Pure logic: the RMT encoder callback in dmx_rmt.h and the host test both run it.
//
// A UART byte is start(0) + 8 data (LSB first) + 2 stop(1). Run-length encoded it always starts
// with a low run and ends with a high one, so it is a whole number of rmt_symbol_word_t (two runs
// each), whatever the neighbouring bytes are. Each byte value's words are worked out once into a
// table, and a frame is the break/MAB word followed by every slot's words from that table.
//
// That stream used to be written into a 12 KB buffer per output before every frame. Now the RMT
// driver asks for the next symbols as it needs them (from its refill interrupt) and they come
// straight out of the table, so an output only keeps its slot bytes. On a classic ESP32 with WiFi
// those buffers were most of the heap the web UI needed.
#include <stdint.h>
#include <stddef.h>
#if defined(ESP_PLATFORM)
#include "hal/rmt_types.h"
#include "esp_attr.h"
#else
typedef union {
    struct { uint16_t duration0 : 15; uint16_t level0 : 1; uint16_t duration1 : 15; uint16_t level1 : 1; };
    uint32_t val;
} rmt_symbol_word_t;
#define IRAM_ATTR
#endif

#define RMT_DMX_BIT      4          // 4 us per bit @250 kbaud
#define RMT_DMX_BREAK    176        // break low, us
#define RMT_DMX_MAB      12         // mark-after-break high, us
// Most words a byte can take (0x55: ten runs = five words), with one to spare.
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

// Where the encoder is in a frame: the slot, and the word within that slot's table entry.
struct DmxEncPos { size_t slot; uint8_t word; };

// The next piece of a frame (break/MAB word, then n slots) into out[0..room). `written` is how
// many symbols this frame has had so far, 0 on the first call, which starts it over. Returns the
// symbol count and sets *done after the last word of the last slot.
//
// It always fills the room it's given, splitting a slot across two calls when it has to. That
// matters: if the encoder returns 0, the IDF (5.5) simple encoder has it write into a small
// overflow buffer instead, and when the frame's last slot ends up there and the RMT memory fills
// before that buffer is drained, the rest of it is dropped. The frame would lose its last slot.
// Runs in the RMT interrupt, so: IRAM, no library calls, and the table must be built beforehand.
static IRAM_ATTR size_t dmxEncStep(const uint8_t* data, size_t n, size_t written, size_t room,
                                   rmt_symbol_word_t* out, bool* done, DmxEncPos* at) {
    size_t w = 0;
    if (written == 0) {
        if (room < 1) return 0;
        out[w++] = g_breakWord;
        at->slot = 0; at->word = 0;
    }
    size_t s = at->slot;
    uint8_t k = at->word;
    while (s < n && w < room) {
        const uint8_t b = data[s], nw = g_byteLutN[b];
        while (k < nw && w < room) out[w++] = g_byteLut[b][k++];
        if (k == nw) { s++; k = 0; }
    }
    at->slot = s; at->word = k;
    if (s >= n) *done = true;
    return w;
}
