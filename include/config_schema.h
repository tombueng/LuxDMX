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
    DmxOutput outputs[MAX_OUTPUTS];
    int       dispType;
    int       dispSda, dispScl, dispRot, dispCs, dispDc, dispRst, dispSck, dispMosi;
    int       ethCs, ethSck, ethMosi, ethMiso, ethInt, ethRst, ethFreqMhz;
    bool      ethW5500;
    int       wiredPhy;
    int       rmiiPhy, rmiiAddr, rmiiMdc, rmiiMdio, rmiiPwr, rmiiClk;
    bool      useEthernet;
    int       wifiMode;
    bool      apFallback;     // derived legacy mirror of linkLossMode (not a schema field)
    int       linkLossMode;
    String    apPassword;
    bool      staticIp;
    String    ip, gateway, subnet, dns;
    bool      autoUpdate;
};

extern Config cfg;
