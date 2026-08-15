# Assembly

How many of the 46 positions you actually solder depends on what you are building.
Almost nothing here is mandatory.

## Answer these first

1. Where does power come from: **USB**, **external 5 V**, or **12/24 V via buck**?
2. Which **DMX ports** (1, 2, 3)?
3. Which **pixel ports** (1 to 5)?
4. **Wired Ethernet** or WiFi only?
5. **Display** and **encoder** connected?
6. Is there already a **fuse in the supply lead**?

## Core

| Part | Side | Fit it when | Note |
|---|---|---|---|
| `ESP32-S3 (16N8R)` | front | always | Nothing works without it. |

## Supply

| Part | Side | Fit it when | Note |
|---|---|---|---|
| `5V Buck Converter` | back | supplied from 12/24 V **and** neither 5V-IN nor USB connected | Set it to 5.0 V **before** soldering it in. |
| `5V IN` | front | 5 V comes from outside | Alternative to USB and the buck. |
| `F1` | front | you would rather replace a blown fuse than wait for a polyfuse to cool | Alternative to the polyfuse, never both. Its own two holes, same nets. |

## Pixel

| Part | Side | Fit it when | Note |
|---|---|---|---|
| `1000uF 35V` | front | pixel ports are used | Buffers the current steps of the strips. 13 mm can, 5.00 mm pitch. |
| `12-24V IN` | front | pixel ports are used | The actual power inlet. **Either** this terminal **or** the DC jack, never both. |
| `74AHCT541 pixel buffer` | back | **at least one** pixel port is used | Not optional: the terminals hang off its outputs. WS281x want 0.7 x VDD = 3.5 V and the 3.3 V from the S3 will not do it reliably. |
| `Pixel1:Vcc/Data/GND` | front | pixel port 1 is used |  |
| `Pixel2:Vcc/Data/GND` | front | pixel port 2 is used |  |
| `Pixel3:Vcc/Data/GND` | front | pixel port 3 is used |  |
| `Pixel4:Vcc/Data/GND` | front | pixel port 4 is used |  |
| `Pixel5:Vcc/Data/GND` | front | pixel port 5 is used |  |
| `Polyfuse MF-R 5.1(4A)/10.2(9A)` | front | pixel ports are used **and** no external fuse | Bourns MF-R, 30 V. Middle hole up to 4 A, right hole up to 9 A. MF-RHT and MF-RG are 16 V parts and unusable on 24 V. |

## Network

| Part | Side | Fit it when | Note |
|---|---|---|---|
| `100nF W5500` | back | W5500 fitted | Decoupling right at the module. |
| `10k ETH_CS pu` | back | W5500 fitted | Holds CS high while the GPIOs are still floating out of reset. |
| `10k ETH_RST pu` | back | W5500 fitted | Same for RST, otherwise the W5500 resets itself during boot. |
| `1uF W5500` | back | W5500 fitted | Middle of the three. 100nF / 1uF / 22uF in ascending order away from the pin, because the rail had a factor of 220 between its only two values. |
| `22uF W5500` | back | W5500 fitted | Local bulk under the module, 2.5 mm from its 3V3 pin. The regulator is 62 mm and 62 nH away on the dev board, so this is what holds the rail up when the PHY steps its load; the other bulk is too far off to help. |
| `W5500 Ethernet Module` | front | you want wired Ethernet | Leave it out and everything runs over WiFi. |

## DMX port 1

| Part | Side | Fit it when | Note |
|---|---|---|---|
| `10k dir` | back | DMX port 1 is used | Holds DE/RE defined through reset, otherwise the driver keys the bus before firmware runs. |
| `120R term` | back | DMX port 1 sits at the **end** of the bus | Leave it out mid-chain, and check the RS-485 module: most already carry 120 R. |
| `330R bias+` | back | DMX port 1 drives the bus (controller role) | Fail-safe bias. Once per bus, not on every device. With two terminators (60 R) 330 R gives 275 mV idle, above the 200 mV needed. |
| `330R bias-` | back | DMX port 1 drives the bus (controller role) | Belongs with 330R bias+, always as a pair. |
| `DMX 1 - GND/B/A` | front | DMX port 1 is used | Header out to the panel XLR. |
| `TVS bidir` | back | DMX port 1 leaves the enclosure | SMF12CA, bidirectional, 12 V standoff. The land takes SOD-123, SOD-123F, SOD-123FL, SMA and 1206, so an SMAJ12CA fits too. Two per port, A and B to GND. |
| `TVS bidir` | back | DMX port 1 leaves the enclosure | SMF12CA, bidirectional, 12 V standoff. The land takes SOD-123, SOD-123F, SOD-123FL, SMA and 1206, so an SMAJ12CA fits too. Two per port, A and B to GND. |
| `U3 - MAX485 Modul` | front | DMX port 1 is used |  |

## DMX port 2

| Part | Side | Fit it when | Note |
|---|---|---|---|
| `10k dir` | back | DMX port 2 is used | Holds DE/RE defined through reset, otherwise the driver keys the bus before firmware runs. |
| `120R term` | back | DMX port 2 sits at the **end** of the bus | Leave it out mid-chain, and check the RS-485 module: most already carry 120 R. |
| `330R bias+` | back | DMX port 2 drives the bus (controller role) | Fail-safe bias. Once per bus, not on every device. With two terminators (60 R) 330 R gives 275 mV idle, above the 200 mV needed. |
| `330R bias-` | back | DMX port 2 drives the bus (controller role) | Belongs with 330R bias+, always as a pair. |
| `DMX 2 - GND/B/A` | front | DMX port 2 is used | Header out to the panel XLR. |
| `TVS bidir` | back | DMX port 2 leaves the enclosure | SMF12CA, bidirectional, 12 V standoff. The land takes SOD-123, SOD-123F, SOD-123FL, SMA and 1206, so an SMAJ12CA fits too. Two per port, A and B to GND. |
| `TVS bidir` | back | DMX port 2 leaves the enclosure | SMF12CA, bidirectional, 12 V standoff. The land takes SOD-123, SOD-123F, SOD-123FL, SMA and 1206, so an SMAJ12CA fits too. Two per port, A and B to GND. |
| `U4 - MAX485 Modul` | front | DMX port 2 is used |  |

## DMX port 3

| Part | Side | Fit it when | Note |
|---|---|---|---|
| `10k dir` | back | DMX port 3 is used | Holds DE/RE defined through reset, otherwise the driver keys the bus before firmware runs. |
| `120R term` | back | DMX port 3 sits at the **end** of the bus | Leave it out mid-chain, and check the RS-485 module: most already carry 120 R. |
| `330R bias+` | back | DMX port 3 drives the bus (controller role) | Fail-safe bias. Once per bus, not on every device. With two terminators (60 R) 330 R gives 275 mV idle, above the 200 mV needed. |
| `330R bias-` | back | DMX port 3 drives the bus (controller role) | Belongs with 330R bias+, always as a pair. |
| `DMX 3 - GND/B/A` | front | DMX port 3 is used | Header out to the panel XLR. |
| `TVS bidir` | back | DMX port 3 leaves the enclosure | SMF12CA, bidirectional, 12 V standoff. The land takes SOD-123, SOD-123F, SOD-123FL, SMA and 1206, so an SMAJ12CA fits too. Two per port, A and B to GND. |
| `TVS bidir` | back | DMX port 3 leaves the enclosure | SMF12CA, bidirectional, 12 V standoff. The land takes SOD-123, SOD-123F, SOD-123FL, SMA and 1206, so an SMAJ12CA fits too. Two per port, A and B to GND. |
| `U5 - MAX485 Modul` | front | DMX port 3 is used |  |

## Interface

| Part | Side | Fit it when | Note |
|---|---|---|---|
| `Button 1` | front | you want the buttons | 6 x 6 mm tact switch on IO3 and IO46. Take a 30 mm plunger if it has to reach the same front panel as the 20 mm encoder shaft. Both go to GND, the pins pull up internally. |
| `Button 2` | front | you want the buttons | 6 x 6 mm tact switch on IO3 and IO46. Take a 30 mm plunger if it has to reach the same front panel as the 20 mm encoder shaft. Both go to GND, the pins pull up internally. |
| `Display:SDA/SCL/3V3/GND` | front | you want the display |  |
| `Encoder A/B/SW` | front | you want the encoder | EC11 with a push switch, the part inside a KY-040. No pullups needed, GPIO42/41/21 have their own. |

## Other

| Part | Side | Fit it when | Note |
|---|---|---|---|
| `100nF` | back | recommended | Decoupling for the 3V3 rail. |
| `22uF 3V3 bulk` | back | recommended | Holds up the 3V3 rail when three transceivers key at once. |
| `EXP 3V3/GND/47/48/43/44` | front | optional | Brings out 3V3, GND, the two UART-bridge pins and the **unbuffered** pixel signals 4 and 5. |

## Pixels

| Part | Side | Fit it when | Note |
|---|---|---|---|
| `330R PIX1` | back | you use that pixel port | Series damping at the buffer output, one per port. Fit it before you blame the strip: without it the 3-5 ns edge rings on a metre of wire. 220R to 470R all work, the board says 330R. |
| `330R PIX2` | back | you use that pixel port | Series damping at the buffer output, one per port. Fit it before you blame the strip: without it the 3-5 ns edge rings on a metre of wire. 220R to 470R all work, the board says 330R. |
| `330R PIX3` | back | you use that pixel port | Series damping at the buffer output, one per port. Fit it before you blame the strip: without it the 3-5 ns edge rings on a metre of wire. 220R to 470R all work, the board says 330R. |
| `330R PIX4` | back | you use that pixel port | Series damping at the buffer output, one per port. Fit it before you blame the strip: without it the 3-5 ns edge rings on a metre of wire. 220R to 470R all work, the board says 330R. |
| `330R PIX5` | back | you use that pixel port | Series damping at the buffer output, one per port. Fit it before you blame the strip: without it the 3-5 ns edge rings on a metre of wire. 220R to 470R all work, the board says 330R. |

## Shopping list, everything fitted

| Qty | Part | Side | only needed when |
|---:|---|---|---|
| 6 | TVS bidir | back | any DMX port leaves the enclosure |
| 5 | 330R pixel | back | you use that pixel port |
| 5 | PIXn V+/DATA/GND | front | any pixel port is used |
| 3 | 10k dir | back | any DMX port is used |
| 3 | 120R term | back | any DMX port sits at the **end** of the bus |
| 3 | 330R bias+ | back | any DMX port drives the bus (controller role) |
| 3 | 330R bias- | back | any DMX port drives the bus (controller role) |
| 3 | MAX3485 DMXn | front | any DMX port is used |
| 3 | XLRn 1=shld 2=D- 3=D+ | front | any DMX port is used |
| 2 | 100nF | back | recommended |
| 2 | Tact 6x6 H30 | front | you want the buttons |
| 1 | 1000uF 35V | front | pixel ports are used |
| 1 | 10k ETH_CS pu | back | W5500 fitted |
| 1 | 10k ETH_RST pu | back | W5500 fitted |
| 1 | 12-24V -> 5V buck | back | supplied from 12/24 V **and** neither 5V-IN nor USB connected |
| 1 | 12-24V IN 24A | front | pixel ports are used |
| 1 | 1uF | back | W5500 fitted |
| 1 | 22uF 3V3 bulk | back | recommended |
| 1 | 22uF W5500 | back | W5500 fitted |
| 1 | 5V in | front | 5 V comes from outside |
| 1 | 74AHCT541 pixel buffer | back | **at least one** pixel port is used |
| 1 | Blade fuse holder, alternative to the polyfuse | front | you would rather replace a blown fuse than wait for a polyfuse to cool |
| 1 | EC11 | front | you want the encoder |
| 1 | ESP32-S3 N16R8 | front | always |
| 1 | EXP 3V3/GND/47/48/43/44 | front | optional |
| 1 | MF-R 30V | front | pixel ports are used **and** no external fuse |
| 1 | OLED SDA/SCL/VCC/GND | front | you want the display |
| 1 | USR-ES1 W5500 | front | you want wired Ethernet |

## What is not a part

**The solder bridge.** It is a pad pair on the back inside the polyfuse footprint, between
its two left holes. Not a component, just a blob of solder.

| | Polyfuse | Bridge |
|---|---|---|
| fuse on the board | fit | leave open |
| external fuse in the supply lead | leave out | close |
| no fuse at all | leave out | close |

Exactly one of the two. Both together is a bridged fuse, which is no fuse.

## Watch out

**One 5 V source at a time.** USB, the 5V-IN header and the buck share a rail and back-feed
each other. If the buck is fitted and USB is plugged in, one source fights the other. There
is no reverse or ORing protection on the board.

**Set the buck before soldering it in.** These modules have a trimmer and arrive in any
position. At 12 V out the ESP32, the W5500 and the display all go at once.

**Screw terminal or DC jack, not both.** They sit on the same nets.

**120 R only at the end of the bus.** And check the RS-485 module first, the cheap ones
usually carry 120 R and bias already. A second one puts 60 R on the bus.

**The buffer is not optional.** The pixel terminals hang off its outputs; without it nothing
reaches them.

**All the small parts sit on the back.** The modules cover the front. Do the back first, then
the headers, or you will not get to them.

**The lands take more than one size.** Resistors and capacitors go on a land running 0.30 to
2.30 mm off centre, so 0402, 0603, 0805 and 1206 all sit on copper and you can use whatever
you have. The TVS lands go out to 2.90 mm and take SOD-123 through SMA as well. None of it
reflows, the lands are longer than the parts and nothing self-aligns, but by hand it does not
matter.

## Build levels

| | DMX | Pixel | Network | What you need |
|---|---|---|---|---|
| **DMX only, USB powered** | 1-3 | - | WiFi | ESP32, one RS-485 module per port, XLR headers, 10k dir, bias and termination as required |
| **DMX + LAN** | 1-3 | - | W5500 | plus the W5500 and its two 10k |
| **Pixel only** | - | 1-5 | WiFi | ESP32, buffer, terminals, 1000uF, power inlet, fuse, buck |
| **Everything** | 3 | 5 | W5500 | all of the above, plus display and encoder |

The buck is only needed where 12/24 V is present **and** neither USB nor 5V-IN. On the bench
with a USB cable: leave it out.
