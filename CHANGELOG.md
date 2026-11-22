# Version history

What changed, newest first. Firmware versions are the release builds (`v1.0.N`, see
[Releases](https://github.com/tombueng/LuxDMX/releases)); a box with auto-update on picks them up by
itself. The sequencer has no version number of its own: it's the page at
[tombueng.github.io/LuxDMX/sequencer](https://tombueng.github.io/LuxDMX/sequencer/) and you always
get the newest one.

## Unreleased

**Sequencer**

- **A new demo, Band on a small rig.** The festival's big stage, but with the gear a small band
  really has: 4 wash heads up front, 4 beam heads at the back, 2 on each side, 10 wide LED columns,
  a row of PARs, strobes, blinders, haze. Fits on two universes. Delete what you don't own and it
  still looks right: every look lights the PARs and the columns as well as the heads, and the heads
  aim by where they stand in their row, not by a number per head.
- **Lights get a face and a depth, not just a width** (Mounting, next to Width). Bars and strips
  (so a fat LED column looks fat in 3D), PARs, fresnels, blinders and strobes (a flat LED PAR, a
  4-lite). The fields show the size it comes in. Moving heads still only scale as a whole.

A long round of testing it the way people use it (on a laptop, an upright tablet and a phone; a DJ,
a church volunteer, a theatre tech, a band). Mostly fixes, a few things that were missing:

- **Tempo effects no longer step back while a song plays.** The beat clock ran a frame ahead of
  the song, and when frames came unevenly (a busy page) it went back and forth: moving heads and
  chases went two steps on, one back, in the 3D and on the wire. It counts from the song's beat now.
- **The 3D stage, fixed in a few places:**
  - pixel bars, rings and matrix heads light the room (the washes, the crowd light, the fog, the
    mirror ball's dots) in their cells' colours: a red chase on a bar used to light it blue;
  - the club's and the bar's own mirror balls and the ballroom's dancers move again (they turned
    on paper and stood still on screen);
  - with nobody on stage (Theatre, Church, Cinema) going to another view no longer builds the
    whole room again and swings the camera to the front;
  - after the 3D had been let go (Live with its stage hidden for a few minutes) and came back, it
    broke on every frame. It sets itself up for the new one now;
  - your own venue model is read once and freed when it's replaced or removed, not once per view;
  - "Show it in 3D" no longer flies the camera off in a view you open minutes later;
  - "Selected" on a light up under a high ceiling (the cinema's house lights) frames it again;
  - hidden views give their picture buffers back to the graphics card, at Low the screens hold
    still, and a view switch no longer waits for the exposure meter.
- **The theatre's names are back on the plan.** Since the curtain and the drops are drawn as
  cloths, a third of its names were gone. A cloth is a line now that other names may sit on, with
  its own name at one end; two names no longer touch by a pixel; a crowded plan tries the smaller
  size when fewer than three quarters of the names fit.
- **Faster where it adds up:** the output thread's frame on the festival demo went from 4.5 to
  2.6 ms, and working out every light's 3D look again (on any change, on every pointer move of a
  drag) from 5 to 1 ms.
- **A reloaded or stuck box window no longer looks connected.** Reload the box's little window
  (F5 in it) and the app sometimes kept saying "connected" while nothing reached the lights: the
  window was waiting to be spoken to. The app notices a quiet window now (it reports every second),
  asks it, and takes it back within a few seconds; one that doesn't answer gets the red bar.
- Lights on one spot of the plan (the bar's four shelves, above each other on its back wall) can be
  picked there now: click again and the next one comes. Before, every click got the top one.
- Check the patch: Home and End go to the first and last light (233 in the big demo), and it says
  that a light clicked on the stage or in the list is the one it checks.
- The festival demo's machines no longer stand inside each other. They were five rows 10-25 cm
  apart along the front of the stage. Now the flames line the front edge, the spark machines stand
  on the floor in front of the stage, CO2 and confetti take turns on the wings beside it, and the
  fog machines sit at its front corners. Two hazers inside the outer beam heads moved too.
- The Bar's two strobes hung 4 cm from the dance floor's washes, one inside the other. They hang
  in the gaps now, and every template is checked for that.
- Demo songs from Jamendo come from our copy first, like ccMixter's: their server lets a browser
  have the file on about every second request, so half the songs started with a failed download.
- **Small things:** a follow waits for a cue's own colour, position and beam times; a light with
  more than a universe per pixel no longer hangs the page; "saving..." can't get stuck when the
  browser's storage is full; a pasted cue is checked like one from a file.
- **More timeline tracks open**: a cue list's track opens into its level over the song (click in
  the row for a point, drag it, double-click to take it away; while the song plays it scales the
  list's fader, the output thread plays it too), and the Moments track into how long each moment
  lasts, as a bar whose end you drag (or the arrow keys on it). Before, a moment's length could only
  be changed by placing it again.
- **"Stop effects" stops them on stage, not just on the screen.** The effects your cues run kept
  going on the wire after the button (the screen said they'd stopped), and tapping one of them
  afterwards flipped the two around. The output now hears it like every other command.
- **The QLC+ export no longer fires a machine again in every scene after it.** In a play, the
  cue cards and the export carried flames, CO2, confetti and haze on into every later cue (playback
  never did). An exported workspace opened those channels again, and QLC+ has no Arm.
- **Moving a cue to another list keeps it whole.** "Move to" in a cue's menu was a cut and a
  paste: the cut took every Live button and timeline moment that played the cue with it, and the
  paste gave it a new id. Now the cue itself moves, what plays it follows, and one Undo takes it back.
- **The console no longer leaves a second 3D stage running** when you switch to another view.
- **Small things that were off:** the arrow keys on the pan/tilt pad lost presses when you tapped
  fast and moved the whole bar instead of the heads you'd picked; on the Live and Timeline plans a
  pinch or a middle-button pan that started on a light did nothing; moving an instant crowd change
  with the arrow keys turned it into a half-second ramp.
- **Live got lighter on a big rig:** the "Confetti at 2:41 · safe" and "Fog on" chips were worked
  out on every frame (20 ms a go on the festival demo, which is time the timeline's cues waited for).
  Now they're worked out when the show changes. A hidden console or programmer also stops following
  the stage frame by frame.
- **Changing what a light's channels do is kept when you press Done.** Before, only the Save button
  under the table kept it, and Done threw it away without a word (swap red and green, Done, and
  they were back). Now leaving the editor saves for all lights of the type, Undo takes it back, and
  "Throw the changes away" is the way to drop it. A channel called just "Red" that you make green is
  called "Green" too.
- **The app opens on the demo show.** A visit starts with the big festival demo playing, and the
  first time a short intro runs over the stage like subtitles (under 20 seconds): what you're
  looking at, and where your lights, your box and the show-night buttons are. "When the app opens"
  (beside it and in Shows) picks the demo, an empty show or the last one; a reload keeps what was
  open, and an untouched demo doesn't pile up in your shows.
- **Curtains and drops on the plan are cloths, not dots.** The 2D stage draws them as wide as they
  are, across the stage: solid while they hang in view (a curtain shut, a drop flown in), faint and
  dashed when they're out of the way; a curtain track's halves part.
- **Sharing an add-on works on a slow computer too.** Its little preview was made under the same
  30 ms a frame limit as the stage, so a busy laptop got "it takes too long to work out" instead of
  the file. The preview is made once, so it isn't timed any more (the step limit still holds).
- **The Theatre's curtain flies out, its scenery hangs at the back.** The house curtain is a fly
  curtain now (a new type: its winch lifts the whole cloth up into the tower, the valance stays), in
  front of the stage; the four painted drops hang upstage behind where the actors play, the first
  one already set behind the closed curtain. With LuxDMX Link connected the machinery held still
  even when no node played its universe: over Art-Net Link only counts the universes its nodes play.
- **A pinspot on the mirror ball stops on the ball** on the 3D stage, instead of shining on
  through it and laying a grey disc on the bar's wall. The Bar's first pinspot hangs between the
  PARs now, not inside a beam light.
- **A template started twice is "Bar" and "Bar 2"**, not two shows both called "Bar" in the Shows
  list. Any new show gets a name no other show here has.
- **A lighter 3D stage**: the camera-like exposure no longer makes the page wait for the graphics
  card to answer a question every few frames (about a sixth of the page's time with the 3D stage
  open), and the stage stopped making the browser lay the page out again every frame. Switching
  views no longer compares the whole show for saving on each tab click.
- **The Theatre's curtain opens, live too.** The templates' curtains and fly bars sit on universe 15,
  which no box plays: a winch nobody's box plays sends nothing to a motor, so the 3D stage moves it
  with the show. A real one on a box still holds until the machines are armed.
- **An opera house's stage**: the theatre's opening is 26 x 14.5 m now, the stage 40 m wide and 23 m
  deep, the cyc 32 x 19 m, two front-of-house bars, the fly tower up to 32 m. The house curtain is
  folded velvet with a valance and gold fringes; the front light is softer and the deck dark, so
  the scenes don't glare white, and the castle lost its zebra stripes.
- **Real fixtures, the first two**: the Stairville LED Matrix Blinder 5x5 and the Showtec Phantom
  Matrix FX are drawn as what they are on the 3D stage and in the library: the size, the 25 cells
  in the manual's order, each cell's own beam, the blinder's warm white, the Phantom's head moving
  on its yoke. A library tile plays the mode that can do the most, so a pixel light shows its pixels.
- **Curves on the timeline**: the Effects track opens into a row per knob (speed, size, spread...);
  drag the line to change the effect's own value, double-click for a curve that changes the knob
  along the bar while the song plays (the output thread plays it too; nothing in the show is
  rewritten as it plays). And the wheel zooms the timeline now, without Ctrl.
- **Round LEDs** on the 3D stage: a matrix's, a ring's and a strip's pixels are little discs now, not
  boxes (as cheap: they're still drawn all at once).
- **LED strips of your own**: the LED maker makes strips too (how many LEDs, how long, the colour
  order each LED wants: GRB for WS2812, RGBW...), and any light can have its own size on the 3D stage
  (setup, Mounting: Width), a strip's length or a bigger PAR. The Bar has 144-LED strips the whole
  width of the back bar behind the bottles on every shelf and one under the counter, and its
  bottles are see-through glass now (and drawn in a dozen batches instead of 416 meshes).
- **A mirror ball on a DMX motor**: a new generic type with one motor channel (stop, either way,
  slow to fast). The ball never hangs dead still, it sways and twists a little on its chain. The
  Bar has one: slow all evening, faster for the disco.
- **Offline, properly.** The app keeps all of itself when it's first opened (before, only what had
  been loaded), and a Wi-Fi without internet no longer holds the start up. Catalog songs played once
  stay for offline; the demos' songs all come down as soon as one is used.
- **Updates by themselves**: looked for at the start, every half hour and on coming back, put in
  at a quiet moment without asking, never mid-show. A short note says when it happened.
- **Settings keep their version.** Everything the app keeps in the browser has a version now, and
  one place brings old settings along (STORAGE.md). Nothing is thrown away: what can't be read is
  put aside.
- **Space pauses a template's show** after Play the show (it opened the shows instead).
- **A scene change on a winch says winch**, not "fires a machine": the Theatre's drops and the
  curtains no longer look like pyro on every card.
- The 3D stage's sliders are twice as wide where the toolbar has the room.
- **A much bigger Theatre** for its big stage: 89 lights (ten front-of-house, gobo profiles on the box
  booms with leaves, water and snowflakes, eight each of cyc floods, booms, specials, spots and washes,
  footlights, ground rows) and a play in nineteen scenes, each with its drop flown in: curtain up, a
  forest, moonlight, a castle at sunrise, a storm, an escape through the city, snow, underwater, a
  battle, the finale (the one confetti shot).
- **A much bigger Cinema**: 67 lights (house lights over the rows, twelve wall washers, the marquee round
  the screen, an eight-light stage wash, spots, sky beams for the premieres, step lights, a starry
  ceiling) and 23 looks: Hollywood searchlights, a countdown, awards night, space opera, an action
  movie, a western, a silent film, deep sea. The curtain opens for the films. Confetti only for the
  winner.
- **A much bigger Bar**: 45 lights (ten PARs, six shelf bars, an LED strip on the counter, heads, beam
  heads, strobes) and an LED sign beside the neon (BAR in neon, HAPPY HOUR typed out, SHOTS on the beat,
  GOAL for the match). Twenty-two moods: rooftop sunset, quiz night, football, Latin night, disco,
  shots, ladies' night, the lock-in. Confetti only for the birthday.
- **A much bigger Wedding**: 67 lights (16 uplights, a pinspot on all 13 tables, eight heads, four
  spots, beam heads, the dance floor's own), an LED sign over the head table (Just married, LOVE in
  neon, Mr & Mrs) and a heart panel on the DJ's table, and 24 looks from the guests arriving to the
  sparkler send-off; the heads draw a heart. Confetti only for the bouquet.
- **A much bigger Band**: 78 lights (beam heads, uplights on the deck, more spots, washes, movers,
  pixel bars, blinders and strobes) and 25 looks full of the new moves and pixel shows. Confetti only
  once, at the very end. The plan's group buttons scroll in one row when a rig has many groups.
- **A real mirror ball** in the bar and the club: it turns on its own motor (it stood still without
  music) and throws its dots round the room when the pinspots hit it, with thin rays in the haze.
- **Stage machinery**: a curtain track and a fly bar with a painted drop (a forest, a castle, a
  starry sky, a city...), on a winch channel with a winch's safety. The theatre (three times the
  size now, with a fly tower) opens its house curtain and flies its drops in and out with its cues;
  the cinema (bigger too) opens its screen curtain for the feature.
- **40 more effects.** For a matrix or a disc, ten with your words (Letter zoom, Typewriter, Wavy
  text, Falling letters, Word flip, Glitch text, Word flash, Sparkle text, Spinning sign, Neon sign)
  and ten pictures (Snake, Double helix, Confetti fall, Snowfall, Lightning storm, Rising hearts,
  Vortex, Beat wipes, Block strobe, Rotozoom). For moving heads, twenty more moves: a square, a
  star, a heart, a spirograph, a searchlight, wipers, a head bang on the beat, heads weaving
  against each other, the beams meeting in one point...
- **Loop this part** on the timeline (right-click a part, or L): it plays over and over while you
  work on its looks.
- **Save with its songs** (Shows): one .luxdmx.zip with the show and its songs' audio (and your own
  3D venue), for another computer. A plain show file only names its songs, which you had to find
  and load again over there, one by one. Opening the zip puts them in place.
- Recording a rainbow (or any colour or move effect that switches its lights on) gave a cue that
  played the lights dark. It plays them lit, as they were.
- Undo of a Record puts the stage back as it was, not just the list; the lock for the service isn't
  an undo step any more (Ctrl+Z after unlocking locked again); a locked page has no rig.
- Groups keep their number when you reorder them, so `group 5` stays the same group.
- A tap on the padlock asks: with a PIN or without. On a touch screen, **+ Add** adds lights and
  groups to the selection.
- An effect button on Live stops the effect even when the cue on stage runs it.
- The timeline shows what lies after a shorter song (and moves it in on a tap), Fit fits, an effect
  dropped on a part of the song runs to the end of that part, parts move to the playhead.
- Live's cue list follows the list GO plays; GO at the end of a list says so.
- The cue sheet says each light's level, and a list prints its own.
- New lights land clear of the ones on stage; names on the plan stay inside it and read as their own
  light's; the plan keeps its lights apart on a narrow screen.
- The top bar fits an upright iPad and counts the interface size (120 % on a laptop).
- The box's window can be reloaded: the app takes it back by itself.
- Big rigs are quick again: a Record with 320 lights and 40 cues took 5 s, adding 200 lights to a
  big rig froze the page for 12 s. Both take moments now.
- The same show in two tabs: the out-of-date one says **changed in another tab** and takes the
  newer version on a tap, instead of quietly saving over it.
- A browser that won't keep the show (storage full or blocked) says **not saved** in red, instead
  of "saving…" for ever.
- By keyboard alone the whole thing works now without the focus getting lost: Space presses a
  Live button you tabbed to, the arrows move a cue on the timeline, Escape cancels a rename, and
  a screen reader hears percentages and headings where it heard 0.7 and buttons that did nothing.
- A box on slow Wi-Fi is said (in orange, with how much gets through) instead of looking fine while
  a chase stood still; a box that keeps dropping out doesn't make the page jump; with two boxes the
  red bar says which universes and which box.
- On the beat: the BPM field takes only real tempos (typing 90 went through 9 BPM), Tap puts the
  beat where you tap, cues that go on after N beats don't drift any more, and the stage, Auto GO
  and the effects on the wire stay on the same beat after the page was busy for a moment.
- In a German browser: the cue sheet CSV opens in German Excel (';', 2,5, umlauts), decimals with a
  comma work everywhere, AltGr+Q gives @ on the console, file names keep their umlauts.
- Colour is never the only sign: On stage and ARMED in words on a phone too, armed chips striped,
  a patch clash marked, picked cue cards dashed, faint text lighter.
- The printed cue sheet and patch: page numbers and the show's name on every page, lights in runs
  (the big demo's cue sheet went from 62 pages to 12), long notes wrap instead of shrinking the page.
- A show night doesn't wear the app down: an hour of playing, switching and editing left memory,
  listeners and the output rate flat, and playing (GO, Live buttons) no longer saves after each press.
- Add fixtures is one dialog with the search box on top, live as you type over the built-in types
  and the 2400+ library fixtures. Every tile plays its light in 3D: spots sweep and run their gobos
  and prisms, washes breathe, PARs run the colours, bars chase. All in one WebGL context, only the
  tiles on the screen, so it stays smooth. The old library popup is gone.
- 3D: the Cinema and Bar templates play in real rooms of their own, not on the concert stage: a
  big cinema (screen, curtains, a premiere stage, raked rows with an audience, step lights, wall
  washers, a starry ceiling) and a bar (a long counter, a back bar of lit bottles, people on the
  stools, bartenders, tables, a dance floor with a mirror ball), every light installed there.
- A new template, **Wedding**, in a ballroom of its own: 14 uplights washing the draped walls,
  pinspots on ten table centrepieces, gobo spots for the first dance, wash heads and PARs over the
  dance floor, the head table, the cake, chandeliers, low fog, cold sparks, bubbles and confetti.
  Cues from the guests arriving to the lights going up, and its show plays to a pop song.
- 3D: the Theatre and Church templates too: a theatre (proscenium with the house curtain, a cyc,
  lighting bars, booms in the wings, footlights, stalls and a full balcony) and a church (the
  chancel with altar, cross and choir, pews with the congregation, stained glass windows).
- The gallery is in the ⋯ menu at the top and in the 3D stage's ⋯ now, not only behind Ctrl+K.
- Live's **Stop effects** stops everything moving, the cue's own effects too (its look stays; the
  next cue brings its effects back). It only stopped the ones started by hand.
- From a wedding DJ's evening (a tester trimming the Wedding template to a small rig): a light
  dragged on the plan moves in 3D too; removing a machine takes its shot list and the cue actions
  that started it; cues tapped onto the timeline in a row go a bar apart; the timeline's Moments
  offer only the machines the rig has; a machine's Live button pressed while safe says "Safe: not
  firing"; a locked page's Blackout says "hold"; Add LuxDMX connects at once; a phone's GO bar
  says what's next; overlapping addresses are said under the light list too.
- Small ones from a tester's round: pressing Edit on Live moves none of the bar's buttons, "open in
  another tab" goes away when that tab is closed, Play the show on a phone opens on the 3D stage,
  the lock PIN is kept as a hash (not readable in the show file), a tab opened from an on-stage
  tab starts blind, the bar's guests stopped sitting with their arms crossed.
- The templates play as shows: each has a song of its own (Band to hard rock, DJ / Party to house,
  the theatre to a pop number, and so on; any other can be picked) and **Play the show** runs its
  looks on that song's parts with the machines on the drops. DJ / Party moved into the club, DJ
  included. Folded demos stay as a row of play buttons now, so the festival show can't get lost.
  Each has its audience on the crowd track too: waiting before the song, cheering as the room
  would (a concert on every chorus, a theatre only at the end, a bar chatting all along).
  The club and house party demos get theirs as well (they had hundreds of people and no sound).
- Undo on a big show is quicker: it changes only what differs instead of swapping in the whole
  show, so the screen redraws just that (the festival: 0.86 s frozen per undo, now about 0.5). An
  edit there redraws only the cue pictures it changed and works out the risk marks in one go
  (0.56 s down to about 0.42; most of what's left is the show being written out to save it).
- 3D: light lands on walls now, not only on the floor: wall washers and uplights paint the walls
  (the church between its windows, the cinema's side walls), a gobo shows on the theatre's cyc or
  the cinema's screen, a head pointed up lights the ceiling.
- A render has the crowd in its sound now, as you hear it when the show plays: the chatting before
  the band comes on, the cheers on the big moments, at the Crowd volume.
- The plans of the church and the cinema cover the whole room now, not just the stage: their lights
  hang all over it. The theatre's covers the stage and the stalls, so its front-of-house bar and
  house lights are out in the house on the plan too, not at the stage's edge.
- 3D: **Your stage** in the Venue panel: your real stage at its size (width, depth, a riser or
  not, how many trusses and how high). The room, crowd and camera moves are built for it, the
  lights hang on its trusses, the plan is that stage.
- 3D: **Measure** next to Aim: two clicks give the distance (across, up or down); one light gives
  its height above the deck or floor and where its beam lands, how far and how wide.
- 3D: **Selected** next to the camera views flies the camera to the selected lights, and **Show it
  in 3D** in a light's right-click menu opens the 3D stage and does the same. The camera finds a
  clear spot (never inside the rows, the tables or the people; checked on every light of every
  template).
- A gallery, **What the 3D stage draws** (Ctrl+K "gallery", or from Add fixtures and the
  welcome): 23 live tiles, uplights on a wall, gobos turning, prisms, heads in a fan, pixel bars, discs, winches,
  flames, sparks, confetti, CO2, fog with a light through it. The README has them as animations,
  made by the app itself (`tools/gallery/capture.mjs`).
- One place to start a show: **New show…** in Shows opens the start dialog (Shows lost its own
  template list); its **Empty stage** is a new show; an empty show has one **Add lights** on the
  stage instead of four buttons in four places.
- The welcome is two rows of tiles: the demo shows (each with its own music menu, and they fold away
  for good once you don't need them), and the everyday starts (empty, the templates, a show file).
  Every demo and template also comes as **Lights only**: the rig placed, nothing programmed.
- Render: the 3D view keeps the video's shape while it renders (a 4K render showed twice as wide),
  and closing or reloading the page during a render asks first. On the dev server, code changes
  wait until the render is done instead of breaking it off.
- Render: "the song from the playhead" takes a length, so a short clip has its sound. The only short
  one used to be "the look as it is", which has no sound and didn't say so.
- Lots of smaller things: cut-off numbers, dialogs that closed on a typo, focus after dialogs, help
  notes off the screen, empty states that now say what to do, one name for saving a show file.
- The QLC+ fixture list had a stray `&#10;` in one name (Chauvet Shocker 90 IRC QRG) and trailing
  spaces in three. Its names are read from QLC+'s XML in one pass now.

**Firmware**

- **A universe changed from the console or on the box takes DMX at once** (issue #160). When
  MagicQ's Network Manager (or any ArtAddress) or the box's own menu moved an output to another
  universe, the page showed the new number but the output kept listening on the old one: nothing
  came out until a Save on the settings page. It follows the new universe straight away now.
- **A pixel port on a WT32-ETH01 stays on after saving** (issue #165). The box refused pins of
  things that were switched off: the WT32 keeps the W5500's default pins although it runs its own
  Ethernet, so a port on GPIO5 went off after every save while the page said "Saved". Only what's
  on counts now, the same rule the settings page uses, and a port the box still turns off is
  named in the save's answer with the reason.
- **Channel labels and the box's name show as text.** The status page's change log and the bar at
  the top of every page put them in as HTML, so a label like `<b>Spot</b>` came out bold, and one
  with a script in it ran in every browser that opened the box. A quote in the name broke
  `/info.json` (and with it every page); the backup's file name and the setup page's link keep only
  the letters, digits and dashes of it now.

## 2026-11-12

**Sequencer**

- Pixel lights cell by cell: single LEDs of a bar, a ring or a matrix in the programmer, in cues,
  presets, groups and effects. The fixture editor can repeat a channel block N times as cells.
- A console mode if you know desks: command line (`1 thru 4 @ 50`, `goto cue 5`), fixed fixture
  numbers, faders, encoders, palettes, cue list faders, MIDI learn.
- Real gobos in the 3D stage, about a hundred patterns incl. glass gobos, plus prisms, animation
  wheels, shake, scroll, iris and focus. The demo shows use them a lot.
- Beam angles come from the fixture files (OFL, GDTF, QLC+) now, not from a guess.
- More than two axes: endless pan and tilt, a roll axis, moving bars whose heads tilt on their own.
- Winches. They only move while the machines are armed, stay where they are when made safe (never
  back to 0, that's the top) and have soft limits per winch.
- Render the 3D stage to a video, frame by frame, up to 4K or 8K, with the song.
- Pan and tilt calibration for any moving head, also when its profile doesn't name the channels.
- Second gobo wheel, prism rotation, animation wheel, built-in effects and colour programs get
  their own controls. Separate fade times for colour, position and beam.
- Show files are format 1.2.0 when they use cells; an older sequencer refuses such a file instead
  of playing it wrong.
- Fixed: a tab that started blind could still send the live show through its output thread.

**Firmware**

- The OTA and AP passwords never show up in `/info.json`. A tickbox clears them, the AP password
  is 8 to 63 characters, and a new OTA password counts right away.
- README: how to keep the box on a network of its own (Art-Net and sACN have no passwords).

## 2026-11-10

- The license is Apache-2.0 now, with a warranty disclaimer in the README.

## 2026-11-03 to 11-09 (v1.0.287 to v1.0.298)

- The sequencer is out: a lighting console in the browser, on GitHub Pages. The box serves a little
  bridge so a browser can send DMX and a phone can play the show through it.
- LED rings and matrices as fixtures, with effects made for them (#159).
- LED wiring per light, trying a light's channels one by one, focus calibration, effects as
  add-ons (#161).
- sACN: the socket opens on the task that reads it; status page fixed on phones.
- ESPAsyncWebServer pinned to upstream's fix for torn WebSocket frame headers.

## October 2026 (v1.0.261 to v1.0.285)

- Up to four WiFi networks, it joins whichever is there (#120).
- Download the whole config as a file and restore it (#108).
- The display switches off after a while (#134).
- Classic ESP32: the web UI no longer runs it out of heap, and works on WiFi again (#135).
- The PSRAM image gets an 8 MB flash header, so it boots on an N8R8.

## August and September 2026 (v1.0.240 to v1.0.258)

- Art-Net: a console can rename the node and set the universes (ArtAddress, #130).
- `/config` never invents settings it could then save (#133).
- The S3 PSRAM image actually enables PSRAM now (#127).
- A wedged W5500 link recovers by itself instead of sitting there unreachable (#115).
- RDM keeps its fixtures when an output gets a new universe (#118).
- A per-output warning when a Continuous output beats a mismatched source (#126).
- Delta output follows content changes, not packet arrivals (#123). Encoder steps apply (#125).
- A board profile for the Radig ESP32-S3 DMX/RDM node (#122).

## July 2026 (v1.0.129 to v1.0.237)

- DMX output driven by RMT: no framing errors under load (#65). esp_dmx is gone (#112).
- RDM over Art-Net, with a bus scheduler that keeps DMX smooth (#71), and an RDM page with
  fixtures and sensor charts (#72). Slow fixtures no longer get lost in discovery (#114).
- DM9051 SPI Ethernet (#69). Our own first-run setup portal instead of WiFiManager (#67).
- Output rate per port, or following the console (#104). The output frame can't be read half
  written any more (#106). Restart only when a setting needs it (#105).
- Restart the box remotely and update it from a URL (#111). OTA: retries a scheduled update
  (#83), checks the version over plain HTTP (#82), never reports a cut-off upload as done (#99).
- ArtIpProg remote IP config, off by default (#116). Pick the universe on the unit itself (#94).
- One status language for the LEDs (#79). Tests that measure the DMX wire and the RDM bus (#113).
- Hardware: v5 with protected DMX512-A outputs (#60), then one board called v6 (#102).

## June 2026 (v1.0.62 to v1.0.126)

- WT32-ETH01 Ethernet (#1), an optional OLED status panel (#5).
- Flash from the browser (#7).
- A pin picker that draws the real header (#12, #54).
- W5500 Ethernet on any board (#22), and picking the wired chip at runtime (#28).
- HTP/LTP merging of two sources, with sACN priority (#23).
- Renamed from LumiGate to LuxDMX (#39).
- What to do on signal loss (#44). Config from a schema, also over serial (#49).
- One-click firmware update with a real progress dialog (#52). Hostname over DHCP (#59).
