# HIL rig wiring, WT32-ETH01 + MAX485

The hardware-in-the-loop bench with a **WT32-ETH01** (ESP32 + on-board LAN8720 RMII Ethernet)
as the controller, wired to a MAX485 for DMX/RDM, with an RP2350 as the DMX analyzer /
ground-truth / RDM responder on the bus.

Firmware: `wt32eth01` env (RMT DMX + the crash fixes). It clocks DMX out of RMT and uses the
on-board wired Ethernet, so there is **no W5500 to wire**, just plug the RJ45 into the LAN.
OTA update: `curl -F firmware=@.pio/build/wt32eth01/firmware.bin http://<ip>/ota/upload`.

## Controller pins (this rig's running config)

| Signal | WT32 GPIO | config key |
|---|---|---|
| Output 0 DMX out (DI) | **IO5**  | `o0_tx=5` |
| Output 0 RDM rx (RO)  | **IO4**  | `o0_rx=4` |
| Output 0 DE/RE (dir)  | **IO33** | `o0_rts=33` |
| Output 1 DMX out      | IO32     | `o1_tx=32` (unwired on this rig) |

Note: the `wt32eth01` template default is `o0_tx=4 / o0_rx=5`; this bench runs them swapped
(`o0_tx=5 / o0_rx=4`) to match the physical wiring. Use whatever matches your board, the ground
truth is: DMX out is on IO5, RDM rx is on IO4.

## WT32 → MAX485 (DMX / RDM transceiver)

```
  WT32 IO5  (o0_tx) ─────► DI            A ─┬───────────► DMX bus A ──► RP responder
  WT32 IO4  (o0_rx) ◄───── RO   MAX485   B ─┤
  WT32 IO33 (o0_rts)─────► DE + RE (tied)   │  220R bias: A→3V3, B→GND ; 120R term across A/B
  3V3 ──────────────────► VCC              GND ── common
  GND ──────────────────► GND
```
- DE-only style module: DE + RE tied, driven by `o0_rts`. Receiver stays live so the controller
  reads its own echo / the RDM reply on `o0_rx`.
- **Gotcha:** RXD/TXD-labelled modules must be crossed (`TXD=RO → MCU RX`), not name-matched, or the
  RX pin floats and RDM replies never arrive.

## Ethernet

On-board **LAN8720 RMII**, nothing to wire, just the RJ45 to the LAN. (RMII uses IO0/IO16-19/21-23/25-27
internally; keep DMX/other pins off those.) Enabled via `useeth=1`, `wiredphy=1`.

## RP2350 analyzer / responder taps

```
  RP GP5  (ground-truth UART @250k) ◄── WT32 IO5  (o0_tx, DMX out, logic-level tap)
  RP GP13 (reply capture)           ◄── WT32 IO4  (o0_rx, the RDM reply line)
  RP transceiver A/B                ◄─► DMX bus A/B  (RP is the fixture responder + PIO analyzer)
  Common GND between WT32, MAX485, and the RP, required.
```
- `gtRefresh`/`gtFramingErr` (the GP5 UART) are the authoritative "is the DMX output clean" numbers.

## Verified on this rig
- RMT DMX output clean: 40.0 Hz, 0 framing errors, even under a 15k pkt/s Art-Net flood (issue #64 fix).
- Crash fixes hold: heavy flood + WebSocket + `/rdm.json` poll → 0 reboots, 0 aborts, DMX stayed clean.
- 5-hour realistic soak: 37 cycles, 0 reboots, no leak.

## Serial
- USB-serial is a CH340 (open DTR/RTS low so opening the port doesn't reset the running board).
- Logger streams to `C:\tmp\wt32_serial.log`; stop it before using the COM port for a serial write,
  restart after.
