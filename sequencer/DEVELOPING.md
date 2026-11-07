# Developing the LuxDMX sequencer

How the sequencer is built, how to change it without breaking it, and the traps we already fell
into. What it should be is in VISION.md, the plan in PLAN.md, the show file in FORMAT.md, the
user-facing guide in GUIDE.md (README.md is the short front page: the
highlights, the GIFs and screenshots).

## What it is

A lighting console in the browser for hobbyists: patch lights, program looks and cue lists, run
effects, play a show live (pages of buttons and faders, a phone as a remote), arrange it on a
timeline under a song, and see it on a 3D stage. No backend. The show lives in the browser
(IndexedDB) and in `.luxdmx.json` files. DMX goes out through a LuxDMX box (over its own bridge
page) or to any Art-Net / sACN node through LuxDMX Link, a small helper on the computer.

Rules from VISION.md that decide most questions: no syntax, things look like what they do,
sensible defaults everywhere, depth is opt-in, plain words.

## Running it

```
npm install
npm run dev            # http://127.0.0.1:5173/ (VITE_DEFAULT_DEVICE=<box> adds a box at start)
npm run check          # svelte-check + the e2e TypeScript
npm test               # vitest (unit and app tests, happy-dom)
npm run e2e            # Playwright against a fake box (test/fake-luxdmx.mjs)
```

The demo songs' own copies (`public/songs/`, about 100 MB) aren't in git: `npm run songs` fetches
them from the artists' files and checks each against its sha256 in `src/timeline/catalog.ts`
(credits in SONGS.md; `npm run build:release` does it too).

e2e starts its own dev server (port 5174) and fake box (8199). `PW_PORT` and `FAKE_PORT` move
them, so two runs at once don't share one fake box. `LUXDMX_HOST=<ip>` also runs `hw.spec.ts`
against a real box (it changes what the box puts out: only on a bench box).

LuxDMX Link (the Art-Net / sACN helper) is in `link/` (Go, no dependencies):
`cd link && go test ./...`; `npm run link` builds every system's download into `public/link/`
(with `manifest.json`; `node scripts/build-link.mjs --only linux-amd64` for one), which the app
offers in "Get LuxDMX Link". `public/link/` isn't in git: `npm run build:release` builds Link and
then the app, so a deployed site has the downloads next to it.

## The layout

| Folder | What's in it |
|---|---|
| `src/app.svelte.ts` | The app state (one `app` object): the show, selection, programmer, playback, outputs, undo, saving, the timetable, cold start and reload restore. Most UI actions are methods here. |
| `src/model/` | The show: `types.ts` (every type), `format.ts` (load, validate, upgrade, save), `library.ts` (built-in fixture types, capabilities), `timeline.ts`, `schedule.ts`, `sun.ts`, cue numbering, diffs. |
| `src/engine/` | What goes out each frame: `engine.ts` (lists, effects, merging, rendering to universes), `player.ts` (a cue list playing: fades, follow-ons, tracking), `resolve.ts`, `render.ts` (values to DMX channels per fixture mode), effects (`fxkit.ts` shared parts, `effects.ts` built-in, `pixels.ts` pixel shows, `custom.ts` formula and picture). |
| `src/output/` | `bridge.ts` (a LuxDMX box through its bridge popup and websocket), `link.ts` (LuxDMX Link on this computer). Both also carry RDM requests (`rdm()`: answered by id, a timeout when the other end has none). |
| `src/rdm/` | RDM: `types.ts` (the light as RDM says it), `box.ts` (a box's `/rdm.json` read), `match.ts` (the rig against the patch, the fixes, which library profile a light is; pure, tested), `rig.svelte.ts` (scan, watch, history, the fixes applied); the screen is `ui/RigCheck.svelte`. The bridge page relays `rdm` messages to the box's own `/rdm*` endpoints; the fake box has a small simulated rig. |
| `src/stage3d/` | The 3D stage (three.js, lazy loaded): `Stage3D.svelte` (scene, camera, tools), `geometry.ts` (placement and aiming maths), `rig.ts` (the lights, instanced), `particles.ts` (fog, haze, confetti, bubbles, flames, sparks, CO2), `venue.ts` (stage, truss, PA, crowd, band), `people.ts` (jointed people), `models.ts`, `textures.ts` (painted canvases). |
| `src/audio/` | The crowd (`crowd.ts`): chatter and cheering from recordings (`crowdReal.ts`, files in `public/sounds/crowd/` made by `scripts/build-crowd-sounds.py`; no applause, no clapping), or made in the browser when those can't be had (`crowdKit.ts`, rendered once per page in `crowdKit.worker.ts`), driven by the timeline's own crowd track (`Timeline.crowd`, kept out of `items` so the moments' types and `prune.ts` stay as they are), on the song's audio path (so video takes have it). |
| `src/timeline/` | The song player (`player.svelte.ts`) and the demo beat (`beat.ts`); `analyze.ts` finds a song file's tempo, first downbeat and parts (see below). |
| `src/ui/` | Svelte components. `ui.svelte.ts` holds UI-only state (modals, toasts, the 3D switch). |
| `src/content/` | Show templates, the big demo, presets, busking pages, "what's new". |
| `src/import`, `src/export` | QLC+, OFL, GDTF imports; cue and patch sheets, QLC+ export. |
| `src/input/` | Microphone beat and level, MIDI. |
| `src/remote/` | A phone as a remote, through the box. |
| `src/store/` | IndexedDB: shows, songs and venue models, the clipboard. |
| `link/` | LuxDMX Link (Go). |
| `e2e/` | Playwright tests; `e2e/README.md` has the coverage table. |
| `schema/` | The JSON schema of the show file. |

## A frame, start to end

1. `app.tick()` (every animation frame) hands the programmer to the engine.
2. `Engine.frame()` asks every running list (`ListPlayer`) for its look and weight, merges them
   (intensity and fog HTP, everything else latest takes precedence), runs the effects
   (`runEffects`), adds the live layer (flash, blinder, strobe), fits each look to what the light
   can do (`fitLook`) and renders every fixture into its universe (`renderFixture`).
3. The outputs send each universe that changed (and a heartbeat): the bridge as `'D'` frames over
   the box's websocket, Link as the same frames to the helper.
4. The 2D stage, the 3D stage and the cards draw from `app.stage` (the resolved values), never
   from the DMX bytes.

Everything an effect or a look does is a pure function of time and position, so the preview, the
stage and the output agree and tests can check exact values.

## The show file

`types.ts` is the truth; `format.ts` reads and checks a file (`upgrade()` for older ones),
`FORMAT.md` explains it, `schema/luxdmx-show.schema.json` describes it. Change all four together;
`model/schema.test.ts` checks that saved shows pass the schema. Unknown keys are kept, wrong ones
dropped with a note. Anything that can make a machine run (fog, flames, CO2) must have a bounded
duration in the file (a burst says its seconds, at most 30).

## A song's tempo and parts from its sound

`timeline/analyze.ts` is pure (a mono signal in, numbers out): spectral flux at 86 frames a
second (all bands, kick, snare), the tempo as the steady grid that fits the onsets over the whole
song (autocorrelation for candidates, each refined to 0.01 BPM by folding the envelope), the level
picked in 70 to 180 BPM (the faster of two when the slower one's half-way points are nearly as
strong as its beats), the beats where kick and snare hit (+20 ms: log flux peaks before the
attack), the "one" from kick on 1/3, snare on 2/4 and the sound changing, parts from a checkerboard
novelty over bar features (8 band groups, chroma, loudness). `songAnalysis.ts` renders the
decoded song to mono 11025 Hz in an `OfflineAudioContext` and runs it in `analyze.worker.ts`;
without a worker, `analyzeSteps` (a generator) runs on the page in slices of about 12 ms. Below
`SURE` confidence it names no parts. `LUXDMX_MEASURE=1 npx vitest run src/timeline/analyze.catalog.test.ts`
measures it against the demo songs (their tempo, offset and parts were found offline with librosa
and checked by hand; needs `public/songs/` and ffmpeg): change it, measure again.

## Effects

An effect is an `EffectDef` (fxkit.ts): id, name, category (move, color, pixel, intensity), a
one-line blurb, its defaults and `run(e, p)`. `e` is one element (a light, or a pixel of a bar):
its phase in the cycle, its place `x` along the group, `u` along its own light, its `row` (which
light), `beats` and `secs` since the effect started, a stable `seed`. `p` are the knobs. `run`
returns intensity, colour, pan/tilt offsets or a white strike. No state between frames: anything
that looks stateful (bouncing balls, ripples, fire) is computed from time and seeds.

Rings and matrices (`shapes.ts`, `shape: true` on the def): `FixtureMode.layout` says where the
pixels are, `model/pixelLayout.ts` turns it into `Places` once per mode, and the effect reads
`sx`, `sy` (-1..1), `rad`, `ang`, `lane` and the grid `gx`, `gy`, `gw`, `gh` from `e`. What's the same
for every pixel of a frame (an eye's pose, the stars) is worked out once for that moment and kept
for the next pixel, keyed on the time: that's a cache, not state. On a strip they get a line through
the middle (`sy` 0), so they must not assume a second dimension. Their contact sheet is the quick
way to judge one: run it at a few moments on a disc and a matrix and look.

A box only gets the universes it plays (`Bridge.wants`): its bridge page says its DMX outputs and
its pixel ports. Don't widen that to "every pixel universe to every box": frames go one at a time, so
on the big demo that took a DMX universe from 0.6 to 0.1 frames a second. `app.unservedPixels()` is
what the note under the top bar (ConnectionBanner) shows.

A mode with more than 512 channels (`isWide`) spans universes: `spansOf(fixture, mode)` is the only
place that knows how, whole pixels per universe. The engine draws it into a buffer of its own and
copies the spans; patching, the universe counters and the channel list go through `spansOf`,
`channelAt` and `sharesChannels`. Never add one to `f.address` by hand for those.

Adding one: the def in the right file, a blurb in plain words, defaults that look good on a row of
eight PARs and on a 60-pixel strip, a unit test of a few exact values, an e2e that runs it on the
fake box, and a line in GUIDE.md. New knobs go into `EffectParams` and `BASE` in effects.ts
(`paramsOf` only keeps known keys) and into FORMAT.md.

## The 3D stage

- Metres, y up, the audience is at +z, the band faces +z. The deck is `DECK` (1.2 m) high,
  `W` x `D`. Rotations are yaw, pitch, roll in degrees, applied as three.js Euler `'YXZ'`
  (`toWorld` in geometry.ts is the same maths without three).
- A moving head turns about its pivot `PIVOT_UP` above the clamp; aim and calibrate work from
  there (`pivotOf`). `geometry.test.ts` checks aim, calibrate and the drawn beam agree.
- Lights are instanced per look (`rig.ts`); a light's place changes call `rig.place()`, only
  lights coming or going rebuild.
- The venue is built once. Static parts are baked into a few meshes per material (`gear.ts`
  `bake`); the crowd is instanced and moves in its own shader (`crowd.ts`: jumps on the beat, arms
  turning about the shoulders); the band and the screens update themselves in `animate()`.
- Two rooms (`geometry.ts` `ROOMS`, `settings.stage3d.room`): the big stage in a hall and a small
  club / pub. Anything that asks "is this on the deck" or "where's the floor" goes through the room
  shown (`floorAt`, `onDeck`), never through `W`/`D` directly: lights, beams and particles must land
  in the room you see. A light without its own 3D place goes where its plan position puts it in
  that room; one placed by hand keeps its metres.
- The demos' rooms (`club`, `party`, `truss` in `ROOMS`) are built in `rooms.ts`, not `venue.ts`
  (`buildVenue` hands them over; they return a `Stage`, the part of `Venue` the 3D stage uses).
  Their truss is a list of pieces (`Room.frame`, middle lines): the room draws exactly those, and
  the demos' shows (`content/club.ts`, `party.ts`, `trussTest.ts`, listed in `content/demos.ts`)
  hang their lights on them; `demos.test.ts` checks every light rests on a piece, the deck or the
  floor. A room without a stage has `deck.x < 0` (everything stands on the floor). `Room.walls` is
  the inside of every room. The DJ (`dj.ts`) is a `Person` behind the booth in `DJ_BOOTH`; the
  crowd is `crowd.ts`'s, built with `flags: 0`.
- The festival demo (`content/demo.ts`) has show time before and after its song (`Timeline.lead`
  and `tail`: items at negative times and past the song's end): a 32 s intro (house lights, the
  crowd cheering, searchlights, the backdrop, the band walking on) and the cheer after it, with
  the crowd track (`src/audio/`). It plays on two lists: **Show** (the looks: colour, level,
  effects, never pan or tilt) and **Moves** (priority high, pan and tilt only: shapes aimed with
  `aimAt` from where each head hangs or stands, the second of a pair worked out from the first so
  the heads swap in under a beat). Its timeline comes from the song's parts and its `hits`
  (`catalog.ts`: slam, stop, dip, drums, fill, end, measured by hand; guessed from the parts for a
  song without them). `demo.test.ts` checks every move is on the beat grid and every head reaches
  every shape.
- The crowd's flags are waved in the vertex shader (`crowd.ts`: `fSwing`, `fCloth`, `fArm`): the
  pole turns about `FLAG_PIVOT`, the left arm turns (and stretches a little) to keep its wrist on
  the pole, the cloth is laid out from the pole every frame. `flagSwing`, `flagTurn` and `flagArm`
  are the same sums in TypeScript and `venue.test.ts` checks the hands with them: change both.
- The LED screens' live picture (`Stage3D.svelte` `feedFrame`): the Broadcast crew's shot drawn
  small into two render targets in turn (the screens never sample the one being drawn), the
  particles' point scale set for that picture while it's drawn. The screens' material is marked
  `userData.live` so `bake()` leaves it alone (a baked copy would never get the picture).
- The band name (`settings.bandName`) is painted onto the banners, scrims and screens; changing it
  repaints those textures only, it never rebuilds the venue.
- People (`people.ts`) are jointed: arms and legs are two-bone chains solved so a hand or foot is
  exactly where it's sent. Put hands on things through `Person.hand()`, never by placing meshes.
  Hands hold things through `Person.hold()` (grip shape, axis, palm; `follow` turns the hand with
  the forearm), sticks go in with `inHand()`, feet on pedals with `foot(side, at, pitch)`, bending
  at the hips with `lean()`. The band's bodies and moving feet are never baked.
  `people.test.ts` checks hands land on their targets and mics point at mouths.
- Anything that moves with time in the 3D stage steps by the clock, not by the frame: particles
  are stepped in slices of at most 0.1 s for however long the frame took (up to half a second), so
  a slow computer shows the same fog, only in fewer pictures.
- The camera moves (Tour, Broadcast, Crane, Steadicam, Drone, Band cam) are worked out in
  `director.ts`: `direct(mode, room, music, cast, memory)` takes the time, the beat count, the
  lights' energy and the song's part, and who's where (`castOf`: the band or the DJ as venue.ts and
  rooms.ts build them, plus the lights), and gives back the camera's place, target, lens (against
  the normal 42°) and roll. No three.js and nothing read from the scene. What a crew remembers
  (Broadcast's last cut, how loud it's been, how far the drone has dived) is the plain `Memory`
  record the stage hands back each frame, so the same inputs always give the same shots. Each
  room's camera places are in `CREW`; `spaceOf`/`blocked` is what a camera must stay out of (walls,
  ceiling, deck, truss and the lights under it, the band, the DJ booth, the crowd's heads and hands,
  big gear). `director.test.ts` walks every mode through every room for four minutes and checks
  that, the speeds, the cuts, and that the people and the crowd really are where `CREW` assumes:
  move someone in venue.ts or rooms.ts and it tells you. While a move runs the stage doesn't call
  `controls.update()` (its polar clamp would undo low shots); a grab (OrbitControls `start`, then
  a `change` of more than a nudge) stops it.
- The 3D stage reads `app.stageNow` (every frame's values, not reactive), never `app.stage` (the
  panels' copy, published every n-th frame when the page is busy: movers at 6 updates a second).
  Moving heads go through `motion.ts` (`slew`: a real head's top speed and acceleration per axis),
  in `rig.ts` only: what goes out is unchanged, Aim and the tests' `aimError` use the DMX values.
- The 3D world outlives the view showing it (`Stage3D.svelte`'s module script: `park`/`takeKept`):
  Program, Timeline and Live each have a stage, and the renderer, scene, room, rig and particles
  are handed on; controls, gizmo and the glow passes are per stage. Views are kept, hidden (see
  The UI), so a stage is mostly *released*, not destroyed: its view hidden (the `view-shown`
  context), it stops its frames and observers, disconnects its controls from the canvas and parks
  the world; shown again it takes the world back, catches up (the effects that change the world
  run only while `holding` and run again on its return) and restores the camera from the tab's
  copy. A hidden stage has no elements on the page. A stage that starts while the last one still
  has the world waits up to 0.4 s for it. Released when 3D is switched off (or after 3 minutes
  parked). Trap: a teardown reads reactive state as it was *before* the change tearing it down, so
  it reads `ui.stage3dNow` (a plain copy), not `ui.stage3d`.
- Textures are painted on canvases (`textures.ts`): nothing downloaded, nothing to license. Cache
  them (`make()`), they're shared.
- Fog and haze (`particles.ts`): a jet that brakes on its own speed, then puffs carried by a 1 m
  air grid over the room (worked out 20 times a second: fog flows from thick to thin, so it can't
  pile up at the backdrop), a slow drift towards the audience, held by the room's walls; each puff
  lives 28 to 38 s and fades as it swells. Puffs live in flat typed arrays, and per-frame fog work
  is two passes over them: keep it that way (five passes cost 5 ms a frame). `particles.test.ts`
  measures where a burst has got to at 5, 10 and 20 s and that it's gone at 40 s.
- Room walls and ceilings are unlit (they fill half the picture) and marked with `house()` (gear.ts):
  their colour follows the Ambient slider every frame, so they're kept out of `bake()`'s merging
  (merging folds a material's colour into the vertices). New unlit room surfaces: `house()` them.
- Particles are point sprites with additive or normal blending. They must never darken the
  picture in big areas: additive where they glow, sizes capped, faded near the camera, no NaN.
  `__stage3d.hdr()` (dev) reads the scene back as floats and counts NaN and overflow; the e2e
  "picture stays finite" uses it.
- Closing the 3D stage disposes everything and calls `forceContextLoss()`.
- Budget: 60 fps with the big demo at 1600 x 900 on a modest GPU (we measure on a Radeon RX 6400:
  about 7 ms of script and 10 ms of GPU a frame). Draw calls cost more than triangles here: merge
  a person's or a prop's parts per material, instance repeated things.

## The UI

- Svelte 5 runes. App state lives in `app` (app.svelte.ts), UI-only state in `ui`
  (ui.svelte.ts). Components read them directly.
- Program, Live and Timeline are built once and kept (App.svelte): opened the first time, or in a
  quiet moment after the start (one at a time, then laid out once while still invisible), and
  hidden, not taken down, while another is shown (`content-visibility: hidden` keeps their layout,
  `inert` keeps them out of the keys and screen readers). So "mounted" no longer means "on
  screen": anything that should only happen while a view is shown checks `app.view` (each view
  has a `shown`, and sets the `view-shown` context the 3D stage reads). Hidden, a view must cost
  nothing a frame: the plan and the DMX line aren't drawn, the 3D stage is released, the timeline
  doesn't follow the playhead, its lists hold the last frame (`whileShown(() => app.stage)` from
  `ui/shown.svelte.ts`: the fixture list, the group dots, the cue deck, Live's tiles); window keys
  check the view; leaving Live still lets go of what's held. A test that finds things by CSS class
  can now meet a hidden view's copy: scope it to the view or add `.filter({ visible: true })`. Sizes read while hidden are 0: keep the last real one (`bind:clientWidth` with a setter
  that skips 0). A first visit draws the view's frame at once and its long lists (the tiles, the
  timeline's chips and items) a frame later. `e2e/views.spec.ts` checks it.
- CSS tokens in `src/style.css` (`--bg`, `--panel`, `--line`, `--text`, `--muted`, `--accent`,
  `--focus`, ...). The root font is 87.5 %; touch targets for show controls are at least 44 px.
- Every control is reachable by keyboard and has a name (axe runs in e2e). Right-click menus have
  a keyboard way too (the menu key, Shift+F10). Help is a short hint or a title, never a wall.
- Words: plain, short, friendly ("Fog for 5 s", not "Trigger SFX burst"). Say what will happen.
  No em dashes in UI text or docs.
- Errors the user should know about go to `ui.toast()`; nothing fails silently.

## Writing code here

- Match the code around you: its naming, its comment density, its idioms. Comments say why, in
  plain words.
- TypeScript strict. No `any` in `src/` (tests may use it). No new dependency without a good
  reason; versions are pinned exactly.
- Keep the engine and the effects pure and allocation-light: they run every frame for hundreds of
  lights (`engine/perf.test.ts` keeps the budget).
- Safety first where machines are involved: fog and effect machines are HTP across lists, bursts
  end by themselves (at most 30 s), closing the page sends them to zero (`fogSafe`), a reload
  doesn't black out a running show, one tab sends a show at a time (Web Locks).
- The machine gate (`model/safety.ts`, `Engine.gate`) is the last thing that touches the DMX bytes:
  after every fixture is rendered and after the channel wizard's overlay, so nothing written later
  can fire a machine. Confetti, flames, sparks and CO2 are 0 unless armed; armed, a channel must
  be seen at 0 before a shot passes, and a shot is cut after `MAX_ON`. Arming only happens on
  stage (`app.armMachines`); going blind, a show change and a reload disarm. A list put on a cue
  without playing into it (a timeline jump, the timetable) is in `engine.jumped`: its machines stay
  quiet, raw values included, through its own follow-ons, until a GO. Never add a path that writes
  DMX bytes after the gate, and never persist the armed state.
- Blind (`app.output`) sends the frozen look (fog, haze and machines zeroed); Blackout always gets
  through. On stage is kept per tab (sessionStorage), across a cold restore of a show that was
  playing on stage, and in the browser for a locked show.
- A frame must never throw for good: `app.tick` catches and resends the last look with fog and
  machines off; `runEffects` catches per effect (`engine.broken`, named once in a toast).
- The output thread (`output/thread.ts`, a module worker; the page's side `output/host.svelte.ts`)
  has its own `Engine` and clock and sends to Link (its own socket) and to boxes whose bridge page
  took a channel (`Bridge.offerPort`, a MessagePort; the page says `{type:'port', ok:1}`). The
  page's engine is the mirror: `host.wrap` forwards every command (with `engine.now()` at the call,
  so fades start together) and the `jumped` set; `sync()` sends the inputs (programmer, live,
  masters, armed...) and the show when they change; a command first sends the show if it changed
  (a list made and started at once must exist there). The show goes as text, parsed in the thread,
  and only when it changed (`showChanged()` from `markDirty`, `checkpoint`, `replaceShow`; the save
  hands its JSON over with `showJsonIs`). Never compare it on a timer: `JSON.stringify` of a big
  show through the proxies takes 100 to 400 ms on the page. The send before a command must not
  clear the "changed" flag: a command can come in the middle of a change (a new show stops the old
  one's lists before it's there), and only the frame's send sees the change finished. A click or a
  key alone (`markDirty(350, false)`) only books the save, which hands a changed show over; a
  command while that save is due runs it first (`thread.beforeCommand`), so an edit in a form
  followed by a GO reaches the thread before the GO. Rules: never change engine state other than
  through its methods, properties `sync` knows, or `jumped` (anything else never reaches the
  thread); safety inputs (`armed`, `blackout`) go at once (`inputsNow`); `serves(b)` says who sends
  to a box, never both (a late page frame would put an older look back). The page's own Link
  connection and the thread's both send `{type:'page', id: PAGE_ID}` (output/link.ts), so Link
  (1.2.0 on) counts one page, not two. On `pagehide`: `final()`
  (terminate) first, then the safe look, to boxes as `bye` (the bridge page closes the channel
  before sending it). The thread takes over only once it's heard from; silent, the page sends.
  `e2e/thread.spec.ts` blocks the page's main thread and checks the box still gets every frame
  (the test browser must keep every site in its own process: `--site-per-process`).
- The DMX output comes first, drawing is low priority. `app.frame()` sends right after
  `engine.tick()`, then does the rest; the screen's copy (`publish`: stage, look, status) goes out
  every frame or every n-th (`load.uiEvery`). `perf/load.svelte.ts` times every output frame and
  steps the drawing down when frames come late (pictures less often, then `load.level`: the 3D
  stage's pixel ratio, glow and frame rate, the plan's blur and animations) and back up after calm
  seconds. Anything new that draws every frame reads `load.level` and reports its time with
  `load.did(ms)`. Never put drawing work before the send, and never wait for the screen in it.
  With the output thread running (`load.outputSafe`) the page's late frames can't make the output
  late: `load.level` (the 3D stage) stays at the quality chosen; `uiEvery` (to 3 at most) and
  `load.level2d` (the plan's blur and animations: most of a busy page on a big rig) step down.
  Without the thread both levels move together. The quality
  with nothing stored is High (`Number(null)` is 0: it once made everyone's default Low).
- Big pictures go on the page as one image, not as shapes: the cue and tile thumbnails
  (`thumb.ts` `stageSvg`) are shown through `svgImage` (a data URL, cached). As SVG elements a
  deck of 40 cues on a 300-light rig was 14,000 elements and seconds of layout per tab switch.
  Marks worked out from a whole cue (`cueRisk`) go through `ui/risk.ts`, cached per cue until
  `app.showRev` changes. The same for the app's getters that look at the whole show: `pages` (the
  generated page of a show without one) and `liveList` are worked out once per show and revision.

## Tests

- Unit tests sit next to the code (`*.test.ts`, vitest, happy-dom). `app.harness.ts` builds a
  whole app for tests that need one. happy-dom has no 2D canvas: code that paints must cope with
  `getContext('2d')` returning null.
- Every feature gets an e2e test in `e2e/` (Playwright, the fake box records every frame:
  `channels()`, `frames()`, `history()` in helpers.ts) and a row in `e2e/README.md`.
- The 3D tests use the dev hook `window.__stage3d` (stats, screen positions, aim error, `hdr()`,
  `internals`). It only exists in dev builds.

## Docs

With every change that a user can see: GUIDE.md (features, how-tos; README.md too when it's a
highlight), FORMAT.md and the schema
(file changes), e2e/README.md (coverage). (`content/whatsNew.ts` isn't a changelog: it finds the
lists and effects a hand-made live page doesn't have yet.)

## Traps we fell into

- `Object.assign(mesh, { position })` throws (position is read-only): use `mesh.position.set`.
- Svelte trims a leading space in an element: use `&nbsp;` where a space matters.
- `-0` ends up in saved numbers: add `+0` when rounding.
- An empty signature equals the initial empty one: start a cache key at `null`, not `''`.
- A getter that builds something from the whole show runs on every read, and the phone remote reads
  `pages`, `livePage` and `liveList` a few times a tick: built each time, the demo's generated page
  (~100 ms through the proxies) froze the laptop as soon as a phone joined. Key it on `showRev`.
- Shared scratch vectors mutated by two callers in one frame give wrong results: own scratch.
- Exponential growth per frame (`size *= 1 + dt * k`) runs away over a long life: ease towards a
  cap instead.
- A dark, normal-blended sprite near the camera covers the screen: additive, capped, faded.
- Reading layout (`clientWidth`, `scrollLeft`) every frame makes the browser lay out every frame.
- Something hidden under another view still costs: don't render it (the 2D plan under the 3D).
- Timezones: tests that touch the sun or the timetable use `guessPlace()` or set `TZ`.
- `pkill -f <pattern>` matches your own shell when the pattern is in its command line: stop
  servers by port.
- A value a little outside 0..1 (from a file, a formula) must never throw in the frame: clamp
  before using it as an index (a gobo at -0.1 picked slot -1 and stopped every light's output).
- Per-mode facts (which channels are 16 bit, gated, the shutter's ranges) are worked out once per
  mode in a `WeakMap` (`capsOf`, `planOf`, `gatedChannels`). That's only right because a fixture
  type is never edited in place: saving one makes a new object. Keep it that way.
