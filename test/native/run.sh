#!/usr/bin/env bash
# Native round-trip test for the config engine (host g++, no device needed).
# Linux/macOS counterpart of run.bat. Compiles test_main.cpp + the engine against
# the Arduino/Preferences shims and runs it. DEFAULT_TEMPLATE picks the board preset
# the first section asserts against.
# Usage:  test/native/run.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
mkdir -p build

# Generate the embedded templates from templates/*.ini (the same source the firmware uses)
python3 tools/gen_config_templates.py "$ROOT" "$ROOT/src/generated/config_templates.gen.h"

# The two -Wno- flags silence known noise in the test shim itself (test/native/shim/Arduino.h),
# not in the engine under test.
g++ -std=c++17 -O1 -Wall -Wextra -Wno-unused-parameter \
    -Wno-deprecated-copy -Wno-misleading-indentation \
    -I test/native/shim -I lib/EmbeddedConfig/src -I include \
    -DDEFAULT_TEMPLATE=luxdmx_v6 \
    test/native/test_main.cpp \
    lib/EmbeddedConfig/src/config_core.cpp lib/EmbeddedConfig/src/config_serial.cpp \
    lib/EmbeddedConfig/src/config_json.cpp \
    src/config/config_schema.cpp src/config_templates_gen.cpp \
    -o build/cfgtest

build/cfgtest

# Pixel mapping / power / gamma arithmetic (src/pixel_map.h). Pure integer maths, no
# Arduino and no hardware, so it runs here rather than needing a strip on a bench.
g++ -std=c++17 -O1 -Wall -Wextra \
    -I include -I src \
    test/native/pixel_map_test.cpp -o build/pixtest
build/pixtest

# Which saved WiFi network gets joined, and the form's reorder (src/wifi_pick.h, issue #120).
g++ -std=c++17 -O1 -Wall -Wextra -I src test/native/wifi_pick_test.cpp -o build/wifitest
build/wifitest

# The DMX/RDM RMT encoder (src/dmx_rmt_enc.h, issue #135): pulled the way the IDF driver does it,
# the symbols and the line levels have to be exactly the old whole-frame encoder's.
g++ -std=c++17 -O1 -Wall -Wextra -I src test/native/dmx_enc_test.cpp -o build/dmxenctest
build/dmxenctest
