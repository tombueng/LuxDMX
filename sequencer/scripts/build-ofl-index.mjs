// Builds public/ofl/index.json: every Open Fixture Library fixture (name, manufacturer, categories,
// modes; the RDM manufacturer and model ids and each mode's RDM personality, where the library knows
// them, so a fixture found on the rig with RDM can be patched with its own profile) at one pinned commit. The app searches this offline and fetches a single fixture from
// jsDelivr at the same commit when you add it. OFL data is MIT licensed (see public/ofl/LICENSE).
//
//   node scripts/build-ofl-index.mjs [commit]        (default: current master)
//   node scripts/build-ofl-index.mjs --tests          also refresh test/fixtures/ofl/*.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'OpenLightingProject/open-fixture-library';
const TEST_FIXTURES = ['cameo/flat-pro-18', 'showtec/club-par-12-6-rgbwauv', 'eurolite/led-pix-12-hcl', 'robe/robin-600e-spot',
  'clay-paky/sharpy', 'martin/mac-aura', 'stairville/m-fog-1000', 'eurolite/led-kls-801'];

const args = process.argv.slice(2);
const getJson = async (url) => {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'luxdmx-sequencer-build' } });
    if (r.ok) return r.json();
    if (r.status === 404) throw new Error(`404 ${url}`);
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
  }
  throw new Error(`failed ${url}`);
};

const sha = args.find((a) => /^[0-9a-f]{7,40}$/.test(a)) ?? (await getJson(`https://api.github.com/repos/${REPO}/commits/master`)).sha;
const raw = (p) => `https://raw.githubusercontent.com/${REPO}/${sha}/${p}`;
console.log('OFL commit', sha);

const tree = await getJson(`https://api.github.com/repos/${REPO}/git/trees/${sha}?recursive=1`);
const keys = tree.tree.map((t) => t.path).filter((p) => /^fixtures\/[^/]+\/[^/]+\.json$/.test(p)).map((p) => p.slice(9, -5));
const mans = await getJson(raw('fixtures/manufacturers.json'));

const fixtures = [];
let next = 0, redirects = 0;
async function worker() {
  while (next < keys.length) {
    const key = keys[next++];
    const j = await getJson(raw(`fixtures/${key}.json`));
    if (j.redirectTo) { redirects++; continue; }
    const man = key.split('/')[0];
    const rdmMan = mans[man]?.rdmId, rdmModel = j.rdm?.modelId;
    fixtures.push({
      k: key, n: j.name, m: mans[man]?.name ?? man, c: j.categories ?? [],
      modes: (j.modes ?? []).map((m) => (m.rdmPersonalityIndex ? [m.name, m.channels?.length ?? 0, m.rdmPersonalityIndex] : [m.name, m.channels?.length ?? 0])),
      ...(Number.isInteger(rdmMan) && Number.isInteger(rdmModel) ? { r: [rdmMan, rdmModel] } : {}),
    });
  }
}
await Promise.all(Array.from({ length: 16 }, worker));
fixtures.sort((a, b) => (a.m + a.n).localeCompare(b.m + b.n));

const out = path.join(root, 'public/ofl');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ commit: sha, generated: new Date().toISOString(), fixtures }));
fs.writeFileSync(path.join(out, 'LICENSE'), (await (await fetch(raw('LICENSE'))).text()));
console.log(`${fixtures.length} fixtures (${redirects} redirects skipped) -> public/ofl/index.json`);

if (args.includes('--tests')) {
  const dir = path.join(root, 'test/fixtures/ofl');
  fs.mkdirSync(dir, { recursive: true });
  for (const k of TEST_FIXTURES) {
    const j = await getJson(raw(`fixtures/${k}.json`));
    fs.writeFileSync(path.join(dir, k.replace('/', '__') + '.json'), JSON.stringify(j, null, 2));
  }
  console.log(`${TEST_FIXTURES.length} test fixtures -> test/fixtures/ofl/`);
}
