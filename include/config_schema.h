#pragma once
#include <Arduino.h>

// ---------------------------------------------------------------------------
// The persisted config structs, moved here out of main.cpp. config_schema.cpp
// describes every field below in one table (CONFIG_FIELDS / OUTPUT_FIELDS).
// ---------------------------------------------------------------------------

static constexpr int MAX_OUTPUTS = 2;

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

struct Config {
    String    hostname;
    // Node names a console sees in its Art-Net node list (ArtPollReply ShortName / LongName,
    // programmable from the console with ArtAddress, issue #129). Kept apart from `hostname`
    // on purpose: hostname drives mDNS and the DHCP client name and needs a reboot, while
    // these are a pure label. Empty = fall back to the hostname, so two boxes on the same
    // wire are still told apart without setting anything.
    String    artShortName;   // <= 17 chars on the wire (18 with the NUL)
    String    artLongName;    // <= 63 chars on the wire (64 with the NUL)
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
