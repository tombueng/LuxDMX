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
#ifndef RDM_RMT_UART
#define RDM_RMT_UART   UART_NUM_2       // a spare UART (no esp_dmx in the RMT build) used RX-only
#endif
#define RDM_SC             0xCC         // RDM start code
#define RDM_SC_SUB         0x01         // RDM sub-start code (SC_SUB_MESSAGE)
#define RDM_HDR_LEN        24           // fixed header bytes SC..PDL (message length = 24 + PDL)
#define RDM_RESP_TIMEOUT_MS 9           // responder must reply within this window of the request end
#define RDM_DISC_TIMEOUT_MS 3           // discovery reply window

// --- module state ---------------------------------------------------------------------------
static rdm_uid_t g_rdmCtrl = {0x4C58, 0};   // controller UID: man_id 'LX' (<=0x7fff), dev_id from MAC
static RmtDmx*   g_rdmRmt  = nullptr;        // the RDM output's RMT channel (shared for request TX)
static int       g_rdmDe   = -1;             // DE/RE direction pin (HIGH=TX, LOW=RX)
static int       g_rdmRx   = -1;             // UART RX pin (transceiver RO)
static uint8_t   g_rdmTN   = 0;              // RDM transaction number (rolls)
static bool      g_rdmUartUp = false;

static inline void rdmDe(int level) { gpio_set_level((gpio_num_t)g_rdmDe, level); }

// Set up the RX-only UART + DE pin. Call once at boot for the RDM output. rmt is that output's
// already-initialised RMT channel; it is reused to transmit RDM requests.
static bool rdmRmtInit(RmtDmx* rmt, int dePin, int rxPin) {
    g_rdmRmt = rmt; g_rdmDe = dePin; g_rdmRx = rxPin;
    // Controller UID device-id from the base MAC (stable per board).
    uint8_t mac[6] = {0};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    g_rdmCtrl.dev_id = ((uint32_t)mac[2] << 24) | (mac[3] << 16) | (mac[4] << 8) | mac[5];

    gpio_config_t io = {};
    io.pin_bit_mask = 1ULL << dePin;
    io.mode = GPIO_MODE_OUTPUT;
    gpio_config(&io);
    rdmDe(1);   // idle in TX/drive so DMX (on RMT) keeps driving the line

    uart_config_t uc = {};
    uc.baud_rate = 250000;
    uc.data_bits = UART_DATA_8_BITS;
    uc.parity    = UART_PARITY_DISABLE;
    uc.stop_bits = UART_STOP_BITS_2;          // DMX/RDM is 8N2
    uc.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
    uc.source_clk = UART_SCLK_DEFAULT;
    if (uart_driver_install(RDM_RMT_UART, 512, 0, 0, nullptr, 0) != ESP_OK) return false;
    uart_param_config(RDM_RMT_UART, &uc);
    // RX only — TX/RTS/CTS left unconnected so the UART never drives the bus.
    uart_set_pin(RDM_RMT_UART, UART_PIN_NO_CHANGE, rxPin, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
    gpio_set_pull_mode((gpio_num_t)rxPin, GPIO_PULLUP_ONLY);   // keep RO idle-high if it ever tri-states
    g_rdmUartUp = true;
    return true;
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
static void rdmTx(const uint8_t* pkt, int len) {
    RmtDmx* rd = g_rdmRmt;
    if (!rd || !rd->chan) return;
    uart_flush_input(RDM_RMT_UART);              // drop anything stale before we listen
    rdmDe(1);                                    // drive
    rmtDmxEncode(rd, pkt, len);                  // break + MAB + packet bytes
    rmt_transmit_config_t tc = {}; tc.loop_count = 0; tc.flags.eot_level = 1;
    rmt_transmit(rd->chan, rd->enc, rd->sym, rd->nsym * sizeof(rmt_symbol_word_t), &tc);
    rmt_tx_wait_all_done(rd->chan, 60);          // wait until the last bit has left
    rdmDe(0);                                    // turnaround: stop driving, enable the receiver
    // If the transceiver keeps its receiver enabled during drive (single DE/EN pin, /RE tied
    // active), our own frame echoes straight back into the RX FIFO. Let that echo tail finish
    // arriving, then flush it, so the following read sees ONLY the responder's reply.
    esp_rom_delay_us(90);
    uart_flush_input(RDM_RMT_UART);
}

// --- response parsing -----------------------------------------------------------------------
// Read a normal (break-framed) RDM response off the UART, validate it, and hand back the
// parameter data. Returns true if a checksum-valid response addressed to us was received.
static bool rdmReadResp(const rdm_uid_t& expectFrom, uint8_t* pd, int pdMax, int* pdl,
                        rdm_ack_t* ack) {
    uint8_t rx[96];
    int n = uart_read_bytes(RDM_RMT_UART, rx, sizeof(rx), pdMS_TO_TICKS(RDM_RESP_TIMEOUT_MS));
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
static int rdmDiscBranch(uint64_t lower, uint64_t upper, rdm_uid_t* found) {
    uint8_t pd[12];
    putUid(&pd[0], uidUnpack(lower));
    putUid(&pd[6], uidUnpack(upper));
    uint8_t pkt[64];
    int len = rdmBuild(pkt, RDM_UID_BROADCAST_ALL, RDM_CC_DISC_COMMAND,
                       RDM_PID_DISC_UNIQUE_BRANCH, pd, 12);
    rdmTx(pkt, len);
    uint8_t rx[48];
    int n = uart_read_bytes(RDM_RMT_UART, rx, sizeof(rx), pdMS_TO_TICKS(RDM_DISC_TIMEOUT_MS));
    rdmDe(1);
    if (n <= 0) return 0;                         // silence -> empty branch
    // Locate the 0xAA preamble separator (0..7 leading 0xFE preamble bytes precede it).
    int sep = -1;
    for (int i = 0; i < n; i++) { if (rx[i] == 0xAA) { sep = i; break; } if (rx[i] != 0xFE) break; }
    if (sep < 0 || n - sep - 1 < 16) return 2;    // got noise but no clean EUID -> collision
    uint8_t* e = rx + sep + 1;
    uint8_t u[6];
    for (int i = 0; i < 6; i++) u[i] = e[i * 2] & e[i * 2 + 1];   // 0xAA/0x55 de-interleave
    // E1.20 discovery checksum = sum of the 12 masked EUID bytes. Since
    // (uid|0xAA)+(uid|0x55) == uid+0xFF, that equals sum(uid) + 0xFF per byte -- NOT the bare
    // UID sum. (Matches esp_dmx driver.c and any real fixture.)
    uint16_t csum = 0; for (int i = 0; i < 6; i++) csum += (uint16_t)u[i] + 0xFF;
    uint8_t ch[2] = { (uint8_t)(e[12] & e[13]), (uint8_t)(e[14] & e[15]) };
    if (csum != (uint16_t)((ch[0] << 8) | ch[1])) return 2;      // bad checksum -> collision
    found->man_id = (u[0] << 8) | u[1];
    found->dev_id = ((uint32_t)u[2] << 24) | (u[3] << 16) | (u[4] << 8) | u[5];
    return 1;
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
    uart_flush_input(RDM_RMT_UART);
}

// Recursive binary search over a UID range; mutes + records each device found.
static void rdmDiscRange(uint64_t lo, uint64_t hi, rdm_uid_t* out, int max, int* count) {
    int guard = 0;
    while (*count < max && guard++ < max + 4) {
        rdm_uid_t f;
        int r = rdmDiscBranch(lo, hi, &f);
        if (r == 0) return;                       // branch empty
        if (r == 1) {                             // exactly one visible
            if (rdmMute(f)) {
                bool dup = false;
                for (int i = 0; i < *count; i++) if (uidPack(out[i]) == uidPack(f)) { dup = true; break; }
                if (!dup) out[(*count)++] = f;
            }
            continue;                             // re-scan same range: another device may have been masked
        }
        // r == 2: collision -> split the range
        if (lo >= hi) return;                     // single address can't be split further
        uint64_t mid = lo + (hi - lo) / 2;
        rdmDiscRange(lo, mid, out, max, count);
        rdmDiscRange(mid + 1, hi, out, max, count);
        return;
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
