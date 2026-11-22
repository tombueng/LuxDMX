# Shopping list for TME

For board **rev 1.1**.

The same board, sourced at <https://www.tme.eu/>. Quantities are for one board and come straight out of `BOM.csv`.

**No prices or stock figures here, on purpose.** TME answers 403 to anything automated, so those could not be read and are not going to be guessed. What this list gives you is the specification that decides each line, so whichever equivalent TME has in stock will be the right one, plus the few symbols that were confirmed by hand.

| Qty | What it has to be | Where to look | Watch out |
|---:|---|---|---|
| 2 | 100nF 1206 X7R, 50 V | search: 100nF 1206 X7R 50V | Any maker. X7R matters, X5R or Y5V do not belong on a decoupling line. |
| 1 | 1uF 1206 X7R, 50 V | search: 1uF 1206 X7R 50V | X7R again. A 1uF Y5V loses most of its value at voltage. |
| 2 | 22uF 1206 X5R, 6.3 V or more | search: 22uF 1206 X5R | 6.3 V is the minimum; 10 V or 16 V is fine and often cheaper. Sits on a 3.3 V rail. |
| 1 | 1000uF 35 V radial, 13 mm can at most, 5 mm lead pitch | search: 1000uF 35V 105C radial | The can must not exceed 13 mm diameter and the leads must be 5 mm apart - the land is drawn for exactly that. |
| 1 | Female header 1 x 4, 2.54 mm, 8.5 mm tall (display socket) | search: female header 1x4 2.54 8.5mm | The 8.5 mm height is what lifts the OLED clear of the modules under it; a standard 7-8.5 mm socket works, a low-profile one does not. |
| 1 | 74AHCT541 or 74HCT541 in SO-20 300 mil | TME lists 74HCT541D,653 (confirmed), which fits the same land | WARNING, two ways to get this wrong. The suffix PW is TSSOP at 0.65 mm and does NOT fit this board; only D (SO-20 300 mil) or TI's DW does. And TME appeared to hold it on reel only, in poor supply - worth checking before you count on it. AHCT is the better part if you find it in the same package. |
| 1 | Bourns MF-R500 polyfuse, 5 A hold, 30 V | TME symbol MFR500-BOU (confirmed) | 30 V matters: the MF-RHT and MF-RG families are 16 V parts and a 24 V pixel supply is outside them. |
| 5 | 10k 1206, 1 % | search: 10k 1206 1% | Any maker. |
| 3 | 120R 1206, 1 % | search: 120R 1206 1% | Any maker. |
| 11 | 330R 1206, 5 % or better | search: 330R 1206 | Any maker. Eleven of them: six RS-485 bias, five pixel damping. |
| 1 | Alps EC11 rotary encoder with switch | TME stocks the Alps EC11 family | The part inside a KY-040. 2.5 mm pin pitch, two mounting posts. |
| 1 | Screw terminal, 2 pole, 5.08 mm pitch | search: PCB screw terminal 5.08 2 way | The holes are 1.40 mm, Kefa's own recommendation for these 0.9 x 0.8 mm pins. Degson, Ninigi, PTR 5.08 mm parts fit the same way. |
| 3 | Screw terminal, 3 pole, 2.54 mm pitch, x3 (DMX ports) | search: PCB screw terminal 2.54 3 way | 1.20 mm holes, so most 2.54 mm terminals fit; Phoenix MPT 0,5/3-2,54 also fits, its pegs have holes on the board. Or a plain 3-pin header. |
| 5 | Screw terminal, 3 pole, 5.08 mm pitch | search: PCB screw terminal 5.08 3 way | Same. Or leave them off and solder the wire flat on the pad, which is what the big pads are for. |
| 6 | SMF12CA, bidirectional TVS, 12 V standoff | TME symbols SMF12CA-DC / -LF / -DIO (confirmed) | Three makers list it. SMAJ12CA in SMA is the same diode at 400 W and also lands on the pad, worth it for long outdoor runs. |
| 2 | Tact switch 6 x 6 mm THT, x2 | search: tact switch 6x6 THT | Any plunger height 5 to 30 mm fits the land. For a front panel at the encoder's 20 mm shaft you want about 30 mm, see below. |

## Modules and mechanical

| What | Where to look | Watch out |
|---|---|---|
| ESP32-S3-DevKitC-1 N16R8 CLONE with 25.40 mm rows | marketplace (Binghe and similar dual USB-C clones) | NOT Espressif's own DevKitC-1 that TME stocks: its rows are 22.86 mm apart and it does not fit. 8 MB PSRAM (R8) is not optional either. |
| W5500 Ethernet module (USR-ES1 style) | unlikely at TME, marketplace | USR-ES1 style W5500 board with a 2 x 6 pin header, same pin order as in the README. |
| MAX3485 module, 3.3 V, with enable, x3 | unlikely at TME, marketplace | 3.3 V part. A MAX485 module is a 5 V part and will not do. |
| 1.3" OLED SH1106, I2C, 4 pin | unlikely at TME, marketplace | Check the pin order against its own silk, the boards ship both ways round. |
| 5 V regulator module: Pololu D24V10F5 | Pololu or its distributors, not TME | Only if the logic runs off the 12/24 V supply. Fixed 5 V, nothing to set. D36V28F5, a RECOM R-78E5.0-1.0 / Mornsun K7805-1000R3 SIP or an MP1584EN board (set to 5.0 V first) fit the same spot, see the README's Regulator section. |
| Fuse holder, MINI blade (ATM), Keystone 3568 | TME symbol KEYS3568 (confirmed) | Only if you fit a blade fuse instead of the polyfuse, never both. MINI/ATM size - the regular ATO/ATC fuse is almost twice as wide and does not go in. The holder is good for 30 A, the board is not: 9.8 A is where the copper gives out, so size the fuse for the load. |
| Tact switch 6 x 6 mm THT, long plunger, x2 | CHECK: TME may not go past ~13-17 mm | The board wants roughly 30 mm to clear the same panel as the encoder shaft. Western distributors tend to stop well short of that - this one may have to come from a marketplace, or you use a shorter switch and a cap. |

The five pixel and one supply terminal can be left off entirely: those positions have pads big enough to solder the wire onto flat.
