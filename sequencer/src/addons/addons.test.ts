// Our add-on effects (themes.ts): every one reads, runs on a disc, a matrix and a strip within its
// budget, shows something and moves; the standard knobs it lists are the ones that change it; and
// public/addons/ (the default repository: index.json and the packages) is what they make.
// WRITE_ADDONS=1 npx vitest run src/addons/addons.test.ts writes public/addons/ again.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EFFECT_MAP, paramsOf, runEffect, type Where } from '../engine/effects';
import { placesFor } from '../model/pixelLayout';
import { effectOfPackage, readPackage, type Standard } from './package';
import { loadRepo, readRepo, REPO_FORMAT, sourceUrl, themePackage } from './catalog';
import { THEMES, type Source, type Theme } from './themes';

const disc = placesFor({ kind: 'rings', rings: [60, 48, 40, 32, 24, 16, 12, 8, 1] });
const mat = placesFor({ kind: 'matrix', cols: 16, rows: 16, zigzag: true });
const shape = (at: typeof disc): Where[] => Array.from({ length: at.n }, (_, i) => ({ u: 0.5, row: 0, rows: 1, at, cell: i }));
const SCENES: Record<string, Where[]> = { disc: shape(disc), matrix: shape(mat), strip: Array.from({ length: 60 }, (_, i) => ({ u: i / 59, row: 0, rows: 1 })) };
const TIMES = Array.from({ length: 24 }, (_, i) => 0.37 + i * 1.73);
const def = EFFECT_MAP.get('script')!;

// what it shows: per scene, per moment, every LED's r, g, b (0..1)
function play(params: Record<string, unknown>, scene: string, times = TIMES): number[][] {
  const p = paramsOf('script', params), where = SCENES[scene];
  return times.map((t) => runEffect(def, p, where.length, t / p.speed, 7, where, { beats: t * 2, secs: t }).flatMap((o) => {
    const c = o.color ?? { r: 1, g: 1, b: 1 }, i = o.intensity ?? 0;
    return [c.r * i, c.g * i, c.b * i];
  }));
}
const sig = (x: number[][]) => x.map((f) => f.map((v) => Math.round(v * 100)).join(',')).join('|');

// the standard knobs that change it, moved well away from where they start
const MOVES: [Standard, (p: Record<string, unknown>) => Record<string, unknown>][] = [
  ['speed', (p) => ({ speed: (p.speed as number ?? 8) * 0.5 })], ['size', (p) => ({ size: (p.size as number ?? 1) > 0.5 ? 0.3 : 0.9 })],
  ['palette', () => ({ colors: [{ r: 1, g: 0, b: 0 }, { r: 0, g: 0, b: 1 }] })], ['range', () => ({ low: 0.3, high: 0.6 })],
  ['contrast', () => ({ contrast: 0.8 })], ['orientation', () => ({ direction: 'backward' })],
];
function usesOf(theme: Theme, s: Source): Standard[] {
  const base = effectOfPackage(themePackage(theme, s, ['level'])).params;
  const was = ['disc', 'matrix'].map((sc) => sig(play(base, sc, TIMES.slice(0, 10))));
  const live = MOVES.filter(([, move]) => ['disc', 'matrix'].some((sc, i) => sig(play({ ...base, ...move(base) }, sc, TIMES.slice(0, 10))) !== was[i])).map(([k]) => k);
  return (['speed', 'level', 'size', 'range', 'contrast', 'palette', 'orientation'] as Standard[]).filter((k) => k === 'level' || live.includes(k));
}

const ALL = THEMES.flatMap((t) => t.effects.map((s) => ({ theme: t, s })));
const OUT = new URL('../../public/addons/', import.meta.url);
const json = (v: unknown) => JSON.stringify(v, null, 1) + '\n';

describe('our add-on effects', () => {
  it('ten themes, five each, every id once', () => {
    expect(THEMES.length).toBe(10);
    for (const t of THEMES) expect(t.effects.length, t.name).toBe(5);
    expect(new Set(ALL.map((a) => a.s.id)).size).toBe(50);
  });
  for (const { theme, s } of ALL) {
    it(`${theme.name}: ${s.name} reads, runs everywhere, shows something and moves`, () => {
      const pkg = readPackage(JSON.stringify(themePackage(theme, s, ['level'])));
      const { params } = effectOfPackage(pkg);
      for (const scene of Object.keys(SCENES)) {
        const frames = play(params, scene);
        for (const f of frames) for (const v of f) expect(Number.isFinite(v), scene).toBe(true);
        const top = Math.max(...frames.map((f) => Math.max(...f)));
        if (scene !== 'strip') expect(top, `${scene}: something lights`).toBeGreaterThan(0.15);
        expect(new Set(frames.map((f) => f.map((v) => Math.round(v * 50)).join(','))).size, `${scene}: it moves`).toBeGreaterThan(2);
      }
    });
  }
});

describe('kept values (the same for every LED, or for every count of a loop) change nothing', () => {
  it('all fifty give exactly what they give worked out LED by LED', async () => {
    const { compileProgram, newCtx, runFrame, runPixel } = await import('../engine/formula');
    for (const { theme, s } of ALL) {
      const pkg = themePackage(theme, s, ['level']), params = (pkg.params ?? []) as never[];
      const fast = compileProgram({ frame: s.frame, pixel: s.pixel }, params), slow = compileProgram({ frame: s.frame, pixel: s.pixel }, params, { keep: false });
      const a = newCtx(), b = newCtx();
      for (const t of [0.4, 2.2, 7.9]) for (const [k, prog] of [[a, fast], [b, slow]] as const) {
        k.t = t; k.beat = t * 2; k.c = (t / 8) % 1; k.size = 1; k.n = disc.n; k.lanes = disc.lanes; k.cells = disc.n; k.gw = disc.gw; k.gh = disc.gh;
        for (const q of s.params ?? []) if (q.type === 'number' || q.type === 'toggle' || q.type === 'choice') k.vals[q.id] = Number(q.default) || 0; else if (q.type === 'colour') k.cols[q.id] = new Float64Array([1, 0.5, 0.2]);
        runFrame(prog, k);
      }
      for (const t of [0.4, 2.2, 7.9]) {
        for (const [k, prog] of [[a, fast], [b, slow]] as const) { k.t = t; k.beat = t * 2; k.c = (t / 8) % 1; runFrame(prog, k); }
        for (let i = 0; i < disc.n; i += 7) {
          for (const k of [a, b]) { k.sx = disc.x[i]; k.sy = disc.y[i]; k.rad = disc.rad[i]; k.ang = disc.ang[i]; k.lane = disc.lane[i]; k.gx = disc.gx[i]; k.gy = disc.gy[i]; k.i = i; k.x = i / disc.n; k.rnd = (i * 0.618) % 1; }
          const x = runPixel(fast, a), y = runPixel(slow, b);
          expect(typeof x === 'number' ? x : [...x], `${s.id} at ${t}s, LED ${i}`).toEqual(typeof y === 'number' ? y : [...y]);
        }
      }
    }
  });
});

describe('their own knobs', () => {
  for (const { theme, s } of ALL.filter((x) => x.s.params?.length)) {
    it(`${s.name}: every one of its knobs changes it`, () => {
      const { params } = effectOfPackage(themePackage(theme, s, ['level']));
      const was = sig(play(params, 'disc', TIMES.slice(0, 10)));
      for (const q of s.params!) {
        const other = q.type === 'number' ? (q.default === q.max ? q.min : q.max) : q.type === 'colour' ? '#0040ff' : q.type === 'toggle' ? !q.default : q.default;
        const now = sig(play({ ...params, vals: { ...(params.vals as object), [q.id]: other } }, 'disc', TIMES.slice(0, 10)));
        expect(now, q.id).not.toBe(was);
      }
    });
  }
});

describe('the default repository (public/addons/)', () => {
  const build = () => {
    const files: Record<string, string> = {};
    const addons = ALL.map(({ theme, s }) => {
      const text = json(themePackage(theme, s, usesOf(theme, s))), file = `effects/${theme.id}/${s.id}.luxfx`;
      files[file] = text;
      return { id: `luxdmx.${s.id}`, kind: 'effect', version: '1.0.0', name: s.name, author: 'LuxDMX', license: 'MIT', description: s.description,
        tags: [theme.id, ...(s.tags ?? [])], fits: ['ring', 'disc', 'matrix'], file, size: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') };
    });
    files['index.json'] = json({ format: REPO_FORMAT, formatVersion: 1, name: 'LuxDMX', maintainer: 'https://github.com/tombueng/LuxDMX',
      themes: THEMES.map((t) => ({ id: t.id, name: t.name })), addons });
    return files;
  };
  if (process.env.WRITE_ADDONS) {
    it('writes public/addons/', () => {
      fs.rmSync(OUT, { recursive: true, force: true });
      for (const [f, text] of Object.entries(build())) { const u = new URL(f, OUT); fs.mkdirSync(new URL('.', u), { recursive: true }); fs.writeFileSync(u, text); }
    }, 300_000);
    return;
  }
  it('is what the themes make (WRITE_ADDONS=1 to write it again)', () => {
    for (const [f, text] of Object.entries(build())) expect(fs.readFileSync(new URL(f, OUT), 'utf8'), f).toBe(text);
  }, 300_000);
  it('loads the way the app loads it: every package there, checked, none left out', async () => {
    const fetcher = (async (u: string) => { const f = new URL(u).pathname.replace(/^\/addons\//, ''); try { return new Response(fs.readFileSync(new URL(f, OUT), 'utf8')); } catch { return new Response('', { status: 404 }); } }) as typeof fetch;
    const { repo, packages, problems } = await loadRepo('http://x/addons/', fetcher);
    expect(problems).toEqual([]);
    expect(repo.themes.map((t) => t.id)).toEqual(THEMES.map((t) => t.id));
    expect(packages.length).toBe(50);
    // a package that isn't what the index says is left out, and said
    const bad = (async (u: string) => new Response(u.endsWith('index.json') ? fs.readFileSync(new URL('index.json', OUT), 'utf8') : '{"format":"luxdmx-effect"}')) as typeof fetch;
    const b = await loadRepo('http://x/addons/', bad);
    expect(b.packages.length).toBe(0);
    expect(b.problems.length).toBe(50);
  });
  it('an index is read strictly: a file outside the repository is never fetched', () => {
    const { repo, problems } = readRepo(JSON.stringify({ format: REPO_FORMAT, formatVersion: 1, name: 'X', addons: [
      { id: 'x.a', kind: 'effect', name: 'A', file: '../../etc/passwd.luxfx', sha256: '0'.repeat(64) },
      { id: 'x.b', kind: 'effect', name: 'B', file: 'https://evil.example/b.luxfx', sha256: '0'.repeat(64) },
      { id: 'x.c', kind: 'effect', name: 'C', file: 'effects/c.luxfx', sha256: '0'.repeat(64) },
    ] }));
    expect(repo.addons.map((a) => a.id)).toEqual(['x.c']);
    expect(problems.length).toBe(2);
  });
});

describe('the address of another source', () => {
  it('https, or this computer for trying one out; ending in /, no login, nothing after a ?', () => {
    expect(sourceUrl('https://someone.example/addons')).toBe('https://someone.example/addons/');
    expect(sourceUrl('https://someone.example/addons/index.json')).toBe('https://someone.example/addons/');
    expect(sourceUrl('  https://someone.example/a/?x=1#y ')).toBe('https://someone.example/a/');
    expect(sourceUrl('http://localhost:8080/repo/')).toBe('http://localhost:8080/repo/');
    expect(sourceUrl('http://127.0.0.1/repo')).toBe('http://127.0.0.1/repo/');
    for (const bad of ['http://someone.example/addons/', 'ftp://x/', 'javascript:alert(1)', 'https://user:pw@someone.example/', 'not a url', 'file:///etc/'])
      expect(sourceUrl(bad), bad).toBeNull();
  });
});

describe('a repository someone else made (the second review)', () => {
  it('sizes in bytes and the hash of the file as served: an umlaut and a byte order mark are fine', async () => {
    const { createHash } = await import('node:crypto');
    const { packageOfEffect } = await import('./package');
    const pkg = { ...packageOfEffect({ id: 'e', name: 'Glühen', kind: 'formula', params: { formula: 'x' } } as any, { author: 'Jürgen' }), id: 'jürgen.x'.replace('ü', 'u') };
    const body = '﻿' + JSON.stringify(pkg), bytes = new TextEncoder().encode(body);
    const index = JSON.stringify({ format: REPO_FORMAT, formatVersion: 1, name: 'Jürgens', addons: [
      { id: pkg.id, kind: 'effect', name: 'Glühen', file: 'x.luxfx', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }] });
    const fetcher = (async (u: string) => new Response(u.endsWith('index.json') ? index : bytes)) as typeof fetch;
    const { packages, problems } = await loadRepo('http://x/r/', fetcher);
    expect(problems).toEqual([]);
    expect(packages.map((p) => p.name)).toEqual(['Glühen']);
  });
});
