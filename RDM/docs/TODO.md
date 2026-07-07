# RDM tester - notes & deferred features

## Robustness

- **Auto-detect RX/TX wiring (immune to the RXD/TXD swap).** Cheap RS485 modules
  label their pins RXD/TXD ambiguously, and it has bitten us twice now: the ESP32-S3
  sim, and again wiring this RP2350 (the transceiver's RO turned out to be on GP0,
  not GP1). The tester should just handle either wiring instead of forcing a
  convention: at boot (and on demand), scan the candidate GPIOs for the ~250 kbaud
  DMX signal, an edge-count exactly like the GPIO edge-scanner that found it on GP0,
  then pick the pin carrying the signal as RX (RO) and the other as TX (DI) and
  configure the PIO accordingly. No jumper, no config screen: wire it either way and
  it just works. (Detect once a signal is present; fall back to the default mapping
  and re-check when the bus goes active.)
