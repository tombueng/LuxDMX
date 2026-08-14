#pragma once
#include <Arduino.h>

// ---------------------------------------------------------------------------
// The persisted config structs, moved here out of main.cpp. config_schema.cpp
// describes every field below in one table (CONFIG_FIELDS / OUTPUT_FIELDS).
// ---------------------------------------------------------------------------

// Three, because the LuxDMX Carrier board wires three RS-485 transceiver modules. Everything
// sized off this constant grows with it. The spots that are NOT automatic: the WS frame
// (WS_FRAME_LEN, whose two browser-side parsers derive the output count from the frame
// length, so they follow) and the RDM line table (RDM_MAX_LINES in rdm_rmt.h).
static constexpr int MAX_OUTPUTS = 3;

struct DmxOutput {
    bool enabled;
    int  universe;   // Art-Net universe; sACN listens on (universe + 1)
    int  port;       // dmx_port_t: 1 or 2
    int  txPin;
    int  rxPin;      // -1 = output only (no RDM)
    int  rtsPin;     // -1 = auto-direction module / no RDM
    int  mergeMode;  // how to combine multiple sources on this universe
    int  lossMode;   // what to send when every source on this universe goes silent
    // Transmit timing (issue #93). The output used to free-run at a hard-coded 40 Hz, so any
    // console sending at another rate got resampled and some frames went out twice.
    int  txRate;     // index into DMX_RATE_MS: the free-running period for this port
    int  txStyle;    // 0 = continuous (free-run at txRate), 1 = delta (one frame per input packet)
    // Where txStyle came from: 0 = set locally (web UI / serial console), 1 = set remotely by a
    // controller via Art-Net ArtAddress (AcStyleDelta / AcStyleConst). Persisted so the UI can
    // still say "your console set this" after a reboot. Art-Net has no command for the RATE, so
    // txRate is always local and needs no companion field.
    int  txStyleSrc;
};

// WS281x pixel ports. Five, because the LuxDMX Carrier wires five buffered data lines.
// A disabled port allocates nothing at all (see pixel.h): a plain ESP32 pixel node with
// no DMX enabled must stay cheap on heap.
static constexpr int MAX_PIXEL_PORTS = 5;

struct PixelPort {
    bool enabled;
    int  pin;          // data GPIO, -1 = unset
    int  count;        // pixels on this port
    int  chip;         // PIX_CHIP_* — protocol family + channel count
    int  order;        // PIX_ORDER_* — colour order on the wire
    int  universe;     // first Art-Net universe this port consumes
    int  startCh;      // 1..512, the channel inside that universe where pixel 1 starts
    int  uniMode;      // 0 = whole pixels per universe (aligned), 1 = packed across 512
    int  latch;        // PIX_LATCH_* — when a multi-universe frame is pushed
    int  fpsCap;       // output rate ceiling, 0 = uncapped (the strip length still caps it)
    int  bright;       // 0..255 master scale
    int  gamma;        // gamma x100 (220 = 2.2); 0 = off
    int  maxMa;        // per-port power cap in mA, 0 = off
    int  mAPerCh;      // current one channel draws at 255, x100 mA (2000 = 20.00 mA)
    int  quiesMa;      // per-pixel idle draw of the controller IC, x100 mA (100 = 1.00 mA)
    int  lossMode;     // LOSS_HOLD / LOSS_ZERO (STOP is meaningless on a latching strip)
    bool statusIdle;   // drive this port with the status colour while it has no pixel data
    int  viewCols;     // live-view grid, user set; 0 = single wrapped row
    int  viewRows;
    bool viewSerp;     // live view draws the strip serpentine (display only)
};

struct Config {
    String    hostname;
    String    otaPassword;
    // Board the USER picked in /config's board selector. Purely a UI/pin-map choice, the
    // firmware itself never acts on it, but it has to be persisted, because the board a
    // build *reports* (BOARD_ID in main.cpp) is compile-time. A released LuxDMX v6 runs the
    // plain esp32s3dev build and reports "esp32s3-devkitc-1", so without this the selector
    // fell back to the DevKit on every reboot / OTA while the applied pins stayed put.
    String    boardSel;
    int       protocol;
    int       ledPin;
    int       ledType;
    int       ledR, ledG, ledY, ledB, ledW;
    int       ledBrR, ledBrG, ledBrY, ledBrB, ledBrW;  // 5-LED panel per-colour brightness (0-255 PWM duty; green/white run dimmer)
    DmxOutput outputs[MAX_OUTPUTS];
    PixelPort pixels[MAX_PIXEL_PORTS];
    // Board's power-pour rating in mA, so the pixel power budget has something to measure
    // against. Conservative default is the carrier's 2-layer figure; a 4-layer build sets
    // 15400. Purely informational, the firmware never limits on it (that is maxMa per port).
    int       railMa;
    int       dispType;
    int       dispSda, dispScl, dispRot, dispCs, dispDc, dispRst, dispSck, dispMosi;
    // On-unit controls (issue #24): optional rotary encoder + up to 4 buttons that
    // drive a small menu on the display. Every pin -1 = unset; the whole subsystem
    // stays off (and costs nothing) unless something is wired. See input_map.h.
    int       encA, encB, encSw;   // rotary encoder A/B + push button (-1 = none)
    int       encSteps;            // quadrature edges per detent (1/2/4)
    bool      encReverse;          // flip rotation direction (A/B-swapped wiring)
    int       btn1Pin, btn2Pin, btn3Pin, btn4Pin;   // extra buttons (-1 = none)
    int       btn1Act, btn2Act, btn3Act, btn4Act;   // BtnRole per button (off/enter/back/next/prev)
    bool      btnActiveHigh;       // buttons + push: true = active-high (to Vcc), false = active-low (to GND)
    int       ctlUniMax;           // top universe the knob/menu reaches (wraps 0..ctlUniMax)
    int       ethCs, ethSck, ethMosi, ethMiso, ethInt, ethRst, ethFreqMhz;
    bool      ethW5500;
    int       ethSpiPhy;   // SPI Ethernet chip: 0=W5500, 1=DM9051 (used when wiredPhy = SPI)
    int       wiredPhy;
    int       rmiiPhy, rmiiAddr, rmiiMdc, rmiiMdio, rmiiPwr, rmiiClk;
    bool      useEthernet;
    int       wifiMode;
    String    wifiSsid;       // STA: the router SSID we join. Empty on a fresh device -> run the setup portal.
    String    wifiPsk;        // STA: the router password (empty = open network)
    bool      apFallback;     // derived legacy mirror of linkLossMode (not a schema field)
    int       linkLossMode;
    String    apPassword;
    bool      staticIp;
    String    ip, gateway, subnet, dns;
    // Honour Art-Net ArtIpProg (remote IP programming, issue #110). Default OFF: the Art-Net spec has
    // no auth, so with this on any unicast packet on the wire can renumber the node. Off = we don't
    // reply at all, which is exactly how the spec says a node without the feature opts out.
    bool      ipProg;
    bool      autoUpdate;
    bool      artnetRdm;      // respond to RDM-over-Art-Net (ArtTodRequest / ArtRdm)
    int       rdmMaxDev;      // RDM device table cap; 0 = auto-detect from available RAM (+ PSRAM)
};

extern Config cfg;
