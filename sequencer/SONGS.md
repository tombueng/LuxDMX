# The songs in the song picker

The demo songs on the Timeline are real songs with real singers. The people named below made
them and released them under Creative Commons licences that let anyone share them, so we can
pass them on with the app. Thank you, all of you.

How it works:

- Picking a song downloads it from where the artist put it. Some sites don't let a web page
  fetch their files (ccMixter, joshwoodward.com and the odd Jamendo file), so the app then takes
  our copy from `public/songs/`. Our copies are the artists' files byte for byte (the sha256 is
  below). They aren't in git: put them in `public/songs/` before building, from the "File" links
  below (`npm run songs` does it).
- The app shows the credit under the waveform while a song is on the timeline, and a show
  file that uses a song keeps its credit.
- CC BY asks for the credit: title, artist, licence, where it's from. CC BY-SA asks the same, and
  if you make something new out of the song (a remix, an edit), share that under CC BY-SA too.
- The tempo, the first downbeat and the parts (intro, verse, chorus...) were measured from the
  audio by us, not given by the artists. They can be off by a bar here and there.

| Licence | What it says |
|---|---|
| [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Share and adapt, for anything, with credit. |
| [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | The same, and what you make from it stays CC BY-SA. |

| Song | Artist | Style | Licence | Length | BPM |
|---|---|---|---|---|---|
| [Miss Muffin](https://www.jamendo.com/track/784445) | Back Door Men | Rock'n'roll | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 3:32 | 200 |
| [Ragazzi retrò](https://www.jamendo.com/track/1027314) | Gli Shakers | Rock'n'roll | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 3:10 | 156 |
| [In Peace](https://ccmixter.org/files/phasenwandler/33726) | phasenwandler feat. Snowflake | Techno | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 5:01 | 135 |
| [Robot Girlfriend](https://ccmixter.org/files/killersweetheart/15747) | killersweetheart feat. Fireproof_Babies | Techno | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 5:54 | 126 |
| [Foolish Game (Levihica Remix)](https://ccmixter.org/files/Levihica/47591) | Levihica feat. Snowflake | House | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 5:58 | 126 |
| [On My Way](https://ccmixter.org/files/phusion/63576) | Tomas PhUsIoN feat. Donnie Ozone | House | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 5:38 | 125 |
| [Airplane Mode](https://www.joshwoodward.com/song/AirplaneMode) | Josh Woodward | Pop | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 3:37 | 179 |
| [Hot Core](https://ccmixter.org/files/AlexBeroza/31990) | Alex Beroza feat. Snowflake | Pop | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 4:07 | 135 |
| [Perpetual Motion](https://ccmixter.org/files/VJ_Memes/42770) | Jeris feat. Donnie Ozone | Hip-hop | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 3:07 | 105 |
| [The Weekend](https://ccmixter.org/files/AlexBeroza/37551) | Alex Beroza feat. Donnie Ozone | Hip-hop | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 3:55 | 130 |
| [We're All Going To Hell](https://freemusicarchive.org/music/Hearse_Pileup/2020/were-all-going-to-hell/) | Hearse Pileup | Rock / punk | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | 3:24 | 180 |
| [Whiskey en el Hotel](https://www.jamendo.com/track/84605) | Whiskey Therapy | Rock / punk | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 3:20 | 126 |
| [Need You](https://www.jamendo.com/track/1041646) | Marker Beacon | Metal | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 3:48 | 120 |
| [Selfish](https://www.jamendo.com/track/1158703) | SIYLIT | Metal | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 3:42 | 150 |
| [Bully](https://www.joshwoodward.com/song/Bully) | Josh Woodward | Hard rock | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 4:05 | 150 |
| [Revolution Now](https://www.joshwoodward.com/song/RevolutionNow) | Josh Woodward | Hard rock | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 3:54 | 130 |
| [Allright](https://www.jamendo.com/track/987716) | The Black Rifles | Hard rock | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 4:06 | 130 |
| [Zero to Phantom](https://www.joshwoodward.com/song/ZerotoPhantom) | Josh Woodward | Alternative | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 4:02 | 120 |
| [Fast Food Fantasy](https://www.joshwoodward.com/song/FastFoodFantasy) | Josh Woodward | Alternative | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 3:43 | 160 |
| [Don't Go (RumbleStep Mix)](https://ccmixter.org/files/cdk/41292) | cdk feat. mykleanthony | Drum & bass | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 4:11 | 170 |
| [Where Did the Silence Start to Grow](https://ccmixter.org/files/VJ_Memes/34781) | Jeris feat. SackJo22 | Drum & bass | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 4:24 | 160 |
| [Light Me On Fire](https://ccmixter.org/files/zep_hurme/39887) | Zep Hurme feat. Admiral Bob | Funk | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 3:37 | 104 |
| [Let the Walls Come Down](https://ccmixter.org/files/JeffSpeed68/66038) | Stefan Kartenberg feat. Mr_Yesterday | Funk | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 3:53 | 96 |
| [Panopticom](https://www.jamendo.com/track/311484) | Sever | Metal | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 4:40 | 152 |
| [Pests](https://www.jamendo.com/track/1167928) | Organic Illusion | Metal | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 3:54 | 140 |
| [Mirin Dajo](https://freemusicarchive.org/music/Zoliborz/Mirin_Dajo/01_Mirin_Dajo/) | Zoliborz | Metal | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 3:42 | 155 |
| [Hard Wired, Born Blind](https://ccmixter.org/files/JeffSpeed68/56449) | Stefan Kartenberg feat. Mr_Yesterday | Metal | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 4:43 | 156 |
| [Liar](https://www.jamendo.com/track/992821) | Grimoff | Metal | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 5:02 | 115 |
| [Ready To Go](https://www.jamendo.com/track/1101668) | Endtape | Hard rock | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 4:40 | 134 |
| [Summer Wind](https://www.jamendo.com/track/479306) | Antarhes | Hard rock | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 3:12 | 107 |
| [I Saw You](https://www.jamendo.com/track/38568) | Predator | Rock / punk | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 3:15 | 180 |
| [It's Never Enough](https://www.jamendo.com/track/580687) | Mudskills | Alternative | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 3:47 | 95 |
| [Leaving Babylon](https://ccmixter.org/files/zep_hurme/60052) | Zep Hurme feat. i_rebel | Reggae | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 3:33 | 126 |
| [More, more, more,...](https://ccmixter.org/files/Reiswerk/50919) | Reiswerk feat. i_rebel | Reggae | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 2:59 | 125 |
| [Everybody On Your Block](https://www.jamendo.com/track/1093615) | Lilly Wolf | Pop | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 4:15 | 128 |
| [I Won't Fall In Love](https://freemusicarchive.org/music/Jens_East_ft_Henk/I_Wont_Fall_In_Love_1068/Jens_East_-_I_Wont_Fall_In_Love_feat_MaryLinn_master_24bit_1625/) | Jens East feat. MaryLinn | Electro | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 3:01 | 117 |
| [Rescue Me](https://ccmixter.org/files/L4M/19218) | L4M feat. Kaer Trouz | Electro | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 2:45 | 130 |
| [El Cha Cha Man](https://www.jamendo.com/track/37754) | Juanitos | Latin | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 3:36 | 136 |
| [Sambarama](https://www.jamendo.com/track/37756) | Juanitos | Latin | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | 4:23 | 122 |

## The crowd

The crowd's sounds on the timeline (`public/sounds/crowd/`, 1.5 MB) are made from two real
recordings: people talking in a hall, and a crowd cheering. No applause and no clapping, they
sounded ugly. `scripts/build-crowd-sounds.py` makes all of them from the files as they were
downloaded.

| Our file | Made from | By | Licence | What we did |
| --- | --- | --- | --- | --- |
| `chatter.mp3` | [Algemeen rumoer en geroezemoes](https://commons.wikimedia.org/wiki/File:Algemeen_rumoer_en_geroezemoes_-_SoundCloud_-_Beeld_en_Geluid.ogg) (Wikimedia Commons, from the sound library of the Netherlands Institute for Sound and Vision) | Beeld en Geluid | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0), and so is our file | cut 30 to 92 s, set its level, MP3 (made a seamless loop in the browser) |
| `cheering.mp3` | [Crowd Cheering](https://pixabay.com/sound-effects/people-crowd-cheering-312831/) (Pixabay) | storegraphic | [Pixabay Content License](https://pixabay.com/service/license-summary/) | a new 20 s loop put together from slices of the cheer's loud part, each at its own pitch, left and right their own slices |
| `cheer-1.mp3`, `cheer-2.mp3` | the same cheer | storegraphic | [Pixabay Content License](https://pixabay.com/service/license-summary/) | the whole cheer made stereo (each side its own short smear of echoes), the second a little deeper and longer; levels set |

The cheer is not under an open licence: the Pixabay Content License lets anyone use and change it
for free, with no credit needed (we give it anyway), but not pass it on as it is, on its own. So
it's only here worked into new sounds for the show, never the file as downloaded. Taking these
three files out of LuxDMX to use elsewhere, Pixabay's terms are what apply to them, not ours.

## Each song

### Miss Muffin, by Back Door Men

- Licence: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- Released at: https://www.jamendo.com/track/784445
- File: https://prod-1.storage.jamendo.com/download/track/784445/mp32/
- Our copy: `public/songs/miss-muffin.mp3`, 5.2 MB, sha256 `da0f3fb84271b07c02b8d3ace0d8b7fc05797cc6ee1ad3212089f5b073d8ebd5`
- Who made it: Back Door Men, an Italian rockabilly band (single, 2011), released by the band on their own Jamendo artist page.
- How we know the licence: the Jamendo track page shows the CC BY-SA licence icons, and Jamendo's file carries `copyright=http://creativecommons.org/licenses/by-sa/3.0/` in its tags.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Ragazzi retrò, by Gli Shakers

- Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Released at: https://www.jamendo.com/track/1027314
- File: https://prod-1.storage.jamendo.com/download/track/1027314/mp32/
- Our copy: `public/songs/ragazzi-retro.mp3`, 5.1 MB, sha256 `5c7e74e5a3f3239cd3d3c618a1554e7af9a5502621f195eb66a6f699e58ba924`
- Who made it: Gli Shakers, an Italian rock'n'roll band, from their 2013 EP *Il futuro è già passato.*, released by the band on their own Jamendo artist page.
- How we know the licence: the Jamendo track page shows the CC BY licence (its licence icons), and Jamendo's file carries `copyright=http://creativecommons.org/licenses/by/3.0/` in its tags.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### In Peace, by phasenwandler feat. Snowflake

- Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Released at: https://ccmixter.org/files/phasenwandler/33726
- File: https://ccmixter.org/content/phasenwandler/phasenwandler_-_In_Peace.mp3
- Our copy: `public/songs/in-peace.mp3`, 12.0 MB, sha256 `b233187568ce2b12e1846844bb6a685c2e8f16573625c870a8ca56e295f91445`
- Who made it: phasenwandler (producer, a four-on-the-floor trance/techno remix, 2011) with Snowflake (vocals, her own a cappella "In Peace", CC BY 3.0).
- How we know the licence: the ccMixter page says "Licensed under Creative Commons Attribution (3.0)"; the one sample it uses (Snowflake's a cappella, uploaded by her) is CC BY 3.0 (checked through ccMixter's API); the file's own tag says the same.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Robot Girlfriend, by killersweetheart feat. Fireproof_Babies

- Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Released at: https://ccmixter.org/files/killersweetheart/15747
- File: https://ccmixter.org/content/killersweetheart/killersweetheart_-_Robot_Girlfriend.mp3
- Our copy: `public/songs/robot-girlfriend.mp3`, 7.1 MB, sha256 `5da23febdb6b1197d31d9f5b941e2234d4601789a88b845390ad4908f41b88bb`
- Who made it: killersweetheart (producer, electro techno, 2008) with Fireproof_Babies (vocals, their own song "Robot Girlfriend", CC BY 3.0).
- How we know the licence: the ccMixter page says "Licensed under Creative Commons Attribution (3.0)"; the one sample it uses (Fireproof_Babies' own recording) is CC BY 3.0 (checked through ccMixter's API). The file's own tag has an unfilled template (`Licensed to the public under %license_url%`), so the page and the API are the evidence here.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Foolish Game (Levihica Remix), by Levihica feat. Snowflake

- Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Released at: https://ccmixter.org/files/Levihica/47591
- File: https://ccmixter.org/content/Levihica/Levihica_-_Foolish_Game_by_snowflake_(Levihica_Remix).mp3
- Our copy: `public/songs/foolish-game.mp3`, 14.3 MB, sha256 `54b34decaffd9a90b178d36bf96327179e1114e91fdd12140603ff9d04596814`
- Who made it: Levihica (producer, deep house remix, 2014) of Snowflake's song "A Foolish Game" (her vocals and lyrics, CC BY 3.0), which uses two guitar loops by Admiral Bob (CC BY 3.0).
- How we know the licence: the ccMixter page says "Licensed under Creative Commons Attribution (3.0)"; every upload in its sample chain is CC BY 3.0, each uploaded by its own maker (checked through ccMixter's API); the file's own tag says the same.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### On My Way, by Tomas PhUsIoN feat. Donnie Ozone

- Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Released at: https://ccmixter.org/files/phusion/63576
- File: https://ccmixter.org/content/phusion/phusion_-_on_my_way.mp3
- Our copy: `public/songs/on-my-way.mp3`, 13.5 MB, sha256 `fd5ebab2705791e19d22f4b1a2bb36a5c61cb603ba4c92a7991561e65294701c`
- Who made it: Tomas PhUsIoN (phusion on ccMixter, producer, 2021) with Donnie Ozone (vocals, his own a cappella "On My Way (Vocal)", CC BY 3.0).
- How we know the licence: the ccMixter page says "Licensed under Creative Commons Attribution (3.0)"; the one sample it uses (Donnie Ozone's vocal, uploaded by Donnie Ozone himself) is CC BY 3.0 (checked through ccMixter's API); the file's own tag says the same.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Airplane Mode, by Josh Woodward

- Licence: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Released at: https://www.joshwoodward.com/song/AirplaneMode
- File: https://www.joshwoodward.com/mp3/JoshWoodward-TheBeautifulMachine-11-AirplaneMode.mp3
- Our copy: `public/songs/airplane-mode.mp3`, 8.7 MB, sha256 `d61b7093cc1015202556f9855ddedc54d2bdb578442ce770b4ad26441024a9a0`
- Who made it: Josh Woodward, from the album *The Beautiful Machine* (2014), on his own site.
- How we know the licence: the song page says "This work is licensed under a Creative Commons Attribution 4.0 License", and his FAQ says all his original music is CC BY 4.0.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Hot Core, by Alex Beroza feat. Snowflake

- Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Released at: https://ccmixter.org/files/AlexBeroza/31990
- File: https://ccmixter.org/content/AlexBeroza/AlexBeroza_-_Hot_Core.mp3
- Our copy: `public/songs/hot-core.mp3`, 9.9 MB, sha256 `de7155ce8112d5724e0d231137c584921e56aed43d87a35ecfd3218008dadccc`
- Who made it: Alex Beroza (producer) with Snowflake (vocals, her own song "Hot Core (down below)"), on ccMixter, 2013. Snowflake's track samples gurdonark, spinningmerkaba, Abstract Audio, error404 and SackJo22, all CC BY 3.0.
- How we know the licence: the ccMixter page says "Licensed under Creative Commons Attribution (3.0)"; every upload in its sample chain is CC BY 3.0 (checked through ccMixter's API); the file's own tag says the same.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Perpetual Motion, by Jeris feat. Donnie Ozone

- Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Released at: https://ccmixter.org/files/VJ_Memes/42770
- File: https://ccmixter.org/content/VJ_Memes/VJ_Memes_-_Perpetual_Motion.mp3
- Our copy: `public/songs/perpetual-motion.mp3`, 6.0 MB, sha256 `16b10bec61f0ca8594384592bf145a2b25499c09d8f575043819f6360b60c87d`
- Who made it: Jeris (VJ_Memes on ccMixter, producer, 2013: funk with brass and clavinet) with Donnie Ozone (rap, his own a cappella "Perpetual Motion", CC BY 3.0).
- How we know the licence: the ccMixter page says "Licensed under Creative Commons Attribution (3.0)"; the one sample it uses (Donnie Ozone's a cappella, uploaded by him) is CC BY 3.0 (checked through ccMixter's API); the file's own tag says the same.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### The Weekend, by Alex Beroza feat. Donnie Ozone

- Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Released at: https://ccmixter.org/files/AlexBeroza/37551
- File: https://ccmixter.org/content/AlexBeroza/AlexBeroza_-_The_Weekend.mp3
- Our copy: `public/songs/the-weekend.mp3`, 9.4 MB, sha256 `e3d780561aadc5e59536c1c987e260936dc64780208290706a6ac2965454c78d`
- Who made it: Alex Beroza (producer) with Donnie Ozone (rap, his own a cappella "The Weekend", CC BY 3.0), on ccMixter, 2012.
- How we know the licence: the ccMixter page says "Licensed under Creative Commons Attribution (3.0)"; the one sample it uses (Donnie Ozone's a cappella) is CC BY 3.0, uploaded by Donnie Ozone himself (checked through ccMixter's API); the file's own tag says the same.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### We're All Going To Hell, by Hearse Pileup

- Licence: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- Released at: https://freemusicarchive.org/music/Hearse_Pileup/2020/were-all-going-to-hell/
- File: https://files.freemusicarchive.org/storage-freemusicarchive-org/tracks/Q5Uw4MG2epEqHOPp4j74UezA4nltxohMDOdkZO7y.mp3
- Our copy: `public/songs/all-going-to-hell.mp3`, 8.3 MB, sha256 `7962ae00ff1639368e855318585242d528d9280b6566aea470c9d0c01286f473`
- Who made it: Hearse Pileup, from the album *2020* (October 2020), uploaded by the band to their own Free Music Archive page.
- How we know the licence: the FMA track page says "We're All Going To Hell by Hearse Pileup is licensed under a Attribution-ShareAlike 4.0 International License", and the band's own Bandcamp page for the album shows the same CC BY-SA 4.0 licence.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Whiskey en el Hotel, by Whiskey Therapy

- Licence: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- Released at: https://www.jamendo.com/track/84605
- File: https://prod-1.storage.jamendo.com/download/track/84605/mp32/
- Our copy: `public/songs/whiskey-hotel.mp3`, 5.0 MB, sha256 `4a57ac4d1ffa06c8f387028f42fa2d1e6d260a7fa4f0fc15fe8ec1ec2dfb8320`
- Who made it: Whiskey Therapy, a rock band singing in Spanish, the title song of their album *Whiskey en el Hotel*, released by the band on their own Jamendo artist page.
- How we know the licence: the Jamendo track page shows the CC BY-SA licence icons, and Jamendo's file carries `copyright=http://creativecommons.org/licenses/by-sa/3.0/` in its tags. (The album also has a cover of "Fortunate Son", which we don't use: a band can't put someone else's song under CC.)
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Need You, by Marker Beacon

- Licence: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- Released at: https://www.jamendo.com/track/1041646
- File: https://prod-1.storage.jamendo.com/download/track/1041646/mp32/
- Our copy: `public/songs/need-you.mp3`, 6.4 MB, sha256 `7b3cb196e72a1f039b279d5390a63fb4c28423b2cd01e20755d1609b6168c543`
- Who made it: Marker Beacon, a French heavy metal band, from their album *Dead Frequencies* (2013), released by the band on their own Jamendo artist page and on their own site, markerbeacon.org, which gives the album away.
- How we know the licence: the Jamendo track page shows the CC BY-SA licence icons, Jamendo's file carries `copyright=http://creativecommons.org/licenses/by-sa/3.0/` in its tags, and the band's own site says "Our music is released under the terms of the Creative Commons BY-SA 3.0 (Attribution-ShareAlike)" (their Bandcamp page says CC BY-SA as well).
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Selfish, by SIYLIT

- Licence: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- Released at: https://www.jamendo.com/track/1158703
- File: https://prod-1.storage.jamendo.com/download/track/1158703/mp32/
- Our copy: `public/songs/selfish.mp3`, 6.1 MB, sha256 `3b48688fc36d871a43c14e1870f8248a9b98c740ccff7da968cd375182166862`
- Who made it: SIYLIT, a metal band from Verona, Italy, from their album *Unidentified Human Object* (2014), released by the band on their own Jamendo artist page.
- How we know the licence: the Jamendo track page shows the CC BY-SA licence icons, and Jamendo's file carries `copyright=http://creativecommons.org/licenses/by-sa/3.0/` in its tags.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Bully, by Josh Woodward

- Licence: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Released at: https://www.joshwoodward.com/song/Bully
- File: https://www.joshwoodward.com/mp3/JoshWoodward-Bully.mp3
- Our copy: `public/songs/bully.mp3`, 9.8 MB, sha256 `7e43bf6ae2d91d14dafee5f3553220facb895c8569422c102a21523085347c04`
- Who made it: Josh Woodward, from his album *The Shade from Our Trees*, on his own site.
- How we know the licence: his site's FAQ says "all of my original music is licensed as Creative Commons 4.0 Attribution", the song page names `https://creativecommons.org/licenses/by/4.0/` as its licence, and his own Bandcamp shows the same CC BY 4.0 for the album.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Revolution Now, by Josh Woodward

- Licence: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Released at: https://www.joshwoodward.com/song/RevolutionNow
- File: https://www.joshwoodward.com/mp3/TheSimpleLife/JoshWoodward-TheSimpleLife-105-RevolutionNow.mp3
- Our copy: `public/songs/revolution-now.mp3`, 5.4 MB, sha256 `39f8f87c1d55e173aac9bd41416b4f9b5c9339d7e0b7c417cfdecfbeb82d0ab2`
- Who made it: Josh Woodward, from his album *The Simple Life*, on his own site.
- How we know the licence: his site's FAQ says "all of my original music is licensed as Creative Commons 4.0 Attribution", and the song page names `https://creativecommons.org/licenses/by/4.0/` as its licence.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Allright, by The Black Rifles

- Licence: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- Released at: https://www.jamendo.com/track/987716
- File: https://prod-1.storage.jamendo.com/download/track/987716/mp32/
- Our copy: `public/songs/allright.mp3`, 6.6 MB, sha256 `8b476d295340299bbab07cb714fd91c43e91a37db7a28f8147cfac399ce3b629`
- Who made it: The Black Rifles, a stoner rock band from Ukraine, from their EP *Whiskey Lovers / Allright* (2012), released by the band on their own Jamendo artist page.
- How we know the licence: the Jamendo track page shows the CC BY-SA licence icons, and Jamendo's file carries `copyright=http://creativecommons.org/licenses/by-sa/3.0/` in its tags. (blackrifles.bandcamp.com is a different band from London.)
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Zero to Phantom, by Josh Woodward

- Licence: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Released at: https://www.joshwoodward.com/song/ZerotoPhantom
- File: https://www.joshwoodward.com/mp3/JoshWoodward-ZeroToPhantom.mp3
- Our copy: `public/songs/zero-to-phantom.mp3`, 6.2 MB, sha256 `2f701426d3fbcc4efa2f920ba6d33dbbc796c3e6510e2faeeb49e37545cce999`
- Who made it: Josh Woodward, a single on his own site.
- How we know the licence: his site's FAQ says "all of my original music is licensed as Creative Commons 4.0 Attribution", and the song page names `https://creativecommons.org/licenses/by/4.0/` as its licence.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Fast Food Fantasy, by Josh Woodward

- Licence: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Released at: https://www.joshwoodward.com/song/FastFoodFantasy
- File: https://www.joshwoodward.com/mp3/sunny/JoshWoodward-SunnySideOfTheStreet-10-FastFoodFantasy.mp3
- Our copy: `public/songs/fast-food-fantasy.mp3`, 5.3 MB, sha256 `fbe1992df61fda9699c7ada760cbe6596fb507248f1b803047aa497514db9a10`
- Who made it: Josh Woodward, from his album *Sunny Side of the Street*, on his own site.
- How we know the licence: his site's FAQ says "all of my original music is licensed as Creative Commons 4.0 Attribution", and the song page names `https://creativecommons.org/licenses/by/4.0/` as its licence.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Don't Go (RumbleStep Mix), by cdk feat. mykleanthony

- Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Released at: https://ccmixter.org/files/cdk/41292
- File: https://ccmixter.org/content/cdk/cdk_-_Don_t_Go_(RumbleStep_Mix).mp3
- Our copy: `public/songs/dont-go.mp3`, 10.1 MB, sha256 `a9542e5b1d94b66ddc84deb3e5c7d4cd33a18239adf39f6c6243fd1f93267a8b`
- Who made it: cdk (producer) with mykleanthony (vocals and lyrics, his own song "Don't Go", CC BY 3.0), which he wrote over Loveshadow's piano piece "A New May Day" (CC BY 3.0), itself made around Snowflake's "At the Root" (CC BY 3.0); on ccMixter, 2013.
- How we know the licence: the ccMixter page says "Licensed under Creative Commons Attribution (3.0)"; every upload in its remix chain is CC BY 3.0, each uploaded by the artist who made it (checked through ccMixter's API); the file's own tag says the same.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Where Did the Silence Start to Grow, by Jeris feat. SackJo22

- Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Released at: https://ccmixter.org/files/VJ_Memes/34781
- File: https://ccmixter.org/content/VJ_Memes/VJ_Memes_-_Where_Did_the_Silence_Start_to_Grow.mp3
- Our copy: `public/songs/silence-grow.mp3`, 5.3 MB, sha256 `c2e09f5694ffd62f59f522eec6df62f692caf47167cbe28e3a951f5289ac0da4`
- Who made it: Jeris (producer) with SackJo22 (vocals, her own a cappella, CC BY 3.0), on ccMixter, 2011.
- How we know the licence: the ccMixter page says "Licensed under Creative Commons Attribution (3.0)"; the one sample it uses (SackJo22's vocal) is CC BY 3.0, uploaded by SackJo22 herself (checked through ccMixter's API); the file's own tag says the same.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Light Me On Fire, by Zep Hurme feat. Admiral Bob

- Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Released at: https://ccmixter.org/files/zep_hurme/39887
- File: https://ccmixter.org/content/zep_hurme/zep_hurme_-_Light_Me_On_Fire.mp3
- Our copy: `public/songs/light-me-on-fire.mp3`, 8.7 MB, sha256 `c1c91687f3d2154f846d1056049c700ea307e550347fe7d45de77c9a48dbc0d7`
- Who made it: Zep Hurme (producer) with Admiral Bob (vocals, the a cappella of his own song, CC BY 3.0), on ccMixter, 2012.
- How we know the licence: the ccMixter page says "Licensed under Creative Commons Attribution (3.0)"; the one sample it uses (Admiral Bob's a cappella) is CC BY 3.0, uploaded by Admiral Bob himself (checked through ccMixter's API); the file's own tag says the same.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Let the Walls Come Down, by Stefan Kartenberg feat. Mr_Yesterday

- Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Released at: https://ccmixter.org/files/JeffSpeed68/66038
- File: https://ccmixter.org/content/JeffSpeed68/JeffSpeed68_-_Let_the_Walls_Come_Down.mp3
- Our copy: `public/songs/walls-come-down.mp3`, 9.3 MB, sha256 `0b6cedb28ae618bc898bc0bf2eecf65ca76dca7695df5ac7c2d8cf8cde7c85cd`
- Who made it: Stefan Kartenberg (producer, JeffSpeed68 on ccMixter) with Mr_Yesterday (his own song and vocals, CC BY 3.0), on ccMixter, 2023.
- How we know the licence: the ccMixter page says "Licensed under Creative Commons Attribution (3.0)"; the one sample it uses (Mr_Yesterday's song) is CC BY 3.0, uploaded by Mr_Yesterday himself (checked through ccMixter's API); the file's own tag says the same.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Panopticom, by Sever

- Licence: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- Released at: https://www.jamendo.com/track/311484
- File: https://prod-1.storage.jamendo.com/download/track/311484/mp32/
- Our copy: `public/songs/panopticom.mp3`, 6.6 MB, sha256 `adb4750f4a974df2e24ce5d7d6885fbb3df3283ccbf50e6155b5bae4f87bc910`
- Who made it: Sever, an alternative metal band from Mainz, Germany (on stage since 2000), from their album *Coma Circle* (2009), recorded at Zentralstudio Mainz and released by the band on their own Jamendo artist page.
- How we know the licence: the Jamendo track page shows the CC BY-SA licence icons, Jamendo's file carries `copyright=http://creativecommons.org/licenses/by-sa/2.0/de/` in its tags (the German 2.0 version of the same licence; the page shows 3.0), and the band's own site, sever-music.com (archived 2010 and 2013), links this album on Jamendo as its download.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Pests, by Organic Illusion

- Licence: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- Released at: https://www.jamendo.com/track/1167928
- File: https://prod-1.storage.jamendo.com/download/track/1167928/mp32/
- Our copy: `public/songs/pests.mp3`, 6.9 MB, sha256 `b47e204948f08350509fe6db6a7d4977344be4f24bd4fe7110c1e6fc86f0292b`
- Who made it: Organic Illusion, a groove metal band from Porto San Giorgio, Italy, from their EP *Deception* (2012), released by the band on their own Jamendo artist page (2014).
- How we know the licence: the Jamendo track page shows the CC BY-SA licence icons, and Jamendo's file carries `copyright=http://creativecommons.org/licenses/by-sa/3.0/` in its tags. The band also sells the EP in online stores ("(P) 2018 Organic Illusion", no other licence stated), so a video with it may get an automatic claim from their distributor.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Mirin Dajo, by Zoliborz

- Licence: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Released at: https://freemusicarchive.org/music/Zoliborz/Mirin_Dajo/01_Mirin_Dajo/
- File: https://files.freemusicarchive.org/storage-freemusicarchive-org/music/WFMU/Zoliborz/Mirin_Dajo/Zoliborz_-_01_-_Mirin_Dajo.mp3
- Our copy: `public/songs/mirin-dajo.mp3`, 13.8 MB, sha256 `32749a9dbed3543350f16183737b20f8c2297e60408b40678e65cd134d1c920c`
- Who made it: Zoliborz, a progressive metal project from St Petersburg, Russia: songs by Vitaly Mimoladov, vocals Gabriele Grilli, bass Steve Di Giorgio, drums Yanic Bercier; a single from 2016, on the Free Music Archive and the band's own Bandcamp.
- How we know the licence: the FMA page says it's licensed under CC BY 4.0, the file's own tag says `Attribution: http://creativecommons.org/licenses/by/4.0/`, and the band's own Bandcamp (zoliborz.bandcamp.com) shows the same CC BY 4.0 for the album and the track.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Hard Wired, Born Blind, by Stefan Kartenberg feat. Mr_Yesterday

- Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Released at: https://ccmixter.org/files/JeffSpeed68/56449
- File: https://ccmixter.org/content/JeffSpeed68/JeffSpeed68_-_Hard_Wired_Born_Blind.mp3
- Our copy: `public/songs/hard-wired.mp3`, 4.5 MB, sha256 `abf8bce5ce09a7ffe2eb7815dba9af11e8d1652e921fdf455e6b269afff733ee`
- Who made it: Stefan Kartenberg (producer, JeffSpeed68 on ccMixter) with Mr_Yesterday (his own song and vocals, CC BY 3.0), on ccMixter, 2017.
- How we know the licence: the ccMixter page says "Licensed under Creative Commons Attribution (3.0)"; the one sample it uses (Mr_Yesterday's song) is CC BY 3.0, uploaded by Mr_Yesterday himself (checked through ccMixter's API); the file's own tag says the same.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Liar, by Grimoff

- Licence: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- Released at: https://www.jamendo.com/track/992821
- File: https://prod-1.storage.jamendo.com/download/track/992821/mp32/
- Our copy: `public/songs/liar.mp3`, 8.5 MB, sha256 `8a34702791c11a5023ca254dc87370c905c013c0676f4a564805674e7738a49e`
- Who made it: Grimoff, a heavy metal band from Mykolaiv, Ukraine, from their album *Twisted Games* (2012), released on Jamendo, the album's only home (Encyclopaedia Metallum lists it as the band's own digital release).
- How we know the licence: the Jamendo track page shows the CC BY-SA licence icons, and Jamendo's file carries `copyright=http://creativecommons.org/licenses/by-sa/3.0/` in its tags. Nothing anywhere says otherwise; the Jamendo account names no site of its own, so we couldn't tie it to the band from outside.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Ready To Go, by Endtape

- Licence: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- Released at: https://www.jamendo.com/track/1101668
- File: https://prod-1.storage.jamendo.com/download/track/1101668/mp32/
- Our copy: `public/songs/ready-to-go.mp3`, 7.4 MB, sha256 `0f1953406dff1d5dc898fd0f1210677931302a99cd0afc070c02f5fbf9be403b`
- Who made it: Endtape, a rock band from Krasnoyarsk, Russia, the title song of their album *Ready To Go* (2013), released by the band on their own Jamendo artist page.
- In the app: the big demo's own song. Its parts and its hardest hits (where the band slams in, its two dead stops, the dips before the choruses, the drums dropping out and the fill into the last chorus) were measured beat by beat from its loudness, bass and cymbals, and the demo's lights hit there.
- How we know the licence: the Jamendo track page shows the CC BY-SA licence icons, and Jamendo's file carries `copyright=http://creativecommons.org/licenses/by-sa/3.0/` in its tags. We found no other release of it and nothing that says otherwise.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Summer Wind, by Antarhes

- Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Released at: https://www.jamendo.com/track/479306
- File: https://prod-1.storage.jamendo.com/download/track/479306/mp32/
- Our copy: `public/songs/summer-wind.mp3`, 5.0 MB, sha256 `51b0fc0f28db5aa0ea55ed6ef6236a094f94d498b7a2b27e8df6eed367808dac`
- Who made it: Antarhes, a hard rock band from Pau, France (2003-2008), from their album *Silaelin* (recorded 2006), released by the band on their own Jamendo artist page.
- How we know the licence: the Jamendo track page shows the CC BY licence icon, and Jamendo's file carries `copyright=http://creativecommons.org/licenses/by/3.0/` and `composer=Antarhes` in its tags. The band also sold the album through CD Baby ("(P) 2003 Antarhes" in the stores), so a video with it may get an automatic claim; no other licence is stated anywhere.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### I Saw You, by Predator

- Licence: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- Released at: https://www.jamendo.com/track/38568
- File: https://prod-1.storage.jamendo.com/download/track/38568/mp32/
- Our copy: `public/songs/i-saw-you.mp3`, 5.3 MB, sha256 `7245f3dbf47a139b899eb7f042402580ecdfc5421a26d00b669c9bab4e09ccaf`
- Who made it: Predator, a punk band from Sweden, from their album *In Monsters We Trust...* (2006), released by the band on their own Jamendo artist page.
- How we know the licence: the Jamendo track page shows the CC BY-SA licence icons, and Jamendo's file carries `copyright=http://creativecommons.org/licenses/by-sa/3.0/` in its tags. Some of the band's other albums are non-commercial, but none of those songs is on this one.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us. Beat trackers count it at 120; the band plays 180 (the parts come out in whole 24-, 12- and 8-bar blocks at 180).

### It's Never Enough, by Mudskills

- Licence: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- Released at: https://www.jamendo.com/track/580687
- File: https://prod-1.storage.jamendo.com/download/track/580687/mp32/
- Our copy: `public/songs/never-enough.mp3`, 5.7 MB, sha256 `89ce4a7a4a4b239b285e7e69fed8fda2e795ae2e3fa524f272c7ed22861069bd`
- Who made it: Mudskills, a grunge band from Sardinia, Italy (singer Eleonora Rocca), from their album *Mudskills* (2010), recorded at H-Studio in Capoterra and released by the band on their own Jamendo artist page.
- How we know the licence: the Jamendo track page shows the CC BY-SA licence icons, and Jamendo's file carries `copyright=http://creativecommons.org/licenses/by-sa/3.0/` in its tags. We found no other release of it and nothing that says otherwise.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us. Beat trackers count it at about 127; it is a half-time 95 (the drums line up within 20 ms at 95, not at 127).

### Leaving Babylon, by Zep Hurme feat. i_rebel

- Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Released at: https://ccmixter.org/files/zep_hurme/60052
- File: https://ccmixter.org/content/zep_hurme/zep_hurme_-_Leaving_Babylon.mp3
- Our copy: `public/songs/leaving-babylon.mp3`, 7.6 MB, sha256 `2a3da0d6fbf012511875366d7e610a6d554aff698418facccd56808e139205c2`
- Who made it: Zep Hurme (producer) with i_rebel (vocals and lyrics, his own a cappella, CC BY 3.0), on ccMixter, 2019.
- How we know the licence: the ccMixter page says "Licensed under Creative Commons Attribution (3.0)"; the one sample it uses (i_rebel's a cappella) is CC BY 3.0, uploaded by i_rebel himself (checked through ccMixter's API); the file's own tag says the same.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### More, more, more,..., by Reiswerk feat. i_rebel

- Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Released at: https://ccmixter.org/files/Reiswerk/50919
- File: https://ccmixter.org/content/Reiswerk/Reiswerk_-_More_more_more_...feat._i_rebel.mp3
- Our copy: `public/songs/more-more.mp3`, 7.2 MB, sha256 `f26954922e4d8c3af64d2a188a41a613870567f4031136e8f4a858197b3482a0`
- Who made it: Reiswerk (producer) with i_rebel (vocals, his own a cappella "more", CC BY 3.0), on ccMixter, 2015.
- How we know the licence: the ccMixter page says "Licensed under Creative Commons Attribution (3.0)"; the one sample it uses (i_rebel's a cappella) is CC BY 3.0, uploaded by i_rebel himself (checked through ccMixter's API); the file's own tag says the same.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Everybody On Your Block, by Lilly Wolf

- Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Released at: https://www.jamendo.com/track/1093615
- File: https://prod-1.storage.jamendo.com/download/track/1093615/mp32/
- Our copy: `public/songs/everybody-on-your-block.mp3`, 6.9 MB, sha256 `28e630f4f17cfbb8056405e321a2c70af8585837bca8ee8e433feeade191a80e`
- Who made it: Lilly Wolf, a synth-pop trio from Brooklyn, from their album *Play Loud* (2013), released by the band on their own Jamendo artist page and their own Bandcamp.
- How we know the licence: the Jamendo track page shows the CC BY licence icon, Jamendo's file carries `copyright=http://creativecommons.org/licenses/by/3.0/` in its tags, and the band's own Bandcamp shows *Play Loud* under CC BY 4.0. Their later releases are all rights reserved, but those are other songs. The song also turns up in stores under a label and on stock-music sites, so a video with it may get an automatic claim. Jamendo's file for this one doesn't let web pages fetch it, so the app plays our copy.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### I Won't Fall In Love, by Jens East feat. MaryLinn

- Licence: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Released at: https://freemusicarchive.org/music/Jens_East_ft_Henk/I_Wont_Fall_In_Love_1068/Jens_East_-_I_Wont_Fall_In_Love_feat_MaryLinn_master_24bit_1625/
- File: https://files.freemusicarchive.org/storage-freemusicarchive-org/music/ccCommunity/Jens_East/I_Wont_Fall_In_Love/Jens_East_-_01_-_I_Wont_Fall_In_Love_feat_MaryLinn.mp3
- Our copy: `public/songs/wont-fall-in-love.mp3`, 7.2 MB, sha256 `b0deca44616674062b5b77ffe2fd00a3359b6701ade1708d88ce1718f01fbc28`
- Who made it: Jens East (Jens Oosterkamp, songwriting and production) with MaryLinn (vocals), a single on his own Free Music Archive artist page.
- How we know the licence: the FMA page says it's licensed under CC BY 4.0, and the file's own tag says `Attribution: http://creativecommons.org/licenses/by/4.0/`. We found no other licence for it anywhere.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### Rescue Me, by L4M feat. Kaer Trouz

- Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Released at: https://ccmixter.org/files/L4M/19218
- File: https://ccmixter.org/content/L4M/L4M_-_Rescue_Me.mp3
- Our copy: `public/songs/rescue-me.mp3`, 6.6 MB, sha256 `65a6d4aff648fbd53014a8abfdad6a23421e7638c7ab22aeda65406875975070`
- Who made it: L4M (producer) with Kaer Trouz (vocals, her own a cappella, CC BY 3.0), on ccMixter, 2009.
- How we know the licence: the ccMixter page says "Licensed under Creative Commons Attribution (3.0)"; the one sample it uses (Kaer Trouz's a cappella) is CC BY 3.0, uploaded by Kaer Trouz herself (checked through ccMixter's API); the file's own tag says the same.
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.

### El Cha Cha Man, by Juanitos

- Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Released at: https://www.jamendo.com/track/37754
- File: https://prod-1.storage.jamendo.com/download/track/37754/mp32/
- Our copy: `public/songs/cha-cha-man.mp3`, 5.5 MB, sha256 `753a4a3838797b17ed546b5f4c27877e5a39e57696d20f6dd2c77680af6f491f`
- Who made it: Juanitos, a 60s-style latin, soul and exotica band from Chambéry, France, from their album *Exotica* (2001), released by the band on their own Jamendo artist page (and on the Free Music Archive).
- How we know the licence: the Jamendo track page shows the CC BY licence icon, and both Jamendo's file and the FMA copy carry `copyright=http://creativecommons.org/licenses/by/2.0/fr/` (the French 2.0 version of the same licence; the Jamendo page shows 3.0).
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us. Played by a live band close to a steady 136 (136.0 to 136.2 per half minute), so the parts sit on the beats we tracked.

### Sambarama, by Juanitos

- Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)
- Released at: https://www.jamendo.com/track/37756
- File: https://prod-1.storage.jamendo.com/download/track/37756/mp32/
- Our copy: `public/songs/sambarama.mp3`, 6.9 MB, sha256 `8c45357a4dd2b4007a59ec690ba42b822baeb44978d1a2d1f22fa782be2099d6`
- Who made it: Juanitos, a 60s-style latin, soul and exotica band from Chambéry, France, from their album *Exotica* (2001), released by the band on their own Jamendo artist page.
- How we know the licence: the Jamendo track page shows the CC BY licence icon, and Jamendo's file carries `copyright=http://creativecommons.org/licenses/by/2.0/fr/` (the French 2.0 version of the same licence; the page shows 3.0).
- What we changed: nothing in the audio. The tempo, first downbeat and parts in the app were measured by us.
