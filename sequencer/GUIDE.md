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
   box's firmware is too old for the sequencer (it needs v1.0.293 or newer: update it from its
   web page).
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
   the channels on the real fixture with the channel wizard. A pixel head or bar (a bee eye, a
   37-LED wash, a 4-lite blinder) is a few head channels and then the same few channels for every
   LED: in your own type **+ Cells…** adds them in one go (red, green, blue, white per LED, or rows
   of your table as the first LED, times 61), with the shape when it has one (rings of 1, 6, 12, 18
   in the order the data runs, or a grid), and the long run shows as one line ("Cells 1 to 61:
   Red, Green, Blue, White each"; RGB cells and white ones next to them are two lines). Its bin
   takes those cells out: the looks already recorded stay on the LEDs that are left (cell 6 that
   becomes cell 2 keeps its colour), and cells the light no longer has go from cues, presets,
   groups and effects. The wizard does the same: find one LED's channels, then "The
   rest are more of the same". A channel you give a job takes its name from it (Red, Pan) unless
   you named it. Effect machines from a file (a flame
   projector, CO2 jet, confetti cannon, spark machine or fogger) are known by their type and their
   own words, so they wait for Arm (fog is fog, never a dimmer) like the built-in ones; in your own
   type pick Confetti, Flame, Sparks or CO2 jet under Machines. A WS2812 or SK6812 pixel strip is one
   light ("Pixel strip, 50 RGB pixels", up to 170 RGB or 128 RGBW: a universe; rings and matrices are
   further down, see "LED rings and matrices"), so a rainbow or a
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
   number next to a slider takes a typed value too (click it: 37 %, a channel at 127). A channel
   set by hand under "All channels" shows on the stage plan and in 3D as what its value does (a
   pan byte turns the head, a gobo or colour wheel slot shows that slot, the shutter closes it),
   read back from the DMX the way a visualizer reads it; its × lets go of it again. With
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
  "enabled" value while armed, 0 while safe, so Arm opens both locks and one click shuts both. A
  machine's own programs (a flame projector's "Auto 1", a colour program on a spark machine) wait
  for Arm the same way, are cut off after the machine's longest time, never start from a jump, and
  go to 0 with the rest when the output goes blind, the page closes or a frame fails. A cue that
  fires one by its channel number ("All channels") is marked like any other. A pyro device found
  over RDM that no library knows comes in with every channel waiting for Arm, until you tell its
  channels apart. On the box, set the output these machines are on to blackout on signal loss: a
  laptop that crashes mid-shot then can't leave one on. The
  2D and 3D stage still show what they'd do. Fixture rows say what each machine is: fog,
  haze or bubbles (repeatable, fog can set off smoke detectors), fires once (confetti, "· safe" or
  "· armed"), dangerous (flames, sparks, CO2). Cues, live buttons, phone buttons and timeline
  items that fire one carry a mark (⚠, or 1× for confetti).
- **Winches (kinetics).** A winch's height (how far down its load is) moves only while the machines
  are armed, like a flame. Made safe (one click on ARMED, Blind, another show, closing the page, a
  reload) it stays where it was last sent, never 0: 0 is its top, and a winch sent there would run
  all the way up. The page keeps where each winch was, so a reload holds it there too (with more
  than one tab open, the newest height wins). Armed with nothing setting its height (the cue
  released, only the confetti meant to be armed), it stays where it is too. Its motion enable
  channel (if it has one) follows Arm like a machine's Safety channel, except while nobody knows
  where the winch is (never sent armed here, nothing kept): then the enable stays shut, armed or
  not, until a cue or a fader gives it a height. Each winch has soft
  limits in its Mounting (Its travel: the highest and the lowest it may go, in % of its travel):
  whatever a cue, an effect, a fader, a number in All channels or the channel wizard says, it's
  sent within them, so set the lowest above the heads of the people under it. Cues that move a
  winch carry the ⚠ mark. A number typed on its height channel in All channels becomes its height;
  raw numbers on that channel (from an old file, say) are never sent, since they'd fade in from 0.
  A controller with several winches as cells: each is its own, pick them in the cell picker like a
  bar's heads, each held on its own (two height channels without cells are one height, a truss
  lifted at both ends). A jump or a scrub on the timeline never moves a winch: it waits until the
  list is played on. Its own programs and control channels (a wave program, homing) stay at their
  off while safe. Nothing patched over it and no number from the channel wizard gets past its
  limits. Taken out of the patch, moved to another address or left behind by another show, its old
  channels keep what they had, its enable safe, until something else is patched there (a reload
  forgets that). Limits set while it hangs outside them don't move it: it goes within them the next
  time the show gives it a height. A winch type without a motion enable channel gets a warning in
  its Mounting: until it has been sent a height armed here, nobody knows where it hangs. The 3D
  stage moves the ball at the winch's real speed (its type's travel and speed): on stage and not
  armed it shows where the winch really hangs (where it's held), armed or blind the show's height. The library has a winch with an LED ball. On the box,
  blackout on signal loss sends its height to 0 as well: fine while its motion enable is on that
  output too (that goes to 0 and the winch stops), but a winch without one needs its own
  controller's hold on DMX loss.
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
  one is which in the room (with cells picked: just those cells, the rest of their light dark). Not
  recorded.
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
- **Console** (the Console tab, a row of faders as its icon on a laptop; on a tablet or a phone in
  the ⋯ menu, near the top; or Ctrl+K): the app laid out like a compact lighting desk, for a mouse,
  a keyboard or a touch screen. The ? next to Enter has examples, and so does typing "help". The
  stage sits beside it (on a narrow screen under the command line): the plan or 3D, as on Program,
  and a click on a light there selects it, as a desk's visualiser does. The eye next to Enter hides
  or shows it (remembered in the browser).

  | Type | It does |
  |---|---|
  | `5 @ full`, `5 full` | light 5 at full |
  | `1 thru 4 @ 50`, `1>4 @ 50` | four lights at half (`@ 5` is 50 %, `@ 05` and `@ 5%` are 5 %) |
  | `1 thru 10 - 5 @ out` | nine lights out (`-` takes out, as on MA and Eos: `1-4` is light 1 without 4) |
  | `+ 7`, `@ +10` | add to what's selected; up 10 from where each light is |
  | `group 2 @ full`, `all @ out` | a group by its number, every light |
  | `1.3 thru 1.16 @ full` | cells 3 to 16 of light 1 (a desk's sub-fixtures) |
  | `record`, `record cue 5 time 3` | a new cue in the list Live plays; cue 5 where it belongs, its fade 3 s |
  | `update`, `update cue 5` | the cue on stage; cue 5 |
  | `goto cue 5`, `cue 5 time 3`, `delete cue 5` | by the cue's number, in the list Live plays or in `list 2` |
  | `go`, `back`, `release`, `go 2` | the list Live plays, or list 2 |
  | `next`, `prev`, `clear`, `undo`, `blackout`, `highlight` | as the buttons |

  - **The command line.** Lights go by their number (the grey one in front of each light in the
    fixture list, on the plan with its # button). It stays when other lights come and go; the patch
    dialog's "Fixture number" changes it, and "Number the 3 from…" in the list's menu numbers a
    selection in one go (101, 102, 103). A run skips numbers without a light and says so. Cells and
    whole lights in one command are refused ("1.3 + 2.5" picks cell 3 on light 1 and cell 5 on
    light 2). "record cue 5" is refused when 5 is there; in a play that's running elsewhere the cue
    is stored and the programmer keeps your changes until Clear. Typed go and goto say when a list's
    machines are safe. Short forms: clr, rec, upd, bo, hl, q (cue), del, oops (undo), ff (full), t
    and > (thru). Typing anywhere on the console goes to the command line, ↑ brings back the last
    one; the keypad keeps a phone's own keyboard down (⌫ rubs out the last digit or word, Esc empties
    the line).
  - **Next / Prev** step through the selection one light at a time; with Highlight on each one
    lights up in turn while the rest of the selection stays faintly on (**Lowlight**, 15 %), **All**
    brings the whole selection back; with one light selected they go to the next light by number.
  - **Faders.** A fader, a select and a Flash button for every light in number order (20 at a time,
    ◀ ▶ for the next; Shift-click or **Add** adds to the selection). A light's fader sets its level
    in the programmer (Record keeps it, Clear lets go). Machines (fog, flames, sparks, CO2, confetti)
    have no strip. Or a **master for every group**: it scales everything its lights do (cues, the
    programmer, flashes; a group of cells just those cells), like the grand master for just them, so
    a GO still changes them and Record doesn't store it. A master below full shows in the top bar
    wherever you are (a tap opens the console), the reply to "5 @ full" says so, and it stays after
    a reload. Faders move from where they are, by how far you drag (a finger landing on the track
    doesn't make it jump), with the wheel or the keyboard (arrows, Page Up/Down, Home is 0, End is
    full; a mouse's double-click: full and back, not on a cue list's fader).
  - **Encoders** for what the selection has, a page each: Intensity (and strobe), Position (pan,
    tilt, move speed), Colour (hue and saturation, a white light turned in hue gets full colour;
    white, amber, UV, colour temperature), Beam (zoom, focus, iris, frost, prism, rotations, and the
    gobo wheels, which click from one gobo to the next and show its name), Built-in (the light's own
    programs: a built-in effect and a colour program that click by name, effect speed, the animation
    wheel) and Fog. Drag up or right, the mouse wheel, or the arrow keys (Shift: fine, Page Up/Down:
    big steps; a tap on the value, a double-click or Enter types one, a hue in degrees). Each light
    turns from where it is, so a fan stays a fan, and lights at different values show it
    ("20–80%"). The page's **palettes** sit under the encoders, and **+ Palette** records a new one
    from what the selected lights show now.
  - **Cue lists.** A fader for every cue list (10 at a time) with GO (the next cue shows under it),
    Flash, ◀ Back and ■ Release; its name lists its cues, numbered, the one on stage marked, and a
    tap on one goes there. Up from 0 starts the list, down to 0 lets it go, and a list let go that
    way plays at full when anything starts it again. A list that fires machines is marked, and while
    they aren't armed GO, Flash and the fader say so. Space is GO on the list Live plays, also after
    a click on a button. Leaving the console lets go of anything held.
  - **Recording.** The grand master and Blackout on the right; Record into (the list), Update,
    Clear (a toast can take it back), Highlight and Undo under the keypad. **Only changes** (also in
    Ctrl+K) makes Record and Update keep just what the programmer holds, as desks do: in a play the
    cues then track (light 2 recorded at half in cue 5 keeps the colour cue 1 gave it, and a change
    to cue 1 shows in cue 5 too), and Update merges your changes into the cue. Off (the default):
    each light you touched goes in with its whole look, so the cue looks the same whatever played
    before it. The show keeps the choice.
  - **MIDI.** With the MIDI button on, every fader gets a small Learn button: press it, move a fader
    or knob on your controller, and from then on that control moves it (it shows "CC7"; pressed
    again it lets go). Lights, group masters, cue lists and the grand master; they work in every
    view (not on a page locked for the service), and the show keeps them. A fader or knob takes over
    only once it reaches where the fader is (plugging in a controller or changing its bank never
    jumps a level or starts a list); a pad is a flash: full while held, back when let go. A control
    a live page's button had goes to the console (learning it says so).
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
- **Gobos, built-in effects and colour programs by name** (programmer, for lights that have
  them): Gobo, Gobo 2, Built-in effect and Colour program show the names from the light's own
  profile ("Star", "Auto show", "Rainbow fade"); picking one gives every selected light the slot of
  that name, wherever it sits on its wheel or channel (a head without one by that name is left as
  it is; one light alone takes the one at that place). Gobo 2 rotation, Prism rotation, the Animation wheel and its
  rotation, and Effect speed are sliders. Files from GDTF, the Open Fixture Library and QLC+ bring
  them in: a second gobo wheel is Gobo 2 (its rotation goes with it), effect and colour programs
  are what they are. Effect machines are still found by their own words, so a flame projector's
  fire channel filed as an "effect" still waits for Arm. A matrix panel from GDTF (its pixels'
  places in the file) or the Open Fixture Library (its pixel grid) comes in laid out as a grid, wired
  the way the file says, so the cell picker's Top and Bottom, pixel effects and the pictures see a
  panel and not one long row.
- **Fan and colour spread** (programmer): one slider fans moving heads out; Rainbow or a two-colour
  gradient spreads colours along the selection (picked cells count one by one: a rainbow round a
  ring's rim).
- **Single cells** (Cells, at the top of the programmer, for pixel bars, rings, matrices and pixel
  heads): pick cells on the little picture of the light, and the brightness and colour below go to
  just them, like a desk's sub-fixtures. Click a cell, drag across cells, drag a box from outside
  them (Alt, or **Take out** on a touch screen, takes them out), type them ("1 thru 16, 20",
  "30-40/2": a range, single cells, every second one; "16-1" backwards, the way a rainbow then
  runs; a number past the light's last cell is said), step through them one at a time with ◀ ▶
  like a desk's Next, or use the keyboard (arrows move the blue ring, Space picks). Picked cells
  are outlined orange. A big matrix gets **Zoom** (2×, 4×): the picture scrolls and a tap picks a
  cell. On the stage plan, Alt-click one of a selected light's pixels to pick that cell (Alt-drag
  still moves the light without snapping); picked cells are outlined there too. Quick picks:
  Whole light, Each cell, Odd, Even, Every 3rd, Invert, the halves, a ring (Rim to Centre), a
  matrix's Border and Checker. Cells the programmer holds something for are outlined; **Let go of these cells**
  frees the picked ones. Record (and Update) keep them in the cue: the rim red and the middle blue
  stays that way, cue after cue, until a cue sets the whole light again. With several lights of the
  same shape selected (same type, mode and wiring), the same cells are picked on each; lights of
  another shape are left alone while cells are picked (it says which). Another selection drops the
  picks. A colour preset made or updated with cells picked takes the first picked cell's colour.
  Effects run on top of the cells a cue set, a whole-light effect on every cell. An effect added
  while cells are picked runs on just those cells, in their order ("Chase on Disc (16 cells)": a
  chase round the rim, the middle keeps its colour). A group made while cells are picked is a group
  of those cells ("Rim"): selecting it picks them again, an effect on it runs on them, its flash
  (a live button, the console) lights just them, and its master on the console scales just them.
  To QLC+ it goes as a group of its whole lights (the export says so).
- **Effects in stage order**: an effect normally runs along the group's order; "Order" in the
  effect editor makes it run left to right on the stage, back to front, or from the centre out,
  however the lights were patched.
- **Effects that run on their own**: an effect started on Live or by the timeline isn't part of a
  cue list, so releasing a list leaves it running (on a pixel bar it lights the cells even when the
  bar's own intensity is 0). A Release says which ones keep running, with a button to stop them, and
  the programmer's "out" reading shows what a selected light really gives (a pixel bar: its
  brightest cell).
- **Contrast** (in an effect's settings, for pixel shows and brightness effects): how hard the light
  falls between dark and bright. Up, what's dim gets dimmer and what's bright gets brighter; down,
  it's softer and more of it glows. Dark stays dark and full stays full; Dim to and Bright to are
  still the ends.
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
- **LED rings and matrices**: a WS2812 ring, a disc of rings (the usual 241 LEDs on 9 rings, 144, 93,
  61, 37) or a matrix (8 x 8, 16 x 16, 32 x 8) is one light with a shape. Pick it in Add fixtures, or
  "Ring or matrix..." for your own: how many LEDs on each ring, or columns and rows, where the data
  starts and which way it runs. A picture walks the LEDs in data order, to compare with the real
  one. Once it's patched, its **LEDs** tab (double-click it in the list) has a test picture for the
  real one, turns and mirrors it, and finds the wiring from three LEDs you click. Over 170 RGB pixels (128 RGBW) a light runs on over the next universes, whole pixels on
  each, the way a LuxDMX box's pixel port reads it: patch it on the universe the port starts at.
  A box tells the app what its ports listen on and only gets those universes. If a line under the
  top bar says "No box plays pixel universe ...", set a pixel port to that universe, or update the
  box: one on v1.0.293 or older doesn't say, and only gets its DMX universes.
  Don't put them on a universe a DMX output listens to (the template starts at 10). On the 2D and
  3D stage they're drawn as what they are.
  - **Their effects** (Effects, Add, Rings and matrices) know where every LED is, so wiring order
    doesn't matter: Eye (wakes up, looks round, gets angry, falls asleep), Reactor, Supernova and
    Radar (short stories that start and end dark; Speed is their length in seconds), Black hole,
    Warp, Galaxy, Hypno, Mandala, Tunnel, Plasma clouds, Lava lamp, Campfire, Code rain, Raindrops,
    Sky rockets, Kick rings, Big heart and Equaliser (on the beat, or the bass with the microphone
    on), Scrolling text (your words). Spread shifts several lights against each other. Wiring test
    checks the shape: a colour per ring or row, each one's first LED white, a dot walking in data
    order. If the picture is scrambled, that's the shape (or the LED count), not the effect.
  - **The Ring and matrix template** (Shows, or Ctrl+K) has a disc, a matrix, a ring and a banner
    from universe 10, with lists of these effects ready on the live page.
- **Add-ons** (Effects, Add, Add-ons): fifty effects for rings, discs and matrices in ten themes:
  radioactive, fire, rain, clouds, sun, love, darkness, water, the sea and nature (a trefoil
  sign, a Geiger counter, a meltdown, embers, a bonfire, a thunderstorm, a sunrise, an eclipse, a
  beating heart, watching eyes, ripples, a jellyfish, northern lights, fireflies...). Pick a theme
  to see its five. They come as packages from our add-on repository (next to the app, kept for
  offline use) and run in a sandbox: a little language of our own that sees the light it draws
  on and nothing else (ADDONS.md). Some have knobs of their own (Trefoil's colour and how fast it
  turns, the Geiger counter's activity, how much drizzle, the heartbeat's pulse, the fireflies'
  colour); the settings show those and only the standard knobs that change it.
  - **Share as a file** (an effect's settings, More): any effect, an add-on, a built-in as you set
    it, a formula or a picture, saved as a `.luxfx` file with your name, what it is, a licence and
    a little animation. **Import an effect file…** (the add-ons' line in the library) reads one
    strictly, shows it under Imported (kept in this browser; × forgets it) and refuses one that
    isn't right, saying why.
  - **More sources…** (at the end of the add-ons): someone else's repository by its address
    (https). Only add sources you trust: anyone can put one up, and what it says about its effects
    isn't checked by anyone (the effects run in the same sandbox as ours). Adding one needs a tick
    that you trust it, and it's kept only once it loads; its effects show under "From ..." in this
    browser, × removes it again. An imported effect or one from another source shows its own
    little animation; one that has none plays only when you point at its card, so nobody's code
    runs just because the library is open. One that takes too long (over 30 ms a frame) stops
    and rests a few seconds, a message says which one; the rest of the show goes on.
- **Every knob does something.** An effect's settings show only what changes that effect (a ring's
  Eye has no palette, a random colour no Size): engine/knobs.ts lists them, and a test runs every
  effect with every knob moved to check. On a ring or a matrix **Size** makes the picture smaller
  and **Back** mirrors it, so what turns turns the other way.
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
  - **Picture**: load a PNG, JPG, WebP, an animated GIF or a short video (MP4, WebM, whatever the
    browser plays: its first 8 seconds at up to 12 frames a second, 64 at most). On a ring, a disc
    or a matrix the picture lies where the LEDs really are, its middle filling the shape (a wide
    one loses its sides). On a strip or a row of PARs the picture
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
  lights**: first with a type of your own that has their RDM maker and model ids (one used in this
  show, then your fixtures; a GDTF file brings them, a type you fixed for this light alone doesn't
  count), in the mode of the light's personality; then with their own profile when the fixture
  library knows them (by their RDM maker and model ids, else by their names); else a plain one with
  their number of channels (a pyro device's channels all wait for Arm). **Identify**
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
  is down or blocked it tries our copy, then the one on the public site, and says so in plain words
  when none works) and keeps
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
  the same either way. Heads with more axes: **endless pan and tilt** (a turning channel: off, CW,
  stop, CCW) turn round and round past any position while it turns, and go back to their position
  the short way when it stops; a **third axis (roll)** turns the head round its own beam, to an angle
  or on and on, and its gobos and prism turn with it. The programmer has them under the sliders
  (Pan rotation, Tilt rotation, Roll, Roll rotation, with a button for each range), the console on
  its Position page; fixture files bring them in (OFL PanContinuous / TiltContinuous / Rotation,
  GDTF PanRotate / TiltRotate). The library has an endless head and a beam head with a roll.
  **Moving bars** (heads in a row, each tilting on its own, sometimes panning too) are lights whose
  cells are heads: pick heads in the cell picker (or "1.2 thru 1.3" on the console) and the pan and
  tilt controls point just them, the rest keep the bar's; a cue keeps each head's, and fades them
  on its position time. A move effect on a bar runs along its heads (a tilt sweep with spread is a
  wave from head to head, a fan fans them); on a bar whose heads only tilt, its pan part turns the
  whole bar. Record, Update and position presets keep each head's own position, and an encoder with
  no heads picked turns each head from where it is (a fan stays a fan). Heads that pan each are
  drawn panning each; a bar with its own pan or tilt besides its heads' keeps their motors at the
  middle unless set, so an angle doesn't count twice. In 3D each head is drawn on the bar with its own motor and its own beam in its cell's
  colour, and the bar pans as one. Fixture files bring them in: GDTF heads (a tilt on each head's
  axis, the colour on the beam under it: one cell), OFL pixels with a tilt each. The library has a
  bar of four.
  A beam is as wide as the light's data says: its fixture file's beam angle
  (OFL's lens, a GDTF zoom or beam angle, QLC+'s lens), narrowest to widest over its zoom; the
  library's heads have their data sheets' angles. One whose file doesn't say gets a guess for its
  kind. The patch dialog's Mounting tab shows it under **Its beam**, and takes the real light's own
  angles when they differ (empty: its type's again). **Spill** (next to Ambient) is how much your lights light up the room round
  them: the band, the deck, the walls and the haze's glow (0 only their beams and where they land;
  it starts lower than it used to be). A spot's gobo shows in 3D as the real pattern: fingers of light in the haze
  and its picture where the beam lands. Which pattern comes from the slot's name in the fixture
  file, in English or German (Stars, Sterne, Flower, Dots, Breakup, Leaves, Water, Spiral, Tunnel,
  Window, Snowflake, Heart, Triangle and so on: 96 of them, symbols and the classic metal ones);
  a slot whose name says nothing ("Gobo 5") gets a pattern of its own, different from the others
  on its wheel, and Open is none; the programmer's gobo buttons show the same pictures. Glass gobos
  (Rainbow glass, Fire glass, Ocean glass, Aurora, Stained glass, Galaxy glass, Sunset) are in
  colour and tint the light. A second wheel lays its pattern over the first. The gobo rotation
  channel turns it as its ranges say (an index range is an angle, CW and CCW ranges turn slow to
  fast; a range called reverse, backward or rückwärts turns the other way too); without ranges 0 is
  still. The library's generic gobo spot turns its gobo and its prism either way (index, CW, stop,
  CCW), as real heads do. Where the wheel has them, **Shake** makes the gobo shake and
  **Wheel ↻ / ↺** runs the whole wheel round through its gobos (buttons under the gobos; a cue keeps
  them). The **prism** splits the beam and the picture: 3, 5 or 8 facets, round or in a line, as the
  prism channel's ranges say (a plain prism channel: three round), turned by its rotation channel.
  The **animation wheel** slides a breakup through the beam as far as it's in, running as its
  rotation says. The **iris** closes the beam down. The **focus** is sharp at one throw: near for 0,
  far for 1, so a head focused for the floor is soft on a closer wall; **frost** softens on top.
  Channels with named ranges (a prism's facets, a rotation's index, CW, stop and CCW) get a button
  for each range above their slider; the slider fine-tunes within it. The library's **Profile spot**
  has all of it: CMY and a colour wheel, a rotating gobo wheel with shake, a fixed wheel with glass
  gobos, an animation wheel, three prisms, iris, zoom, focus and frost. The symbols come from a small
  font that comes with the app (a part of Noto Sans Symbols, SIL Open Font License), so every
  computer draws them the same. The orange frame round the selected lights fades while you work on their
  look (the programmer, effects, presets, the cues, a light's patch), so a colour or an effect shows
  as it is, and comes back as soon as the pointer is on the stage, the fixture list, the groups or
  the cell picker again, or the selection changes. A Live page's stage and the timeline's picture
  never show it: they're for looking. On a busy computer that draws the 3D only a few times a second the heads
  still move at that speed, they don't jump; after the tab was hidden they're straight where the
  show has them. Switching between Program, Timeline and Live keeps the 3D stage as it is
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
- **Render a video (up to 8K)**: **Render** (next to Record) draws the video frame by frame instead
  of recording it as it plays, so it never stutters, whatever the computer: **1080p**, **9:16**
  (1080 x 1920), **4K** (3840 x 2160) or **8K** (7680 x 4320), at 25, 30, 50 or 60 frames a second.
  It renders **the song from its start**, **the song from the playhead**, or **the look as it is**
  for as many seconds as you say (without a song on the timeline, only that). It starts from the
  look on stage now (the lists playing, the effects on, the masters), then the song's cues come at
  their moments; **With what's in the programmer** takes the programmer along too. The sound is the
  song's file (or the demo beat) mixed at full, not the speakers. The panel says how long the video
  is and about how big the file gets. While it renders the 3D stage shows the frames being drawn and
  a chip counts the per cent and the time left; **Stop** ends it and saves nothing. It runs its own
  copy of the show: nothing goes out to the lights from it, and the show here (the box, the cues,
  the programmer) goes on as it is. Slower than real time at 4K and 8K (each frame is drawn at full
  size with the glow and the haze), but every frame is there. Where the browser asks where to save
  (Chrome, Edge) the file goes straight to disk as it's made (an 8K song is gigabytes); elsewhere
  it's saved to the downloads at the end. It's an MP4: H.264 where the browser encodes that size,
  else HEVC or AV1 (8K usually needs one of those: a graphics card that encodes them, or the
  browser's own slower encoder), VP9 last; the sound AAC, or Opus where AAC isn't there (Chrome on
  Linux). A graphics card that can't draw that big says so before anything starts, one that runs
  out of memory part way stops the render with a note. The crowd's sound isn't in a render.
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
  number (what the console goes by; one no other light has), universe, address (it says when channels are shared and offers the next free spot), the DIP
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
  - **Try every channel**: each one has a slider and a number that send that value to the real
    light (through the programmer, so Blind, Blackout and the machines' arming apply as always), a
    wheel's or a gobo's slots are buttons that send the middle of their range, and **All to
    default**, **All to 0**, **All full** and **Let go of all** do the whole light. A held channel is
    marked; its **×** gives it back to the show.
  - **Change what the channels do**: name, what it does, fine, default and the named ranges, right in
    the table. **Save for all N lights of this type** (a type of your own changes in place; one from
    the library becomes a copy the lights use) or **Only for** this light (a copy for it alone). To
    add or remove channels, use "Change the channel layout" in the fixture list's menu.
  - **A ring or a matrix** shows one pixel's channels, standing for every pixel: their sliders set
    all pixels at once, and changing what one does (a GRB panel: the first is green, the second red)
    changes it on every pixel.
- **A ring's or a matrix's LEDs** (the patch's **LEDs** tab): which way it's wired, in words, and a
  picture of it seen from the front. The **Test picture** is an F with its corners in four colours
  on a matrix (top left red, top right green, bottom left blue, bottom right yellow), and an arrow
  pointing up with red at the top of the rim and green on its right on a ring: it looks wrong
  whichever way the real one is off. **Show the picture on the real one too** puts it on the LEDs.
  Mirrored or turned on the real one? **Mirror ↔**, **Mirror ↕**, **Turn ↻** and **↺ Turn** until
  it looks like the picture (a ring also turns by one LED, and **Inside out** when its data starts
  in the middle). **Find the wiring on the real one** lights the first LED red, the second green
  and the last blue; click where you see each of them in the picture, and the wiring follows.
  **Data order** shows the same three and walks a dot along the LEDs. **Wiring by hand**: columns
  and rows, the corner the data starts in, along the rows or the columns, zigzag; or the LEDs per
  ring, the direction and the angle. It's the light's own wiring (two of the same panel can hang
  differently); **Set up: All N of this type** gives them all the same, **Back to the type's
  wiring** drops it. Effects, the stage and the 3D stage follow it.
  - **How the LEDs light** (also for a pixel strip): WS2812 pixels on a LuxDMX box go through its
    gamma and brightness and are rounded to 8 bits, so the low end of a fade is simply off (at
    brightness 150, everything below DMX 25), and over its power cap everything is dimmed together.
    The 2D and 3D stage draw them that way: what the real LEDs don't show is dark there too. The
    numbers come from the box that plays the light, through its bridge or through LuxDMX Link 1.4 or
    later (same universe and start channel: "From
    dmx-gateway: its pixel port on universe 10, brightness 150, gamma 2.2, a 500 mA cap"), else
    from a port as it comes (gamma 2.2, brightness 255, no cap). **Brightness**, **Gamma**, **Power
    cap**, **mA per colour** and **mA dark** can be set here for a light whose box isn't connected
    or says something else; **As the box has it** goes back. It says from which DMX value on a
    colour lights at all. Only the pictures change: what goes out is the same.
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
  the picture does: tilting when it should pan means **Swap pan and tilt**. Turning the other way:
  first check how it's mounted; if
  that's right, its type has the direction the other way round from this light: **Pan turns the
  other way round** (or tilt) puts the picture, Aim and the 3D stage right and changes nothing on
  the wire. **Invert pan** / **Invert tilt** turn what a cue sends round instead (the real head and
  the picture both follow): for heads that should mirror each other. **Pan range** and **Tilt range** for a light whose type
  doesn't say (540 and 270 if nothing does). **Point it at a mark**: pick the centre of the stage
  or a front corner (it says how far from the middle and the edge, to put a bit of tape there), the
  head goes where the model thinks the mark is, nudge it (1°, 5° or 0.2° steps) until the real beam
  is on the mark, then **It's on the mark** works out its pan and tilt offsets: Aim and the 3D stage
  agree with the room from then on. **Set up** picks more lights at once (the selected ones, all
  of its type, a group): mount, invert, swap and range go to all of them, each in its own place,
  mirrored for the ones on the other side of the middle (on its side on the left becomes on its
  side on the right); **Make the other 3 like Head 1** copies one light's setup to the rest (its
  offsets only when asked: every head is a little different). One Undo per change.
- **Focus and calibrate** (a moving head's menu, for all the heads selected; or the link under
  "Point it at a mark"): so ten heads really meet on one spot, the way the big consoles do it.
  Tape a few marks on the real stage; the app suggests a rectangle on the deck and its middle, and
  each mark's place can be typed in (metres across from the middle, back from the front edge, up
  from the floor; a small plan shows them). Pick a mark, and for each head: steer it with the
  arrows (or ◀ ▶ ▲ ▼, in 0.2°, 1° or 5° steps, or its Pan % and Tilt %) until the real beam is on
  the tape, then **Head 3 is on Front left**; the next head that isn't on it yet comes up. **On the
  real heads** sends it out (through the programmer, so Blind applies), **Only the one I'm steering
  is lit** keeps the others dark so you know which beam is which; a gobo with a cross or a narrow
  zoom helps. Once a head has been on three marks (four for its tilt offset too), **Work it out**
  says where it really hangs (metres left or right, up, from the front edge), how it's turned, its
  offsets and how well it fits: "fits all its marks within 2 cm", or which mark is off (steered
  wrongly, or the tape isn't where the table says). If its pan turns the other way round from
  what its type says it says so, and Use it ticks "Pan turns the other way round" for it (a tilt
  the other way round is the same to the beams as a pan offset of 180°, so it comes out as that); if it
  points as if it hung quite differently (turned over), it says that too. With every mark at one
  height, a head's mirror image on the other side of them fits just as well; it then takes the
  likelier one (not reversed, above the floor) and says so: give one mark another height (a box
  on the stage) and steer it there to settle it. With **six marks or more**, one of them at least 40 cm higher or lower than the others, a head whose pan or
  tilt goes further (or less far) than its manual or profile says is measured too: "Its pan goes
  630° and its tilt 250°, not the 540° and 270° its profile says", and Use it keeps that for the
  light (with fewer that don't meet, or all at one height, it says what would measure it). Its invert settings are
  never changed.
- **Find pan and tilt** (in the menu of a light whose profile names nothing that moves it, a plain
  profile from RDM with "Channel 1" to "Channel 12"; and on the patch dialog's Channels tab of any
  light that doesn't move, "Does it move?", for a file that got it wrong): every channel with a
  slider that goes to the real light ("Profile says" what it does now); say which one is **Pan**
  and which **Tilt** (the channel after it as its 16-bit fine one when its name says so, or pick
  it), which one is the **Dimmer** and which opens the **Shutter** (left where the light is on and
  steady), so it lights while you steer it onto marks; one channel may reset the light or turn its
  lamp off, put that slider back to 0 then; how far each goes (540° and 270° unless the manual says
  otherwise; six marks, one at least 40 cm higher or lower, measure it later), and save it for this light or for all of its type. It's
  a head from then on (Aim, 3D, presets), and **Save and focus on marks** goes straight on to Focus
  and calibrate. **Use it** puts that into the show (one Undo): from then on Aim, the 3D stage and every
  position worked out from a place point it where the real one goes. **Keep the marks as position
  presets** makes one position preset per mark with each head's own pan and tilt (focus palettes):
  at the next venue, steer them again and keep them again, and every cue using them follows. What
  was steered stays while the app is open, also when the dialog is closed.
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
  mention keep doing what they were doing. Its timing (on the right when it's selected): a fade,
  and under **More timing** a delay, a fade out for lights getting darker, and times of their own
  for **Colour, Position and Beam** (empty: the fade), so a colour can change at once while the
  heads take 4 s to get to their marks.
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
