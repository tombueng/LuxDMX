// Host test for src/dmx_rmt_enc.h (issue #135): the DMX/RDM frame the RMT sends is now encoded
// piece by piece while it goes out, instead of into a 12 KB buffer first. The wire must not change.
//
// Two checks per frame. The symbols have to come out exactly as the old whole-frame encoder wrote
// them (break word, then every slot's table words). And, independently of the table, the levels
// they describe have to be the UART frame itself, microsecond by microsecond: break 176 low,
// MAB 12 high, then per slot a 4 us start bit, 8 data bits LSB first and 8 us of stop bits.
//
// The pieces are pulled the way IDF 5.5's simple encoder does it (rmt_encoder_simple.c), at the
// room sizes the boards use, overflow buffer and all. That includes its habit of dropping what's
// left in the overflow buffer when the last slot landed there and the memory filled first, which
// is why dmxEncStep never returns 0. The last check shows this sim really does lose the tail for
// an encoder that only writes whole slots.
#include "dmx_rmt_enc.h"
#include <cstdio>
#include <cstdlib>
#include <vector>

static int g_pass = 0, g_fail = 0;
#define CHECK(cond, ...) do { if (cond) { g_pass++; } else { g_fail++; printf("  FAIL: "); printf(__VA_ARGS__); printf("\n"); } } while (0)

// What v1.0.277 built into rd->sym before every frame.
static std::vector<uint32_t> wholeFrame(const uint8_t* d, size_t n) {
    std::vector<uint32_t> v{g_breakWord.val};
    for (size_t s = 0; s < n; s++)
        for (int k = 0; k < g_byteLutN[d[s]]; k++) v.push_back(g_byteLut[d[s]][k].val);
    return v;
}

// The line level for every microsecond of the frame, straight from the UART framing.
static std::vector<uint8_t> uartLevels(const uint8_t* d, size_t n) {
    std::vector<uint8_t> t(RMT_DMX_BREAK, 0);
    t.insert(t.end(), RMT_DMX_MAB, 1);
    for (size_t s = 0; s < n; s++) {
        t.insert(t.end(), RMT_DMX_BIT, 0);
        for (int b = 0; b < 8; b++) t.insert(t.end(), RMT_DMX_BIT, (d[s] >> b) & 1);
        t.insert(t.end(), 2 * RMT_DMX_BIT, 1);
    }
    return t;
}

static std::vector<uint8_t> symLevels(const std::vector<uint32_t>& sym, bool* zeroDur) {
    std::vector<uint8_t> t;
    *zeroDur = false;
    for (uint32_t v : sym) {
        rmt_symbol_word_t w; w.val = v;
        if (!w.duration0 || !w.duration1) *zeroDur = true;   // a zero duration ends the RMT stream
        t.insert(t.end(), w.duration0, w.level0);
        t.insert(t.end(), w.duration1, w.level1);
    }
    return t;
}

// The old rule, whole slots only, returning 0 when the next one doesn't fit. Only here to show
// what the IDF does to it.
static size_t wholeSlotStep(const uint8_t* d, size_t n, size_t written, size_t room,
                            rmt_symbol_word_t* out, bool* done, DmxEncPos* at) {
    size_t w = 0;
    if (written == 0) { if (!room) return 0; out[w++] = g_breakWord; at->slot = 0; }
    while (at->slot < n) {
        const uint8_t b = d[at->slot], k = g_byteLutN[b];
        if (w + k > room) break;
        for (uint8_t i = 0; i < k; i++) out[w++] = g_byteLut[b][i];
        at->slot++;
    }
    if (at->slot >= n) *done = true;
    return w;
}

typedef size_t (*StepFn)(const uint8_t*, size_t, size_t, size_t, rmt_symbol_word_t*, bool*, DmxEncPos*);

// rmt_encode_simple(): fill `first` symbols, then `refill` at a time, until it reports the frame
// complete. Mirrors the IDF loop line by line, including the overflow buffer (min_chunk_size).
static std::vector<uint32_t> pulled(StepFn step, const uint8_t* d, size_t n, size_t first, size_t refill,
                                    bool* ok, int* ovfUsed) {
    std::vector<uint32_t> out;
    rmt_symbol_word_t mem[1024], ovf[RMT_MAX_WORDS_PER_BYTE];
    DmxEncPos at = {12345, 7};   // garbage: the first call has to reset it
    size_t last = 0, ovfLen = 0, ovfAt = 0, room = first;
    bool cbDone = false;
    *ok = true; *ovfUsed = 0;
    for (int guard = 0; guard < 100000; guard++) {
        size_t off = 0;
        bool isDone = false;
        while (off < room) {
            if (ovfAt < ovfLen) { mem[off++] = ovf[ovfAt++]; continue; }
            if (cbDone) { isDone = true; break; }
            size_t got = step(d, n, last, room - off, &mem[off], &isDone, &at);
            off += got; last += got;
            if (isDone) break;
            if (got == 0) {
                (*ovfUsed)++;
                got = step(d, n, last, RMT_MAX_WORDS_PER_BYTE, ovf, &isDone, &at);
                last += got; ovfLen = got; ovfAt = 0;
                if (isDone) cbDone = true;
                else if (got == 0) { *ok = false; return out; }   // the IDF aborts the frame here
            }
        }
        for (size_t i = 0; i < off; i++) out.push_back(mem[i].val);
        if (isDone) return out;                                // COMPLETE: anything still in ovf is gone
        room = refill;
    }
    *ok = false;
    return out;
}

int main() {
    rmtDmxBuildLut();
    uint8_t maxWords = 0;
    for (int v = 0; v < 256; v++) if (g_byteLutN[v] > maxWords) maxWords = g_byteLutN[v];
    CHECK(maxWords <= RMT_MAX_WORDS_PER_BYTE, "a byte needs %u words, more than RMT_MAX_WORDS_PER_BYTE", maxWords);

    // Room sizes: classic ESP32 (one 64-word block, refilled by halves), S3 without DMA
    // (48 / 24), S3 DMA (1024 / 512), and some awkward ones.
    const size_t rooms[][2] = {{64, 32}, {48, 24}, {1024, 512}, {7, 7}, {13, 5}, {1, 1}};
    std::vector<std::vector<uint8_t>> frames;
    for (int f : {0x00, 0x55, 0xAA, 0xFF, 0x01, 0x80}) frames.push_back(std::vector<uint8_t>(513, (uint8_t)f));
    srand(135);
    for (int i = 0; i < 300; i++) {
        size_t n = (i % 3 == 0) ? 513 : 1 + rand() % 513;   // full DMX frames, and RDM-sized packets
        std::vector<uint8_t> f(n);
        for (auto& b : f) b = (uint8_t)rand();
        frames.push_back(f);
    }
    frames.push_back({0xCC});   // a lone RDM start code

    for (const auto& f : frames) {
        const auto want = wholeFrame(f.data(), f.size());
        const auto lv   = uartLevels(f.data(), f.size());
        for (const auto& r : rooms) {
            bool ok, zero; int ovf;
            const auto got = pulled(dmxEncStep, f.data(), f.size(), r[0], r[1], &ok, &ovf);
            CHECK(ok && got == want, "frame of %zu slots, room %zu/%zu: symbols differ from the whole-frame encoder", f.size(), r[0], r[1]);
            CHECK(ok && symLevels(got, &zero) == lv && !zero, "frame of %zu slots, room %zu/%zu: not the UART frame on the wire", f.size(), r[0], r[1]);
            CHECK(ovf == 0, "frame of %zu slots, room %zu/%zu: needed the overflow buffer %d times", f.size(), r[0], r[1], ovf);
        }
    }

    // Back to back on one channel: every frame starts over at the break, whatever came before.
    {
        DmxEncPos at = {0, 0}; bool done = false;
        rmt_symbol_word_t buf[4];
        const uint8_t a[3] = {0x55, 0x55, 0x55};
        dmxEncStep(a, 3, 0, 4, buf, &done, &at);   // first frame stops part way, mid slot
        done = false;
        size_t got = dmxEncStep(a, 3, 0, 4, buf, &done, &at);
        CHECK(got == 4 && buf[0].val == g_breakWord.val && buf[1].val == g_byteLut[0x55][0].val && !done,
              "a new frame (written == 0) starts with the break and slot 0 again");
    }

    // The trap this encoder avoids: whole slots only, and the IDF loses the end of the frame.
    {
        std::vector<uint8_t> f(513, 0x55);
        bool ok; int ovf;
        const auto got = pulled(wholeSlotStep, f.data(), f.size(), 7, 7, &ok, &ovf);
        CHECK(ovf > 0 && got.size() < wholeFrame(f.data(), f.size()).size(),
              "control: a whole-slot encoder should lose the tail in this sim (got %zu symbols)", got.size());
    }

    printf("dmx encoder: %d passed, %d failed\n", g_pass, g_fail);
    return g_fail ? 1 : 0;
}
