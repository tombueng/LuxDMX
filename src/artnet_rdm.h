#pragma once
// ---------------------------------------------------------------------------
// Art-Net 4 RDM bridge (E1.20 over Art-Net). See docs/rdm.md.
//
// This makes LuxDMX an Art-Net RDM *node/output gateway*: a console (DMX-Workshop,
// MagicQ, grandMA3, OLA...) talks RDM to the fixtures on our physical DMX wire over
// the network. Per the Art-Net spec, discovery is PROXIED (the node runs discovery
// on the wire and publishes a Table of Devices) and GET/SET are PASS-THROUGH.
//
//   ArtPoll        0x2000  -> ArtPollReply 0x2100   (be discoverable, advertise RDM)
//   ArtTodRequest  0x8000  -> ArtTodData   0x8100   (return our Table of Devices)
//   ArtTodControl  0x8200  -> ArtTodData   0x8100   (AtcFlush = flush + re-discover)
//   ArtRdm         0x8300 <-> ArtRdm       0x8300   (relay one GET/SET to a fixture)
//
// Threading (the issue-#64 split): netRxTask (core 0) owns the UDP socket and does ALL
// packet I/O; it queues bus work to the DMX task (core 1), the sole owner of the RDM
// wire. The DMX task drains at most ONE RDM bus op per DMX frame (rdmService, 40 Hz),
// so RDM can never block the DMX output -- discovery runs incrementally in the gaps
// between frames instead of one long blocking sweep. That is the fix for "RDM pollutes
// the bus and DMX slows down": before, a full discovery dropped the wire to ~4-6 fps
// for ~2.3 s; interleaved one-op-per-frame it stays ~31-40 fps throughout.
//
// Lives in the DMX_RMT build only (it uses rdm_rmt.h's raw relay + discovery primitives).
// ---------------------------------------------------------------------------
#include <fcntl.h>            // O_NONBLOCK / F_GETFL / F_SETFL
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include "lwip/sockets.h"     // raw UDP socket so we can enable SO_BROADCAST (receive limited-broadcast ArtPoll)
#include "rdm_rmt.h"

// ---- Art-Net opcodes (little-endian on the wire) --------------------------
static constexpr uint16_t ARTNET_OP_POLL       = 0x2000;
static constexpr uint16_t ARTNET_OP_POLLREPLY  = 0x2100;
static constexpr uint16_t ARTNET_OP_DMX        = 0x5000;
static constexpr uint16_t ARTNET_OP_TODREQUEST = 0x8000;
static constexpr uint16_t ARTNET_OP_TODDATA    = 0x8100;
static constexpr uint16_t ARTNET_OP_TODCONTROL = 0x8200;
static constexpr uint16_t ARTNET_OP_RDM        = 0x8300;
static constexpr uint16_t ARTNET_OP_ADDRESS    = 0x6000;
static constexpr int      ARTNET_PORT          = 6454;
static const uint8_t      ARTNET_ID[8]         = {'A','r','t','-','N','e','t',0};

// AtcFlush command in ArtTodControl
static constexpr uint8_t  ATC_FLUSH = 0x01;

// ArtAddress Command byte (field 13). Art-Net 4 selects the target port by BindIndex, so consoles
// send the "...0" variant; the per-port 1/2/3 variants are deprecated -> we match on the high nibble.
static constexpr uint8_t  AC_CANCEL_MERGE = 0x01;  // drop the merge, next source wins
static constexpr uint8_t  AC_MERGE_LTP0   = 0x10;  // 0x10..0x13 = set merge LTP
static constexpr uint8_t  AC_MERGE_HTP0   = 0x50;  // 0x50..0x53 = set merge HTP
static constexpr uint8_t  AC_CLEAR_OP0    = 0x90;  // 0x90..0x93 = zero the output buffer
static constexpr uint8_t  AC_BQP0         = 0xe0;  // 0xe0..0xef = set BackgroundQueuePolicy 0..15

// BackgroundQueuePolicy (node-wide): the severity at which the gateway harvests RDM STATUS_MESSAGES
// from fixtures in the background. 4 = disabled (default); 0..3 = collect NONE/ADVISORY/WARNING/ERROR.
// Persisted in NVS under key "bqpolicy". Settable via ArtAddress AcBqp* or the web RDM tab.
static uint8_t         g_bqPolicy    = 4;
static volatile bool   g_bqDirty     = false;   // policy changed -> loop() persists it
static volatile bool   g_artCfgDirty = false;   // ArtAddress changed cfg.outputs -> loop() saveConfig()
static constexpr uint32_t BQ_POLL_MS = 5000;    // re-check each device's status at most this often

// ---- module config (captured at init) -------------------------------------
static int      g_artSock       = -1;     // 6454 UDP, owned by core 0 (netRxTask): RX + all TX
static bool     g_artRdmReady   = false;
static uint32_t g_nodeIp        = 0;
static uint8_t  g_nodeMac[6]    = {0};
static bool     g_artRdmEnabled = true;   // mirror of cfg.artnetRdm

// Our RDM port-address = the RDM output's universe (Net/Sub-Net 0, 0..15 here).
static inline uint16_t artRdmPortAddr() {
    return (rdmOut >= 0) ? (uint16_t)cfg.outputs[rdmOut].universe : 0xFFFF;
}

// ---- cross-core work queues -----------------------------------------------
// core 0 (net) -> core 1 (bus): a request to run on the RDM wire.
struct ArtRdmReq {
    uint8_t  kind;        // 0 = TOD request, 1 = TOD flush, 2 = ArtRdm relay
    uint32_t ip;          // requester, for the reply
    uint16_t portAddr;
    uint16_t rdmLen;      // kind 2: RDM packet length (no start code)
    uint8_t  rdm[257];    // kind 2: RDM packet bytes (no start code)
};
// core 1 (bus) -> core 0 (net): a fully-built Art-Net packet to transmit.
struct ArtRdmResp {
    uint32_t ip;
    uint16_t len;
    uint8_t  data[600];
};
enum { ARTREQ_TOD = 0, ARTREQ_FLUSH = 1, ARTREQ_RDM = 2 };
static QueueHandle_t g_artReqQ  = nullptr;   // depth 8
static QueueHandle_t g_artRespQ = nullptr;   // depth 6

// ---- TOD subscribers (core 1 only): IPs that asked for the TOD, pushed on change ----
static constexpr int ART_MAX_SUBS = 8;
static uint32_t g_artSubs[ART_MAX_SUBS] = {0};
static void artAddSub(uint32_t ip) {
    for (int i = 0; i < ART_MAX_SUBS; i++) if (g_artSubs[i] == ip) return;
    for (int i = 0; i < ART_MAX_SUBS; i++) if (g_artSubs[i] == 0) { g_artSubs[i] = ip; return; }
    g_artSubs[0] = ip;   // table full: overwrite the oldest slot
}

// ---- stats (for /rdm.json + web UI) ---------------------------------------
static volatile uint32_t g_artTodReqs = 0, g_artRdmReqs = 0, g_artFlushes = 0, g_artPolls = 0;
static volatile bool     g_artDiscovering = false;
// Live discovery progress for the RDM tab's "scanning" display. Written by the core-1
// discovery step, read by /rdm.json on core 0. stage: 0=idle 1=search 2=enrich 3=publish;
// found=UIDs seen so far; cur=device being read (0-based) of found; sub=PID within a device
// (0=info 1=sw 2=mfg 3=model 4=label 5=sensor-def 6=sensor-val 7=done).
static volatile uint8_t g_discStage = 0, g_discFound = 0, g_discCur = 0, g_discSub = 0;

// ===========================================================================
//  Packet builders
// ===========================================================================
static int rdmLineForUniverse(uint16_t uni);   // fwd decl (defined with the discovery machine)
static inline void wrU16LE(uint8_t* p, uint16_t v) { p[0] = v & 0xff; p[1] = v >> 8; }

// ArtPollReply (239 bytes) for ONE output port. Art-Net wants a separate reply per port, each with
// its own Net/Sub-Net switches and a unique BindIndex, because a single reply carries only one
// Net/Sub-Net and so can't describe ports on different sub-nets. The universe is the full 15-bit
// port-address: Net(7) << 8 | Sub-Net(4) << 4 | Universe(4), not just the low nibble.
static int buildArtPollReply(uint8_t* b, int outIdx, int bindIndex) {
    g_nodeIp = (uint32_t)netLocalIP();          // refresh (DHCP may have assigned it after init)
    memset(b, 0, 239);
    memcpy(b, ARTNET_ID, 8);
    wrU16LE(b + 8, ARTNET_OP_POLLREPLY);
    b[10] = g_nodeIp & 0xff; b[11] = (g_nodeIp >> 8) & 0xff;
    b[12] = (g_nodeIp >> 16) & 0xff; b[13] = (g_nodeIp >> 24) & 0xff;
    wrU16LE(b + 14, ARTNET_PORT);              // Port (LE) = 0x1936
    b[16] = 0; b[17] = 1;                      // VersInfo H/L
    uint16_t uni = (uint16_t)cfg.outputs[outIdx].universe;
    b[18] = (uni >> 8) & 0x7f;                 // NetSwitch (bits 8..14 of the port-address)
    b[19] = (uni >> 4) & 0x0f;                 // SubSwitch (bits 4..7 = sub-net)
    b[20] = 0; b[21] = 0;                      // Oem (unregistered)
    bool rdmNode = g_artRdmEnabled && rdmRmtLineCount() > 0;
    b[23] = 0xd0 | (rdmNode ? 0x02 : 0x00);    // Status1: indicators normal + bit1 = RDM capable
    b[24] = 0x58; b[25] = 0x4C;               // EstaMan (lo,hi) = 0x4C58 'LX'
    strlcpy((char*)(b + 26), "LuxDMX", 18);    // ShortName
    strlcpy((char*)(b + 44), "LuxDMX Art-Net / sACN DMX gateway", 64);  // LongName
    strlcpy((char*)(b + 108), "#0001 [0] OK", 64);   // NodeReport
    // one output port
    b[173] = 1;                                // NumPortsLo = 1
    b[174] = 0x80;                             // PortTypes: output, DMX512
    // GoodOutput: bit7 = data is being transmitted, bit1 = merge mode is LTP (clear = HTP). A console
    // reads bit1 to show the current merge mode -- without it, flipping HTP/LTP in the console looks
    // like it does nothing because the read-back always says HTP.
    b[182] = 0x80 | (cfg.outputs[outIdx].mergeMode == MERGE_LTP ? 0x02 : 0x00);
    b[190] = uni & 0x0f;                       // SwOut: universe nibble (bits 0..3)
    // GoodOutputB (Art-Net 4) reports this port's RDM state to the controller:
    //   bit7 set = RDM disabled          bit6 set = continuous output style
    //   bit5 set = discovery NOT running  bit4 set = background discovery disabled
    // We must report bit5 honestly: hard-coding it clear tells the controller we are *permanently*
    // mid-discovery, and a controller (e.g. DMX-Workshop) won't settle a device to "active" while it
    // believes the gateway's TOD is still being built. Set bit5 whenever discovery is idle so the
    // TOD reads as final. bit4 stays clear (background discovery is enabled/available).
    bool rdmOn = rdmNode && rdmLineForOut[outIdx] >= 0 && outReady[outIdx];
    uint8_t gob = 0x00;
    if (!rdmOn)                gob |= 0x80;    // RDM disabled on this port
    if (!g_artDiscovering)     gob |= 0x20;    // discovery is not currently running -> TOD is final
    b[213] = gob;
    b[200] = 0x00;                             // Style = StNode
    memcpy(b + 201, g_nodeMac, 6);             // MAC
    b[207] = b[10]; b[208] = b[11]; b[209] = b[12]; b[210] = b[13];   // BindIp = our IP
    b[211] = (uint8_t)bindIndex;               // BindIndex (1-based, unique per port)
    b[212] = 0x0e;                             // Status2: web-config + 15-bit + DHCP capable
    b[217] = 0x02;                             // Status3 bit1: BackgroundQueue supported
    b[228] = g_bqPolicy;                       // BackgroundQueuePolicy (0..3 = collect severity, 4 = off)
    return 239;
}

// 1-based BindIndex of the enabled output that carries this universe -- must match the BindIndex the
// same port was given in ArtPollReply, since the controller ties a TOD to a port via
//   Physical Port = (BindIndex-1) * NumPortsLo + Port   (Art-Net 4, ArtTodData).
static uint8_t artBindIndexForUniverse(uint16_t uni) {
    int bind = 0;
    for (int i = 0; i < MAX_OUTPUTS; i++) {
        if (!cfg.outputs[i].enabled) continue;
        bind++;
        if ((uint16_t)cfg.outputs[i].universe == uni) return (uint8_t)bind;
    }
    return 1;
}

// ArtTodData for one port-address, carrying the current TOD (our discovered UIDs).
static int buildArtTodData(uint8_t* b, uint16_t portAddr, const rdm_uid_t* uids, int n) {
    if (n > 200) n = 200;                       // one block holds up to 200 UIDs
    memset(b, 0, 28);
    memcpy(b, ARTNET_ID, 8);
    wrU16LE(b + 8, ARTNET_OP_TODDATA);
    b[10] = 0; b[11] = 14;                      // ProtVer H/L
    b[12] = 1;                                  // RdmVer = 1 (E1.20)
    b[13] = 1;                                  // Port (physical port index within this bind = 1)
    b[20] = artBindIndexForUniverse(portAddr);  // BindIndex must match this port's ArtPollReply
    b[21] = (portAddr >> 8) & 0x7f;             // Net
    b[22] = 0x00;                               // CommandResponse: ArTodFull (TOD is complete)
    b[23] = portAddr & 0xff;                    // Address (Sub-Net + Universe)
    b[24] = (n >> 8) & 0xff; b[25] = n & 0xff;  // UidTotal
    b[26] = 0;                                  // BlockCount
    b[27] = (uint8_t)n;                         // UidCount in this packet
    int o = 28;
    for (int i = 0; i < n; i++) {
        b[o++] = uids[i].man_id >> 8;   b[o++] = uids[i].man_id & 0xff;
        b[o++] = uids[i].dev_id >> 24;  b[o++] = (uids[i].dev_id >> 16) & 0xff;
        b[o++] = (uids[i].dev_id >> 8) & 0xff; b[o++] = uids[i].dev_id & 0xff;
    }
    return o;
}

// ArtRdm wrapping a relayed RDM reply (rdmNoSC = RDM message without the 0xCC start code).
static int buildArtRdm(uint8_t* b, uint16_t portAddr, const uint8_t* rdmNoSC, int rdmLen) {
    memset(b, 0, 24);
    memcpy(b, ARTNET_ID, 8);
    wrU16LE(b + 8, ARTNET_OP_RDM);
    b[10] = 0; b[11] = 14;                      // ProtVer H/L
    b[12] = 1;                                  // RdmVer = 1
    b[21] = (portAddr >> 8) & 0x7f;             // Net
    b[22] = 0x00;                               // Command = ArProcess
    b[23] = portAddr & 0xff;                    // Address
    memcpy(b + 24, rdmNoSC, rdmLen);
    return 24 + rdmLen;
}

// ===========================================================================
//  core 0: receive + dispatch
// ===========================================================================
static bool artPortMatches(uint16_t portAddr) {
    for (int i = 0; i < MAX_OUTPUTS; i++)
        if (cfg.outputs[i].enabled && (uint16_t)cfg.outputs[i].universe == portAddr) return true;
    return false;
}

// Send a raw UDP datagram to ip:6454 from our Art-Net socket. Core 0 only (single-owner socket).
// `ip` is the network-order s_addr captured from the sender, so it goes straight back.
static void artSendTo(uint32_t ip, const uint8_t* data, int len) {
    if (g_artSock < 0) return;
    struct sockaddr_in dst = {};
    dst.sin_family = AF_INET;
    dst.sin_port = htons(ARTNET_PORT);
    dst.sin_addr.s_addr = ip;
    lwip_sendto(g_artSock, data, len, 0, (struct sockaddr*)&dst, sizeof(dst));
}

// Enqueue a request to the bus task; drop silently if the queue is full (controller retries).
static void artEnqueueReq(const ArtRdmReq& r) {
    if (g_artReqQ) xQueueSend(g_artReqQ, &r, 0);
}

// Output index reached by a 1-based BindIndex (inverse of the BindIndex we assign in ArtPollReply:
// the Nth enabled output gets BindIndex N). -1 if out of range.
static int artOutForBindIndex(uint8_t bind) {
    int b = 0;
    for (int i = 0; i < MAX_OUTPUTS; i++) {
        if (!cfg.outputs[i].enabled) continue;
        if (++b == (int)bind) return i;
    }
    return -1;
}

// Unicast one ArtPollReply per enabled output (each with its own BindIndex + universe) back to `ip`.
// Used to answer both ArtPoll and ArtAddress (the spec requires ArtAddress to be confirmed with an
// ArtPollReply, which is also how a console reads back the change it just made).
static void artSendPollReplies(uint32_t ip) {
    static uint8_t reply[239];
    int bind = 1;
    for (int i = 0; i < MAX_OUTPUTS; i++) {
        if (!cfg.outputs[i].enabled) continue;
        int len = buildArtPollReply(reply, i, bind++);
        artSendTo(ip, reply, len);
    }
    if (bind == 1) {   // no enabled output: still answer so the console sees the node
        int len = buildArtPollReply(reply, 0, 1);
        reply[173] = 0;   // NumPorts = 0
        artSendTo(ip, reply, len);
    }
}

// Handle one Art-Net packet (already validated as "Art-Net"). Runs on core 0.
static void artHandlePacket(const uint8_t* p, int n, uint32_t ip) {
    uint16_t op = p[8] | (p[9] << 8);
    switch (op) {
    case ARTNET_OP_DMX: {
        if (n < 18 || cfg.protocol == 1) return;   // protocol 1 = sACN only -> ignore Art-Net DMX
        uint16_t universe = p[14] | (p[15] << 8);
        uint16_t length   = (p[16] << 8) | p[17];      // Art-Net length is big-endian
        if (length > 512) length = 512;
        if (18 + length > n) length = n - 18;
        routeFrame((int)universe, p + 18, length, ip, 0, DEFAULT_PRIORITY);
        return;
    }
    case ARTNET_OP_POLL: {
        g_artPolls++;
        artSendPollReplies(ip);   // one reply per enabled output (own BindIndex + universe)
        return;
    }
    case ARTNET_OP_ADDRESS: {
        // Remote port configuration (DMX-Workshop's "Configure Port" dialog). Command @ byte 106,
        // BindIndex @ byte 13 selects the port. We honour merge mode + background queue policy +
        // output-clear here; universe/port-name programming is intentionally not handled yet.
        if (n < 107) return;
        uint8_t bindIndex = p[13];
        uint8_t cmd       = p[106];
        int out = artOutForBindIndex(bindIndex ? bindIndex : 1);
        uint8_t hi = cmd & 0xf0;
        if (cmd >= AC_BQP0) {                                  // 0xe0..0xef: background queue policy 0..15
            g_bqPolicy = cmd - AC_BQP0;
            g_bqDirty  = true;
            Serial.printf("[ART-ADDR] BackgroundQueuePolicy = %u\n", g_bqPolicy);
        } else if (hi == AC_MERGE_LTP0 || hi == AC_MERGE_HTP0 || cmd == AC_CANCEL_MERGE) {
            if (out >= 0) {
                if (hi == AC_MERGE_HTP0)      cfg.outputs[out].mergeMode = MERGE_HTP;
                else if (hi == AC_MERGE_LTP0) cfg.outputs[out].mergeMode = MERGE_LTP;
                else /* AcCancelMerge */      cfg.outputs[out].mergeMode = MERGE_OFF;
                g_artCfgDirty = true;                          // loop() persists via saveConfig()
                Serial.printf("[ART-ADDR] out%d mergeMode = %d (bind %u)\n",
                              out, cfg.outputs[out].mergeMode, bindIndex);
            }
        }
        // (AcClearOp / universe / port-name programming intentionally not handled yet.)
        // Every ArtAddress must be answered with an ArtPollReply (spec) -- also how the console reads
        // back the applied value and repaints its dialog.
        artSendPollReplies(ip);
        return;
    }
    case ARTNET_OP_TODREQUEST: {
        if (!g_artRdmEnabled || n < 24) return;
        uint8_t net = p[21], addCount = p[23];
        for (int i = 0; i < addCount && 24 + i < n; i++) {
            uint16_t pa = ((uint16_t)(net & 0x7f) << 8) | p[24 + i];
            if (!artPortMatches(pa)) continue;
            ArtRdmReq r = {}; r.kind = ARTREQ_TOD; r.ip = ip; r.portAddr = pa;
            artEnqueueReq(r);
        }
        return;
    }
    case ARTNET_OP_TODCONTROL: {
        if (!g_artRdmEnabled || n < 24) return;
        uint8_t net = p[21], cmd = p[22];
        uint16_t pa = ((uint16_t)(net & 0x7f) << 8) | p[23];
        if (!artPortMatches(pa)) return;
        ArtRdmReq r = {}; r.ip = ip; r.portAddr = pa;
        r.kind = (cmd == ATC_FLUSH) ? ARTREQ_FLUSH : ARTREQ_TOD;
        artEnqueueReq(r);
        return;
    }
    case ARTNET_OP_RDM: {
        if (!g_artRdmEnabled || n < 26) return;
        uint8_t net = p[21];
        uint16_t pa = ((uint16_t)(net & 0x7f) << 8) | p[23];
        if (rdmLineForUniverse(pa) < 0) return;        // must be one of our RDM universes
        // The ArtRdm RdmPacket field is commonly zero-padded to a fixed size -- DMX-Workshop sends
        // a 280-byte field (n=304) for a 26-byte GET. Derive the true length from the RDM message's
        // own Message Length byte (p[25], counts SC..last PD) rather than the packet size, so the
        // trailing padding is ignored. Using n-24 overflowed the 257 cap and dropped every request.
        int msgLen = p[25];                            // RDM Message Length (SC .. last param-data slot)
        int rdmLen = msgLen + 1;                        // RdmPacket = msgLen (incl SC) + 2 checksum - SC
        if (msgLen < RDM_HDR_LEN || rdmLen > 257 || 24 + rdmLen > n) return;
        ArtRdmReq r = {}; r.kind = ARTREQ_RDM; r.ip = ip; r.portAddr = pa;
        r.rdmLen = rdmLen; memcpy(r.rdm, p + 24, rdmLen);
        artEnqueueReq(r);
        return;
    }
    default: return;   // ArtSync, ArtTodData, ArtRdmSub etc. -> not our concern as a node
    }
}

// Drain the 6454 socket: parse Art-Net, dispatch. Bounded so a backlog can't starve the task.
static void artRdmPollRx() {
    if (!g_artRdmReady || g_artSock < 0) return;
    static uint8_t buf[640];
    for (int k = 0; k < 64; k++) {
        struct sockaddr_in src; socklen_t sl = sizeof(src);
        int n = lwip_recvfrom(g_artSock, buf, sizeof(buf), 0, (struct sockaddr*)&src, &sl);
        if (n <= 0) break;                       // non-blocking: <=0 means nothing left
        if (n >= 12 && memcmp(buf, ARTNET_ID, 8) == 0)
            artHandlePacket(buf, n, (uint32_t)src.sin_addr.s_addr);
    }
}

// Send any replies the bus task produced. Runs on core 0 (same task as RX -> single-owner socket).
static void artRdmDrainResponses() {
    if (!g_artRdmReady || !g_artRespQ) return;
    static ArtRdmResp resp;
    for (int k = 0; k < 8; k++) {
        if (xQueueReceive(g_artRespQ, &resp, 0) != pdTRUE) break;
        artSendTo(resp.ip, resp.data, resp.len);
    }
}

// ===========================================================================
//  core 1: incremental discovery machine + request service (bus owner)
// ===========================================================================
// One RDM bus op per call, driven from the DMX task between frames, so DMX never stalls.
enum ArtDiscPhase { AD_IDLE, AD_START, AD_SEARCH, AD_ENRICH, AD_PUBLISH };
static ArtDiscPhase g_adPhase = AD_IDLE;
// search
static uint64_t g_adStkLo[64], g_adStkHi[64];
static int      g_adSp = 0;
static uint64_t g_adLo, g_adHi;
static bool     g_adRange = false;
static int      g_adBudget = 0;
static rdm_uid_t g_adFound[RDM_HW_MAX];        // small fixed uid scratch (hard max)
static int      g_adFoundN = 0;
// enrich (one transaction per step). g_adTab is the second big RdmDevice table; like rdmDevices
// it is allocated to g_rdmMaxDev entries in rdmAllocTables() (prefers PSRAM), not static.
static RdmDevice* g_adTab = nullptr;           // [g_rdmMaxDev]
static int      g_adTabN = 0;
static int      g_adEi = 0;       // which found device
static int      g_adSub = 0;      // 0=info 1=sw 2=sensordef 3=sensorval
static int      g_adSensor = 0;
static int      g_adLine = 0;     // RDM line (transceiver output) currently being discovered
static bool     g_adAll  = false; // true = sweep every line in sequence (one Discover, both universes)

// line < 0 discovers every RDM line in sequence; line >= 0 discovers just that one.
static void artStartDiscovery(int line = -1) {
    if (g_adPhase != AD_IDLE || rdmRmtLineCount() == 0) return;
    g_adAll  = (line < 0);
    g_adLine = g_adAll ? 0 : line;
    if (g_adLine >= rdmRmtLineCount()) return;
    rdmRmtSelect(g_adLine);
    g_adPhase = AD_START;
    g_artDiscovering = true;
    rdmBusy = true;
}

// Compare the freshly found UID set to the current TOD; true if it changed.
static bool artTodChanged() {
    if (g_adTabN != rdmCount) return true;
    for (int i = 0; i < g_adTabN; i++) {
        bool seen = false;
        for (int j = 0; j < rdmCount; j++)
            if (rdm_uid_is_eq(&g_adTab[i].uid, &rdmDevices[j].uid)) { seen = true; break; }
        if (!seen) return true;
    }
    return false;
}

// The RDM engine line that reaches a given Art-Net universe/port-address, or -1.
static int rdmLineForUniverse(uint16_t uni) {
    for (int L = 0; L < MAX_OUTPUTS; L++) {
        int o = rdmOutForLine[L];
        if (o >= 0 && (uint16_t)cfg.outputs[o].universe == uni) return L;
    }
    return -1;
}

// Enqueue an ArtTodData carrying one universe's current TOD straight back to a single requester.
static void artSendCurrentTod(uint32_t ip, uint16_t pa) {
    static uint8_t pkt[28 + RDM_HW_MAX * 6];
    rdm_uid_t uids[RDM_HW_MAX];
    int nu = 0;                                    // only the fixtures on this universe
    for (int i = 0; i < rdmCount; i++)
        if ((uint16_t)rdmDevices[i].universe == pa) uids[nu++] = rdmDevices[i].uid;
    int len = buildArtTodData(pkt, pa, uids, nu);
    ArtRdmResp r; r.ip = ip; r.len = len; memcpy(r.data, pkt, len);
    if (g_artRespQ) xQueueSend(g_artRespQ, &r, 0);
}

// Push each RDM universe's own Table of Devices to every subscriber (one ArtTodData per port).
static void artPushTodToSubs() {
    static uint8_t pkt[28 + RDM_HW_MAX * 6];
    rdm_uid_t uids[RDM_HW_MAX];
    for (int L = 0; L < MAX_OUTPUTS; L++) {
        int o = rdmOutForLine[L];
        if (o < 0) continue;
        uint16_t pa = (uint16_t)cfg.outputs[o].universe;
        int nu = 0;
        for (int i = 0; i < rdmCount; i++)
            if (rdmDevices[i].universe == pa) uids[nu++] = rdmDevices[i].uid;
        int len = buildArtTodData(pkt, pa, uids, nu);
        for (int s = 0; s < ART_MAX_SUBS; s++) {
            if (!g_artSubs[s]) continue;
            ArtRdmResp r; r.ip = g_artSubs[s]; r.len = len; memcpy(r.data, pkt, len);
            if (g_artRespQ) xQueueSend(g_artRespQ, &r, 0);
        }
    }
}

// Advance the discovery state machine by one bus transaction. Returns true if still working.
static bool artDiscStep() {
    rdm_ack_t ack;
    // snapshot progress for the web UI (one cheap write per bus step)
    g_discStage = (g_adPhase == AD_SEARCH) ? 1 : (g_adPhase == AD_ENRICH) ? 2
                : (g_adPhase == AD_PUBLISH) ? 3 : (g_adPhase == AD_START) ? 1 : 0;
    g_discFound = (uint8_t)g_adFoundN;
    g_discCur   = (uint8_t)g_adEi;
    g_discSub   = (uint8_t)g_adSub;
    switch (g_adPhase) {
    case AD_START:
        rdmRmtSelect(g_adLine);      // drive discovery on this line's transceiver + RX UART
        rdmUnMuteAll();
        g_adSp = 0; g_adStkLo[0] = 0; g_adStkHi[0] = uidPack(RDM_UID_MAX); g_adSp = 1;
        g_adRange = false; g_adFoundN = 0;
        g_adBudget = 8 * g_rdmMaxDev + 128;
        g_adPhase = AD_SEARCH;
        return true;
    case AD_SEARCH: {
        if (!g_adRange) {
            if (g_adSp == 0 || g_adFoundN >= g_rdmMaxDev || g_adBudget <= 0) {
                g_adEi = 0; g_adSub = 0; g_adTabN = 0; g_adPhase = AD_ENRICH;
                return true;
            }
            g_adLo = g_adStkLo[--g_adSp]; g_adHi = g_adStkHi[g_adSp];
            g_adRange = true;
        }
        rdm_uid_t f; int r = rdmDiscBranch(g_adLo, g_adHi, &f); g_adBudget--;
        if (r == 0) { g_adRange = false; return true; }          // branch empty -> next range
        if (r == 1) {                                            // one visible -> mute + record
            if (rdmMute(f)) {
                bool dup = false;
                for (int i = 0; i < g_adFoundN; i++)
                    if (uidPack(g_adFound[i]) == uidPack(f)) { dup = true; break; }
                if (!dup && g_adFoundN < g_rdmMaxDev) g_adFound[g_adFoundN++] = f;
            }
            return true;                                         // re-scan this range (device muted out)
        }
        if (g_adLo >= g_adHi) { g_adRange = false; return true; }// collision at one address -> drop
        uint64_t mid = g_adLo + (g_adHi - g_adLo) / 2;           // collision -> split, left half now
        if (g_adSp < 63) { g_adStkLo[g_adSp] = mid + 1; g_adStkHi[g_adSp] = g_adHi; g_adSp++; }
        g_adHi = mid;
        return true;
    }
    case AD_ENRICH: {
        if (g_adEi >= g_adFoundN) { g_adPhase = AD_PUBLISH; return true; }
        RdmDevice& d = g_adTab[g_adEi];
        switch (g_adSub) {
        case 0: {                                               // DEVICE_INFO (first step for this device)
            d = RdmDevice{}; d.uid = g_adFound[g_adEi];
            rdm_device_info_t info;
            if (rdmRmtGetDeviceInfo(d.uid, &info, &ack) && ack.type == RDM_RESPONSE_TYPE_ACK) {
                d.startAddr = info.dmx_start_address; d.footprint = info.footprint;
                d.modelId = info.model_id; d.subDeviceCount = info.sub_device_count;
                d.productCategory = info.product_category; d.swVersionId = info.software_version_id;
                d.personality = info.personality.current; d.personalityCount = info.personality.count;
                d.sensorCount = info.sensor_count > RDM_MAX_SENSORS ? RDM_MAX_SENSORS : info.sensor_count;
            }
            g_adSub = 1;
            return true;
        }
        case 1:                                                 // SOFTWARE_VERSION_LABEL
            rdmRmtGetSwLabel(d.uid, d.swLabel, sizeof(d.swLabel), &ack);
            g_adSub = 2;
            return true;
        case 2:                                                 // MANUFACTURER_LABEL
            rdmRmtGetString(d.uid, RDM_PID_MANUFACTURER_LABEL, d.mfgLabel, sizeof(d.mfgLabel), &ack);
            g_adSub = 3;
            return true;
        case 3:                                                 // DEVICE_MODEL_DESCRIPTION
            rdmRmtGetString(d.uid, RDM_PID_DEVICE_MODEL_DESCRIPTION, d.modelDesc, sizeof(d.modelDesc), &ack);
            g_adSub = 4;
            return true;
        case 4:                                                 // DEVICE_LABEL (user-assignable)
            rdmRmtGetString(d.uid, RDM_PID_DEVICE_LABEL, d.deviceLabel, sizeof(d.deviceLabel), &ack);
            g_adSensor = 0;
            g_adSub = (d.sensorCount > 0) ? 5 : 7;
            return true;
        case 5: {                                               // SENSOR_DEFINITION (sensor g_adSensor)
            RdmSensor& sen = d.sensors[g_adSensor];
            rdm_sensor_definition_t def = {};
            if (rdmRmtGetSensorDef(d.uid, g_adSensor, &def, &ack) && ack.type == RDM_RESPONSE_TYPE_ACK) {
                sen.type = def.type;
                strlcpy(sen.name, def.description[0] ? def.description : rdmTypeStr(def.type), sizeof(sen.name));
                strlcpy(sen.unit, rdmUnitStr(def.unit), sizeof(sen.unit));
            }
            g_adSub = 6;
            return true;
        }
        case 6: {                                               // SENSOR_VALUE (present + lowest/highest/recorded)
            RdmSensor& sen = d.sensors[g_adSensor];
            int16_t p, lo, hi, rec;
            if (rdmRmtGetSensorFull(d.uid, g_adSensor, &p, &lo, &hi, &rec, &ack)) {
                sen.value = p; sen.lowest = lo; sen.highest = hi; sen.recorded = rec; sen.valid = true;
                if (!sen.name[0]) strlcpy(sen.name, "Sensor", sizeof(sen.name));
            }
            g_adSensor++;
            g_adSub = (g_adSensor < d.sensorCount) ? 5 : 7;
            return true;
        }
        default:                                                // 7 -> this device is done
            g_adTabN = g_adEi + 1;
            g_adEi++; g_adSub = 0;
            return true;
        }
    }
    case AD_PUBLISH: {
        int outIdx = rdmOutForLine[g_adLine];
        uint16_t uni = (outIdx >= 0) ? cfg.outputs[outIdx].universe : 0;
        // Replace only THIS line's fixtures in the shared table; keep the other lines' fixtures.
        int keep = 0;
        for (int i = 0; i < rdmCount; i++)
            if (rdmDevices[i].universe != uni) rdmDevices[keep++] = rdmDevices[i];
        rdmCount = keep;
        for (int i = 0; i < g_adTabN && rdmCount < g_rdmMaxDev; i++) {
            g_adTab[i].universe = uni;
            g_adTab[i].rdmLine  = (uint8_t)g_adLine;
            rdmDevices[rdmCount++] = g_adTab[i];
        }
        rdmApplySavedPoll();     // restore each fixture's per-sensor poll switches
        rdmScanned = true;
        Serial.printf("[RDM] discovery line %d (uni %d): %d device(s)\n", g_adLine, uni, g_adTabN);
        if (g_adAll && g_adLine + 1 < rdmRmtLineCount()) {   // sweep the next line too
            g_adLine++;
            rdmRmtSelect(g_adLine);
            g_adPhase = AD_START;
            return true;
        }
        rdmBusy = false;
        g_artDiscovering = false;
        g_adPhase = AD_IDLE;
        artPushTodToSubs();
        return false;
    }
    default:
        return false;
    }
}

// Live sensor poll: refresh each *enabled* sensor about once a second. A bus op only happens on
// a frame where an enabled sensor is actually due, so the DMX frame rate only takes a hit
// proportional to how many sensors are switched on (roughly one read per second per sensor)
// instead of one RDM transaction on every single frame. Disabled sensors are never touched.
static int g_pollDev = 0, g_pollSen = 0;
static const uint32_t SENSOR_POLL_MS = 1000;
static void artSensorPollStep() {
    uint32_t now = millis();
    for (int tries = 0; tries < g_rdmMaxDev * RDM_MAX_SENSORS; tries++) {
        if (rdmCount == 0) return;
        if (g_pollDev >= rdmCount) { g_pollDev = 0; g_pollSen = 0; }
        RdmDevice& d = rdmDevices[g_pollDev];
        if (d.sensorCount == 0 || g_pollSen >= d.sensorCount) { g_pollDev++; g_pollSen = 0; continue; }
        RdmSensor& s = d.sensors[g_pollSen];
        if (!s.poll || (uint32_t)(now - s.pollMs) < SENSOR_POLL_MS) { g_pollSen++; continue; }
        rdmRmtSelect(d.rdmLine);   // reach this fixture on its own line/universe
        rdm_ack_t ack; int16_t p, lo, hi, rec;
        if (rdmRmtGetSensorFull(d.uid, g_pollSen, &p, &lo, &hi, &rec, &ack)) {
            s.value = p; s.lowest = lo; s.highest = hi; s.recorded = rec; s.valid = true;
        }
        s.pollMs = now;
        g_pollSen++;
        return;   // one due sensor read this frame
    }
    // nothing due this frame -> no bus op, DMX keeps its full frame rate
}

// Art-Net BackgroundQueuePolicy harvester. While a policy is set (0..3), read one device's
// STATUS_MESSAGE per idle frame (round-robin), filtered by the policy's severity. Lowest priority
// and one bus op, so DMX is untouched. A single paced timer (not a per-device array, to save DRAM on
// the classic ESP32) spreads a full sweep over ~BQ_POLL_MS. The highest-severity message per device
// is cached on the RdmDevice for /rdm.json + the web UI.
static int      g_bqDev  = 0;
static uint32_t g_bqNext = 0;
static void artBqStep() {
    static const uint8_t POLICY_STATUS[4] = { 0x00, 0x02, 0x03, 0x04 };  // NONE/ADVISORY/WARNING/ERROR
    if (g_bqPolicy >= 4 || rdmCount == 0) return;
    uint32_t now = millis();
    uint32_t gap = BQ_POLL_MS / (uint32_t)rdmCount; if (gap < 20) gap = 20;   // one device per this gap
    if ((uint32_t)(now - g_bqNext) < gap) return;
    g_bqNext = now;
    if (g_bqDev >= rdmCount) g_bqDev = 0;
    RdmDevice& d = rdmDevices[g_bqDev++];
    rdmRmtSelect(d.rdmLine);
    rdm_ack_t ack; uint8_t t; uint16_t id; int16_t d1, d2; int cnt;
    if (rdmRmtGetStatus(d.uid, POLICY_STATUS[g_bqPolicy], &t, &id, &d1, &d2, &cnt, &ack)) {
        d.statusType = t; d.statusMsgId = id; d.statusCount = cnt;   // data values parsed, not stored
    }
}

// Called once per DMX frame from rdmService (core 1). Does at most ONE bus op: a user control
// (set personality/label) or a queued ArtRdm relay/TOD takes priority, otherwise one discovery
// step, otherwise (when live polling is on) one sensor read. Never blocks the frame.
static void artRdmService() {
    if (!rdmAvailable()) return;
    g_artRdmEnabled = cfg.artnetRdm;
    rdm_ack_t ack;

    // RDM-tab controls: set personality / device label (one op, user-initiated). Select the target
    // fixture's line first so the request goes out on its universe.
    if (rdmSetPersReq) {
        rdmSetPersReq = false;
        RdmDevice* d = rdmFind(rdmPersUid); if (d) rdmRmtSelect(d->rdmLine);
        if (rdmRmtSetPersonality(rdmPersUid, rdmReqPers, &ack)) {
            if (d) d->personality = rdmReqPers;
            Serial.printf("[RDM] set personality=%u\n", rdmReqPers);
        }
        return;
    }
    if (rdmSetLabelReq) {
        rdmSetLabelReq = false;
        RdmDevice* d = rdmFind(rdmLabelUid); if (d) rdmRmtSelect(d->rdmLine);
        if (rdmRmtSetString(rdmLabelUid, RDM_PID_DEVICE_LABEL, rdmReqLabel, &ack)) {
            if (d) strlcpy(d->deviceLabel, rdmReqLabel, sizeof(d->deviceLabel));
        }
        return;
    }

    // Queued Art-Net requests -- a controller is blocked waiting on each reply. Drain several per
    // frame under a time budget: at one op per DMX frame the relay tops out near 40/s, and a
    // controller polling a full universe issues requests faster than that, so its per-request
    // timeout trips and it reports the devices as lost. The budget bounds the time borrowed from the
    // DMX frame (a relay op is ~9 ms of UART wait, the frame is 25 ms) so DMX keeps ticking while
    // the backlog clears.
    if (g_artReqQ) {
        uint32_t t0 = micros();
        ArtRdmReq req;
        int served = 0;
        while (xQueueReceive(g_artReqQ, &req, 0) == pdTRUE) {
            int reqLine = rdmLineForUniverse(req.portAddr);   // which universe/line this request targets
            if (req.kind == ARTREQ_RDM) {
                g_artRdmReqs++;
                if (reqLine >= 0) rdmRmtSelect(reqLine);       // relay on the target universe's line
                uint8_t respNoSC[257];
                int rl = rdmRmtRawRelay(req.rdm, req.rdmLen, respNoSC, sizeof(respNoSC));
                if (rl > 0) {
                    static uint8_t pkt[600];
                    int len = buildArtRdm(pkt, req.portAddr, respNoSC, rl);
                    ArtRdmResp r; r.ip = req.ip; r.len = len; memcpy(r.data, pkt, len);
                    if (g_artRespQ) xQueueSend(g_artRespQ, &r, 0);
                }
            } else if (req.kind == ARTREQ_TOD) {
                g_artTodReqs++;
                artAddSub(req.ip);
                artSendCurrentTod(req.ip, req.portAddr);
            } else if (req.kind == ARTREQ_FLUSH) {
                g_artFlushes++;
                artAddSub(req.ip);
                // Answer the flush at once with the TOD we already hold: ArtTodControl expects an
                // ArtTodData back promptly, but our re-discovery is deliberately incremental (one bus
                // op per DMX frame) so DMX never stalls. Reply now, refresh in the background, and
                // push the updated TOD to all subscribers when it completes.
                artSendCurrentTod(req.ip, req.portAddr);
                artStartDiscovery(reqLine);
            }
            if (++served >= 8 || (uint32_t)(micros() - t0) > 18000) break;
        }
        if (served) return;
    }

    // A web-triggered discovery (rdmDiscoverReq) runs incrementally; rdmDiscReqLine picks the line
    // (-1 = sweep every universe).
    if (rdmDiscoverReq) { rdmDiscoverReq = false; artStartDiscovery(rdmDiscReqLine); }

    // One discovery step, if a discovery is in progress.
    if (g_adPhase != AD_IDLE) { artDiscStep(); return; }

    // Idle background work (lowest priority, one bus op/frame): live sensor polling and the Art-Net
    // BackgroundQueue status harvest, alternated so both progress when both are enabled.
    bool bqOn = (g_bqPolicy < 4) && rdmCount > 0;
    if (g_pollAny && bqOn) { static bool t = false; t = !t; if (t) artBqStep(); else artSensorPollStep(); }
    else if (bqOn)         artBqStep();
    else if (g_pollAny)    artSensorPollStep();
}

// ---- setup + config -------------------------------------------------------
static void artRdmInit() {
    esp_read_mac(g_nodeMac, ESP_MAC_WIFI_STA);
    g_nodeIp = (uint32_t)netLocalIP();
    g_artRdmEnabled = cfg.artnetRdm;
    prefs.begin(PREF_NS, true);
    g_bqPolicy = prefs.getUChar("bqpolicy", 4);   // restore BackgroundQueuePolicy (4 = disabled)
    prefs.end();
    // Deep enough to hold a whole-universe burst: a console that fires a GET at every device it just
    // discovered (64/universe) must not have requests silently dropped while the bus drains them one
    // per DMX frame. Dropped requests show up in the console as devices that "lost contact".
    if (!g_artReqQ)  g_artReqQ  = xQueueCreate(48, sizeof(ArtRdmReq));
    if (!g_artRespQ) g_artRespQ = xQueueCreate(12, sizeof(ArtRdmResp));
    // Raw UDP socket on 0.0.0.0:6454 with SO_BROADCAST so a limited-broadcast ArtPoll
    // (255.255.255.255, used by DMX-Workshop/OLA) is received, not just subnet-directed.
    // Non-blocking: netRxTask polls it. Single-owner (core 0), so no locking needed.
    g_artSock = lwip_socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (g_artSock >= 0) {
        int one = 1;
        lwip_setsockopt(g_artSock, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
        lwip_setsockopt(g_artSock, SOL_SOCKET, SO_BROADCAST, &one, sizeof(one));
        struct sockaddr_in a = {};
        a.sin_family = AF_INET; a.sin_port = htons(ARTNET_PORT); a.sin_addr.s_addr = INADDR_ANY;
        lwip_bind(g_artSock, (struct sockaddr*)&a, sizeof(a));
        int fl = lwip_fcntl(g_artSock, F_GETFL, 0);
        lwip_fcntl(g_artSock, F_SETFL, fl | O_NONBLOCK);
        g_artRdmReady = true;
    } else {
        Serial.println("[ART-RDM] socket() failed");
    }
    Serial.printf("[ART-RDM] Art-Net RDM node up on :%d (port-address 0x%04X, RDM %s)\n",
                  ARTNET_PORT, artRdmPortAddr(), g_artRdmEnabled ? "on" : "off");
    // No power-on scan: RDM discovers only on demand (a manual Discover, or a console's
    // ArtTodControl/AtcFlush), so boot never dips the DMX output. The TOD starts empty.
}
