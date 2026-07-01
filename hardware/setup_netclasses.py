"""Set up the three net classes the routing pipeline relies on, so Freerouting routes each net at its
correct width/via in ONE pass (no post-hoc widening):

  Default : 0.20mm trace, 0.6/0.3 via, 0.15 clearance  -- normal signals (DMX data, display, LED, USB, serial, expansion)
  Power   : 0.40mm trace, 0.6/0.3 via, 0.15 clearance  -- the +5V family + the VPOE/VISO rails (~1.3A @1oz/10C,
                                                          plenty for the ~0.8A +5V; 0.5mm was too wide to fit at U9)
  Fine    : 0.15mm trace, 0.5/0.2 via, 0.10 clearance  -- ONLY the W5500-dense nets (eth pairs, eth taps, SPI, the
                                                          0.5mm-QFN cluster). The thin trace + small via is allowed
                                                          here and nowhere else.

Writes the classes + name-pattern assignments into luxdmx.kicad_pro. Idempotent / re-runnable. KiCad 10."""
import json

PRO = r"C:\dev\DMX\hardware\luxdmx.kicad_pro"
POWER = ["+5V", "+5V_POE", "+5V_DMX", "+5V_USB", "+5V_USBF", "VPOE+", "VPOE-", "VISO", "VISO2"]
FINE = ["ETH_TXN", "ETH_TXP", "ETH_RXN", "ETH_RXP", "ETH_TCT", "ETH_RCT", "ETH_CS", "ETH_INT", "ETH_RST",
        "SCLK", "MOSI", "MISO", "TOCAP", "W5500_1V2", "XI", "XO",
        "N$1", "N$3", "N$4", "N$5", "N$6", "N$7", "N$8", "N$9", "N$10"]

d = json.load(open(PRO, encoding="utf-8"))
ns = d["net_settings"]
default = next(c for c in ns["classes"] if c["name"] == "Default")
default.update({"track_width": 0.2, "clearance": 0.15, "via_diameter": 0.6, "via_drill": 0.3,
                "diff_pair_width": 0.2, "diff_pair_gap": 0.25, "diff_pair_via_gap": 0.25})


def mk(name, tw, cl, vd, vdr, dpw=0.2, dpg=0.25):
    c = dict(default)
    c.update({"name": name, "track_width": tw, "clearance": cl, "via_diameter": vd, "via_drill": vdr,
              "diff_pair_width": dpw, "diff_pair_gap": dpg})
    return c


ns["classes"] = [c for c in ns["classes"] if c["name"] not in ("Power", "Fine")]
ns["classes"].append(mk("Power", 0.4, 0.15, 0.6, 0.3))
ns["classes"].append(mk("Fine", 0.15, 0.1, 0.5, 0.2, 0.15, 0.15))
ns["netclass_patterns"] = ([{"netclass": "Power", "pattern": n} for n in POWER] +
                           [{"netclass": "Fine", "pattern": n} for n in FINE])
ns["netclass_assignments"] = None
json.dump(d, open(PRO, "w", encoding="utf-8"), indent=2)
pw = next(c for c in ns["classes"] if c["name"] == "Power")["track_width"]
fw = next(c for c in ns["classes"] if c["name"] == "Fine")["track_width"]
print(f"net classes set: Default 0.20mm / Power {pw:.2f}mm ({len(POWER)} nets) / Fine {fw:.2f}mm ({len(FINE)} nets)")
