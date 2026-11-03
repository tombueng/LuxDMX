// Builds LuxDMX Link (link/, Go) for every system the app offers it for, into public/link/ with a
// manifest.json the app reads to offer the right file. The builds are reproducible (no paths, no
// build ids), so the same source gives the same sha256.
//
//   node scripts/build-link.mjs                       all of them
//   node scripts/build-link.mjs --only linux-amd64    just these (comma separated)
//   node scripts/build-link.mjs --out some/dir        somewhere else
//
// macOS gets a zip: a browser saves a download without the "executable" bit, and a Mac can't run
// a file without it (a zip keeps it, and the Mac unpacks it with a double-click).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const linkDir = path.join(root, 'link');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const out = path.resolve(root, arg('--out') ?? 'public/link');
const only = arg('--only')?.split(',').map((s) => s.trim());

// os/arch as the app names them, and Go's names for them
export const TARGETS = [
  { os: 'windows', arch: 'amd64', goos: 'windows', file: 'luxdmx-link-windows-amd64.exe' },
  { os: 'windows', arch: 'arm64', goos: 'windows', file: 'luxdmx-link-windows-arm64.exe' },
  { os: 'macos', arch: 'arm64', goos: 'darwin', file: 'luxdmx-link-macos-arm64.zip' },
  { os: 'macos', arch: 'amd64', goos: 'darwin', file: 'luxdmx-link-macos-amd64.zip' },
  { os: 'linux', arch: 'amd64', goos: 'linux', file: 'luxdmx-link-linux-amd64' },
  { os: 'linux', arch: 'arm64', goos: 'linux', file: 'luxdmx-link-linux-arm64' },
];

const version = fs.readFileSync(path.join(linkDir, 'main.go'), 'utf8').match(/const version = "([^"]+)"/)?.[1];
if (!version) throw new Error('no version in link/main.go');
try { execFileSync('go', ['version'], { stdio: 'ignore' }); } catch {
  console.error('Go is needed to build LuxDMX Link (https://go.dev/dl/, 1.22 or newer).');
  process.exit(1);
}

fs.mkdirSync(out, { recursive: true });
const work = path.join(linkDir, 'dist', 'build');
fs.mkdirSync(work, { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');
// (a fixed date in the zip, so it's reproducible too: a zip keeps local time, so local midnight)
const ZIP_TIME = new Date(2026, 0, 1);

const files = [];
for (const t of TARGETS) {
  if (only && !only.includes(`${t.os}-${t.arch}`)) continue;
  const bin = path.join(work, `luxdmx-link-${t.goos}-${t.arch}${t.goos === 'windows' ? '.exe' : ''}`);
  // Windows: no console window (it installs itself and shows its page in the browser)
  const ld = ['-s', '-w', '-buildid=', ...(t.goos === 'windows' ? ['-H=windowsgui'] : [])].join(' ');
  execFileSync('go', ['build', '-trimpath', '-ldflags', ld, '-o', bin, '.'], {
    cwd: linkDir, stdio: 'inherit', env: { ...process.env, GOOS: t.goos, GOARCH: t.arch, CGO_ENABLED: '0' },
  });
  let data = fs.readFileSync(bin);
  if (t.os === 'macos') {
    // one file in it, executable (Unix mode in the high half of the attributes, os 3 = Unix)
    data = Buffer.from(zipSync({ 'LuxDMX Link': [new Uint8Array(data), { os: 3, attrs: (0o100755 << 16) >>> 0, mtime: ZIP_TIME, level: 9 }] }));
  }
  fs.writeFileSync(path.join(out, t.file), data, { mode: t.os === 'linux' ? 0o755 : 0o644 });
  files.push({ file: t.file, os: t.os, arch: t.arch, size: data.length, sha256: sha(data), version });
  console.log(`${t.file.padEnd(32)} ${(data.length / 1e6).toFixed(1)} MB`);
}

// a partial build keeps what the manifest already says about the others
const mf = path.join(out, 'manifest.json');
let old = [];
try { old = only ? JSON.parse(fs.readFileSync(mf, 'utf8')).files ?? [] : []; } catch { /* a first build */ }
const all = [...old.filter((f) => !files.some((n) => n.file === f.file) && fs.existsSync(path.join(out, f.file))), ...files]
  .sort((a, b) => TARGETS.findIndex((t) => t.file === a.file) - TARGETS.findIndex((t) => t.file === b.file));
fs.writeFileSync(mf, JSON.stringify({ app: 'luxdmx-link', version, files: all }, null, 2) + '\n');
console.log(`LuxDMX Link ${version}: ${all.length} file${all.length === 1 ? '' : 's'} in ${path.relative(root, out)}/`);
