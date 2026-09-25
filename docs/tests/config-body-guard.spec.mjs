// Anything that POSTs /config has to send the pixel ports back.
//
// /config is a checkbox form: handleConfigPost() writes every bool from the PRESENCE of its
// key, so a body that leaves one out does not "leave it alone", it writes false. That rule
// already cost us once, when a helper dropped `useeth` and stranded a wired device in its
// setup AP with no way back over the network.
//
// The pixel ports walked into the same trap from the other side. They are not in /info.json
// (that endpoint gets polled, and a strip's settings are not status), so a form body built
// from an /info.json snapshot alone carries no p<i>_en -- and the save switches all five
// ports off. Worse, the usual "post the snapshot back" cleanup posts the same gap a second
// time, so nothing comes back and the damage outlives the test run.
//
// Two guards, both offline: the form builder actually emits the fields, and no spec quietly
// grows a new /config body that forgets them.
import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configForm, pixelFormFields } from './lib/device.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const PORT = {
  en: true, pin: 38, count: 8, chip: 0, order: 0, uni: 0, start: 1, uniMode: 0, latch: 0,
  fpsCap: 0, bright: 255, gamma: 220, maxMa: 0, mAPerCh: 570, quiesMa: 100, loss: 0,
  statusIdle: true, viewCols: 16, viewRows: 16, viewSerp: true,
};
const SNAP = {
  protocol: 2, hostname: 'x', otapw: 'y', ledType: 0, ledPin: -1,
  outputs: [{ en: true, uni: 0, port: 1, tx: 17, rx: 18, rts: 16 }],
  pixels: [PORT, { ...PORT, en: false, statusIdle: false, viewSerp: false }],
};

test.describe('a /config body carries the pixel ports', () => {
  test('the three pixel bools survive a round-trip through configForm()', () => {
    const f = configForm(SNAP);
    // Present means "on". All three are written from presence, so all three have to be here.
    expect(f.p0_en,     'enabled port stays enabled').toBe('1');
    expect(f.p0_statid, 'status-idle stays on').toBe('1');
    expect(f.p0_vserp,  'serpentine stays on').toBe('1');
    // And absent means "off", which is the whole point: port 1 is disabled and must not
    // come back on just because the helper pads the body out.
    expect(f.p1_en,     'disabled port stays disabled').toBeUndefined();
    expect(f.p1_statid).toBeUndefined();
    expect(f.p1_vserp).toBeUndefined();
  });

  test('every configurable pixel field is in the body', () => {
    const keys = Object.keys(pixelFormFields([PORT]));
    // The schema's PIXEL_FIELDS, by their form key (config_schema.cpp).
    for (const k of ['en', 'pin', 'count', 'chip', 'order', 'uni', 'start', 'unimode', 'latch',
                     'fpscap', 'bright', 'gamma', 'maxma', 'machan', 'quiesma', 'loss',
                     'statid', 'vcols', 'vrows', 'vserp'])
      expect(keys, `p0_${k} missing from the form body`).toContain(`p0_${k}`);
  });

  test('no field arrives as "undefined"', () => {
    // A renamed JSON key in /pixels.json shows up here rather than as a device that quietly
    // reset its brightness to the string "undefined" and clamped it to something.
    for (const [k, v] of Object.entries(pixelFormFields([PORT])))
      expect(v, `${k} came out undefined -- /pixels.json probably does not report it`).not.toMatch(/undefined/);
  });

  test('every spec that POSTs /config sends the pixel ports', () => {
    const offenders = [];
    for (const f of readdirSync(HERE).filter((n) => n.endsWith('.spec.mjs'))) {
      const src = readFileSync(join(HERE, f), 'utf8');
      if (!/post\(\s*'\/config'/.test(src)) continue;
      // Two halves, and both have to be there: sending the keys is no use without the data,
      // and fetching the data is no use if the body drops it again.
      //
      // "Imports the shared configForm" has to be read off the import line, not off the word
      // appearing somewhere. Five specs define a LOCAL function of the same name, and matching
      // the bare word let every one of them through -- this guard was waved past its own
      // regression test until it was written this way.
      const imports   = (src.match(/import \{([^}]*)\} from '\.\/lib\/device\.mjs'/) || [, ''])[1]
                          .split(',').map((n) => n.trim());
      const sendsKeys = imports.includes('configForm') || /pixelFormFields|p\$\{i\}_en|p\d+_en/.test(src);
      const getsPorts = /configSnapshot|pixelPorts|pixels\.json/.test(src);
      if (!sendsKeys || !getsPorts) offenders.push(f);
    }
    expect(offenders,
      'these build a /config body without the pixel ports, so saving switches all five off')
      .toEqual([]);
  });
});
