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
};

struct Config {
    String    hostname;
    String    otaPassword;
    int       protocol;
    int       ledPin;
    int       ledType;
    int       ledR, ledG, ledY, ledB, ledW;
    int       ledBrR, ledBrG, ledBrY, ledBrB, ledBrW;  // 5-LED panel per-colour brightness (0-255 PWM duty; green/white run dimmer)
    DmxOutput outputs[MAX_OUTPUTS];
    int       dispType;
    int       dispSda, dispScl, dispRot, dispCs, dispDc, dispRst, dispSck, dispMosi;
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
    bool      autoUpdate;
    bool      artnetRdm;      // respond to RDM-over-Art-Net (ArtTodRequest / ArtRdm)
    int       rdmMaxDev;      // RDM device table cap; 0 = auto-detect from available RAM (+ PSRAM)
};

extern Config cfg;
