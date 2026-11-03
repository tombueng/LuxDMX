// The box's own pages (/remote, /bridge) are plain HTML with an inline script that no build step
// looks at: one apostrophe in a sentence breaks the whole page. They're parsed here (not run).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe("the box's pages", () => {
  for (const name of ['remote', 'bridge']) {
    it(`${name}.html: its scripts parse`, () => {
      const html = readFileSync(new URL(`../../../src/pages/${name}.html`, import.meta.url), 'utf8');
      const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      expect(scripts.length).toBeGreaterThan(0);
      for (const s of scripts) expect(() => new Function(s)).not.toThrow();
    });
  }
});
