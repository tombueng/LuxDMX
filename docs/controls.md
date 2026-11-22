# On-unit controls (rotary encoder + buttons)

Issue [#24](https://github.com/tombueng/LuxDMX/issues/24).

Once a node is bolted into a truss you don't really want to dig out a laptop or
squint at a phone just to bump the universe. So there's an optional knob (and/or a
few buttons) that drives a tiny menu on the display. Turn it, pick the universe,
done. It saves like the web UI does and takes effect straight away.

It's all optional and off by default: nothing runs, and no pins are touched, until
you actually set some pins in `/config`. A board with no encoder pays nothing.

## What you can do with it

- **Set the universe** for each output, live, shown big on the display.
- **Switch the input protocol** (Art-Net / sACN / both).
- **Switch the network** between WiFi (joins your network), WiFi AP (the box makes
  its own) and Ethernet, issue [#150](https://github.com/tombueng/LuxDMX/issues/150).
  Handy for a travel box: phone as hotspot in one place, phone joining the box in
  the next. Ethernet only shows up when a wired PHY is set in `/config`.
- Two outputs? You get a "Uni A" / "Uni B" pair in the menu. One output? It just
  says "Universe".
- The choice persists (NVS), same as the web UI.

The menu is deliberately small right now (universes, protocol, network, exit). It's
built from a plain list so more items are easy to add later.

## Wiring

You can wire **any** of these, in any combination, to any free GPIOs:

- a quadrature **rotary encoder** (A / B), optionally with a **push** switch,
- up to **four buttons**.

Buttons and the encoder push are active-low by default: wire the common pin to GND
and the firmware turns on the internal pull-up. If you'd rather wire to 3V3, flip
*Buttons active-high* in `/config` and it uses pull-downs instead. Encoder A/B are
open contacts to the common pin, so the usual EC11 with the flat side up just works.

On the LuxDMX board the **J6 expansion header** breaks out the free non-strapping GPIOs
plus power for exactly this:

```
J6 (JST-SH, 9-pin):
  1 +3V3  2 GND   3 IO35  4 IO36  5 IO37  6 IO48  7 TX0   8 RX0   9 GND
```

A comfortable default is encoder **A=IO35, B=IO36, push=IO37**, which leaves IO48 for a
button. TX0/RX0 (IO43/IO44) are the UART0 console, so using those costs
you the serial log. (Pins aren't baked in as defaults, set them in `/config` for your
build. The pin picker draws the header for the board you select, which is less error-prone
than counting.)

## How the menu is driven

Everything collapses onto four moves: **move next**, **move prev**, **select**,
**back**. How your hardware produces them:

| Input | Short press / turn | Long press |
|---|---|---|
| Encoder turn | next / prev item (or +/- the value) | – |
| Encoder push | select | back |
| Button set to *Next* / *Prev* | next / prev | select |
| Button set to *Enter* | select | back |
| Button set to *Back* | back | back |
| A single lone button (nothing else) | next | select |

The long-press fallbacks are what make sparse setups usable: a two-button Next/Prev
rig can still *select* by holding, an Enter-only rig can still go *back* by holding,
and a single button can walk the whole menu (tap to move, hold to select) because
the menu always has an **Exit** item to leave by. Turn the knob to move through the
list, press to edit a value, turn to change it, press again to save. Wander off for
a few seconds and the menu closes on its own without saving a half-made edit.

If the display has gone dark from its screen timeout (`disptimeout`, default 20 s, see
[display.md](display.md#screen-timeout-issue-134)), the first turn or press only wakes it up
and does nothing else. Then it works as usual.

### No display, or encoder with no button

If there's no way to *select* (an encoder with no push and no buttons), or there's
no display to show a menu, it falls back to a simpler mode: turning the knob nudges
the first enabled output's universe, and it auto-saves about a second and a half
after you stop turning. Less pretty, still useful.

## Config keys

All live under the **Controls** card in `/config` (and the serial console / NVS use
these keys). Every pin defaults to `-1` (off).

| Key | Meaning | Default |
|---|---|---|
| `enca`, `encb` | rotary encoder A / B pins | `-1` |
| `encsw` | encoder push-button pin | `-1` |
| `encsteps` | quadrature edges per detent: `1` (non-detented), `2` (half-step), `4` (standard EC11) | `4` |
| `encrev` | reverse the turn direction (for A/B-swapped wiring) | off |
| `btn1pin`…`btn4pin` | the four button pins | `-1` |
| `btn1act`…`btn4act` | each button's action: `0` off, `1` Enter, `2` Back, `3` Next, `4` Prev | `3` / `4` / `1` / `2` |
| `btnah` | buttons wired active-high (to 3V3) instead of active-low (to GND) | off |
| `ctlunimax` | top universe the knob/menu reaches; it wraps `0…ctlunimax` | `15` |

The button-action defaults (Next / Prev / Enter / Back) are just what the dropdowns
pre-fill to, so a 4-button build makes sense out of the box. They do nothing until
you give a button a pin.

## What happens when you save

- **Universe**: applied live. Art-Net re-routes by the packet's own universe on the
  very next frame, and sACN re-joins its multicast group (done on the receive task,
  which owns the sockets). No reboot.
- **Protocol**: saved, then the device reboots to bring the right listeners up
  cleanly (the display flashes `REBOOT` for a moment first). Same as the web form.
- **Network**: saved, then the device reboots into the new mode, same as saving the
  Network card on `/config` (it sets `useeth` and `wifimode`). A few things to know:
  - **WiFi** joins the networks saved on `/config`. With none saved it opens the
    `LuxDMX-setup` portal, like a fresh box.
  - **WiFi AP** is named after the hostname. It uses the AP password from `/config`
    (8+ characters, WPA2). Without one the AP is **open**, so set one before you
    travel with it.
  - **Ethernet** keeps the WiFi mode it had, so switching back gets you that again.
    No link at boot means the link-loss policy from `/config` kicks in as usual.

## For the curious: how it's built

The fiddly logic lives in a few small, Arduino-free headers so it can be unit-tested
on a PC with no board attached:

- [`src/enc_decode.h`](../src/enc_decode.h) — the quadrature state-table decoder,
  the per-detent accumulator (with step count + reverse), and the debounced
  short/long button classifier.
- [`src/input_map.h`](../src/input_map.h) — turns an encoder + up to four buttons (in
  any combination, with roles and active-low/high) into the four abstract moves,
  including all the long-press synthesis above.
- [`src/menu.h`](../src/menu.h) — the browse/edit menu state machine (wrapping
  values, action items, disabled items that just vanish).
- [`src/net_choice.h`](../src/net_choice.h) - the Network entry: one value for the
  `useeth` + `wifimode` pair, and Ethernet only when a wired PHY is set.

`main.cpp` only samples the pins in a low-priority task, renders the menu, and applies
the result. The host test is [`test/native/controls_test.cpp`](../test/native/controls_test.cpp)
(run `test/native/run.sh`, or `test\native\run_controls.bat` on Windows), which covers
the decode, every input combination, the menu and its Network entry.

## Measuring `encsteps` instead of guessing it

The symptom of a wrong `encsteps` is a knob that moves two menu entries per click, or half a
click at a time. Which value is right depends on the encoder's mechanics, and the datasheet is
usually not on hand, so measure it:

```
curl "http://<device>/enc.json?reset=1"     # zero the counters
                                            # now turn the knob exactly 10 detents
curl "http://<device>/enc.json"
```

```json
{"present":true,"a":42,"b":41,"sw":21,
 "perDetent":4,        // what the running decoder uses
 "cfgPerDetent":4,     // what is stored in the config
 "reverse":false,
 "edges":43,"steps":10}
```

`edges / clicks` is the encoder's edges-per-detent and therefore the value `encsteps` wants.
A standard EC11 lands near 4 (a stray extra edge or two is the knob settling, not a problem).
`steps / clicks` is what you are getting today: it should be 1.

`perDetent` and `cfgPerDetent` are reported separately on purpose. They differed once, because
`encsteps` is a live setting whose value was only pushed into the decoder at boot, so saving a
new one changed the config and not the knob. Fixed, but the two fields stay: when they disagree,
the setting has not reached the hardware and a reboot is the workaround.
