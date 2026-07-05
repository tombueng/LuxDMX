// Structural check for the curated physical headers (issue #17).
//
// For every board that ships a `phys` block it asserts the header is well-formed:
//   - the expected total pin count for that board,
//   - the power rails are present (3V3 + GND, plus EN/5V/VIN where applicable),
//   - every `gpio` referenced by a physical pin also exists in the board's `cols`
//     GPIO list (so the diagram and the validator can never disagree),
//   - no two pins share the same side+pos,
//   - every silk label is a non-empty string,
//   - only `type:"gpio"` pins carry a gpio; power/gnd/en/nc never do.
//
// Run:  node web/boards/validate_physical.mjs
// Exits non-zero on the first board that fails, so it doubles as a CI gate.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

// Boards we curated by hand, with the pin count we expect for each footprint.
// rails = silk labels that must be present; enable = an enable/reset pin must exist
// (its silk is "EN" on the classic boards but "RST" on the S3 DevKitC-1).
const EXPECT = {
  'esp32-devkitc':     { pins: 38, rails: ['3V3', 'GND', '5V'] },
  'nodemcu-32s':       { pins: 38, rails: ['3V3', 'GND', '5V'] },
  'esp32-devkit-v1':   { pins: 30, rails: ['3V3', 'GND', 'VIN'] },
  'esp32s3-devkitc-1': { pins: 44, rails: ['3V3', 'GND', '5V'] },
};

const VALID_TYPES = new Set(['power', 'gnd', 'en', 'gpio', 'nc']);
let failures = 0;

function fail(id, msg) { console.error(`  ✗ ${id}: ${msg}`); failures++; }

function gpioSet(desc) {
  const set = new Set();
  for (const col of desc.cols || []) for (const p of col) set.add(p.gpio);
  return set;
}

function checkBoard(id, expect) {
  const file = path.join(DIR, id + '.json');
  if (!fs.existsSync(file)) { fail(id, 'descriptor file missing'); return; }
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));

  if (!d.phys || !Array.isArray(d.phys.pins)) { fail(id, 'no phys.pins array'); return; }
  const pins = d.phys.pins;

  // total pin count
  if (pins.length !== expect.pins) fail(id, `expected ${expect.pins} pins, got ${pins.length}`);

  // usb edge present + sane
  if (!['top', 'bottom', 'left', 'right'].includes(d.phys.usb || ''))
    fail(id, `phys.usb must be top/bottom/left/right, got ${JSON.stringify(d.phys.usb)}`);

  const cols = gpioSet(d);
  const seenPos = new Set();
  const silks = new Set();

  for (const p of pins) {
    const where = `pin ${p.side}${p.pos} (${p.silk})`;
    if (!VALID_TYPES.has(p.type)) fail(id, `${where}: bad type "${p.type}"`);
    if (p.side !== 'L' && p.side !== 'R') fail(id, `${where}: side must be L or R`);
    if (!Number.isInteger(p.pos) || p.pos < 1) fail(id, `${where}: pos must be a positive integer`);
    if (typeof p.silk !== 'string' || !p.silk.trim()) fail(id, `${where}: silk must be a non-empty string`);

    const key = p.side + ':' + p.pos;
    if (seenPos.has(key)) fail(id, `${where}: duplicate position ${key}`);
    seenPos.add(key);
    silks.add(String(p.silk).toUpperCase());

    if (p.type === 'gpio') {
      if (!Number.isInteger(p.gpio)) fail(id, `${where}: gpio pin without a numeric gpio`);
      else if (!cols.has(p.gpio)) fail(id, `${where}: gpio ${p.gpio} is not in the board's cols GPIO list`);
    } else if (p.gpio != null) {
      fail(id, `${where}: a ${p.type} pin must not carry a gpio (${p.gpio})`);
    }
  }

  // required power rails (by silk) + a ground + an enable/reset pin (by type)
  for (const rail of expect.rails)
    if (!silks.has(rail)) fail(id, `missing power rail "${rail}"`);
  if (!pins.some((p) => p.type === 'gnd')) fail(id, 'missing a GND pin');
  if (!pins.some((p) => p.type === 'en')) fail(id, 'missing an enable/reset (EN/RST) pin');

  // at least one assignable GPIO, obviously
  if (!pins.some((p) => p.type === 'gpio')) fail(id, 'no assignable gpio pins');
}

console.log('Validating curated physical headers...');
for (const [id, expect] of Object.entries(EXPECT)) {
  const before = failures;
  checkBoard(id, expect);
  if (failures === before) console.log(`  ✓ ${id} (${expect.pins} pins)`);
}

if (failures) {
  console.error(`\n${failures} problem(s) found.`);
  process.exit(1);
}
console.log('\nAll curated physical headers are well-formed.');
