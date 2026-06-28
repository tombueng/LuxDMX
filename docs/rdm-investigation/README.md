# Reliable RDM on the ESP32-S3

*An on-the-wire study of RDM timing and DMX-receive reliability on the LuxDMX node, by Thomas Büngener.*

The full write-up is **[REPORT.pdf](REPORT.pdf)** (also a self-contained web page,
[REPORT.html](REPORT.html); Markdown source in [REPORT.md](REPORT.md)). Figures are in
[figures/](figures/).

What it covers:

- The RDM controller's TX to RX turnaround, measured on the physical RS485 wire with a calibrated
  logic analyzer: about 15 us, roughly 160 us before the earliest a compliant fixture may reply, so
  it cannot miss a reply by reacting too slowly. WiFi while idle costs nothing.
- Wired Ethernet (W5500) was breaking RDM discovery, and the fix: keep the network work (AsyncTCP,
  the W5500 SPI bring-up) on core 0 so the DMX/RDM interrupt on core 1 is never starved. Validated at
  800 back-to-back discoveries with zero real misses.
- A measured study of ESP32 DMX *receive* reliability (answering a builder's forum question): the
  128-byte UART FIFO buys about 5.6 ms of slack, esp_dmx keeps its ISR in IRAM, and across WiFi-scan
  load, a sustained real-traffic flood, and real flash writes during receive the error count stayed
  ~0. The one thing that does break it is holding interrupts off longer than the FIFO depth (a
  non-IRAM ISR during a flash blackout, or a long critical section), reproduced and shown.

Built with `pandoc` + `tectonic` from `REPORT.md` and `header.tex`.
