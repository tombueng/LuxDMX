// Compiles the board-default config templates into the firmware.
//
// The template DATA is generated from templates/*.ini into
// generated/config_templates.gen.h at build time (extra_scripts.py ->
// tools/gen_config_templates.py). This tiny committed wrapper is what pulls that
// data into the build: it lives in src/ and is always present, so PlatformIO
// always has it in the source-file list. The generator used to emit a .cpp
// directly, but a clean first build globs src/ *before* extra_scripts runs, so
// that freshly generated .cpp was missing from the glob and the link failed with
// "undefined reference to CONFIG_TEMPLATES". A generated header included from this
// committed source sidesteps the ordering entirely (headers are resolved at
// compile time, like every other generated asset in this project).
#include "generated/config_templates.gen.h"
