# EmbeddedConfig

A small, schema-driven configuration engine for ESP32 projects. You describe every
persisted setting once, in a field table, and the engine gives you all of this off
that one description:

- **NVS load/save** with per-board default **templates** (`templates/*.ini`) and a
  per-field legacy-key fallback, so an OTA update never wipes an existing device.
- A **JSON** dump (`toJson`) for status pages / inspection.
- **Validated single-field apply** (`setValue`, range-clamped) that a web form or a
  serial line both drive, no field details duplicated per transport.
- A **serial console** (`config_serial`) with one grammar that serves a human at a
  terminal *and* a machine/AI client: `help / list / get / set / json / load /
  template / save / reboot / factory / wifi`.

The engine itself knows nothing about HTTP, WiFi, or your specific settings. It is
generic; the only project-specific pieces live in the consumer.

## What the consumer provides

Two headers on the include path (e.g. the project `include/` dir) plus one source:

- `config_schema.h` — your `Config` (and any nested structs) + `extern Config cfg;`.
- `config_enums.h` — structural constants the schema references (enum counts, etc.).
- `config_schema.cpp` — the field tables `CONFIG_FIELDS[]` / `OUTPUT_FIELDS[]` plus
  their counts, built from the descriptor macros.

Defaults do **not** live in the schema. They come from board templates (key=value
`*.ini` files) embedded into `CONFIG_TEMPLATES[]`; `DEFAULT_TEMPLATE` selects which
one a build applies. The resolution order at `load()` is
`neutral (from each field's constraint) -> active template -> saved NVS`.

## Device-side actions (Hooks)

The serial console's `save / reboot / factory / wifi` verbs are device-specific, so
they are injected as function pointers (`cfgserial::Hooks`) rather than baked in.
Wire them to your firmware's persistence / restart / WiFi in one place.

This library was extracted from the LuxDMX firmware (https://luxdmx.org); see that
project's `src/config/config_schema.cpp` and `templates/` for a complete example.
