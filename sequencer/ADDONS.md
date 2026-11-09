# Add-ons: effects as files

An effect can be a file: a `.luxfx` package that says what it is, who made it, which lights it's
for, which knobs it has, and how it draws. People send them to each other, import them, and
repositories serve them. The LuxDMX Sequencer reads every package strictly and never runs code from
one: what draws is written in a small language of our own (`luxfx-1`), read by our own parser,
which can reach the light it draws on and nothing else. No browser, no storage, no network, no
other show.

## The package

One JSON file, UTF-8, at most 2 MB.

```json
{
  "format": "luxdmx-effect", "formatVersion": 1,
  "id": "tom.ember-glow", "version": "1.0.0", "name": "Ember glow",
  "author": { "name": "Tom", "url": "https://example.org" }, "license": "CC-BY-4.0",
  "description": "Embers breathing under ash.", "tags": ["fire"], "category": "pixel",
  "fits": ["ring", "disc", "matrix"],
  "preview": "pic1:32x32:83,83,...:<base64>",
  "uses": ["speed", "level", "range", "contrast", "orientation", "spread"],
  "params": [
    { "id": "glow", "name": "Glow", "description": "How hot it burns", "type": "number", "min": 0, "max": 1, "step": 0.01, "default": 0.6 }
  ],
  "defaults": { "speed": 8, "tempo": false },
  "code": { "lang": "luxfx-1", "frame": "let pulse = wave(t / 3)", "pixel": "heat(fbm(sx * 3, sy * 3 - t) * glow * (0.6 + 0.4 * pulse))" }
}
```

| Field | What |
|---|---|
| `id` | `author.effect`, lower case letters, digits and `-`; unique in a repository |
| `version` | the package's own version, `1.0.0` |
| `name`, `description`, `tags` | what the picker shows and searches |
| `author` | `name`, and an `https://` link if you like |
| `license` | an SPDX id: `MIT`, `CC-BY-4.0`, `CC0-1.0` ... |
| `category` | `pixel`, `intensity`, `color` or `move` |
| `fits` | what it's made for: `ring`, `disc`, `matrix`, `strip`, `bar`, `lights`, `heads` |
| `preview` | a small animation for the picker (the app makes it when you save a package) |
| `uses` | the standard knobs that change it (below); the app shows only these |
| `params` | its own knobs (below) |
| `defaults` | where the standard knobs start |
| one of `native`, `code`, `media` | what it plays: a built-in effect, code, or a picture / GIF / video as frames |
| `code.speed` | for `luxfx-1`: the Speed at which its `t` runs in real seconds (without it, `defaults.speed`) |

### Standard knobs

The app draws these the same way for every effect; a package lists the ones that change it in
`uses`: `speed` (seconds or beats a round), `level` (strength), `size`, `spread`, `direction`,
`order`, `blocks`, `width`, `range` (dim to, bright to), `contrast`, `palette` (its colours),
`orientation` (on a ring or a matrix, mirrored). Code reads them as `size`, `c` (where the round
is, from `speed`), `phase` (with `spread` and `direction`), `pal(...)` (the palette); `range`,
`contrast`, `level` and `orientation` are applied by the app to what the code gives.

### Own knobs

| `type` | Fields | In code |
|---|---|---|
| `number` | `min`, `max`, `step`, `default`, `unit` | the number |
| `choice` | `choices: [{ value, name }]`, `default` | which one, 0, 1, 2 ... |
| `toggle` | `default` (true / false) | 1 or 0 |
| `colour` | `default` (`#rrggbb`) | a colour |
| `text` | `default`, `maxLength` | not readable by code (for effects of ours that take words) |

Each has an `id` (a name code can use: a letter, then letters and digits), a `name` and a sentence
of `description`. Ids can't be the names of the standard knobs.

## The language, `luxfx-1`

`code.pixel` runs for every LED, every frame, and gives its colour (or a number: a brightness in
the palette's colour). `code.frame` runs once a frame before that, for what's the same for every
LED (where a ball is, how far a story has got). Both are lines of `let name = value` and
`fn name(a, b) = value` (a small function of your own, used like the built-in ones, which can't
call itself), and `pixel` ends with the value it gives. `//` starts a comment; a line can go on
inside brackets.

A ball going round the rim, its tail fading. `frame`:

```
let at = frac(t / 4)                  // where it is, 0..1 round
```

`pixel`:

```
let d = frac(at - ang)                // how far behind it this LED is
let tail = pow(1 - d, 12) * step(0.8, rad)
hsv(0.6 + d * 0.2, 1, tail)
```

What a value can read:

- **where the LED is**: `x` and `u` (0..1 along the lights / along its own light), `i`, `n`, `row`,
  `rows`, and on a ring or a matrix `sx`, `sy` (-1..1, up is plus), `rad` (0 in the middle, 1 at
  the edge), `ang` (0..1 clockwise from the top), `lane`, `lanes` (its ring or its row), `gx`,
  `gy`, `gw`, `gh` (column and row on a grid), `first` (1 on the first LED of a ring or a run).
- **time**: `t` (seconds), `beat`, `c` (where the round is, 0..1), `phase`, `bass` (0..1 with the
  microphone), `rnd` (a random number per LED that stays).
- **knobs**: `size`, and the package's own by their id.
- **functions**: `sin cos tan atan2 hypot dist abs floor ceil round frac sign min max clamp mix
  step smoothstep pow sqrt exp log wave triangle square gauss noise fbm random`, colours `hsv rgb
  pal heat`, and `mix` works on colours too.
- **a few steps over a set**: `sum(k, n, value)`, `maxof(k, n, value)`, `minof(k, n, value)`
  add up, or take the biggest or smallest of, `value` for `k` = 0, 1 ... n-1 (n a number up to
  64, written out). Not inside each other. Good for sparks, stars and drops.

Names you give (lets, fns, knob ids) can't be the language's own (`x`, `t`, `heat`, `sum` ...); a
fn's own value names can be, inside it. Speed works on every add-on: its `t` runs faster or
slower than at the speed it came with, and `c` goes round once per Speed.

Limits: a program is at most 4000 characters and 1500 parts (its own functions put in place:
40,000), and the work in one frame is bounded twice: by counted steps (noise in layers counts
sixteen), and by the clock (30 ms a frame). One that goes over is stopped and named, rests a few
seconds before it's tried again, and everything else goes on. Values that are the same for every
LED, or change only with a loop's counter, are worked out once a frame and kept, so a program can
be written plainly and still run fast. Loops (`sum`, `maxof`, `minof`) are for programs only, not
for a plain Formula effect. Our own fifty are in
`src/addons/themes.ts`, a good place to see how things are done.

## A repository

Plain files on any web server, no login: an `index.json` and the packages next to it.

```json
{
  "format": "luxdmx-addons", "formatVersion": 1, "name": "LuxDMX", "maintainer": "https://github.com/tombueng/LuxDMX",
  "addons": [
    { "id": "luxdmx.ember-glow", "kind": "effect", "version": "1.0.0", "name": "Ember glow", "author": "LuxDMX", "license": "MIT",
      "description": "...", "tags": ["fire"], "fits": ["ring", "disc", "matrix"], "file": "effects/fire/ember-glow.luxfx", "size": 4210, "sha256": "..." }
  ]
}
```

`size` is the file's size in bytes and `sha256` the hash of the file as it is on the server
(hex); a package that doesn't match is left out and said. The server has to let other sites read
the files (CORS: `Access-Control-Allow-Origin: *`, which GitHub Pages does). Ours is the default and comes with the app (`public/addons/`, made from `src/addons/themes.ts`
by `WRITE_ADDONS=1 npx vitest run src/addons/addons.test.ts`; the test checks it's up to date).
Another one is added by its address in the effect library: under the add-ons, **More sources…**
(an `https://` address, or `http://localhost` for trying one out; it's kept only once it loads,
and only after a tick that you trust it). Its effects show under their own heading, kept in that
browser. **Only add sources you trust**: what a repository says about itself and its effects isn't
checked by anyone. The sandbox keeps what its effects can do to the light they play on, but names,
pictures and descriptions are theirs.

## Sending yours in

In the app: an effect's settings, More, **Share as a file…** saves it as a package (with your
name, what it is, a licence and a little animation). Anyone can bring it in with **Import an
effect file…** in the effect library. For ours: add it to `src/addons/themes.ts`, write the
repository again (above) and open a pull request.
