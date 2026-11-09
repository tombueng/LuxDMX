// Writes the small second repository the e2e tests add as "another source" (node test/fixtures/addons-repo/make.mjs).
import fs from 'node:fs';
import crypto from 'node:crypto';
const here = new URL('.', import.meta.url);
const pkg = { format: 'luxdmx-effect', formatVersion: 1, id: 'tester.green-pulse', version: '1.0.0', name: 'Green pulse', author: { name: 'A tester' }, license: 'CC0-1.0',
  description: 'A green glow pulsing out from the middle, from a repository that is not ours.', tags: ['test'], category: 'pixel', fits: ['ring', 'disc', 'matrix'],
  uses: ['speed', 'level', 'range', 'contrast'], params: [], defaults: { speed: 4, tempo: false }, code: { lang: 'luxfx-1', pixel: 'rgb(0, 1, 0.2) * gauss(rad - frac(t / 2), 0.15)' } };
const text = JSON.stringify(pkg, null, 1) + '\n';
fs.mkdirSync(new URL('effects/', here), { recursive: true });
fs.writeFileSync(new URL('effects/green-pulse.luxfx', here), text);
const index = { format: 'luxdmx-addons', formatVersion: 1, name: 'A tester\'s effects', maintainer: 'https://example.org', themes: [{ id: 'test', name: 'Test' }],
  addons: [{ id: pkg.id, kind: 'effect', version: '1.0.0', name: pkg.name, author: 'A tester', license: 'CC0-1.0', description: pkg.description, tags: ['test'], fits: pkg.fits,
    file: 'effects/green-pulse.luxfx', size: Buffer.byteLength(text), sha256: crypto.createHash('sha256').update(text).digest('hex') }] };
fs.writeFileSync(new URL('index.json', here), JSON.stringify(index, null, 1) + '\n');
