// Fetch the demo songs (src/timeline/catalog.ts) into public/songs/, the app's own copies: from the
// artists' own files, each checked against its sha256 (our copies are the same bytes). Skips the
// ones already there and right. `node scripts/fetch-songs.mjs` (npm run songs). Credits: SONGS.md.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/timeline/catalog.ts'), 'utf8');
// (the catalog is plain data we write ourselves: each entry has these fields, one per line or so)
const entries = [...src.matchAll(/id: '([a-z0-9-]+)'[\s\S]*?page: '([^']+)'[\s\S]*?url: '([^']+)'[\s\S]*?mirror: '([^']+)'[\s\S]*?sha256: '([0-9a-f]{64})'/g)]
  .map(([, id, page, url, mirror, sha]) => ({ id, page, url, mirror, sha }));
if (!entries.length) { console.error('no songs found in catalog.ts'); process.exit(1); }

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
let bad = 0;
for (const s of entries) {
  const file = join(root, 'public', s.mirror);
  if (existsSync(file) && sha256(readFileSync(file)) === s.sha) { console.log(`ok       ${s.id}`); continue; }
  try {
    const r = await fetch(s.url, { headers: { Referer: s.page, 'User-Agent': 'LuxDMX sequencer (demo songs, credits in SONGS.md)' }, redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const b = Buffer.from(await r.arrayBuffer());
    if (sha256(b) !== s.sha) throw new Error(`checksum differs (${b.length} bytes): the artist may have changed the file`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, b);
    console.log(`fetched  ${s.id} (${(b.length / 1e6).toFixed(1)} MB)`);
  } catch (e) { bad++; console.error(`FAILED   ${s.id}: ${e.message} (${s.url})`); }
}
console.log(`${entries.length - bad} of ${entries.length} songs in public/songs/`);
process.exit(bad ? 1 : 0);
