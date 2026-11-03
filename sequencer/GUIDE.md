# LuxDMX Sequencer: the guide

A lighting console that runs in the browser and plays on your LuxDMX. Patch your lights, set them,
record cues, throw effects on them, and play the show from big buttons. No install, no account,
nothing leaves your computer except the DMX going to your box.

It's made for people running a small show: a band, a DJ night, a school play, a church, a bar.
Pro fixtures work too (GDTF, the Open Fixture Library, QLC+ fixture files, 16-bit, colour and gobo
wheels), you just don't have to learn a pro console to use them.

## Getting started

1. **Connect your LuxDMX.** Top right, `+`, type the box's address (what you'd type to open its
   web page), then **Connect** and **Allow** in the popup. The popup has to stay open: it's the
   box's own page, and it's what carries the DMX (a browser page can't send Art-Net itself).
   The pill next to the box says how it's going; "no answer" means the address is wrong or the
   box's firmware is too old for the sequencer (update it from its web page).
   **Any other Art-Net or sACN node** (or a LuxDMX without the popup): pick "Art-Net / sACN from
   this computer" under `+`. That needs **LuxDMX Link**, a small helper on this computer (a browser
   can't send Art-Net itself). If it isn't running, **Get Link** on the pill offers the download
   for your system (Windows, macOS, Linux). Open it once: it installs itself just for you (no admin
   rights), starts when you log in, and the app finds it by itself. It's not signed yet, so the
   first time Windows says "unknown app" (More info, Run anyway) and macOS wants a right-click,
   Open (macOS 15 and newer: System Settings, Privacy & Security, Open Anyway); on Linux, make it
   executable first. Then it finds the nodes on the network (ArtPoll) and sends Art-Net, sACN or
   both (the pill's menu). Its own page, http://127.0.0.1:47920, shows what it's doing and has a
   Remove button. The app from the internet (GitHub Pages) in Chrome: the browser asks once
   whether the site may reach devices on your local network. Choose Allow, or Link can't be
   found; the pill then says "blocked by the browser" and the site settings (the icon left of
   the address) let you allow it later. See `link/README.md`.
2. **Add your lights** (Fixtures, Add). Most cheap PARs are one of the generic types: look at the
   channel table in the manual ("CH1 dimmer, CH2 red...") and pick the one that matches. Anything
   else: search the library, open a GDTF / QLC+ / OFL file, or make your own type, even by trying
   the channels on the real fixture with the channel wizard. Effect machines from a file (a flame
   projector, CO2 jet, confetti cannon, spark machine or fogger) are known by their type and their
   own words, so they wait for Arm (fog is fog, never a dimmer) like the built-in ones; in your own
   type pick Confetti, Flame, Sparks or CO2 jet under Machines. A WS2812 or SK6812 pixel strip is one
   light ("Pixel strip, 50 RGB pixels", up to 170 RGB or 128 RGBW: a universe), so a rainbow or a
   chase runs along it.
   Or skip all that: click the show name (top left) and start from a template. The templates
   (Band, DJ / Party, Theatre, Church, Cinema, Bar) are well stocked on purpose: 27 to 48 lights
   each on one universe (PARs, spot and wash heads, pixel bars, strobes, blinders, haze, fog and
   the effect machines that suit the place), groups, 9 to 28 effects (pixel shows among them) and
   11 to 17 looks, so there's something to try at once; delete what you don't own. Types you make or
   import are kept in the browser under **My fixtures**, so the next show has them too. Lights
   added to a show that already has looks can **play along like one that's there** ("In the
   looks: like PAR 3" in the Add dialog, suggested for a light of the same type or kind): they get
   its part in every look, its groups and its effects. Otherwise they stay dark until you set them.
3. **Select lights and set them** in the programmer on the right: intensity, colour (presets or
   the wheel), position for moving heads, and every other channel under "All channels". The
   number next to a slider takes a typed value too (click it: 37 %, a channel at 127). With
   nothing selected it offers your groups (one click selects one) and shows what's playing, each
   with a way to stop it.
4. **Record** a cue. Set the next look, Record again. **GO** (or Space) steps through them with
   a fade. Or let it start you off: an empty cue list offers **starter looks for my rig** (warm
   and cool washes, sunset and ocean gradients across the stage, two-colour splits, a party look
   with a rainbow), made from what your lights can do; one Undo takes them away again.
5. **Effects**: select lights, Effects, Add, pick one. It runs right away; Record puts it into the
   cue. Select some lights and the effects running on them light up green in the list ("on 2
   selected"), so you see what's moving them.
6. **Live** (top bar) is for playing: a page of buttons built from your show. Edit it to make it
   your own. Got a MIDI controller (pads, faders)? In Edit, select a button and press Learn, then
   touch the pad (Chrome and Edge; Firefox and Safari have no Web MIDI).

Press `?` for every keyboard shortcut and `Ctrl+K` to find anything. No lights connected yet?
The app opens with a **welcome** in front of everything (the plan and the 3D stage alike) while
the show has nothing in it: the first steps, the templates, opening a show file, and **Show me a
demo**. It comes up once per show; closed, **Get started** on the empty stage brings it back (and
Ctrl+K "demo"). The big demo is a festival stage with 233 lights on 22 universes, 114 of them
moving heads (washes and beam heads on three trusses, beams standing on the deck, heads on the
truss towers and in the pit, spots on the side trusses, washes at the deck's front edge; plus a
wall of pixel strips, a pixel line along the deck edge, LED bars, blinders, strobes, confetti,
flames, sparks, CO2, bubbles, haze) on the 3D stage, playing a real song: by default a hard rock
song ("Ready To Go" by Endtape, CC BY-SA), and you can pick any song from the list under
**Music** (or the demo beat, ten minutes made in the app with nothing to download). Two lists
play it: **Show** (the looks: a new one every four bars where the music is busy) and **Moves**
(where the heads point, above the looks: pairs of shapes taking turns on the beat, every two beats
in a chorus, every bar in a verse). The demo song's hardest hits were measured beat by beat (the
band slamming in, its two dead stops, the dips before the choruses, the drums dropping out): on a
slam the look changes at once, the heads snap and flash on every beat of the first bar, CO2 and
the blinders go off; on a stop it goes dark but for a few spots on the band, then the heads flash
in eighths into the slam. Other songs get the same from their parts (a slam where a chorus
starts, a drum fill at the end of a build-up). Flames on every chorus, confetti on the first and
the last, sparks through the solo, a blackout as the song ends. Before the song there's half a
minute of show: the house lights on and people chatting, then dark and a cheer, searchlights
sweeping the crowd, the backdrop coming up slowly as the cheering grows, strobes and the blinders
as the band walks on, the band in its spots for a breath, then the first chord. After it the
blinders hit the crowd and the house lights come up. The crowd (real recordings, see the
Timeline's crowd) cheers only at the beginning: louder as the show gets going, loudest on the
first chord, then it dies away under the song; after it people talk as the lights come up. The
song comes down first (a few MB; the progress is on the button);
when it can't, the demo plays on the demo beat and says so. Every pixel show plays in it, and the
Formula and Picture effects too. Full screen on the 3D stage for a presentation.

Three more demos come with their own room on the 3D stage:
- **DJ in a club**: a DJ at the decks on a 12 m stage (nodding along, a hand on the mixer, the
  other one up when the track drops), 20 moving heads (spots and washes on the trusses and on the
  deck), LEDs all round the stage (a wall of pixel strips behind the booth, strips up the truss
  towers and along the front truss, a pixel line along the deck edge, LED bars), fog machines
  behind the booth blowing past the DJ, CO2, sparks and confetti, a crowd of a couple of hundred.
  Cued to a techno track ("In Peace" by phasenwandler feat. Snowflake): the drops get CO2, a
  strobe hit and the blinders, the breaks get fog.
- **House party**: no stage. A square of truss over the crowd on four legs, moving heads all
  round it, pixel strips facing down into the crowd, LED bars up the legs, a speaker stack in
  each corner, the DJ's table on the floor at one end. A smaller crowd that dances like the big
  one (no flags). Cued to a house track ("On My Way" by Tomas PhUsIoN feat. Donnie Ozone).
- **Test truss**: an empty room with one truss holding two of every kind of light (spots,
  washes, PARs, strobes, blinders, fresnels, LED bars, pixel strips) and two of every machine on
  the floor in front. Its list has a cue for each thing to check ("Spots: pan and tilt",
  "Washes: colour", "Confetti: one shot"...), a chase goes round them all, Live has a button per
  machine, and a little show on the demo beat walks through it all. The machines stay safe as in
  any show: Blind by default, and pyro only fires once you hold Arm.

## Things that help at a gig

- **Safe by default.** What you do only goes out to the lights when the top bar says **On stage**
  (red); in **Blind** you see it on the stage here (and on the Live page and a phone remote it says
  so), and the lights keep the look they had, without fog, haze and the machines. **Blackout**
  always reaches the stage. A new tab starts blind; a reload keeps what it was, and so does a
  tablet switched off and on in the middle of a show (it carries on where it was), or a show locked
  for the service. Going on stage asks once, going blind is one click.
- **The machines wait for a person.** Confetti, flames, sparks and CO2 send nothing until someone
  **holds Arm** for a moment, and only while on stage (a red ARMED shows while they can fire, Safe
  while they can't; one click makes them safe again; going blind, another show, a reload or a fresh
  start make them safe too, and another show or a reload says so). One that was already on when they were armed waits until it has been off: arming never
  fires anything by itself. An armed one stops on its own after 5 s (sparks 30 s) until it's let go
  of and pressed again, so a cue left on a flame can't keep it burning. Nothing gets round this: not
  a light patched over a machine's address, not a number typed in "All channels", not the channel
  wizard. A machine's own Safety / Enable channel (MagicFX and the like) follows Arm: its "LIVE" or
  "enabled" value while armed, 0 while safe, so Arm opens both locks and one click shuts both. The
  2D and 3D stage still show what they'd do. Fixture rows say what each machine is: fog,
  haze or bubbles (repeatable, fog can set off smoke detectors), fires once (confetti, "· safe" or
  "· armed"), dangerous (flames, sparks, CO2). Cues, live buttons, phone buttons and timeline
  items that fire one carry a mark (⚠, or 1× for confetti).
- **Nothing fires by itself.** Jumping about or scrubbing the timeline, Next part and Next song never fire a moment (on
  stage the real lights and heads do follow a drag of the playhead; the first drag says so, and
  Blind is the way to look around without them); Play
  right after a jump starts just after where it landed (from the very start, what's on 0:00
  happens); a list the timeline jumped onto keeps its machines quiet through its own follow-ons
  until GO. A list the timetable plays never fires machines (nobody may be there). GO and Auto GO
  never step through the machine shots. An effect that can't run (a formula, a picture) is left
  out and named; anything else that goes wrong in a frame keeps the look that went out, with fog
  and the machines off.
- **The DMX output comes first.** The output runs on a thread of its own: it works out every frame
  and sends it, 40 a second, whatever the page is drawing or doing (the page keeps a copy of the
  engine for the screen, and tells the thread every GO, jump and change the moment it happens). To
  LuxDMX Link it sends through a connection of its own; to a LuxDMX box through a channel straight
  to the box's bridge page (firmware from 28.10.2026 on; an older box's page gets its frames from
  the page as before). A page that closes stops the thread first and sends its safe look last
  (fog and machines off), so nothing from the thread can come after it. In a browser without
  workers the page sends itself, the frame going out before anything is drawn. With the thread the
  page being slow can't make the output late, so the 3D stage keeps the quality you chose, and while
  the page is busy only the panels and the plan give way (updated every second or third frame, the
  plan without its blur and moving bits);
  the 3D stage reads every frame's values itself, so moving heads move as smoothly as it draws.
  Without the thread, when drawing would slow the page (a slow laptop, a busy machine), the stage
  pictures give way at once: they update every other frame, then draw simpler (the 3D stage with
  fewer frames a second and no glow, never fewer pixels than the screen has; the plan without its
  blur and moving bits), and come back up after a few calm seconds. The chip in the stage's header shows how hard the page
  works (a dot: green on time, orange a few late frames, red late; ▾ while the drawing has given
  way); open, it shows the output's frames a second and its longest gap, the graphics card's time
  per 3D frame (where the browser says), and the **drawing quality** slider (Low, Medium, High:
  the most it may draw; High until you pick another, kept in this browser).
- **Follow the music** (the ♪ in the top bar): the microphone listens for the kick drum and sets
  the tempo, and tempo effects land on the beat. Nothing is recorded or sent anywhere. Works best
  with music that has a clear beat; the BPM field keeps your own tempo for when it's off.
- **Sound effects**: "Sound pulse" makes lights pulse with the bass, "VU meter" fills a pixel bar
  (or a row of PARs) with the loudness. Both listen through ♪ (without it they just sit at full).
  The DJ / Party template has both, and a "Bass" look that uses them.
- **Big moments**: the generated live page has a **Blinder** (every light full white while held)
  and a **Drop** (white, strobes going and a fog burst of at most 10 s while held; no strobes in
  the rig: every light strobes). Put either on a MIDI pad. A group flash can be white too (its
  button settings). A light without a strobe channel (a pixel strip, a cheap PAR) still strobes
  for "strobe while held" and Drop: its level blinks. Flashes, Blinder and Drop let
  go by themselves after 30 s, held or not (so does any flash button), so a pad stuck under a laptop
  lid can't keep them on.
- **Effect machines on the live page**: a cue list that only fires machines (confetti, CO2,
  sparks, flames, bubbles) is a button under "Effect machines" on the generated page. A tap
  fires it, a tap while it runs stops it. The templates and the demo have one such list per
  machine: one cue that runs the machines for a moment (a confetti shot, 1.5 s of CO2, 3 s of
  sparks, a short 0.4 s shot of flame, 20 s of bubbles) and then the list lets go by itself, so nothing is left
  running. Change the cue's wait to make a shot longer or shorter. A look can fire them too (a cue
  action "start Confetti", like the templates' finales). Flames, sparks, CO2 and confetti only
  reach the real machines once they're armed; until then the stage shows them and the wire stays at 0.
- **A play** (the Theatre template, or "Run as a play" in a list's settings): a GO from any button,
  key, pad or phone is protected against a nervous double press (a second one within 0.3 s on the
  same list is ignored), "back to cue 9" shows cue 9 exactly as it plays from the top, and a
  GO during a fade never leaves a light stuck halfway. Record while a list is playing puts the new
  cue right after the one on stage (a cue between 20 and 21 at the tech), and GO carries on with
  what was next. A cue can play a cue of another list ("play cue House full of House lights"), so
  the house comes up at the interval whatever it was on (Back doesn't run actions). For a play (cues
  with standby notes or follow-ons, or the list says so) the generated live page shows the whole cue list the way a play is run: number,
  name, fade, what follows and the standby note, the cue on stage lit and kept in view, the next one
  marked; holding a row jumps there (a tap doesn't). No number keys, no Blinder, Drop or Tempo; the
  house lights get GO and Back. Any page can have one (Edit, Add, "A whole cue list").
- **Cue numbers like the script's**: a cue recorded or pasted between 20 and 21 is 20.5, and the
  numbers stay with their cues from then on (on the cards, the GO bar, the cue sheet, the phone).
  Type a number into a cue's settings to set it; the list's menu has "Renumber the cues 1, 2, 3…".
- **Fog and haze** run only in the cue that sets them (haze one cue started doesn't drift on into the
  next ones). For haze all night, put it in a list of its own: across lists fog and haze go by the
  highest, like intensity, so the moods' "no fog" doesn't stop it (and that list's fader turns
  the haze down). Off on a fog or haze machine stops its fog too; a cue recorded while haze runs from
  an earlier cue doesn't take the haze with it; and Live shows "Fog on · Stop" while a cue keeps a
  machine running (it stops until the next cue).
- **Looks and plays.** In a list of looks (moods, a bar's or a church's buttons: picked by hand)
  a look sets the lights it names and leaves the rest as they are: "Hall" lights the hall, the
  church stays as it was (an effect on the church's lights keeps going too), and its card shows
  the hall lit and the church as outlines ("not in this look", where a dark light means "off").
  Fog and haze still stop with the next look. In a play ("Run as a play"; a list with standby notes or follow-ons when it was opened) a
  cue is what the list adds up to at that point, so Back or a jump to cue 9 shows cue 9 whatever
  came before. So does a chase or sequence that steps by itself, so going round comes back to step
  1's look.
- **A timetable** (the More menu, Timetable; Ctrl+K "schedule"; on a phone Live's ⋯): looks by the
  clock, the opening look at 17:00, the evening one at 21:00, everything off at closing, DJ night
  on Fridays and Saturdays (tap a day to pick just that one). It runs while the page is open (keep
  the tablet or laptop on, the tab open), and the Live header says what comes next ("Choir practice
  · tomorrow at 19:00"). It plays what came since it last looked: a tablet that slept through 21:00
  catches up when it wakes (at once, no fade from black), a look played by hand stays until the
  next time comes, and changing a time never switches anything by itself. "Everything off" fades
  the lists out; a blackout entry stays on until a "blackout off" (and any look tapped or played
  by the clock ends a blackout anyway). A new time takes the days of the one above it (another
  Sunday row for the church, not a daily one); right-click or hold a row to duplicate it or make
  it every day again, Del removes the row you're in. A time can go by the sun too: "sunset, 30
  min after" moves with the seasons (a shop window or the church's floodlights at dusk all year).
  It's worked out in the app for the show's place: guessed from the time zone until you tap "Use
  this device's location" or type it in. A party tonight in the room the window show lights?
  Right-click the next-up chip (or Pause in the timetable): skip tonight (until 06:00), pause for
  3 hours, or switch the timetable off; what comes meanwhile is skipped, not played late.
- **For staff**: a page with just the looks in one go (right-click the + next to the pages, Ctrl+K
  "staff", or on a touch screen the ⋯ next to the padlock). It has no GO, no Next and no Auto GO:
  what's on, big, and Blackout. Lock it with the padlock (right-click it, or the ⋯ on a touch
  screen: Lock with a PIN; the digits show while you set it, so a typo can't lock you out). Locked, only that page shows (also after a restart), the master
  slider, Release, Fade out, Release all, tempo and list levels are out of reach (shown greyed,
  on phones too), the staff page of looks has no GO to step into "All off", Blackout takes holding a
  moment (off is a tap; held Space or Enter works too), and the phone dialog only shows how many
  phones are on. Holding the padlock asks for the PIN (a wrong one asks again). Forgot it? Open the app's address with
  `#unlock` on the end and confirm: the show unlocks and the PIN is gone. A locked show sent to
  another device opens unlocked there.
- **When the lights stop getting anything** (the box's Wi-Fi drops, someone closes the box's little
  window) a red bar says so at the top, with Reconnect when a tap can fix it; after a restart, the
  same bar asks for the one tap that connects the box again while the show is locked or picked
  up. A tablet switched off and on again (within 3 hours, and only if no other tab is playing the
  show) puts back what was playing, at once, so the box gets the same look it has been holding and
  nothing dips. With nothing to put back
  it sends nothing until something plays. A reload keeps a waiting cue's countdown where it was.
  Left alone for weeks (a shop or Halloween window): a browser restart needs that one tap before
  the timetable reaches the box again (browsers only open the box's window from a tap). Until
  then the box holds the last look it had (its signal-loss setting, "hold" by default), so the
  window stays lit; closing the page sends the fog machines to 0 first, so a fog burst can't get
  stuck on. A power cut can't do that: keep fog off unattended shows, or set that output to
  blackout on signal loss in the box's settings.
- **Fade out** (on the generated live page, next to the masters): the end of a song, everything to
  black over 5 seconds; press again and it comes back, and so does the next look you play. Moving
  the grand master by hand takes over.
  Any button can do it (Edit, a "Blackout, tap…" button, Does: Fade out, and its time).
- **A phone as a remote** (Live, **Phone**; or the ⋯ menu): switch it on and scan the code with a
  phone. It gets the live page's buttons, faders, GO and Blackout, playing the show on this
  computer, so you can walk into the room with it. The page comes from your LuxDMX (no app on the
  phone, works without internet; the phone has to be on the box's network). It can only play, not
  edit. The Blinder, Drop and fog buttons sit right above GO on the phone, Blackout takes holding
  it a moment, and the phone keeps its screen on while it plays. The laptop says when a phone
  joins, lists them, and can take one off (a guest who scanned the code). A phone that locks or
  loses the Wi-Fi lets go of whatever it held within a second and a half, and says which link is
  down. For a phone that comes back every week (the pastor's), tick "Keep it on with this code":
  the remote is on again after a restart, same code, so the bookmark on the phone keeps working.
  While the show is locked, phones get only the locked page, and its masters are greyed there too.
- **A set list**: one cue list per song. In Live, a cue list button set to "Make GO play it" (or
  the list menu on the GO bar) picks the song Space plays. Give a list a tempo (list settings,
  Tempo) and picking the song sets the show to it, so the chases are right from the first beat.
- **Auto GO** (Live, next to GO): steps through the list on its own every 1 to 32 bars, on the
  beat, and starts over at the end. With "follow the music" on, the looks change with the song's phrases. A party on autopilot.
  A GO by hand in between doesn't get stepped over half a second later: the next automatic one
  waits for the bar after.
- **Highlight** (the sun in the programmer): the selected lights go full white so you can see which
  one is which in the room. Not recorded.
- **Fog** buttons only fog while held, and switch off after their maximum even if you keep holding.
  A **fog timer** (Live, Edit, Add; or right-click the fog machine) fogs a few seconds every few
  minutes, with its own button. A burst is at most 60 s, the pause at least 15 s and as long as
  the burst, and a new timer waits for you to switch it on.
- **Blackout** puts a pink frame round the whole screen while it's on, so it's never missed. In
  Live it's the button on the GO bar (and B on the keyboard).
- **Lock it for the service** (the padlock on a live page): only playing is left, no Program, no
  editing, no tempo, no page menu. Unlocking takes holding the padlock for a second, so a stray tap
  can't do it. Changes made in Program that weren't recorded show as a banner on Live, with Clear.
- **The live page** works with a touch screen, the keyboard (letters on the buttons, Space for GO, B for blackout)
  and MIDI pads and faders. The GO bar shows what's on, what's next, and the next cue's note (a
  theatre standby: "when the lamp goes off"). While it's open the screen doesn't dim or lock (tablets and laptops
  that allow it), and phones give a little tick under the finger. A page you made your own keeps
  your layout, keys and MIDI; a new look goes on it next to the others, and a list, an effect or a
  group made later shows as "2 new in the show" at the top: one tap puts them on the page (Undo
  takes them off). In Edit a finger moves a control by its grip, the keyboard with Alt+arrows.
- **Background tabs** don't slow the output down (the clock runs in a Worker).
- **No internet at the venue?** Open the app once at home: it keeps itself and works offline after
  that (shows live in the browser anyway). Chrome and Edge can also install it as an app (the
  install icon in the address bar), so it opens in its own window without browser bars.
- **Colours from a picture**: the picture button in Presets, Colours (or drop an image on the
  panel) turns the main colours of a poster, an album cover or a photo of the room into colour
  presets, and with lights selected offers a slow colour fade through them. Ctrl+K finds it too ("poster", "photo").
- **White lights** (warm white + cool white LEDs) take the white colour presets as a colour
  temperature: "Warm white" makes them warm. A real colour they can't make leaves them white, and
  the stage draws what they really show; the programmer says which lights can't do colour.
- **Fan and colour spread** (programmer): one slider fans moving heads out; Rainbow or a two-colour
  gradient spreads colours along the selection.
- **Effects in stage order**: an effect normally runs along the group's order; "Order" in the
  effect editor makes it run left to right on the stage, back to front, or from the centre out,
  however the lights were patched.
- **Effects that run on their own**: an effect started on Live or by the timeline isn't part of a
  cue list, so releasing a list leaves it running (on a pixel bar it lights the cells even when the
  bar's own intensity is 0). A Release says which ones keep running, with a button to stop them, and
  the programmer's "out" reading shows what a selected light really gives (a pixel bar: its
  brightest cell).
- **Pixel shows** (Effects, Add, Pixels): the classics from LED strip firmware like WLED, colour
  and brightness together, on a pixel strip, a few bars or a plain row of PARs. Theater chase,
  Flames (rising from the start of each light), Twinkles, Juggle, Sinelon, Colour waves (Pride),
  Bouncing balls, Ripples, Fireworks (a rocket up, then a burst), Matrix rain, Aurora, Plasma,
  Rainbow with glitter, Heartbeat, Dual scanner, Meteor rain, Lightning along the strip, Rain drips,
  Popcorn and Gradient chase. Each brings colours that suit it (any palette works; Aurora, Heat,
  Lava, Matrix, Candy and Neon are new), and Size is its one extra knob (the blurb says what it
  does: how many balls, how high the flames...). On a wall of strips the ones that rise or fall
  run up every strip on its own; "Back" in Direction turns them round when your strips hang the
  other way up.
- **Your own effects** (Effects, Add, under Pixels):
  - **Formula**: one line that says how bright, or which colour, each pixel is, like
    `hsv(x - c, 1, 1)` (a rainbow rolling along). `x` is where the pixel is (0 to 1), `t` the
    seconds, `c` where the effect is in its round (Speed sets that), `beat`, `bass`, `rnd` and a
    few more; `wave()`, `noise()`, `hsv()`, `rgb()`, `pal()` (your palette) and friends. A number
    is a brightness in the palette's colour. Start from an example (Rainbow wave, Comet, Sparkle,
    Breathing, Police, Fire, Plasma...); "What can I write?" under the field lists it all. A typo
    is shown right under the field, where it is, and the lights keep the last formula that
    worked. A formula can only light pixels: it's read by the app itself, never run as code, so a
    show from someone else is safe to open.
  - **Picture**: load a PNG, JPG, WebP or an animated GIF. On a strip or a row of PARs the picture
    scrolls through the lights, one row of it at a time (a pass per round), and a GIF plays its
    frames at its own pace (Speed stretches or squeezes it). On several pixel bars it shows as a
    wall, one row of the picture per bar. "On the lights" picks line or wall yourself. Pictures
    are scaled down to at most 160 × 120 and 64 frames and kept in the show (so it travels with
    the file); the editor says how big.
- **Setting up at the venue**: **Check the patch** (under the fixture list) lights one fixture at
  a time at full white, the others dark, with its name, address and DIP switches on screen. Arrows
  step, Auto walks the rig by itself; if a different light comes on, fix the address right there
  (type it, or click the switches the way they're set on the fixture).
- **The rig with RDM** (**Rig** next to the boxes at the top, or Ctrl+K "rdm"): lights that speak
  RDM say who they are, where they listen and how they're doing. **Scan the rig** asks every
  connected box (each LuxDMX box with its own RDM controller, through its bridge page; any Art-Net
  node with RDM through LuxDMX Link 1.3.0 or later, which is then the RDM controller) and lists
  every light it finds: maker, model, its own label and id, its address and mode, its sensors (a
  head's temperature, with a little line of how it went) and any status message it reports. A
  strip per universe shows the show's patch above the real rig below, so a light in the wrong place
  or two lights sharing channels stand out. For each light that's off there's a fix either way:
  **set the light** to the patch's address or mode over RDM, or **move the patch** to where the light
  is; **Make the rig match the show** does every fix towards the lights in one go (with the list of
  what changes). Lights the show doesn't know are patched where they are with **Patch the new
  lights**: with their own profile when the fixture library knows them (by their RDM maker and
  model ids, else by their names), else a plain one with their number of channels. **Identify**
  makes the real light flash and selects its fixture (in the list, the plan and the 3D stage);
  **Name it** writes the fixture's name into the light. A fixture patched from the rig, or told to
  **Remember it**, knows its light (its RDM id is kept in the show) and is followed wherever its
  address goes. **Watch the rig** reads the boxes every few seconds while the show runs: a light that
  stops answering, a status message or a head running hot show up in the log and as a count on the
  Rig button. sACN carries no RDM of its own: lights on an sACN node are reached through the node's
  own RDM (a LuxDMX box does it itself) or over Art-Net. Through a LuxDMX box, setting a light's
  mode or label needs a firmware that has them (an older one says so); through Link it all works.
- **"Why is that PAR dark?"**: the menu (⋯) has **DMX output**, every channel of a universe as it
  leaves, live. Hover a channel to see whose it is and what it does, click to select that fixture.
  Blue marks where a fixture starts, red a channel two fixtures share.
- **Reloaded by accident?** No "leave this page?" question first: a reload picks up where the show was: the same cues, effects, masters
  and blackout (not flashes someone was holding), the page you were on, the song GO plays, Auto GO
  and ♪, and the box popups reconnect by themselves, no click. A phone remote carries on too. Only
  a reload of that tab within a minute; a copy of the tab starts dark, and opening the app fresh
  puts back what was playing only within 3 hours (see "When the lights stop getting anything").
- **Undo says what it undid** ("Undone: light “Par 3” removed"), and the last steps survive a
  reload of the tab.
- **Timeline** (top, next to Program and Live): a song and what happens on it. Load an mp3/wav/ogg
  (it stays in this browser, the show file only names it) or pick one under **Demo songs…**: real
  songs with vocals (24: rock'n'roll, techno, house, pop, hip-hop, rock/punk, metal, hard rock,
  alternative, drum & bass and funk; credits and licences in [SONGS.md](SONGS.md)), free to use under their Creative Commons licences, listed by genre with their
  tempo, length and credit, or the demo beat (ten minutes at 126 BPM, made in the app). Listen
  plays 15 seconds of one first. Picking a song downloads it (with a progress bar; if its own site
  is down or blocked it tries our copy, and says so in plain words when neither works) and keeps
  it in this browser like a loaded file. It brings its tempo, its first downbeat and its parts
  (intro, verse, chorus, drop...): they show as a strip on the ruler, a click on one goes there,
  and cues snap to them. A song file of your own gets the same, found from its sound when it's
  loaded (a second or so, in the background): its tempo, its first downbeat and its parts (intro,
  verse, chorus, break, outro, named by how loud they are), with a note saying what was found
  ("128 BPM, first beat at 0:00.4, 9 parts found: check them on the ruler"). The last song's tempo
  and parts never stay on a new file. When it isn't sure (no steady beat, a band playing without a
  click, maybe twice as fast) it says so and leaves the parts to you; Undo takes off what was found.
  On the demo songs it gets the tempo of 37 of 39 (200 BPM punk comes out at half, and says it's
  unsure), the first downbeat of most and about two thirds of the parts to within a bar. **P** (or
  **Part** in the transport, or a right-click on the ruler) starts a part at the bar line nearest
  the playhead, named after the one before it ("Chorus 2"); double-click a part on the ruler to
  rename it, right-click it to remove it. The song's credit (title, artist, licence) shows under the tracks while
  it's the song, and stays with the show; another browser offers to download it again. A song
  still coming down when another show is opened stays off that show (it says so). While the song
  plays, the effects and Auto GO run at its tempo and on its beats, counted from its first
  downbeat (following the microphone still wins). Coming up to a machine moment that won't fire
  because the machines are safe, the Live page says so ("Confetti at 2:41 · safe").
  Drag a cue, an effect or a moment (confetti, flames, sparks, CO2, bubbles,
  fog, a strobe or blinder hit, blackout) onto the tracks, or tap it to put it at the playhead.
  What's placed drags along the beat grid and onto the song's parts (Alt: free), an effect bar's
  end makes it longer, right-click or Del removes. Play runs the show on the song's clock, in Live and on the 3D stage
  too (Live has a play/pause chip with the time at the top). Going through the song is safe: grab
  the green playhead anywhere along its height (or drag on the ruler, click a part, Home, End, the
  arrows) and the stage shows the looks at that point (cues, effects, blackout) while nothing fires.
  Moments only fire while playing forward, and only with the machines armed (the chip in the
  transport says which); flames, CO2 and sparks carry a hazard mark on the tracks, confetti a 1×.
  Let go while it was playing and it plays on from there. Space plays and pauses; the volume stays with this browser. A reload
  carries on from where the song would be by now (silently until you touch the page, if the
  browser wants a click before it plays sound).
- **Before and after the song** (Timeline, under the song: **Before the song** and **After it**, in
  seconds, up to ten minutes each, none by default): time for the show around the song, an intro
  and a walk-on before it, the cheer and the house lights after it. On the ruler they sit left and
  right of the song, hatched and named, and the song's parts and beat grid stay over the song.
  Cues, effects, moments and the crowd go there like anywhere else (times before the song count
  down: -0:12.0). Play from the start (and **Home**) begins at the very start and the song comes in
  at its own 0:00; **End** goes to the end of the time after it, where the show stops. Next part
  from the intro goes to the song's first part. Making the time shorter never cuts off what's
  placed there (it says so). Things placed outside the song snap to half seconds.
- **The crowd** (Timeline, **Crowd** in the list on the left, its own track): the sound of a real
  crowd, from recordings (a hall full of people talking, a crowd cheering, a cheer that swells up
  and dies away; about 1.5 MB, credits in SONGS.md; without them, sounds made in the browser stand
  in). No applause and no clapping: they sounded ugly, so they're gone (an older show's Clapping
  plays as quiet cheering). **Chatter** (people talking while they wait), **Cheering**, **Roar**
  and **Quiet** change how the crowd sounds from there on, over the length of their bar (drag its end); **Cheer!** swells up and dies
  away over its bar. Right-click one for how loud it is. It plays with the song, in Live and with
  the 3D stage closed too, and it's in a video of the 3D stage. **Crowd** next to the song's
  volume switches it off, the slider next to it sets how loud it is against the song (both kept
  in this browser). The sounds come down once when a song with a crowd is first played (then
  they're kept for offline); playing them costs next to nothing. On the 3D stage the band (and the
  DJ) only play while there's music: the song playing on the timeline, or ♪ hearing a beat. Before
  the song, after it and with nothing playing they stand still where the last bar began.
- **A gig in one show** (Timeline, **Set list**): every song of the night in one show, in order,
  each with its own file or demo song, tempo, parts and cues. The lights, cues, effects and live
  pages are shared, so a patch fix is made once. **Add a song** puts a new one at the end; a click
  on a song shows it; double-click renames it, right-click (or ⋯) moves it earlier or later or
  removes it (Alt+↑/↓ move the focused one). **Count-in**: none (the drummer counts) or a bar of
  clicks from this device. **Between songs**: a look a song that ends by itself goes to (else its
  last look stays). On Live the generated page starts with the band's buttons: **Play** (and
  Pause; it says the song and where it is), **Next song** (it names the one after) and **Next
  part**, with the keys `,` `.` and `-`, and MIDI Learn like any button (a foot pedal); Edit, Add,
  "Songs" puts them on a page of your own. Next song is not another show: the song is stopped at
  its start and its first look comes up, while haze, the other lists, Blind or On stage and Arm
  stay as they are and nothing goes dark (a nervous double tap skips one song, not two). Play
  from the start begins a beat before the song's first downbeat, so pressed on the drummer's
  "four" the song's "one" comes with the band's (with a count-in the clicks come first and the
  song comes in on its first downbeat). **Next part** waits for the next beat and jumps to the
  next part of the song (a chorus left out, a solo cut short; pause to hold a longer solo, then
  Next part): it's a jump, so a moment in between never fires and a cue it lands on keeps its
  machines quiet. A song without parts uses its cues as parts. **Sound here** (Live's header, the
  ⋯ menu on a phone, the note next to the volume on the Timeline): off when the band plays live,
  so nothing comes out of this device while the song's clock runs on and the lights follow it (a
  video of the 3D stage still gets the song). Kept in this browser. A phone remote gets the
  three buttons too.
- **The stage in 3D** (2D / 3D above the stage): a hall with the stage and the band ("We Are Not
  The Band"), truss, PA, LED walls, backline and gear, the crew at work (monitors at the side of
  the stage, sound and lights at FOH, a camera, two follow spots), an audience of a few hundred
  people, and your lights as they are right now: beams in the haze, pools on the
  deck, moving heads turning, confetti, bubbles, flames, sparks and CO2 from the effect machines
  (confetti lies where it lands for half a minute and fades away, the newest burst taking the place
  of the oldest pieces when there's too much; sparks are hard white-hot points brighter than white that light up a warm glow round their fountain, flames a tight see-through column; fog spreads over the stage and is gone about half a minute after
  the machine stops).
  Drag to look round (camera views: Front, FOH, Side, Top, from the stage; full screen for a
  presentation; a reload keeps the camera where it was). **Camera moves**: the camera films the
  show by itself, picked from the little arrow next to Tour (the button starts and stops the one
  picked). **Tour** goes slowly round the room. **Broadcast** is a live TV director: hard cuts on
  the bar lines, mostly between views of the whole stage from out front (from the back of the
  room, front left, front right, high up, over the crowd) and a crane, now and then a close-up from
  the pit or a handheld at the side of the stage, each shot held 2 to 8 bars (shorter when it's
  loud), the wide shot on a drop. **Crane** sweeps over the crowd up to the stage and back, rising
  in between. **Steadicam** walks along the front of the stage and round the band (or the DJ),
  swaying a little with each step. **Drone** flies big arcs high up, dives in towards the stage on
  a drop and pulls back out when it's quiet. **Band cam** cuts between close-ups on the beat: hands
  on the guitars, the drummer, the singer at the mic, the keys; in the club and at the party the
  DJ's hands, the DJ and the crowd; on the test truss the lights, one kind after another. They
  follow the music (the beat, how hard your lights hit, the song's parts when the timeline plays),
  stay inside the room and out of the truss, the deck and the people, and a recording gets exactly
  what you see. Dragging the stage (or the wheel) stops a move, a click on a light doesn't; the
  move running is kept in this tab with the camera. The camera
  exposes like a real one: looking into the lights from the stage it turns down, a dark look it
  lifts a little. A click selects a light (an orange frame round each selected one), the same
  selection as the plan. **Move** and **Turn** put it where it really hangs (let go near a truss and it hangs on it,
  near the deck and it stands on it); Hang, On the deck and In front mount the whole selection.
  **Aim**: click a spot and the selected moving heads point there (it works out pan and tilt from
  how each one hangs and its pan/tilt range; Record keeps it). **Calibrate** (one head selected):
  point the real head at a spot on the stage with the pan/tilt pad, click that spot in 3D, and its
  pan and tilt offsets are set so the 3D stage and Aim agree with the room. A head that points
  the wrong way round: invert pan or tilt in its patch's **Mounting** tab (the offsets, swap and
  its pan/tilt range are there too, with a guided "point it at a mark").
  Several lights at once: the gizmo moves them all, or turns each in its place by the same amount;
  the panel at the bottom sets X, height, Z, turn, tip and roll for the whole selection ("mixed"
  means they differ; − and + move each one a step; a tap on its name folds it away, and it stays
  folded in this browser), Spread puts them evenly between the outer two,
  and Aim turns fixed lights (PARs, blinders, strobes) to face the spot too. A light clicked here
  is selected in the fixture list too (it scrolls to it). Moving heads turn at a real head's speed
  (about two seconds for a full pan, speeding up and braking), so a fast effect looks like a real
  head chasing it, with smaller swings when it's too fast to follow; what goes out to the lights is
  the same either way. Switching between Program, Timeline and Live keeps the 3D stage as it is
  (it's only built again after 2D, or 3 minutes away from it). The **Haze** slider is
  how much haze is in the air (it acts at once, over its whole range); while the fog machines run
  the room fills up as the fog spreads (the beams show more everywhere) and it clears with the fog. A fog machine blasts a hard jet out of its nozzle
  that brakes after a few metres; then the cloud rolls out over the whole stage and drifts towards
  the audience within 10 to 20 s, getting thinner as it goes, spills off the edge of the stage and
  is gone 30 to 40 s after the machine stops. A hazer's haze rises and spreads further, so it fills
  the room more evenly. Fog is greyish where no light is and in the colour of the beams it's in; placed on the deck
  it faces the band (turn it with Turn to blow somewhere else). **Glow** is the halo round bright
  lenses. **Ambient** is the room's own light besides yours (the sky, the house,
  reflections, how much of the walls and roof you see): on a curve like the eye's, so most of the
  slider is the dark end; low to start with (the walls near black), 0 for a black venue where only
  your lights show anything (the camera then doesn't lift a dark look either), kept in this browser. The band plays along on the beat: the guitarists' left hands round the necks (sliding
  to the next chord at the bar line), strumming across the strings, hands on the keys, the
  drummer's sticks in his fists hitting the drums, his feet on the kick and hi-hat pedals. The
  more your lights do, the more they move: the singer steps back from the mic at the end of a
  phrase to jump or clap, the others bang their heads, stomp and lean back.
  The crowd nods and bobs on the beat, and the more your lights do, the more of them jump (the
  front rows first, friends together, landing on the beat), throw their arms up and bang their
  heads; some film with their phones or sit on someone's shoulders, and ten of them wave flags,
  most with the band's banner from the backdrop on them (it reads the right way round from both
  sides): side to side, a bar there and back, wider when it's loud, the cloth streaming behind the
  pole, swinging round at each turn, drooping when it slows and rippling when it's fast.
  The LED screens beside the stage show the show the way a TV director films it (the **Broadcast**
  camera move, its own cuts, live; in the pub the TVs show it too). Off in the Venue panel (**The
  live camera on the screens**) they show the band's name; at the lowest drawing quality too.
  **Venue**: the room, **Big stage** (the hall) or **Small club / pub**: the same band on a smaller
  stage across the end of a room with brick walls and a low ceiling, two little trusses hung from
  it, a PA on poles, TVs on the walls, a bar at the back with its bartender, a few dozen people.
  Your lights move onto its rig (where the plan puts them: a quarter across the plan is a quarter
  across that stage); lights you placed by hand in 3D stay where you put them, and Reset puts them
  on the room's rig. The camera views go inside the pub. The demos bring rooms of their own: a club
  (a stage framed by truss on four towers, a truss over the dance floor, a bar at the back, a
  mirror ball), a party room (a square of truss over the crowd, no stage) and an empty room with
  one truss; the camera views go inside them too. **Band name**: your band's name on the
  backdrop, the banners, the screens and the kick drum (painted in the style of the band picture
  that's there by default; leave it empty for the picture; in the club and at the party it's on
  the front of the DJ booth). Both are kept with the show (the screens' live camera in this browser).
  Load your own venue or stage as a 3D model (.glb, or a .gltf with everything inside),
  fitted onto the floor (a model in millimetres or centimetres is scaled down), then size, place
  and turn it; the built-in stage can go. The model stays in this browser. Its panel closes with
  its X or Esc. The tools stay on one row: on a smaller 3D view Haze, Glow, Ambient, the video size and
  full screen are under **More** (⋯), on a phone the camera views and Venue too.
- **A video of the 3D stage**: **Record** (the red dot in the 3D toolbar) records what the 3D stage
  shows, with the song or the demo beat (and the crowd) in it when the timeline plays. The easy way: Timeline,
  Play, 3D on its picture, Record. A red REC chip counts the time; **Stop** saves
  "<show name> 3D <date>.mp4" to your downloads. It's an MP4 (H.264 and AAC) where the browser can
  make one, a WebM (VP9 and Opus) where it can't; both play in VLC and in browsers. A browser that
  only makes WebM (Firefox) says "WebM only" next to Record: Instagram and many phones want MP4,
  so record in Chrome, Edge or Safari, or convert the file. Video size
  (next to Record, or under More): **1080p** draws the stage at 1920 x 1080 while it records,
  whatever the window (it shows with bars here and goes back after Stop), **9:16** is 1080 x 1920
  for phones (Reels, Stories) with a lens wide enough to get the band and the lights in from where
  the camera is, **As shown** is the size on the screen. 30 frames a second; the sound is as loud
  as the timeline's volume. If the computer couldn't draw 20 frames a second while it recorded,
  the note at Stop says the video stutters and what to try (As shown, or fewer tabs). The layout
  holds still while it records (a window made narrower doesn't end the take). Closing the 3D
  view saves what's recorded so far; closing the page ends it without a file. A browser that can't
  record says so.
- **Your layout**: drag the gaps between the panels to make the lists, the programmer or the cues
  bigger (double-click a gap for the normal size, or focus it and use the arrows). Remembered in
  the browser. The chips at the top of the programmer (Intensity, Colour, Position, Channels) jump
  to that part and show where you are.
- **Room for the stage**: the top bar stays one row. When the boxes' pills don't fit on it (a laptop
  screen, several boxes) they fold into one button with a status dot, as on a tablet: its list has
  every box, Connect and **The rig (RDM)…**. On the stage plan the names never run into each other:
  each goes under its light, above it, or beside it; one with no room left is shown on hover (a
  selected light always shows its name).
- **A light's patch** (double-click it in the list, or "Name, address, mode…" in its menu): name,
  universe, address (it says when channels are shared and offers the next free spot), the DIP
  switches to click, its type and mode. When it shares channels with the lights after it (a
  bigger mode, say) it offers to move those up just as far as needed. When the fixture knows its
  real light (or one answers RDM at its address), **The real light** shows what that light says:
  its address, mode, label and how it's doing (status, temperature), with the fixes either way
  (**Set the light to 5** over RDM, or move the patch to where the light is), any of the light's
  own modes to pick, Identify, and Name it. Several selected (Enter, or "Patch the 6 selected…" in the
  menu): a universe for all, addresses one after the other from a start (with a gap if you like),
  names numbered; it says where the run ends and what it would sit on. One Undo takes it back.
- **A light's channels** (the patch's **Channels** tab): its mode channel by channel, to hold
  next to the DMX table in the manual: number, DMX address, name, what it does, which coarse
  channel a fine (16 bit) one belongs to, the default, the gobo and colour wheel slots. Its other
  modes say what picking one does (how many channels more or fewer, which lights after it would
  move and to where, what comes free): **Use it**, or **Use it, move the lights after it**. The real
  light has to be set to the same mode (its menu, DIP switches, or RDM).
- **Setting up a light** (the patch's **Mounting** tab, or **Mounting…** in a light's menu, for the selection too): how it's mounted, the way it's done at a
  rig. A moving head is **Hung** (under a truss, it goes onto the nearest one), **Standing**, **On
  its side** on the left or right (base against a tower, head towards the middle) or **at the
  back** (head towards the audience), with **its front** (the side with the display: at pan 50 %
  a head tilts that way) facing the audience, a side, the back, up or down. A fixed light points
  **straight down**, **at the stage**, **at the audience**, **straight up** or **up at the back**.
  Exact angles too (turn, tip, roll). Next to it a 3D picture of just that light (the same models
  and beams as the 3D stage, a floor, what it hangs on, a person for scale; drag round it, Front,
  Side, Above). **Try it**: Home (pan and tilt 50 %), pan to each end, tilt to each end, the beam
  on and off, on the picture and, with **On the real lights too**, on the real ones (through the
  programmer, so Blind, Blackout and the machine safety apply as always; machines get nothing;
  switching it off or closing gives the lights back what they had). Watch the real head do what
  the picture does: turning the other way means **Invert pan** or **Invert tilt**, tilting when it
  should pan means **Swap pan and tilt**. **Pan range** and **Tilt range** for a light whose type
  doesn't say (540 and 270 if nothing does). **Point it at a mark**: pick the centre of the stage
  or a front corner (it says how far from the middle and the edge, to put a bit of tape there), the
  head goes where the model thinks the mark is, nudge it (1°, 5° or 0.2° steps) until the real beam
  is on the mark, then **It's on the mark** works out its pan and tilt offsets: Aim and the 3D stage
  agree with the room from then on. **Set up** picks more lights at once (the selected ones, all
  of its type, a group): mount, invert, swap and range go to all of them, each in its own place,
  mirrored for the ones on the other side of the middle (on its side on the left becomes on its
  side on the right); **Make the other 3 like Head 1** copies one light's setup to the rest (its
  offsets only when asked: every head is a little different). One Undo per change.
- **Big rigs**: past a dozen lights the fixture list gets a filter (name, type, group, or an
  address: "25" finds whatever sits on channel 25). The library search works from the keyboard
  (arrows, Enter loads, Enter again uses it) and lists each mode's channels, to hold next to the
  manual's DMX table.

## The ideas, in one minute

- **Fixtures** are your lights. **Groups** are named sets of them ("Front", "Movers"); effects run
  along a group's order.
- **Presets** are named looks (a colour, a position). A cue remembers the preset, not the value,
  so changing "Warm white" once changes every cue that uses it.
- The **programmer** holds what you're changing right now. It sits on top of everything until you
  Record it into a cue or Clear it.
- A **cue** is a look plus timing. It only contains the lights you changed, so lights it doesn't
  mention keep doing what they were doing.
- A **cue list** plays cues in order: with GO, or on their own (a chase). Several lists can run at
  once: brightness is highest-wins, everything else is latest-wins. House lights on their own
  list, a fog timer on another, the show on a third.
- **Effects** are chases, rainbows, circles, fire, lightning... They follow the tempo (Tap).
- **Live pages** are grids of buttons and faders: scenes, GO, flash, fog (only while held, with a
  hard maximum), masters.

## Shows and files

Shows are saved in the browser as you go (the show manager lists them, with a picture of the
stage). To move a show to another computer or keep a backup, save it as a file: that's an open,
documented JSON format, see [FORMAT.md](FORMAT.md). **Send to another device** (Shows, or the More
menu on a tablet or phone) hands the file to the share sheet (Nearby Share, AirDrop, mail) where
there is one, and downloads it where there isn't. On the other side, "Open a show file", or just
drop the file on the app's window. Copy and paste works between shows too (cues find their
lights by name).

**Coming from QLC+?** Open your `.qxw` in the show manager. Fixtures come over with their QLC+
definitions (dimmer packs become single dimmers), fixture groups become groups, scenes become cues,
chasers and sequences become cue lists (fades, holds, loop / single shot / ping-pong, backward),
EFX become move effects, collections become a cue that starts what they hold. Channel values turn
into colours, intensities and positions where the fixture says what a channel is. RGB matrices,
scripts, shows, audio/video and the virtual console don't come over; the import says what it left
out. **Save for QLC+** writes a workspace back: fixtures (library ones with their definition,
generic ones as QLC+'s generic types), a scene per cue with the exact DMX values, a chaser per cue
list, moves as EFX.

**Paper and spreadsheets**: the menu (⋯, top right) prints a cue sheet (every list, cue, fade, what
happens next, notes; "Save as PDF" in the print dialog) or saves it as CSV. **Print the patch**
gives the setup sheet for the venue: every fixture by universe and address, its mode, and the DIP
switches drawn for fixtures that set their address with little switches (the fixture's edit row
shows them too). Show files can be
checked against `schema/luxdmx-show.schema.json`.

## Development

```sh
npm install
npm run dev                 # http://localhost:5173
npx vitest run              # unit tests (engine, effects, importers, file format, the whole app in happy-dom: src/app.test.ts)
npx playwright test         # e2e against a fake LuxDMX (test/fake-luxdmx.mjs)
LUXDMX_HOST=192.168.1.50 npx playwright test e2e/hw.spec.ts   # against a real box
```

`VITE_DEFAULT_DEVICE=<host>` in `.env.local` adds your box to every show that has none (handy on
your own machine).

The e2e suite ([e2e/README.md](e2e/README.md) has the full list) drives the real UI and reads back what a box receives: every DMX value in the tests
is measured, fades and effect periods included. A test also fails on any uncaught error or Svelte
warning in the page. `e2e/a11y.spec.ts` runs axe-core over the main screens (names, roles,
landmarks, contrast).

Fixture libraries: the Open Fixture Library (MIT) and the QLC+ fixture definitions (Apache 2.0)
are fetched from their repositories at pinned commits when you pick a fixture; only a small index
ships with the app.

More: [VISION.md](VISION.md) (what this should become and what it shouldn't), [PLAN.md](PLAN.md)
(phases and status), [FORMAT.md](FORMAT.md) (the show file).
