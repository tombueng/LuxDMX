// Embedded board templates. STOPGAP: hand-written from templates/*.ini so the
// engine + tests work now. Phase-1 task: have extra_scripts.py generate this file
// from templates/*.ini at build time (same trick as the web assets).
#include "config_core.h"

static const char* const T_BASE =
    "subnet=255.255.255.0\n"
    "o0_en=1\n"
    "o1_uni=1\n"
    "o1_port=2\n";

static const char* const T_LUXDMX_V4 =
    "extends=_base\n"
    "ledtype=3\n"
    "ledr=1\nledg=2\nledy=6\nledb=7\nledw=15\n"
    "o0_tx=17\no0_rx=18\no0_rts=8\n"
    "o1_en=1\no1_tx=16\no1_rx=21\no1_rts=47\n"
    "ethcs=10\nethsck=12\nethmosi=11\nethmiso=13\nethint=14\nethrst=9\n"
    "dispsda=4\ndispscl=5\ndispsck=39\ndispmosi=40\ndispcs=41\ndispdc=42\ndisprst=38\n";

static const char* const T_WT32ETH01 =
    "extends=_base\n"
    "ledpin=2\nledtype=1\n"
    "o0_tx=4\no0_rx=5\n"
    "useeth=1\nwiredphy=1\n"
    "rmiimdc=23\nrmiimdio=18\nrmiipwr=16\n"
    "dispsda=14\ndispscl=15\n";

const CfgTemplate CONFIG_TEMPLATES[] = {
    {"_base",      T_BASE},
    {"luxdmx_v4",  T_LUXDMX_V4},
    {"wt32eth01",  T_WT32ETH01},
};
const size_t CONFIG_TEMPLATE_COUNT = sizeof(CONFIG_TEMPLATES) / sizeof(CONFIG_TEMPLATES[0]);
