#pragma once
// Structural constants the schema references. These are NOT board defaults — they
// describe what the compiled code supports (how many merge modes / fallback modes
// / RMII PHY families exist). They mirror the values in main.cpp; when the engine
// is wired in (Phase 1) main.cpp includes this header instead of redefining them.

// Values MUST match main.cpp's definitions exactly (separate translation units
// share the cfg struct, so the ints have to mean the same thing on both sides).
enum { MERGE_OFF = 0, MERGE_HTP = 1, MERGE_LTP = 2 };
enum { NET_WIFI_STA = 0, NET_WIFI_AP = 1 };
enum { WIRED_FB_RETRY = 0, WIRED_FB_AP = 1, WIRED_FB_REBOOT = 2 };

#ifndef RMII_PHY_COUNT
#define RMII_PHY_COUNT 6   // count of RMII PHY families the code knows (structural)
#endif
