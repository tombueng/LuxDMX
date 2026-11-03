import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOG, GENRES, type CatalogLicense } from './catalog';

// Licences that let us pass the songs on with the app. NC only where a genre had nothing else
// (SONGS.md says which and why).
const ALLOWED: Record<CatalogLicense, RegExp> = {
  CC0: /^https:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/$/,
  'CC BY': /^https:\/\/creativecommons\.org\/licenses\/by\/\d\.\d\/$/,
  'CC BY-SA': /^https:\/\/creativecommons\.org\/licenses\/by-sa\/\d\.\d\/$/,
  'CC BY-NC': /^https:\/\/creativecommons\.org\/licenses\/by-nc\/\d\.\d\/$/,
  'CC BY-NC-SA': /^https:\/\/creativecommons\.org\/licenses\/by-nc-sa\/\d\.\d\/$/,
};
const PUBLIC = resolve(__dirname, '../../public');

describe('song catalog', () => {
  it('has at least two songs with vocals for every genre', () => {
    for (const g of Object.keys(GENRES)) expect(CATALOG.filter((s) => s.genre === g).length, g).toBeGreaterThanOrEqual(2);
    expect(CATALOG.every((s) => s.vocals)).toBe(true);
  });

  it('ids are unique and fit a file name', () => {
    const ids = CATALOG.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('licences only from the allowed list, with the matching deed', () => {
    for (const s of CATALOG) {
      expect(Object.keys(ALLOWED), s.id).toContain(s.license);
      expect(s.licenseUrl, s.id).toMatch(ALLOWED[s.license]);
    }
  });

  it('every song names where it came from and has a file there', () => {
    for (const s of CATALOG) {
      expect(s.title && s.artist, s.id).toBeTruthy();
      expect(s.page, s.id).toMatch(/^https:\/\//);
      // (Jamendo's download links have no file extension)
      expect(s.url, s.id).toMatch(/^https:\/\/.+\.(mp3|ogg)(\?.*)?$|^https:\/\/prod-1\.storage\.jamendo\.com\/download\/track\/\d+\/mp32\/$/);
      // a Jamendo file is the track its page shows (the two numbers are typed separately)
      const jam = s.url.match(/jamendo\.com\/download\/track\/(\d+)\//);
      if (jam) expect(s.page, s.id).toBe(`https://www.jamendo.com/track/${jam[1]}`);
    }
  });

  // (public/songs/ isn't in git: a fresh checkout fetches them with `npm run songs`)
  it.skipIf(!existsSync(resolve(PUBLIC, 'songs')))('every mirror file is in public/songs/, the artist\'s file byte for byte', () => {
    for (const s of CATALOG) {
      expect(s.mirror, s.id).toBe(`songs/${s.id}.${s.mirror.split('.').pop()}`);
      const f = resolve(PUBLIC, s.mirror);
      expect(existsSync(f), `${f} (npm run songs)`).toBe(true);
      expect(statSync(f).size, f).toBeGreaterThan(500_000);
      expect(createHash('sha256').update(readFileSync(f)).digest('hex'), s.id).toBe(s.sha256);
    }
  });

  it('tempo, first downbeat and length make sense', () => {
    for (const s of CATALOG) {
      expect(s.bpm, s.id).toBeGreaterThanOrEqual(60);
      expect(s.bpm, s.id).toBeLessThanOrEqual(200);
      expect(s.offset, s.id).toBeGreaterThanOrEqual(0);
      expect(s.offset, s.id).toBeLessThan(s.duration / 4);
      expect(s.duration, s.id).toBeGreaterThanOrEqual(120);
      expect(s.duration, s.id).toBeLessThanOrEqual(400);
    }
  });

  it('sections start at 0, run in order, stay inside the song and have plain names', () => {
    const names = /^(Intro|Verse|Pre-chorus|Chorus|Build|Drop|Break|Bridge|Solo|Instrumental|Outro)( \d)?$/;
    for (const s of CATALOG) {
      expect(s.sections.length, s.id).toBeGreaterThanOrEqual(4);
      expect(s.sections[0].at, s.id).toBe(0);
      for (let i = 0; i < s.sections.length; i++) {
        const x = s.sections[i];
        expect(x.name, s.id).toMatch(names);
        expect(x.at, `${s.id} ${x.name}`).toBeLessThan(s.duration);
        expect(x.energy, `${s.id} ${x.name}`).toBeGreaterThanOrEqual(0);
        expect(x.energy, `${s.id} ${x.name}`).toBeLessThanOrEqual(1);
        if (i) expect(x.at - s.sections[i - 1].at, `${s.id} ${x.name}`).toBeGreaterThanOrEqual(4);
      }
    }
  });
});
