# What the sequencer keeps, and how old data comes along

Everything the app keeps has a version, and there is one place that brings old data up to date:
`src/store/kept.ts` for the small things in the browser's storage, `src/model/format.ts` for shows.
The rules:

- **Nothing is lost.** Data an app can't read (damaged, or a step that throws) is put aside under
  `<key>.unreadable`, never deleted, and the app goes on with its default.
- **Always written in the newest form.** Old data is read, brought up to date step by step, and
  written back at once, so it's migrated only once.
- **A version in every store.** Small values are kept as `{"v": 2, "data": …}`; a show carries its
  `formatVersion`; a database its version number; a song bundle its manifest's `version`.
- **One step per version, never edited.** Each store lists its steps (from 1 to 2, from 2 to 3…). A
  change of form adds a step and raises the version; the old steps stay as they are.
- **Newer than this app:** read as far as it can (shows: `minReaderVersion` decides), and never
  written back older. A value from a newer app is left alone, the app uses its default.

## Where it all is

| What | Where | Version | Brought up to date by |
|---|---|---|---|
| Shows (the open one and the saved ones) | IndexedDB `luxdmx-sequencer`, stores `shows` and `meta`; a copy of the open one in `luxdmx.seq.show` | `formatVersion` in the show (1.2.0); the database's own version (3) | `format.ts` `MIGRATIONS` (shows), `shows.ts` `onupgradeneeded` (the database) |
| My fixture types | IndexedDB `luxdmx-sequencer`, store `types` | as in a show's `fixtureTypes` | `format.ts` (they are read like a show's types) |
| Songs of shows, beat models | IndexedDB `luxdmx-audio` (`songs`, `models`) | the database's version (2) | `audio.ts` `onupgradeneeded` |
| Songs kept for offline | Cache Storage `luxdmx-songs` | the cache's name | `songCache.ts` |
| The app itself, for offline | Cache Storage `luxdmx-sequencer-<build>` | the build | `public/sw.js` (the old builds' copies go) |
| Settings, views, the last of each panel | localStorage `luxdmx.seq.*` | `{"v": n}` per key | `kept.ts` |
| Undo of the open show | localStorage `luxdmx.seq.undo` | the show's `formatVersion` inside | `format.ts` |
| A show file | `.luxdmx.json` | `formatVersion` | `format.ts` |
| A show with its songs | `.luxdmx.zip` | `manifest.json` `version` (1) | `bundle.ts` |
| An effect add-on | `.luxdmx-effect.json` | `version` in it | `addons/package.ts` |

## The pattern for a setting

```ts
// src/store/kept.ts: one entry per key
export const OUTPUT = kept('luxdmx.seq.output', 1, 'blind' as 'live' | 'blind', {
  // (each step: the old value in, the next version's out)
  1: (old) => (old === 'live' ? 'live' : 'blind'),
});
// anywhere
const o = OUTPUT.get();      // brought up to date if it was older, and written back
OUTPUT.set('live');          // written as {"v": 1, "data": "live"}
```

A value from before versions (a plain string or JSON) counts as version 0 and goes through step 1.
Every read brings its value up to date and writes it back; `migrateKept()` does it for every entry
at once (and for each member of a family, such as `luxdmx.seq.lastplay.<show>`). A test checks
that nothing in the app touches the browser's storage outside this list.

Undo over a reload (this tab's session) keeps the show format's version: steps from another
version, after an update, aren't brought back.

## The box and the Link

The app talks to a box through its `/bridge` page (postMessage, every message marked
`luxdmx: 1`, the protocol's version) and to the LuxDMX Link over a WebSocket. The box's own HTTP API
(`/info.json`, `/config`, `/rdm.json`, `/pixels.json`) is the firmware's; versioned paths
(`/api/v1/…`, the old ones kept as they are) would go there, in a firmware change of their own.
