// RMT-TX + UART-RX RDM (E1.20) controller — issue #64 robust path.
//
// Why this exists: the RMT DMX path (dmx_rmt.h) makes DMX output immune to core-0 EMAC-DMA
// contention, but esp_dmx drove RDM off the same UART. Sharing one pin between RMT and esp_dmx
// at runtime meant create/delete churn of a peripheral per RDM transaction, which leaks a
// hardware interrupt each time and exhausts the interrupt pool after a few cycles. This module
// removes the churn entirely:
//
//   * RMT sends EVERYTHING — DMX frames AND RDM request packets (an RDM request is just a
//     break-framed byte stream with start code 0xCC, which rmtDmxEncode already produces).
//   * A UART is used RX-ONLY to catch responder replies (transceiver RO -> rxPin).
//   * DE/RE is a plain GPIO (rtsPin): HIGH = drive (TX), LOW = listen (RX).
//
// Nothing is ever installed/deleted at runtime, so there is no interrupt leak and the RDM
// output keeps full RMT immunity. All bus access runs on the DMX task thread (the sole owner
// of the RMT channel), so there is no cross-core peripheral access.
#pragma once
#include "dmx_rmt.h"
#include "driver/uart.h"
#include "driver/gpio.h"
#include <esp_mac.h>
#include <esp_rom_sys.h>         // esp_rom_delay_us()
#include <rdm/include/types.h>   // rdm_uid_t / rdm_device_info_t / rdm_sensor_* / PIDs / CCs (types only, no driver)
#include <rdm/controller.h>      // rdm_ack_t (struct only — we never call the esp_dmx controller)

// --- config ---------------------------------------------------------------------------------
// Each RDM-capable output ("line") is a transceiver: its own RMT TX channel, DE/RE pin and an
// RX-only UART. The RMT DMX build leaves UART1/UART2 free, so up to two lines are supported and
// RDM can run on both universes (one at a time; the engine selects the active line per transaction).
#ifndef RDM_MAX_LINES
#define RDM_MAX_LINES 2
#endif
#define RDM_SC             0xCC         // RDM start code
#define RDM_SC_SUB         0x01         // RDM sub-start code (SC_SUB_MESSAGE)
#define RDM_HDR_LEN        24           // fixed header bytes SC..PDL (message length = 24 + PDL)
#define RDM_RESP_TIMEOUT_MS 9           // responder must reply within this window of the request end
#define RDM_DISC_TIMEOUT_MS 3           // discovery reply window
static const uart_port_t RDM_LINE_UART[RDM_MAX_LINES] = { UART_NUM_2, UART_NUM_1 };  // RX-only, one per line

// --- module state ---------------------------------------------------------------------------
static rdm_uid_t g_rdmCtrl = {0x4C58, 0};   // controller UID: man_id 'LX' (<=0x7fff), dev_id from MAC

struct RdmLine { RmtDmx* rmt; int de; int rx; uart_port_t uart; bool up; };
static RdmLine   g_rdmLines[RDM_MAX_LINES] = {};
static int       g_rdmLineN = 0;

// The active line — every transaction below drives these; rdmRmtSelect() points them at a line.
static RmtDmx*     g_rdmRmt  = nullptr;      // active RMT channel (shared for request TX)
static int         g_rdmDe   = -1;           // active DE/RE direction pin (HIGH=TX, LOW=RX)
static int         g_rdmRx   = -1;           // active UART RX pin (transceiver RO)
static uart_port_t g_rdmUart = UART_NUM_2;   // active RX UART
static uint8_t   g_rdmTN   = 0;              // RDM transaction number (rolls)
static volatile uint32_t g_rdmSent = 0;      // RDM frames transmitted on the bus (for the web UI)
static volatile uint32_t g_rdmRecv = 0;      // checksum-valid RDM responses received

static inline void rdmDe(int level) { gpio_set_level((gpio_num_t)g_rdmDe, level); }

static int rdmRmtLineCount() { return g_rdmLineN; }
// Point the transaction engine at a line (its RMT channel + DE pin + RX UART). Cheap; call it before
// running discovery / a transaction on that line. RDM is serialised on the DMX task, so switching
// the active line between ops is safe.
static void rdmRmtSelect(int line) {
    if (line < 0 || line >= g_rdmLineN) return;
    RdmLine& L = g_rdmLines[line];
    g_rdmRmt = L.rmt; g_rdmDe = L.de; g_rdmRx = L.rx; g_rdmUart = L.uart;
}

// Register an RDM line (RX-only UART + DE pin; rmt is that output's already-initialised RMT channel,
// reused to transmit RDM requests). Call once per RDM-capable output at boot. Returns the line index
// or -1 if full. The first line registered becomes the active one.
static int rdmRmtInit(RmtDmx* rmt, int dePin, int rxPin) {
    if (g_rdmLineN >= RDM_MAX_LINES) return -1;
    int idx = g_rdmLineN;
    uart_port_t uart = RDM_LINE_UART[idx];
    if (idx == 0) {   // controller UID device-id from the base MAC (stable per board), once
        uint8_t mac[6] = {0};
        esp_read_mac(mac, ESP_MAC_WIFI_STA);
        g_rdmCtrl.dev_id = ((uint32_t)mac[2] << 24) | (mac[3] << 16) | (mac[4] << 8) | mac[5];
    }
    gpio_config_t io = {};
    io.pin_bit_mask = 1ULL << dePin;
    io.mode = GPIO_MODE_OUTPUT;
    gpio_config(&io);
    gpio_set_level((gpio_num_t)dePin, 1);   // idle in TX/drive so DMX (on RMT) keeps driving the line

    uart_config_t uc = {};
    uc.baud_rate = 250000;
    uc.data_bits = UART_DATA_8_BITS;
    uc.parity    = UART_PARITY_DISABLE;
    uc.stop_bits = UART_STOP_BITS_2;          // DMX/RDM is 8N2
    uc.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
    uc.source_clk = UART_SCLK_DEFAULT;
    if (uart_driver_install(uart, 512, 0, 0, nullptr, 0) != ESP_OK) return -1;
    uart_param_config(uart, &uc);
    // RX only — TX/RTS/CTS left unconnected so the UART never drives the bus.
    uart_set_pin(uart, UART_PIN_NO_CHANGE, rxPin, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
    gpio_set_pull_mode((gpio_num_t)rxPin, GPIO_PULLUP_ONLY);   // keep RO idle-high if it ever tri-states

    g_rdmLines[idx].rmt = rmt; g_rdmLines[idx].de = dePin; g_rdmLines[idx].rx = rxPin;
    g_rdmLines[idx].uart = uart; g_rdmLines[idx].up = true;
    g_rdmLineN++;
    if (idx == 0) rdmRmtSelect(0);   // default active line
    return idx;
}

// --- request framing ------------------------------------------------------------------------
static inline void putUid(uint8_t* p, const rdm_uid_t& u) {
    p[0] = u.man_id >> 8; p[1] = u.man_id & 0xff;
    p[2] = u.dev_id >> 24; p[3] = u.dev_id >> 16; p[4] = u.dev_id >> 8; p[5] = u.dev_id & 0xff;
}
// Build a full RDM request packet (start code + message + 16-bit checksum) into buf. Returns len.
static int rdmBuild(uint8_t* buf, const rdm_uid_t& dest, uint8_t cc, uint16_t pid,
                    const uint8_t* pd, uint8_t pdl) {
    int i = 0;
    buf[i++] = RDM_SC;
    buf[i++] = RDM_SC_SUB;
    buf[i++] = RDM_HDR_LEN + pdl;               // message length (SC..end of PD)
    putUid(&buf[i], dest); i += 6;
    putUid(&buf[i], g_rdmCtrl); i += 6;
    buf[i++] = g_rdmTN++;                        // transaction number
    buf[i++] = 0x01;                            // port ID / response type = 1 (request)
    buf[i++] = 0x00;                            // message count = 0 in a request
    buf[i++] = 0x00; buf[i++] = 0x00;          // sub-device = ROOT (0)
    buf[i++] = cc;
    buf[i++] = pid >> 8; buf[i++] = pid & 0xff;
    buf[i++] = pdl;
    for (uint8_t j = 0; j < pdl; j++) buf[i++] = pd[j];
    uint16_t ck = 0; for (int j = 0; j < i; j++) ck += buf[j];   // checksum incl. start code
    buf[i++] = ck >> 8; buf[i++] = ck & 0xff;
    return i;
}

// Transmit a pre-built raw packet over RMT, then flip DE to RX. Blocks until TX is on the wire.
// On a DE-only transceiver (receiver always on) our own frame echoes back into the RX FIFO during
// the drive; we let that echo tail drain and flush it so the following read sees only the reply.
static void rdmTx(const uint8_t* pkt, int len) {
    RmtDmx* rd = g_rdmRmt;
    if (!rd || !rd->chan) return;
    g_rdmSent++;
    uart_flush_input(g_rdmUart);              // drop anything stale before we listen
    rdmDe(1);                                    // drive
    rmtDmxEncode(rd, pkt, len);                  // break + MAB + packet bytes
    rmt_transmit_config_t tc = {}; tc.loop_count = 0; tc.flags.eot_level = 1;
    rmt_transmit(rd->chan, rd->enc, rd->sym, rd->nsym * sizeof(rmt_symbol_word_t), &tc);
    rmt_tx_wait_all_done(rd->chan, 60);          // wait until the last bit has left
    rdmDe(0);                                    // turnaround: stop driving, enable the receiver
    esp_rom_delay_us(90);                        // let our own echoed frame finish arriving
    uart_flush_input(g_rdmUart);              // discard it -> the read sees only the responder reply
}

// Read one break-framed RDM response off the UART, returning the instant the whole frame
// (SC .. checksum) has arrived instead of always blocking the full timeout. A responder must reply
// within ~2 ms (E1.20 RESPONDER_PACKET_SPACING), so once the frame is in there is nothing to wait
// for; this collapses the old fixed ~9 ms UART wait to the real turnaround time. It lets the gateway
// service a busy controller several times faster without taking any extra time from the DMX frame
// (this is only about how long we listen on the wire, not the DMX output timing). Returns the byte
// count captured; the caller still locates the SC and validates length + checksum.
static int rdmReadFrame(uint8_t* rx, int rxMax) {
    uint32_t t0 = micros();
    int n = 0, sc = -1, need = -1;
    while ((uint32_t)(micros() - t0) < (uint32_t)RDM_RESP_TIMEOUT_MS * 1000u) {
        int r = uart_read_bytes(g_rdmUart, rx + n, rxMax - n, pdMS_TO_TICKS(1));
        if (r > 0) {
            n += r;
            if (sc < 0)                                   // find the SC + SUB_START_CODE
                for (int i = 0; i + 1 < n; i++)
                    if (rx[i] == RDM_SC && rx[i + 1] == RDM_SC_SUB) { sc = i; break; }
            if (sc >= 0 && need < 0 && n - sc >= 3)
                need = rx[sc + 2] + 2;                    // message length byte + 16-bit checksum
            if (need > 0 && n - sc >= need) break;        // whole frame captured -> return now
        }
        if (n >= rxMax) break;
    }
    return n;
}

// --- response parsing -----------------------------------------------------------------------
// Read a normal (break-framed) RDM response off the UART, validate it, and hand back the
// parameter data. Returns true if a checksum-valid response addressed to us was received.
static bool rdmReadResp(const rdm_uid_t& expectFrom, uint8_t* pd, int pdMax, int* pdl,
                        rdm_ack_t* ack) {
    uint8_t rx[96];
    int n = rdmReadFrame(rx, sizeof(rx));        // returns as soon as the whole reply has landed
    rdmDe(1);                                    // done listening -> back to drive (DMX resumes)
    // Find the start code. A leading break shows up as a 0x00 (framing error) byte; skip to 0xCC.
    const char* fail = nullptr;
    int s = -1, msgLen = -1; uint16_t ck = 0, got = 0;
    if (n < 26) fail = "short";
    else {
        for (int i = 0; i < n - 1; i++) { if (rx[i] == RDM_SC && rx[i + 1] == RDM_SC_SUB) { s = i; break; } }
        if (s < 0) fail = "noSC";
    }
    uint8_t* m = rx + s;
    if (!fail) {
        int avail = n - s;
        msgLen = m[2];                           // SC..last byte before checksum
        if (msgLen + 2 > avail || msgLen < RDM_HDR_LEN) fail = "len";
        else {
            for (int i = 0; i < msgLen; i++) ck += m[i];
            got = (m[msgLen] << 8) | m[msgLen + 1];
            if (ck != got) fail = "ck";
        }
    }
    if (fail) return false;
    if (ack) {
        ack->src_uid.man_id = (m[9] << 8) | m[10];
        ack->src_uid.dev_id = ((uint32_t)m[11] << 24) | (m[12] << 16) | (m[13] << 8) | m[14];
        ack->type          = (rdm_response_type_t)m[16];
        ack->message_count = m[17];
        ack->pid           = (m[21] << 8) | m[22];
        ack->err           = DMX_OK;
        ack->size          = msgLen + 2;
    }
    int rpdl = m[23];
    if (rpdl > pdMax) rpdl = pdMax;
    if (23 + rpdl > msgLen) rpdl = msgLen - 23;  // guard against a lying PDL
    if (rpdl < 0) rpdl = 0;
    for (int i = 0; i < rpdl; i++) pd[i] = m[24 + i];
    *pdl = rpdl;
    g_rdmRecv++;
    return true;
}

// One request/response transaction to a specific device. Retries a lost response a couple of
// times (fresh transaction number each attempt) -- E1.20 allows the controller to re-issue on a
// lost/late reply, and it makes back-to-back GETs robust to a fixture that's slow to turn around.
static bool rdmTransaction(const rdm_uid_t& dest, uint8_t cc, uint16_t pid,
                           const uint8_t* reqPd, uint8_t reqPdl,
                           uint8_t* respPd, int respMax, int* respPdl, rdm_ack_t* ack) {
    uint8_t pkt[64];
    for (int attempt = 0; attempt < 3; attempt++) {
        int len = rdmBuild(pkt, dest, cc, pid, reqPd, reqPdl);   // fresh TN per attempt
        rdmTx(pkt, len);
        if (rdmReadResp(dest, respPd, respMax, respPdl, ack)) return true;
        esp_rom_delay_us(1000);                                  // brief gap before re-issuing
    }
    return false;
}

// --- discovery ------------------------------------------------------------------------------
static inline uint64_t uidPack(const rdm_uid_t& u) { return ((uint64_t)u.man_id << 32) | u.dev_id; }
static inline rdm_uid_t uidUnpack(uint64_t v) { rdm_uid_t u; u.man_id = v >> 32; u.dev_id = (uint32_t)v; return u; }

// Send DISC_UNIQUE_BRANCH(lower..upper) and read the (break-less, preamble+EUID) reply.
// Returns 0 = nobody in range, 1 = exactly one (decoded into *found), 2 = collision (>1 in range).
// A reply that arrives but doesn't decode cleanly is RE-READ: on a noisy bus a lone fixture's reply
// can pick up a stray bit flip and look just like a multi-fixture collision. A stochastic error
// clears on a re-read (-> clean single), while a genuine collision stays garbled every time
// (-> split). True silence returns "empty" at once (no wasted retries on the many empty branches).
static int rdmDiscBranch(uint64_t lower, uint64_t upper, rdm_uid_t* found) {
    uint8_t pd[12];
    putUid(&pd[0], uidUnpack(lower));
    putUid(&pd[6], uidUnpack(upper));
    for (int attempt = 0; attempt < 3; attempt++) {
        uint8_t pkt[64];
        int len = rdmBuild(pkt, RDM_UID_BROADCAST_ALL, RDM_CC_DISC_COMMAND,
                           RDM_PID_DISC_UNIQUE_BRANCH, pd, 12);
        rdmTx(pkt, len);
        uint8_t rx[48];
        int n = uart_read_bytes(g_rdmUart, rx, sizeof(rx), pdMS_TO_TICKS(RDM_DISC_TIMEOUT_MS));
        rdmDe(1);
        if (n <= 0) return 0;                        // silence -> genuinely empty branch
        // Locate the 0xAA preamble separator (0..7 leading 0xFE preamble bytes precede it).
        int sep = -1;
        for (int i = 0; i < n; i++) { if (rx[i] == 0xAA) { sep = i; break; } if (rx[i] != 0xFE) break; }
        if (sep >= 0 && n - sep - 1 >= 16) {
            uint8_t* e = rx + sep + 1;
            uint8_t u[6];
            for (int i = 0; i < 6; i++) u[i] = e[i * 2] & e[i * 2 + 1];   // 0xAA/0x55 de-interleave
            // E1.20 discovery checksum = sum of the 12 masked EUID bytes == sum(uid)+0xFF per byte
            // ((uid|0xAA)+(uid|0x55) == uid+0xFF). Matches esp_dmx and any real fixture.
            uint16_t csum = 0; for (int i = 0; i < 6; i++) csum += (uint16_t)u[i] + 0xFF;
            uint8_t ch[2] = { (uint8_t)(e[12] & e[13]), (uint8_t)(e[14] & e[15]) };
            if (csum == (uint16_t)((ch[0] << 8) | ch[1])) {              // clean single -> done
                found->man_id = (u[0] << 8) | u[1];
                found->dev_id = ((uint32_t)u[2] << 24) | (u[3] << 16) | (u[4] << 8) | u[5];
                return 1;
            }
        }
        // bytes present but not a clean single: stray bit flip on a lone fixture, or a real
        // collision. Re-read; if it stays dirty across attempts it is a genuine collision -> split.
    }
    return 2;
}

// Mute a single device (so it drops out of further DISC_UNIQUE_BRANCH sweeps). Returns true on ACK.
static bool rdmMute(const rdm_uid_t& uid) {
    uint8_t resp[8]; int rpdl = 0; rdm_ack_t ack;
    // DISC_MUTE has a 2-byte control-field response; any valid reply counts as muted.
    return rdmTransaction(uid, RDM_CC_DISC_COMMAND, RDM_PID_DISC_MUTE, nullptr, 0,
                          resp, sizeof(resp), &rpdl, &ack);
}
// Un-mute everyone (broadcast, no response expected) before a fresh discovery.
static void rdmUnMuteAll() {
    uint8_t pkt[64];
    int len = rdmBuild(pkt, RDM_UID_BROADCAST_ALL, RDM_CC_DISC_COMMAND,
                       RDM_PID_DISC_UN_MUTE, nullptr, 0);
    rdmTx(pkt, len);
    vTaskDelay(pdMS_TO_TICKS(1));                 // let the broadcast settle
    uart_flush_input(g_rdmUart);
}

// Iterative binary search over the UID range, mutes + records each device found. ITERATIVE on
// purpose: a recursive split of the 48-bit UID space goes ~48 deep, which overflows the DMX task
// stack and hard-resets the board (seen on the bench: corrupted backtrace / SW_CPU_RESET). An
// explicit range stack keeps memory bounded, and a total-branch budget means even a garbled bus
// (every branch reads as a collision) finishes instead of thrashing forever.
static void rdmDiscRange(uint64_t lo0, uint64_t hi0, rdm_uid_t* out, int max, int* count) {
    static uint64_t stkLo[64], stkHi[64];         // deferred right-halves (single-threaded -> static OK)
    int sp = 0; stkLo[sp] = lo0; stkHi[sp] = hi0; sp++;
    int budget = 8 * max + 128;                   // hard cap on total DISC branches
    while (sp > 0 && *count < max && budget > 0) {
        uint64_t lo = stkLo[--sp], hi = stkHi[sp];
        int guard = 0;
        while (*count < max && guard++ < max + 4 && budget-- > 0) {
            rdm_uid_t f;
            int r = rdmDiscBranch(lo, hi, &f);
            if (r == 0) break;                    // branch empty -> next range
            if (r == 1) {                         // exactly one visible -> mute + record, re-scan range
                if (rdmMute(f)) {
                    bool dup = false;
                    for (int i = 0; i < *count; i++) if (uidPack(out[i]) == uidPack(f)) { dup = true; break; }
                    if (!dup) out[(*count)++] = f;
                }
                continue;
            }
            if (lo >= hi) break;                  // collision at a single address -> give up on it
            uint64_t mid = lo + (hi - lo) / 2;    // collision -> do the left half now, defer the right
            if (sp < 63) { stkLo[sp] = mid + 1; stkHi[sp] = hi; sp++; }
            hi = mid;
        }
    }
}

// Full discovery sweep. Returns the number of devices found (<= max).
static int rdmRmtDiscover(rdm_uid_t* out, int max) {
    rdmUnMuteAll();
    int count = 0;
    rdmDiscRange(0, uidPack(RDM_UID_MAX), out, max, &count);
    return count;
}

// --- typed GET/SET wrappers (match the surface main.cpp previously used from esp_dmx) --------
static bool rdmRmtGetDeviceInfo(const rdm_uid_t& uid, rdm_device_info_t* info, rdm_ack_t* ack) {
    uint8_t pd[40]; int pdl = 0;
    if (!rdmTransaction(uid, RDM_CC_GET_COMMAND, RDM_PID_DEVICE_INFO, nullptr, 0,
                        pd, sizeof(pd), &pdl, ack)) return false;
    if (ack->type != RDM_RESPONSE_TYPE_ACK || pdl < 19) return false;
    info->model_id            = (pd[2] << 8) | pd[3];
    info->product_category    = (pd[4] << 8) | pd[5];
    info->software_version_id = ((uint32_t)pd[6] << 24) | (pd[7] << 16) | (pd[8] << 8) | pd[9];
    info->footprint           = (pd[10] << 8) | pd[11];
    info->personality.current = pd[12];
    info->personality.count   = pd[13];
    info->dmx_start_address   = (pd[14] << 8) | pd[15];
    info->sub_device_count    = (pd[16] << 8) | pd[17];
    info->sensor_count        = pd[18];
    return true;
}
static bool rdmRmtGetSwLabel(const rdm_uid_t& uid, char* buf, size_t len, rdm_ack_t* ack) {
    uint8_t pd[40]; int pdl = 0;
    if (len) buf[0] = 0;
    if (!rdmTransaction(uid, RDM_CC_GET_COMMAND, RDM_PID_SOFTWARE_VERSION_LABEL, nullptr, 0,
                        pd, sizeof(pd), &pdl, ack)) return false;
    if (ack->type != RDM_RESPONSE_TYPE_ACK) return false;
    int n = pdl; if (n > (int)len - 1) n = len - 1; if (n < 0) n = 0;
    memcpy(buf, pd, n); buf[n] = 0;
    return true;
}
static bool rdmRmtGetSensorDef(const rdm_uid_t& uid, uint8_t sensorNum,
                               rdm_sensor_definition_t* def, rdm_ack_t* ack) {
    uint8_t pd[40]; int pdl = 0;
    if (!rdmTransaction(uid, RDM_CC_GET_COMMAND, RDM_PID_SENSOR_DEFINITION, &sensorNum, 1,
                        pd, sizeof(pd), &pdl, ack)) return false;
    if (ack->type != RDM_RESPONSE_TYPE_ACK || pdl < 13) return false;
    def->num  = pd[0]; def->type = pd[1]; def->unit = pd[2]; def->prefix = pd[3];
    int dn = pdl - 13; if (dn < 0) dn = 0; if (dn > 32) dn = 32;   // description is the tail (offset 13)
    memcpy(def->description, pd + 13, dn); def->description[dn] = 0;
    return true;
}
static bool rdmRmtGetSensorValue(const rdm_uid_t& uid, uint8_t sensorNum,
                                 rdm_sensor_value_t* val, rdm_ack_t* ack) {
    uint8_t pd[16]; int pdl = 0;
    if (!rdmTransaction(uid, RDM_CC_GET_COMMAND, RDM_PID_SENSOR_VALUE, &sensorNum, 1,
                        pd, sizeof(pd), &pdl, ack)) return false;
    if (ack->type != RDM_RESPONSE_TYPE_ACK || pdl < 3) return false;
    val->sensor_num    = pd[0];
    val->present_value = (int16_t)((pd[1] << 8) | pd[2]);
    return true;
}
static bool rdmRmtSetStartAddr(const rdm_uid_t& uid, uint16_t addr, rdm_ack_t* ack) {
    uint8_t pd[2] = { (uint8_t)(addr >> 8), (uint8_t)(addr & 0xff) };
    uint8_t resp[8]; int rpdl = 0;
    if (!rdmTransaction(uid, RDM_CC_SET_COMMAND, RDM_PID_DMX_START_ADDRESS, pd, 2,
                        resp, sizeof(resp), &rpdl, ack)) return false;
    return ack->type == RDM_RESPONSE_TYPE_ACK;
}
static bool rdmRmtSetIdentify(const rdm_uid_t& uid, bool on, rdm_ack_t* ack) {
    uint8_t pd = on ? 1 : 0;
    uint8_t resp[8]; int rpdl = 0;
    if (!rdmTransaction(uid, RDM_CC_SET_COMMAND, RDM_PID_IDENTIFY_DEVICE, &pd, 1,
                        resp, sizeof(resp), &rpdl, ack)) return false;
    return ack->type == RDM_RESPONSE_TYPE_ACK;
}

// --- extended typed GET/SET (labels, personality, full sensor value) ------------------------
// Generic string GET (MANUFACTURER_LABEL, DEVICE_MODEL_DESCRIPTION, DEVICE_LABEL, ...).
static bool rdmRmtGetString(const rdm_uid_t& uid, uint16_t pid, char* buf, size_t len, rdm_ack_t* ack) {
    uint8_t pd[40]; int pdl = 0;
    if (len) buf[0] = 0;
    if (!rdmTransaction(uid, RDM_CC_GET_COMMAND, pid, nullptr, 0, pd, sizeof(pd), &pdl, ack)) return false;
    if (ack->type != RDM_RESPONSE_TYPE_ACK) return false;
    int n = pdl; if (n > (int)len - 1) n = len - 1; if (n < 0) n = 0;
    memcpy(buf, pd, n); buf[n] = 0;
    return true;
}
// Generic string SET (DEVICE_LABEL, ...).
static bool rdmRmtSetString(const rdm_uid_t& uid, uint16_t pid, const char* s, rdm_ack_t* ack) {
    uint8_t resp[8]; int rpdl = 0;
    int n = (int)strlen(s); if (n > 32) n = 32;
    if (!rdmTransaction(uid, RDM_CC_SET_COMMAND, pid, (const uint8_t*)s, (uint8_t)n, resp, sizeof(resp), &rpdl, ack))
        return false;
    return ack->type == RDM_RESPONSE_TYPE_ACK;
}
static bool rdmRmtSetPersonality(const rdm_uid_t& uid, uint8_t pers, rdm_ack_t* ack) {
    uint8_t resp[8]; int rpdl = 0;
    if (!rdmTransaction(uid, RDM_CC_SET_COMMAND, RDM_PID_DMX_PERSONALITY, &pers, 1, resp, sizeof(resp), &rpdl, ack))
        return false;
    return ack->type == RDM_RESPONSE_TYPE_ACK;
}
// SENSOR_VALUE GET returning present + lowest/highest/recorded (E1.20 gives all four; older/simple
// responders may only return present, so the tail fields fall back to present).
static bool rdmRmtGetSensorFull(const rdm_uid_t& uid, uint8_t sensorNum,
                                int16_t* present, int16_t* lo, int16_t* hi, int16_t* rec, rdm_ack_t* ack) {
    uint8_t pd[16]; int pdl = 0;
    if (!rdmTransaction(uid, RDM_CC_GET_COMMAND, RDM_PID_SENSOR_VALUE, &sensorNum, 1, pd, sizeof(pd), &pdl, ack))
        return false;
    if (ack->type != RDM_RESPONSE_TYPE_ACK || pdl < 3) return false;
    *present = (int16_t)((pd[1] << 8) | pd[2]);
    *lo  = pdl >= 5 ? (int16_t)((pd[3] << 8) | pd[4]) : *present;
    *hi  = pdl >= 7 ? (int16_t)((pd[5] << 8) | pd[6]) : *present;
    *rec = pdl >= 9 ? (int16_t)((pd[7] << 8) | pd[8]) : *present;
    return true;
}

// GET STATUS_MESSAGE (0x0030) with a status-type filter (RDM_STATUS_ADVISORY/WARNING/ERROR, or
// RDM_STATUS_NONE for "all"). The response is a list of 9-byte records
// {sub-device(2), type(1), messageId(2), data1(2), data2(2)}. We hand back the highest-severity
// record plus the total count -- enough for the Art-Net BackgroundQueue health view. ACK only.
static bool rdmRmtGetStatus(const rdm_uid_t& uid, uint8_t statusType,
                            uint8_t* outType, uint16_t* outId, int16_t* outD1, int16_t* outD2,
                            int* outCount, rdm_ack_t* ack) {
    uint8_t pd[80]; int pdl = 0;
    *outType = 0; *outId = 0; *outD1 = 0; *outD2 = 0; *outCount = 0;
    if (!rdmTransaction(uid, RDM_CC_GET_COMMAND, RDM_PID_STATUS_MESSAGE, &statusType, 1,
                        pd, sizeof(pd), &pdl, ack)) return false;
    if (ack->type != RDM_RESPONSE_TYPE_ACK) return false;
    int nmsg = pdl / 9;
    *outCount = nmsg;
    int best = -1; uint8_t bestType = 0;
    for (int i = 0; i < nmsg; i++) {
        uint8_t t = pd[i * 9 + 2];
        if (best < 0 || t > bestType) { bestType = t; best = i; }
    }
    if (best >= 0) {
        const uint8_t* m = pd + best * 9;
        *outType = m[2];
        *outId   = (uint16_t)((m[3] << 8) | m[4]);
        *outD1   = (int16_t)((m[5] << 8) | m[6]);
        *outD2   = (int16_t)((m[7] << 8) | m[8]);
    }
    return true;
}

// --- ArtRdm raw pass-through ----------------------------------------------------------------
// Relay an RDM request exactly as an Art-Net controller supplied it. ArtRdm carries the full RDM
// message WITHOUT the 0xCC start code (the controller already computed the checksum over the whole
// message including that start code, per E1.20). We prepend 0xCC, put it on the wire, read the raw
// reply, strip its 0xCC and hand the reply straight back so it can be wrapped into an ArtRdm reply.
// Returns the reply length (>=0, without start code) or -1 (no/invalid reply, e.g. a broadcast).
//   reqNoSC/reqLen : the ArtRdm RDM packet (SUB_START_CODE .. checksum) = RDM message minus SC.
//   respNoSC/max   : buffer for the reply, also minus SC.
static int rdmRmtRawRelay(const uint8_t* reqNoSC, int reqLen, uint8_t* respNoSC, int respMax) {
    RmtDmx* rd = g_rdmRmt;
    if (!rd || !rd->chan || reqLen < RDM_HDR_LEN - 1 || reqLen > 260) return -1;
    static uint8_t pkt[264];
    pkt[0] = RDM_SC;
    memcpy(pkt + 1, reqNoSC, reqLen);            // controller's checksum already covers the SC
    // Destination UID is msg[3..8] -> reqNoSC[2..7]. A broadcast/vendorcast dest gets no reply.
    uint16_t destMan = ((uint16_t)reqNoSC[2] << 8) | reqNoSC[3];
    bool bcast = (destMan == 0xFFFF);
    // Re-issue on a lost/late reply, exactly like rdmTransaction() does for our own GET/SETs.
    // Resending the controller's identical bytes (same TN) is what a real controller does on a
    // timeout; E1.20 GET/SET are idempotent so a duplicate is harmless. Without this, one dropped
    // turnaround (~19% on a busy bus) shows up in the console as a device that "lost contact".
    for (int attempt = 0; attempt < (bcast ? 1 : 3); attempt++) {
        rdmTx(pkt, reqLen + 1);
        if (bcast) return 0;                          // relayed, nothing to read back
        uint8_t rx[96];
        int n = rdmReadFrame(rx, sizeof(rx));         // returns as soon as the whole reply has landed
        rdmDe(1);                                     // done listening -> drive (DMX resumes next frame)
        if (n < 26) { esp_rom_delay_us(1000); continue; }
        int s = -1;
        for (int i = 0; i < n - 1; i++) { if (rx[i] == RDM_SC && rx[i + 1] == RDM_SC_SUB) { s = i; break; } }
        if (s < 0) { esp_rom_delay_us(1000); continue; }
        uint8_t* m = rx + s;
        int avail = n - s;
        int msgLen = m[2];
        if (msgLen + 2 > avail || msgLen < RDM_HDR_LEN) { esp_rom_delay_us(1000); continue; }
        uint16_t ck = 0; for (int i = 0; i < msgLen; i++) ck += m[i];
        if (ck != (uint16_t)((m[msgLen] << 8) | m[msgLen + 1])) { esp_rom_delay_us(1000); continue; }
        g_rdmRecv++;                                  // a valid relayed reply (WS "RDM rx" counts it too)
        int outLen = msgLen + 2 - 1;                  // full reply minus the start code
        if (outLen > respMax) outLen = respMax;
        memcpy(respNoSC, m + 1, outLen);              // SUB_START_CODE .. checksum
        return outLen;
    }
    return -1;
}
