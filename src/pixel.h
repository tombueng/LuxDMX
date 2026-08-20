// The pixel engine: per-port framebuffers, the latch rule, power limiting and the push
// task. Mapping arithmetic lives in pixel_map.h (host-tested); the peripheral lives behind
// pixel_out.h. This file is the part that owns state.
//
// Two properties drive the design:
//
//   Nothing is allocated for a port that is off. A plain ESP32 running as a pixel node with
//   no DMX has to stay cheap on heap, so buffers are sized from the live config at apply
//   time and freed the moment a port is disabled. There are no arrays sized for the maximum.
//
//   Applying a config never takes a running rig down. Buffers for the NEW config are built
//   before the old ones are dismantled; if an allocation fails the old world keeps running
//   and the failure is reported instead. That is why every pixel field can be CFG_LIVE,
//   including the data pin and the pixel count.
#pragma once
#include <Arduino.h>
#include <string.h>
#include "esp_heap_caps.h"

#include "config_schema.h"
#include "config_enums.h"
#include "pixel_map.h"
#include "pixel_out.h"

// ---------------------------------------------------------------------------
// Per-port runtime state
// ---------------------------------------------------------------------------
struct PixPortRt {
    uint8_t*  fb        = nullptr;   // framebuffer, console order (R,G,B[,W]), count*bpp
    uint8_t*  out       = nullptr;   // fb after brightness/gamma/power, what the driver sends
    size_t    fbLen     = 0;
    uint8_t   gtab[256] = {0};       // gamma x brightness, rebuilt on apply
    uint64_t  arrived   = 0;         // bit per universe slot seen since the last latch
    uint64_t  wantMask  = 0;         // every slot this port needs for a complete frame
    uint16_t  slots     = 0;         // universes this port spans
    uint32_t  lastRxMs  = 0;
    uint32_t  frameMs   = 0;         // when the frame now assembling received its first slice
    uint32_t  lastTxMs  = 0;
    uint32_t  latches   = 0;
    uint32_t  partials  = 0;         // latched on timeout with universes missing
    uint32_t  estMa     = 0;         // last frame's estimate
    uint32_t  worstMa   = 0;         // all channels at 255
    uint16_t  scale     = 256;       // power-cap scale actually applied (256 = none)
    float     inFps     = 0.0f;
    uint32_t  inWinMs   = 0;
    uint16_t  inCnt     = 0;
    float     outFps    = 0.0f;
    uint32_t  outWinMs  = 0;
    uint16_t  outCnt    = 0;
    bool      srcLost   = true;
    bool      dirty     = false;
};

static PixPortRt g_pix[MAX_PIXEL_PORTS];
static bool      g_pixAnyEnabled = false;
static uint32_t  g_pixSyncSeq    = 0;   // bumped by ArtSync / E1.31 sync (see artnet_rdm.h)
static uint32_t  g_pixSyncSeen   = 0;

// A frame that has waited this long with universes still missing is pushed anyway, with the
// absent slices holding their previous content. One lost packet then costs a stale slice for
// one frame instead of a dropped frame across every port, which is the behaviour a strip
// wants: a latching LED holds whatever it was last told, so never pushing is the worst case.
static constexpr uint32_t PIX_LATCH_TIMEOUT_MS = 120;
// No source at all for this long and the loss policy applies.
static constexpr uint32_t PIX_SRC_TIMEOUT_MS = 4000;

static inline int pixBpp(int port) { return pixBytesPerPixel(cfg.pixels[port].chip); }

static void pixelService();                 // fwd decl (the task body, defined below)
static TaskHandle_t g_pixTask = nullptr;

// Apply/service handshake. pixelApply() runs on the loop task and FREES the framebuffers;
// pixelService() runs on the pixel task and READS them. Without this the two race and the
// device reboots the moment a pixel setting is changed while a source is streaming -- which
// is exactly how it behaved before this was added.
//
// Cooperative rather than vTaskSuspend(): suspending a task running on the other core can
// stop it mid-function with a pointer already loaded, which does not make the free any safer.
// Here the service loop simply declines to start while a change is pending, and the applier
// waits for any in-flight pass to finish before touching a pointer.
// There are TWO readers of the framebuffers, on two different cores: the push task
// (pixelService, core 1) and the network task (pixelWriteSlice, core 0, via routeFrame). Both
// have to be out before a pointer is freed, so this is a reader count rather than a single
// flag, and it is atomic because the two cores increment it concurrently.
static volatile bool g_pixPause   = false;   // apply pending: readers must not start
static volatile int  g_pixReaders = 0;       // readers currently inside the buffers

static inline bool pixReadEnter() {
    if (g_pixPause) return false;
    __atomic_fetch_add(&g_pixReaders, 1, __ATOMIC_SEQ_CST);
    if (g_pixPause) {                        // set between the check and the increment
        __atomic_fetch_sub(&g_pixReaders, 1, __ATOMIC_SEQ_CST);
        return false;
    }
    return true;
}
static inline void pixReadExit() { __atomic_fetch_sub(&g_pixReaders, 1, __ATOMIC_SEQ_CST); }

static void pixelPauseBegin() {
    g_pixPause = true;
    __sync_synchronize();
    // Readers hold the buffers for microseconds (a memcpy or two), so this returns almost
    // immediately; the bound only exists so a wedged reader cannot hang a config save.
    for (int i = 0; i < 200 && __atomic_load_n(&g_pixReaders, __ATOMIC_SEQ_CST) > 0; i++)
        vTaskDelay(pdMS_TO_TICKS(1));
}
static void pixelPauseEnd() { g_pixPause = false; }

// The push task. Created lazily, the first time a port is actually enabled, so a DMX-only
// box never pays for its stack. Priority 6 on core 1: comfortably below the DMX task's 19,
// so a pixel frame can never delay a DMX break, and off core 0 where lwIP lives.
static void pixelTaskBody(void*) {
    TickType_t next = xTaskGetTickCount();
    for (;;) {
        vTaskDelayUntil(&next, pdMS_TO_TICKS(2));
        pixelService();
    }
}
static void pixelStartTask() {
    if (g_pixTask || !g_pixAnyEnabled) return;
    xTaskCreatePinnedToCore(pixelTaskBody, "pixel", 4096, nullptr, 6, &g_pixTask, 1);
    Serial.println("[PIX] push task started");
}

// ---------------------------------------------------------------------------
// Apply: build the new world, then swap
// ---------------------------------------------------------------------------
// Returns false and leaves the running config untouched if anything could not be allocated.
// `err` gets a message with the numbers in it, because "pixel port 3: needs 8160 B, only
// 4112 B free" is actionable and "failed" is not.
static bool pixelApply(String& err) {
    uint8_t* newFb[MAX_PIXEL_PORTS]  = {nullptr};
    uint8_t* newOut[MAX_PIXEL_PORTS] = {nullptr};
    size_t   newLen[MAX_PIXEL_PORTS] = {0};
    bool     ok = true;

    for (int p = 0; p < MAX_PIXEL_PORTS && ok; p++) {
        const PixelPort& c = cfg.pixels[p];
        if (!c.enabled || c.pin < 0 || c.count <= 0) continue;
        const size_t len = (size_t)c.count * pixBytesPerPixel(c.chip);
        // Prefer PSRAM: on a board that has it these can be generous, and on one that does
        // not the internal fallback keeps a modest strip working.
        uint8_t* a = (uint8_t*)heap_caps_calloc(len, 1, MALLOC_CAP_SPIRAM);
        if (!a) a = (uint8_t*)heap_caps_calloc(len, 1, MALLOC_CAP_8BIT);
        uint8_t* b = (uint8_t*)heap_caps_calloc(len, 1, MALLOC_CAP_SPIRAM);
        if (!b) b = (uint8_t*)heap_caps_calloc(len, 1, MALLOC_CAP_8BIT);
        if (!a || !b) {
            if (a) heap_caps_free(a);
            if (b) heap_caps_free(b);
            err = String("pixel port ") + (p + 1) + ": needs " + (unsigned)(len * 2)
                + " B, largest free block " + (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
            ok = false;
            break;
        }
        newFb[p] = a; newOut[p] = b; newLen[p] = len;
    }

    if (!ok) {   // nothing has been touched yet; drop the half-built world and keep running
        for (int p = 0; p < MAX_PIXEL_PORTS; p++) {
            if (newFb[p])  heap_caps_free(newFb[p]);
            if (newOut[p]) heap_caps_free(newOut[p]);
        }
        return false;
    }

    // Swap in. From here on nothing can fail, so the running state is never left half-built.
    // Hold the push task off first: everything below frees buffers it may be reading.
    pixelPauseBegin();
    PixOutPort ports[MAX_PIXEL_PORTS];
    int n = 0;
    g_pixAnyEnabled = false;
    for (int p = 0; p < MAX_PIXEL_PORTS; p++) {
        PixPortRt& rt = g_pix[p];
        uint8_t* oldFb = rt.fb; uint8_t* oldOut = rt.out;
        rt.fb = newFb[p]; rt.out = newOut[p]; rt.fbLen = newLen[p];
        if (oldFb)  heap_caps_free(oldFb);
        if (oldOut) heap_caps_free(oldOut);

        const PixelPort& c = cfg.pixels[p];
        rt.arrived = 0; rt.dirty = false; rt.srcLost = true;
        rt.slots = 0; rt.wantMask = 0;
        if (!rt.fb) {
            // A port that just went off must stop describing a frame it no longer has. These
            // numbers are the last live frame's, and left standing they show up in
            // /pixels.json and the power readout as a disabled port still drawing current.
            rt.estMa = 0; rt.worstMa = 0; rt.scale = 256;
            rt.latches = 0; rt.partials = 0;
            rt.inFps = 0.0f; rt.outFps = 0.0f; rt.inCnt = 0; rt.outCnt = 0;
            continue;
        }

        rt.slots = (uint16_t)pixUniverseSpan(c.chip, c.uniMode, c.count, c.startCh);
        rt.wantMask = rt.slots >= 64 ? ~0ULL : ((1ULL << rt.slots) - 1ULL);
        pixBuildGamma(rt.gtab, c.gamma, c.bright);
        rt.worstMa = pixWorstCaseMa(c.count, pixBytesPerPixel(c.chip), c.mAPerCh, c.quiesMa);
        // Re-render what the port is already holding. Brightness, gamma, colour order and the
        // power cap all change how the SAME framebuffer looks, and a WS281x strip keeps showing
        // its last frame until it is given a new one -- so without this, moving the brightness
        // slider changes nothing on a strip whose source has gone quiet, and the setting looks
        // broken. Costs one frame.
        rt.dirty = true;
        g_pixAnyEnabled = true;
        ports[n].pin = c.pin; ports[n].count = c.count;
        ports[n].chip = c.chip; ports[n].order = c.order;
        n++;
    }

    pixOutEnd();
    const PixBackend want = (cfg.pixBackend == 1) ? PIXBK_RMT
                          : (cfg.pixBackend == 2) ? PIXBK_LCD : PIXBK_NONE;
    bool backendOk;
    if (n == 0) {
        backendOk = true;
    } else if (want == PIXBK_NONE && pixLcdPreferred()) {
        // Automatic, on a box with PSRAM: take LCD_CAM even though RMT would fit. RMT's only
        // advantage is that it is cheap in RAM, and that stops mattering with megabytes of
        // external RAM to spend -- while its disadvantage does not: a lane that misses the one
        // DMA channel (DMX takes it first) is refilled from an ISR and glitches the same few
        // LEDs under load. That cost a night of bench time to find, and nothing in the UI hinted
        // at it. Fall through to the normal RMT-first path if LCD_CAM cannot serve these ports,
        // e.g. because they are not all the same LED chip.
        backendOk = (pixOutBegin(ports, n, PIXBK_LCD) != PIXBK_NONE)
                 || (pixOutBegin(ports, n, PIXBK_NONE) != PIXBK_NONE);
    } else {
        backendOk = (pixOutBegin(ports, n, want) != PIXBK_NONE);
    }
    pixelPauseEnd();
    if (!backendOk) {
        err = (cfg.pixBackend == 0)
            ? "no pixel backend available: out of RMT channels for this many ports"
            : "the pixel driver you forced cannot serve this many ports on this chip";
        return false;      // buffers stay, the driver simply is not running
    }
    if (n > 0) Serial.printf("[PIX] %d port(s) on the %s backend\n", n, pixOutBackendName());
    pixelStartTask();      // no-op once running; nothing is created for a board with no pixels
    return true;
}

// Index of port p among the ENABLED ports, which is the index the backend knows it by.
static int pixBackendIndex(int port) {
    int n = 0;
    for (int p = 0; p < MAX_PIXEL_PORTS; p++) {
        if (!g_pix[p].fb) continue;
        if (p == port) return n;
        n++;
    }
    return -1;
}

// ---------------------------------------------------------------------------
// Receive: one universe slice into a port's framebuffer
// ---------------------------------------------------------------------------
// Called from routeFrame() on the network task. Writes straight through -- there is no
// per-source cache for pixels, because they do not merge.
static void pixelWriteSlice(int port, uint16_t uniSlot, const uint8_t* src, uint16_t srcOff,
                            uint16_t dstOff, uint16_t len, uint16_t srcLen) {
    // Bounds-check the port before it indexes anything. `port` comes from a sink row, and the
    // sink table is rebuilt on the loop task while routeFrame() is walking it on the network
    // task -- so a reader can momentarily see a half-written row and hand us a nonsense index.
    // Everything else here is already clamped; this was the one unchecked path into g_pix[].
    if (port < 0 || port >= MAX_PIXEL_PORTS) return;
    if (!pixReadEnter()) return;                        // a config apply is swapping buffers
    PixPortRt& rt = g_pix[port];
    if (!rt.fb || dstOff >= rt.fbLen) { pixReadExit(); return; }
    if (srcOff >= srcLen) { pixReadExit(); return; }    // the source did not send this far
    uint16_t n = len;
    if ((size_t)dstOff + n > rt.fbLen) n = (uint16_t)(rt.fbLen - dstOff);
    if (srcOff + n > srcLen) n = (uint16_t)(srcLen - srcOff);
    if (!n) { pixReadExit(); return; }
    memcpy(rt.fb + dstOff, src + srcOff, n);
    if (uniSlot < 64) rt.arrived |= (1ULL << uniSlot);
    // Stamp when THIS frame began assembling, i.e. the first slice after the last latch. The
    // completion timeout is measured from here and not from the last packet: a source that
    // streams one universe continuously while another never arrives would otherwise keep
    // pushing the deadline out forever and the port would never light at all.
    if (!rt.dirty) rt.frameMs = millis();
    rt.dirty = true;
    rt.srcLost = false;
    rt.lastRxMs = millis();
    rt.inCnt++;
    const uint32_t now = rt.lastRxMs;
    if (now - rt.inWinMs >= 1000) {
        rt.inFps = (float)rt.inCnt * 1000.0f / (float)(now - rt.inWinMs);
        rt.inCnt = 0; rt.inWinMs = now;
    }
    pixReadExit();
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------
// Build the output buffer for one port: colour data -> gamma/brightness -> power cap.
static void pixelBuildOut(int port) {
    PixPortRt& rt = g_pix[port];
    const PixelPort& c = cfg.pixels[port];
    if (!rt.fb || !rt.out) return;

    for (size_t i = 0; i < rt.fbLen; i++) rt.out[i] = rt.gtab[rt.fb[i]];

    rt.estMa = pixEstimateMa(rt.out, rt.fbLen, c.count, c.mAPerCh, c.quiesMa);
    const uint32_t idleMa = ((uint32_t)c.count * (uint32_t)c.quiesMa) / 100;
    rt.scale = (uint16_t)pixPowerScale(rt.estMa, idleMa, c.maxMa);
    if (rt.scale < 256) {
        for (size_t i = 0; i < rt.fbLen; i++)
            rt.out[i] = (uint8_t)(((uint32_t)rt.out[i] * rt.scale) >> 8);
        rt.estMa = pixEstimateMa(rt.out, rt.fbLen, c.count, c.mAPerCh, c.quiesMa);
    }
}

// Should this port latch now? See docs/pixels.md.
static bool pixelShouldLatch(int port, uint32_t now) {
    PixPortRt& rt = g_pix[port];
    const PixelPort& c = cfg.pixels[port];
    if (!rt.fb) return false;

    // Rate cap first: it applies whatever the policy is.
    if (c.fpsCap > 0) {
        const uint32_t minGap = 1000u / (uint32_t)c.fpsCap;
        if (now - rt.lastTxMs < minGap) return false;
    }
    switch (c.latch) {
        case PIX_LATCH_FREERUN: {
            const uint32_t period = c.fpsCap > 0 ? (1000u / (uint32_t)c.fpsCap) : 25u;
            return (now - rt.lastTxMs) >= period && (rt.dirty || !rt.srcLost);
        }
        case PIX_LATCH_SYNC:
            if (g_pixSyncSeq != g_pixSyncSeen) return rt.dirty;
            return rt.dirty && (now - rt.frameMs) >= PIX_LATCH_TIMEOUT_MS;
        case PIX_LATCH_COMPLETE:
        default:
            if (!rt.dirty) return false;
            if (rt.wantMask && (rt.arrived & rt.wantMask) == rt.wantMask) return true;
            // Timeout, measured from when this frame started assembling. Push what we have
            // rather than stall: the missing universes keep their previous content, so a lost
            // packet costs one stale slice for one frame instead of the whole frame across
            // every port. A latching strip holds whatever it was last told, so never pushing
            // is by far the worst outcome available.
            if (now - rt.frameMs >= PIX_LATCH_TIMEOUT_MS) { rt.partials++; return true; }
            return false;
    }
}

// Signal loss: a latching strip holds its last frame on its own, so HOLD is genuinely free
// and only ZERO needs us to do anything.
static void pixelApplyLoss(int port) {
    PixPortRt& rt = g_pix[port];
    if (!rt.fb) return;
    if (cfg.pixels[port].lossMode == LOSS_ZERO) {
        memset(rt.fb, 0, rt.fbLen);
        rt.dirty = true;
    }
}

// The push task's body: called on a tick, decides and clocks. Runs BELOW the DMX task's
// priority, so a pixel frame can never delay a DMX break.
static void pixelService() {
    if (!g_pixAnyEnabled) return;
    if (!pixReadEnter()) return;
    const uint32_t now = millis();

    for (int p = 0; p < MAX_PIXEL_PORTS; p++) {
        PixPortRt& rt = g_pix[p];
        if (!rt.fb) continue;
        if (!rt.srcLost && now - rt.lastRxMs > PIX_SRC_TIMEOUT_MS) {
            rt.srcLost = true;
            pixelApplyLoss(p);
        }
    }

    if (pixOutBusy()) { pixReadExit(); return; }

    const uint8_t* bufs[MAX_PIXEL_PORTS] = {nullptr};
    uint16_t counts[MAX_PIXEL_PORTS] = {0};
    bool any = false;
    int  bi = 0;
    for (int p = 0; p < MAX_PIXEL_PORTS; p++) {
        PixPortRt& rt = g_pix[p];
        if (!rt.fb) continue;
        if (pixelShouldLatch(p, now)) {
            pixelBuildOut(p);
            bufs[bi] = rt.out; counts[bi] = (uint16_t)cfg.pixels[p].count;
            rt.arrived = 0; rt.dirty = false; rt.lastTxMs = now; rt.latches++;
            rt.outCnt++;
            if (now - rt.outWinMs >= 1000) {
                rt.outFps = (float)rt.outCnt * 1000.0f / (float)(now - rt.outWinMs);
                rt.outCnt = 0; rt.outWinMs = now;
            }
            any = true;
        } else {
            // Parallel backends clock every lane together, so a port that is not latching
            // still has to hand over its current output or it would go dark.
            bufs[bi] = rt.out; counts[bi] = (uint16_t)cfg.pixels[p].count;
        }
        bi++;
    }
    if (any) {
        g_pixSyncSeen = g_pixSyncSeq;
        pixOutPush(bufs, counts);
    }
    pixReadExit();
}
