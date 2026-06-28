// Structural check for the curated physical headers (issue #17).
//
// For every board that ships a `phys` block it asserts the header is well-formed:
//   - the power rails are present (3V3 + a GND), plus the exact rails we expect on
//     the hand-checked boards,
//   - every `gpio` referenced by a physical pin also exists in the board's `cols`
//     GPIO list (so the diagram and the validator can never disagree),
//   - no two pins share the same side+pos,
//   - every silk label is a non-empty string,
//   - only `type:"gpio"` pins carry a gpio; power/gnd/en/nc never do,
//   - the USB edge is set.
//
// Boards listed in EXPECT are checked strictly (exact pin count + named rails).
// Any other board that has a `phys` block is auto-discovered and checked against
// the generic rules, so curating a new board needs no edit here.
//
// Run:  node web/boards/validate_physical.mjs
// Exits non-zero on any failure, so it doubles as a CI gate.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

// Hand-checked boards, with the pin count we expect for each footprint.
// rails = silk labels that must be present.
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

function checkBoard(id, desc, expect) {
  if (!desc.phys || !Array.isArray(desc.phys.pins)) { fail(id, 'no phys.pins array'); return; }
  const pins = desc.phys.pins;

  // exact pin count only for the strictly-expected boards
  if (expect && pins.length !== expect.pins) fail(id, `expected ${expect.pins} pins, got ${pins.length}`);

  if (!['top', 'bottom', 'left', 'right'].includes(desc.phys.usb || ''))
    fail(id, `phys.usb must be top/bottom/left/right, got ${JSON.stringify(desc.phys.usb)}`);

  const cols = gpioSet(desc);
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

  // named power rails: exact list on the strict boards, just 3V3 + GND everywhere else
  const rails = expect ? expect.rails : ['3V3', 'GND'];
  for (const rail of rails)
    if (!silks.has(rail)) fail(id, `missing power rail "${rail}"`);
  if (!pins.some((p) => p.type === 'gnd')) fail(id, 'missing a GND pin');
  if (!pins.some((p) => p.type === 'gpio')) fail(id, 'no assignable gpio pins');
  // strict boards must also break out an enable/reset pin
  if (expect && !pins.some((p) => p.type === 'en')) fail(id, 'missing an enable/reset (EN/RST) pin');
}

console.log('Validating curated physical headers...');

// Every *.json with a phys block (index.json has none, so it's skipped naturally).
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'index.json');
let checked = 0;
for (const f of files.sort()) {
  const id = f.replace(/\.json$/, '');
  let desc;
  try { desc = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); }
  catch (e) { fail(id, `invalid JSON: ${e.message}`); continue; }
  if (!desc.phys) continue;   // not curated yet
  const before = failures;
  checkBoard(id, desc, EXPECT[id]);
  checked++;
  const n = desc.phys.pins ? desc.phys.pins.length : '?';
  if (failures === before) console.log(`  ✓ ${id} (${n} pins${EXPECT[id] ? '' : ', auto'})`);
}

// the four hand-checked boards must always be present and curated
for (const id of Object.keys(EXPECT))
  if (!fs.existsSync(path.join(DIR, id + '.json'))) fail(id, 'expected board descriptor is missing');

if (failures) {
  console.error(`\n${failures} problem(s) found across ${checked} curated board(s).`);
  process.exit(1);
}
console.log(`\nAll ${checked} curated physical header(s) are well-formed.`);
