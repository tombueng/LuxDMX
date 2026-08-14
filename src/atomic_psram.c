// Fallback implementations of the two atomic helpers a PSRAM build needs.
//
// On the ESP32-S3 the atomic compare-and-swap instruction (S32C1I) does not work on external
// RAM, so as soon as PSRAM is enabled the toolchain is invoked with -mdisable-hardware-atomics
// and GCC stops inlining atomics: every __atomic_* becomes a library call. Those calls come
// from std::shared_ptr's reference count, so they turn up all over the framework (FS,
// NetworkClient, AsyncWebServer, AsyncTCP) as well as our own pixel reader handshake.
//
// Whether anything answers them depends on how the framework was built. A full IDF source build
// compiles newlib/src/stdatomic.c and provides them; a link against the precompiled esp32s3
// libs does not, and the build dies with
//
//     ext/atomicity.h:71: undefined reference to `__atomic_fetch_add_4'
//
// while the SAME file on a classic ESP32 always ships them, so an unconditional definition here
// fails esp32dev with "multiple definition". Hence `weak`: any real implementation the framework
// brings along wins at link time, and when there is none, these take over. No target guard, no
// build-order assumptions, and nothing to remember when a framework version changes.
//
// A critical section is the right primitive: portENTER_CRITICAL_SAFE takes a spinlock (so the
// other core cannot interleave) and disables interrupts on this one (so an ISR cannot), which is
// the guarantee the instruction would have given, and unlike the instruction it also holds for
// operands living in PSRAM. IRAM_ATTR because a caller may run with the flash cache disabled.
#include <stdint.h>
#include "freertos/FreeRTOS.h"
#include "esp_attr.h"

static portMUX_TYPE s_atomicMux = portMUX_INITIALIZER_UNLOCKED;

__attribute__((weak)) uint32_t IRAM_ATTR
__atomic_fetch_add_4(volatile void* mem, uint32_t val, int memorder) {
    (void)memorder;
    volatile uint32_t* p = (volatile uint32_t*)mem;
    portENTER_CRITICAL_SAFE(&s_atomicMux);
    const uint32_t old = *p;
    *p = old + val;
    portEXIT_CRITICAL_SAFE(&s_atomicMux);
    return old;
}

__attribute__((weak)) uint32_t IRAM_ATTR
__atomic_fetch_sub_4(volatile void* mem, uint32_t val, int memorder) {
    (void)memorder;
    volatile uint32_t* p = (volatile uint32_t*)mem;
    portENTER_CRITICAL_SAFE(&s_atomicMux);
    const uint32_t old = *p;
    *p = old - val;
    portEXIT_CRITICAL_SAFE(&s_atomicMux);
    return old;
}
