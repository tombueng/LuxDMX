// Real songs with vocals that come with the app, released by their artists under Creative Commons
// licences that let us pass them on. The credits and the evidence are in SONGS.md. The player
// tries `url` (the artist's own upload) first, then `mirror` (our copy in public/songs/).
// bpm, offset (the first downbeat), duration and the sections were measured from the audio.

export type CatalogGenre = 'rocknroll' | 'techno' | 'house' | 'pop' | 'hiphop' | 'rock'
  | 'metal' | 'hardrock' | 'alternative' | 'dnb' | 'funk' | 'electro' | 'reggae' | 'latin';
export type CatalogLicense = 'CC0' | 'CC BY' | 'CC BY-SA' | 'CC BY-NC' | 'CC BY-NC-SA';

// a part of the song: where it starts (seconds, on a bar line) and how hard it hits (0..1, its
// loudness against the loud part of the song). Names: Intro, Verse, Pre-chorus, Chorus, Build,
// Drop, Break, Bridge, Solo, Instrumental, Outro; "Chorus 2" and so on when one comes back.
export interface CatalogSection { name: string; at: number; energy: number }
// where the band hits hardest (seconds, on the beat), for a show that wants its lights to hit there
// too: `slam` everything comes in at once after something quieter, `stop` the band stops dead (a
// bar or so), `dip` it drops back for a beat or two before a slam, `drums` the drums come (back)
// in, `fill` a drum fill into a slam, `end` the last chord.
export type CatalogHitKind = 'slam' | 'stop' | 'dip' | 'drums' | 'fill' | 'end';
export interface CatalogHit { at: number; kind: CatalogHitKind }

export interface CatalogSong {
  id: string;
  title: string;
  artist: string;
  genre: CatalogGenre;
  vocals: true;
  license: CatalogLicense;
  licenseUrl: string;      // the licence deed
  page: string;            // where the artist released it
  url: string;             // the artist's own file
  mirror: string;          // our copy, relative to the app ('songs/<id>.mp3')
  sha256: string;          // of the artist's file (our copy is the same bytes; scripts/fetch-songs.mjs checks it)
  bpm: number;
  offset: number;          // seconds to the first downbeat
  duration: number;        // seconds
  sections: CatalogSection[];
  hits?: CatalogHit[];     // measured by hand from the audio (not every song has them)
}

export const GENRES: Record<CatalogGenre, string> = {
  rocknroll: "Rock'n'roll",
  techno: 'Techno',
  house: 'House',
  pop: 'Pop',
  hiphop: 'Hip-hop',
  rock: 'Rock / punk',
  metal: 'Metal',
  hardrock: 'Hard rock',
  alternative: 'Alternative',
  dnb: 'Drum & bass',
  funk: 'Funk',
  electro: 'Electro',
  reggae: 'Reggae',
  latin: 'Latin',
};

export const CATALOG: CatalogSong[] = [
  {
    id: 'ragazzi-retro', title: 'Ragazzi retrò', artist: 'Gli Shakers', genre: 'rocknroll', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    page: 'https://www.jamendo.com/track/1027314',
    url: 'https://prod-1.storage.jamendo.com/download/track/1027314/mp32/',
    mirror: 'songs/ragazzi-retro.mp3',
    sha256: '5c7e74e5a3f3239cd3d3c618a1554e7af9a5502621f195eb66a6f699e58ba924', bpm: 155.8, offset: 1.765, duration: 190.46,
    sections: [{ name: 'Intro', at: 0, energy: 0.71 }, { name: 'Verse', at: 14.09, energy: 0.84 }, { name: 'Chorus', at: 27.95, energy: 0.9 }, { name: 'Verse 2', at: 41.82, energy: 0.73 }, { name: 'Instrumental', at: 58.76, energy: 0.71 }, { name: 'Verse 3', at: 72.63, energy: 0.85 }, { name: 'Chorus 2', at: 86.49, energy: 0.91 }, { name: 'Verse 4', at: 101.89, energy: 0.75 }, { name: 'Solo', at: 118.45, energy: 0.97 }, { name: 'Build', at: 144.26, energy: 0.66 }, { name: 'Chorus 3', at: 161.59, energy: 0.88 }, { name: 'Outro', at: 187.39, energy: 0.44 }],
  },
  {
    id: 'miss-muffin', title: 'Miss Muffin', artist: 'Back Door Men', genre: 'rocknroll', vocals: true,
    license: 'CC BY-SA', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    page: 'https://www.jamendo.com/track/784445',
    url: 'https://prod-1.storage.jamendo.com/download/track/784445/mp32/',
    mirror: 'songs/miss-muffin.mp3',
    sha256: 'da0f3fb84271b07c02b8d3ace0d8b7fc05797cc6ee1ad3212089f5b073d8ebd5', bpm: 200, offset: 0.078, duration: 211.5,
    sections: [{ name: 'Intro', at: 0, energy: 0.33 }, { name: 'Verse', at: 8.48, energy: 0.77 }, { name: 'Verse 2', at: 32.48, energy: 0.76 }, { name: 'Chorus', at: 57.68, energy: 0.79 }, { name: 'Verse 3', at: 74.48, energy: 0.82 }, { name: 'Verse 4', at: 99.68, energy: 0.81 }, { name: 'Chorus 2', at: 124.88, energy: 0.79 }, { name: 'Solo', at: 144.09, energy: 0.76 }, { name: 'Chorus 3', at: 163.29, energy: 0.84 }, { name: 'Outro', at: 182.49, energy: 0.57 }],
  },
  {
    id: 'robot-girlfriend', title: 'Robot Girlfriend', artist: 'killersweetheart feat. Fireproof_Babies', genre: 'techno', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    page: 'https://ccmixter.org/files/killersweetheart/15747',
    url: 'https://ccmixter.org/content/killersweetheart/killersweetheart_-_Robot_Girlfriend.mp3',
    mirror: 'songs/robot-girlfriend.mp3',
    sha256: '5da23febdb6b1197d31d9f5b941e2234d4601789a88b845390ad4908f41b88bb', bpm: 126, offset: 0.521, duration: 354.35,
    sections: [{ name: 'Intro', at: 0, energy: 0.45 }, { name: 'Build', at: 15.76, energy: 0.68 }, { name: 'Verse', at: 31, energy: 0.77 }, { name: 'Verse 2', at: 80.52, energy: 0.78 }, { name: 'Break', at: 120.52, energy: 0.39 }, { name: 'Drop', at: 152.9, energy: 0.75 }, { name: 'Verse 3', at: 181.47, energy: 0.76 }, { name: 'Instrumental', at: 236.71, energy: 0.76 }, { name: 'Outro', at: 305.28, energy: 0.39 }],
  },
  {
    id: 'in-peace', title: 'In Peace', artist: 'phasenwandler feat. Snowflake', genre: 'techno', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    page: 'https://ccmixter.org/files/phasenwandler/33726',
    url: 'https://ccmixter.org/content/phasenwandler/phasenwandler_-_In_Peace.mp3',
    mirror: 'songs/in-peace.mp3',
    sha256: 'b233187568ce2b12e1846844bb6a685c2e8f16573625c870a8ca56e295f91445', bpm: 135, offset: 0.583, duration: 300.51,
    sections: [{ name: 'Intro', at: 0, energy: 0.51 }, { name: 'Instrumental', at: 18.36, energy: 0.8 }, { name: 'Verse', at: 46.81, energy: 0.88 }, { name: 'Break', at: 91.25, energy: 0.56 }, { name: 'Build', at: 116.14, energy: 0.78 }, { name: 'Drop', at: 133.92, energy: 0.83 }, { name: 'Drop 2', at: 169.47, energy: 0.88 }, { name: 'Chorus', at: 212.14, energy: 0.93 }, { name: 'Outro', at: 261.92, energy: 0.68 }],
  },
  {
    id: 'on-my-way', title: 'On My Way', artist: 'Tomas PhUsIoN feat. Donnie Ozone', genre: 'house', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    page: 'https://ccmixter.org/files/phusion/63576',
    url: 'https://ccmixter.org/content/phusion/phusion_-_on_my_way.mp3',
    mirror: 'songs/on-my-way.mp3',
    sha256: 'fd5ebab2705791e19d22f4b1a2bb36a5c61cb603ba4c92a7991561e65294701c', bpm: 125, offset: 1.005, duration: 337.97,
    sections: [{ name: 'Intro', at: 0, energy: 0.74 }, { name: 'Verse', at: 47.09, energy: 0.73 }, { name: 'Chorus', at: 62.45, energy: 0.88 }, { name: 'Drop', at: 77.8, energy: 0.89 }, { name: 'Verse 2', at: 108.52, energy: 0.84 }, { name: 'Drop 2', at: 139.25, energy: 0.88 }, { name: 'Break', at: 169.96, energy: 0.42 }, { name: 'Build', at: 185.32, energy: 0.78 }, { name: 'Drop 3', at: 200.69, energy: 0.88 }, { name: 'Outro', at: 262.12, energy: 0.54 }],
  },
  {
    id: 'foolish-game', title: 'Foolish Game (Levihica Remix)', artist: 'Levihica feat. Snowflake', genre: 'house', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    page: 'https://ccmixter.org/files/Levihica/47591',
    url: 'https://ccmixter.org/content/Levihica/Levihica_-_Foolish_Game_by_snowflake_(Levihica_Remix).mp3',
    mirror: 'songs/foolish-game.mp3',
    sha256: '54b34decaffd9a90b178d36bf96327179e1114e91fdd12140603ff9d04596814', bpm: 126, offset: 0.962, duration: 358.11,
    sections: [{ name: 'Intro', at: 0, energy: 0.6 }, { name: 'Break', at: 23.82, energy: 0.41 }, { name: 'Chorus', at: 31.44, energy: 0.83 }, { name: 'Verse', at: 54.3, energy: 0.92 }, { name: 'Verse 2', at: 75.25, energy: 0.92 }, { name: 'Break 2', at: 107.63, energy: 0.39 }, { name: 'Drop', at: 138.1, energy: 0.91 }, { name: 'Chorus 2', at: 174.3, energy: 0.88 }, { name: 'Break 3', at: 200.96, energy: 0.59 }, { name: 'Build', at: 214.3, energy: 0.64 }, { name: 'Drop 2', at: 229.53, energy: 0.89 }, { name: 'Instrumental', at: 290.49, energy: 0.81 }, { name: 'Outro', at: 311.44, energy: 0.5 }],
  },
  {
    id: 'hot-core', title: 'Hot Core', artist: 'Alex Beroza feat. Snowflake', genre: 'pop', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    page: 'https://ccmixter.org/files/AlexBeroza/31990',
    url: 'https://ccmixter.org/content/AlexBeroza/AlexBeroza_-_Hot_Core.mp3',
    mirror: 'songs/hot-core.mp3',
    sha256: 'de7155ce8112d5724e0d231137c584921e56aed43d87a35ecfd3218008dadccc', bpm: 135, offset: 1.162, duration: 247.17,
    sections: [{ name: 'Intro', at: 0, energy: 0.4 }, { name: 'Verse', at: 13.61, energy: 0.77 }, { name: 'Chorus', at: 42.05, energy: 0.76 }, { name: 'Instrumental', at: 56.27, energy: 0.79 }, { name: 'Verse 2', at: 70.5, energy: 0.77 }, { name: 'Chorus 2', at: 98.94, energy: 0.76 }, { name: 'Instrumental 2', at: 113.16, energy: 0.79 }, { name: 'Verse 3', at: 127.38, energy: 0.79 }, { name: 'Chorus 3', at: 155.83, energy: 0.78 }, { name: 'Bridge', at: 184.27, energy: 0.79 }, { name: 'Chorus 4', at: 198.5, energy: 0.78 }, { name: 'Outro', at: 237.61, energy: 0.27 }],
  },
  {
    id: 'airplane-mode', title: 'Airplane Mode', artist: 'Josh Woodward', genre: 'pop', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    page: 'https://www.joshwoodward.com/song/AirplaneMode',
    url: 'https://www.joshwoodward.com/mp3/JoshWoodward-TheBeautifulMachine-11-AirplaneMode.mp3',
    mirror: 'songs/airplane-mode.mp3',
    sha256: 'd61b7093cc1015202556f9855ddedc54d2bdb578442ce770b4ad26441024a9a0', bpm: 179, offset: 0.129, duration: 216.84,
    sections: [{ name: 'Verse', at: 0, energy: 0.62 }, { name: 'Chorus', at: 47.06, energy: 0.87 }, { name: 'Verse 2', at: 71.19, energy: 0.71 }, { name: 'Pre-chorus', at: 114.1, energy: 0.71 }, { name: 'Chorus 2', at: 119.46, energy: 0.89 }, { name: 'Bridge', at: 140.91, energy: 0.57 }, { name: 'Break', at: 167.73, energy: 0.28 }, { name: 'Chorus 3', at: 190.52, energy: 0.91 }, { name: 'Outro', at: 211.97, energy: 0.43 }],
  },
  {
    id: 'the-weekend', title: 'The Weekend', artist: 'Alex Beroza feat. Donnie Ozone', genre: 'hiphop', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    page: 'https://ccmixter.org/files/AlexBeroza/37551',
    url: 'https://ccmixter.org/content/AlexBeroza/AlexBeroza_-_The_Weekend.mp3',
    mirror: 'songs/the-weekend.mp3',
    sha256: 'e3d780561aadc5e59536c1c987e260936dc64780208290706a6ac2965454c78d', bpm: 130, offset: 0.053, duration: 234.61,
    sections: [{ name: 'Intro', at: 0, energy: 0.37 }, { name: 'Verse', at: 14.82, energy: 0.8 }, { name: 'Chorus', at: 44.36, energy: 0.94 }, { name: 'Verse 2', at: 59.13, energy: 0.91 }, { name: 'Break', at: 73.9, energy: 0.47 }, { name: 'Verse 3', at: 96.05, energy: 0.84 }, { name: 'Chorus 2', at: 125.59, energy: 0.94 }, { name: 'Verse 4', at: 140.36, energy: 0.92 }, { name: 'Break 2', at: 155.13, energy: 0.62 }, { name: 'Chorus 3', at: 169.9, energy: 0.94 }, { name: 'Bridge', at: 184.67, energy: 0.91 }, { name: 'Break 3', at: 199.44, energy: 0.61 }, { name: 'Chorus 4', at: 214.21, energy: 0.95 }, { name: 'Outro', at: 228.98, energy: 0.21 }],
  },
  {
    id: 'perpetual-motion', title: 'Perpetual Motion', artist: 'Jeris feat. Donnie Ozone', genre: 'hiphop', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    page: 'https://ccmixter.org/files/VJ_Memes/42770',
    url: 'https://ccmixter.org/content/VJ_Memes/VJ_Memes_-_Perpetual_Motion.mp3',
    mirror: 'songs/perpetual-motion.mp3',
    sha256: '16b10bec61f0ca8594384592bf145a2b25499c09d8f575043819f6360b60c87d', bpm: 105, offset: 2.304, duration: 187.45,
    sections: [{ name: 'Chorus', at: 0, energy: 0.77 }, { name: 'Verse', at: 18.3, energy: 0.83 }, { name: 'Chorus 2', at: 57.16, energy: 0.84 }, { name: 'Verse 2', at: 73.16, energy: 0.74 }, { name: 'Instrumental', at: 98.3, energy: 0.81 }, { name: 'Verse 3', at: 134.88, energy: 0.89 }, { name: 'Chorus 3', at: 148.59, energy: 0.82 }, { name: 'Outro', at: 182.88, energy: 0.36 }],
  },
  {
    id: 'all-going-to-hell', title: 'We\'re All Going To Hell', artist: 'Hearse Pileup', genre: 'rock', vocals: true,
    license: 'CC BY-SA', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    page: 'https://freemusicarchive.org/music/Hearse_Pileup/2020/were-all-going-to-hell/',
    url: 'https://files.freemusicarchive.org/storage-freemusicarchive-org/tracks/Q5Uw4MG2epEqHOPp4j74UezA4nltxohMDOdkZO7y.mp3',
    mirror: 'songs/all-going-to-hell.mp3',
    sha256: '7962ae00ff1639368e855318585242d528d9280b6566aea470c9d0c01286f473', bpm: 180, offset: 1.076, duration: 204.5,
    sections: [{ name: 'Intro', at: 0, energy: 0.43 }, { name: 'Chorus', at: 11.74, energy: 0.87 }, { name: 'Instrumental', at: 22.41, energy: 0.92 }, { name: 'Verse', at: 33.08, energy: 0.92 }, { name: 'Chorus 2', at: 54.41, energy: 0.93 }, { name: 'Instrumental 2', at: 75.75, energy: 0.9 }, { name: 'Verse 2', at: 86.41, energy: 0.92 }, { name: 'Chorus 3', at: 107.75, energy: 0.92 }, { name: 'Solo', at: 129.08, energy: 0.94 }, { name: 'Chorus 4', at: 161.08, energy: 0.94 }, { name: 'Outro', at: 182.42, energy: 0.89 }],
  },
  {
    id: 'whiskey-hotel', title: 'Whiskey en el Hotel', artist: 'Whiskey Therapy', genre: 'rock', vocals: true,
    license: 'CC BY-SA', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    page: 'https://www.jamendo.com/track/84605',
    url: 'https://prod-1.storage.jamendo.com/download/track/84605/mp32/',
    mirror: 'songs/whiskey-hotel.mp3',
    sha256: '4a57ac4d1ffa06c8f387028f42fa2d1e6d260a7fa4f0fc15fe8ec1ec2dfb8320', bpm: 126, offset: 0.982, duration: 200.14,
    sections: [{ name: 'Intro', at: 0, energy: 0.56 }, { name: 'Verse', at: 16.22, energy: 0.8 }, { name: 'Instrumental', at: 42.88, energy: 0.78 }, { name: 'Verse 2', at: 54.31, energy: 0.79 }, { name: 'Chorus', at: 77.17, energy: 0.87 }, { name: 'Solo', at: 92.4, energy: 0.71 }, { name: 'Verse 3', at: 138.11, energy: 0.79 }, { name: 'Chorus 2', at: 153.35, energy: 0.88 }, { name: 'Outro', at: 176.21, energy: 0.61 }],
  },
  // Metal, hard rock, alternative, drum & bass and funk. All of them play to a click (one steady
  // tempo); where the kick plays on every beat (metal, funk) the first downbeat was taken from
  // where the band and the singer come in, not from the kick.
  {
    id: 'need-you', title: 'Need You', artist: 'Marker Beacon', genre: 'metal', vocals: true,
    license: 'CC BY-SA', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    page: 'https://www.jamendo.com/track/1041646',
    url: 'https://prod-1.storage.jamendo.com/download/track/1041646/mp32/',
    mirror: 'songs/need-you.mp3',
    sha256: '7b3cb196e72a1f039b279d5390a63fb4c28423b2cd01e20755d1609b6168c543', bpm: 120, offset: 0.156, duration: 228.19,
    sections: [{ name: 'Intro', at: 0, energy: 0.69 }, { name: 'Verse', at: 24.16, energy: 0.85 }, { name: 'Chorus', at: 56.16, energy: 0.8 }, { name: 'Instrumental', at: 78.16, energy: 0.77 }, { name: 'Verse 2', at: 92.16, energy: 0.85 }, { name: 'Chorus 2', at: 124.16, energy: 0.81 }, { name: 'Bridge', at: 146.16, energy: 0.76 }, { name: 'Solo', at: 160.16, energy: 0.97 }, { name: 'Instrumental 2', at: 192.16, energy: 0.82 }, { name: 'Outro', at: 210.16, energy: 0.65 }],
  },
  {
    id: 'selfish', title: 'Selfish', artist: 'SIYLIT', genre: 'metal', vocals: true,
    license: 'CC BY-SA', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    page: 'https://www.jamendo.com/track/1158703',
    url: 'https://prod-1.storage.jamendo.com/download/track/1158703/mp32/',
    mirror: 'songs/selfish.mp3',
    sha256: '3b48688fc36d871a43c14e1870f8248a9b98c740ccff7da968cd375182166862', bpm: 150, offset: 1.408, duration: 221.97,
    sections: [{ name: 'Intro', at: 0, energy: 0.21 }, { name: 'Instrumental', at: 6.21, energy: 0.69 }, { name: 'Verse', at: 30.21, energy: 0.8 }, { name: 'Chorus', at: 57.41, energy: 0.85 }, { name: 'Verse 2', at: 83.01, energy: 0.81 }, { name: 'Chorus 2', at: 110.21, energy: 0.86 }, { name: 'Instrumental 2', at: 134.21, energy: 0.8 }, { name: 'Bridge', at: 148.61, energy: 0.97 }, { name: 'Chorus 3', at: 164.61, energy: 0.86 }, { name: 'Outro', at: 191.81, energy: 0.63 }],
  },
  {
    id: 'bully', title: 'Bully', artist: 'Josh Woodward', genre: 'hardrock', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    page: 'https://www.joshwoodward.com/song/Bully',
    url: 'https://www.joshwoodward.com/mp3/JoshWoodward-Bully.mp3',
    mirror: 'songs/bully.mp3',
    sha256: '7e43bf6ae2d91d14dafee5f3553220facb895c8569422c102a21523085347c04', bpm: 150, offset: 0.017, duration: 244.66,
    sections: [{ name: 'Intro', at: 0, energy: 0.45 }, { name: 'Verse', at: 12.82, energy: 0.69 }, { name: 'Verse 2', at: 41.62, energy: 0.71 }, { name: 'Pre-chorus', at: 67.22, energy: 0.66 }, { name: 'Chorus', at: 75.22, energy: 0.73 }, { name: 'Instrumental', at: 89.62, energy: 0.59 }, { name: 'Verse 3', at: 96.02, energy: 0.76 }, { name: 'Pre-chorus 2', at: 118.42, energy: 0.73 }, { name: 'Chorus 2', at: 128.02, energy: 0.79 }, { name: 'Bridge', at: 147.22, energy: 0.88 }, { name: 'Break', at: 177.62, energy: 0.57 }, { name: 'Chorus 3', at: 192.02, energy: 0.74 }, { name: 'Chorus 4', at: 204.82, energy: 0.91 }, { name: 'Outro', at: 227.22, energy: 0.34 }],
  },
  {
    id: 'revolution-now', title: 'Revolution Now', artist: 'Josh Woodward', genre: 'hardrock', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    page: 'https://www.joshwoodward.com/song/RevolutionNow',
    url: 'https://www.joshwoodward.com/mp3/TheSimpleLife/JoshWoodward-TheSimpleLife-105-RevolutionNow.mp3',
    mirror: 'songs/revolution-now.mp3',
    sha256: '39f8f87c1d55e173aac9bd41416b4f9b5c9339d7e0b7c417cfdecfbeb82d0ab2', bpm: 130, offset: 0.058, duration: 233.72,
    sections: [{ name: 'Intro', at: 0, energy: 0.24 }, { name: 'Instrumental', at: 5.6, energy: 0.48 }, { name: 'Build', at: 14.83, energy: 0.76 }, { name: 'Verse', at: 22.21, energy: 0.72 }, { name: 'Pre-chorus', at: 48.06, energy: 0.76 }, { name: 'Chorus', at: 59.13, energy: 0.84 }, { name: 'Verse 2', at: 96.06, energy: 0.73 }, { name: 'Pre-chorus 2', at: 127.44, energy: 0.74 }, { name: 'Chorus 2', at: 138.52, energy: 0.88 }, { name: 'Break', at: 173.6, energy: 0.3 }, { name: 'Build 2', at: 188.37, energy: 0.76 }, { name: 'Chorus 3', at: 208.67, energy: 0.98 }, { name: 'Outro', at: 225.29, energy: 0.25 }],
  },
  {
    id: 'allright', title: 'Allright', artist: 'The Black Rifles', genre: 'hardrock', vocals: true,
    license: 'CC BY-SA', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    page: 'https://www.jamendo.com/track/987716',
    url: 'https://prod-1.storage.jamendo.com/download/track/987716/mp32/',
    mirror: 'songs/allright.mp3',
    sha256: '8b476d295340299bbab07cb714fd91c43e91a37db7a28f8147cfac399ce3b629', bpm: 130, offset: 0.173, duration: 246.06,
    sections: [{ name: 'Intro', at: 0, energy: 0.83 }, { name: 'Verse', at: 59.25, energy: 0.81 }, { name: 'Chorus', at: 72.17, energy: 0.9 }, { name: 'Instrumental', at: 94.32, energy: 0.87 }, { name: 'Verse 2', at: 110.93, energy: 0.83 }, { name: 'Chorus 2', at: 123.86, energy: 0.89 }, { name: 'Instrumental 2', at: 146.01, energy: 0.88 }, { name: 'Bridge', at: 155.24, energy: 0.89 }, { name: 'Instrumental 3', at: 179.24, energy: 0.86 }, { name: 'Outro', at: 221.69, energy: 0.66 }],
  },
  {
    id: 'zero-to-phantom', title: 'Zero to Phantom', artist: 'Josh Woodward', genre: 'alternative', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    page: 'https://www.joshwoodward.com/song/ZerotoPhantom',
    url: 'https://www.joshwoodward.com/mp3/JoshWoodward-ZeroToPhantom.mp3',
    mirror: 'songs/zero-to-phantom.mp3',
    sha256: '2f701426d3fbcc4efa2f920ba6d33dbbc796c3e6510e2faeeb49e37545cce999', bpm: 120, offset: 0.016, duration: 242.45,
    sections: [{ name: 'Intro', at: 0, energy: 0.16 }, { name: 'Verse', at: 8.02, energy: 0.5 }, { name: 'Chorus', at: 46.02, energy: 0.88 }, { name: 'Instrumental', at: 76.02, energy: 0.65 }, { name: 'Chorus 2', at: 98.02, energy: 0.88 }, { name: 'Break', at: 128.02, energy: 0.71 }, { name: 'Chorus 3', at: 134.02, energy: 0.92 }, { name: 'Instrumental 2', at: 152.02, energy: 0.61 }, { name: 'Outro', at: 190.02, energy: 0.47 }],
  },
  {
    id: 'fast-food-fantasy', title: 'Fast Food Fantasy', artist: 'Josh Woodward', genre: 'alternative', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    page: 'https://www.joshwoodward.com/song/FastFoodFantasy',
    url: 'https://www.joshwoodward.com/mp3/sunny/JoshWoodward-SunnySideOfTheStreet-10-FastFoodFantasy.mp3',
    mirror: 'songs/fast-food-fantasy.mp3',
    sha256: 'fbe1992df61fda9699c7ada760cbe6596fb507248f1b803047aa497514db9a10', bpm: 160, offset: 1.387, duration: 223.13,
    sections: [{ name: 'Intro', at: 0, energy: 0.75 }, { name: 'Verse', at: 13.39, energy: 0.66 }, { name: 'Chorus', at: 37.39, energy: 0.82 }, { name: 'Instrumental', at: 59.89, energy: 0.76 }, { name: 'Verse 2', at: 73.39, energy: 0.67 }, { name: 'Chorus 2', at: 95.89, energy: 0.82 }, { name: 'Instrumental 2', at: 119.89, energy: 0.79 }, { name: 'Bridge', at: 143.89, energy: 0.64 }, { name: 'Chorus 3', at: 167.89, energy: 0.87 }, { name: 'Outro', at: 203.89, energy: 0.66 }],
  },
  {
    id: 'dont-go', title: 'Don\'t Go (RumbleStep Mix)', artist: 'cdk feat. mykleanthony', genre: 'dnb', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    page: 'https://ccmixter.org/files/cdk/41292',
    url: 'https://ccmixter.org/content/cdk/cdk_-_Don_t_Go_(RumbleStep_Mix).mp3',
    mirror: 'songs/dont-go.mp3',
    sha256: 'a9542e5b1d94b66ddc84deb3e5c7d4cd33a18239adf39f6c6243fd1f93267a8b', bpm: 170, offset: 0.239, duration: 251.35,
    sections: [{ name: 'Intro', at: 0, energy: 0.32 }, { name: 'Drop', at: 11.53, energy: 0.73 }, { name: 'Verse', at: 39.77, energy: 0.9 }, { name: 'Chorus', at: 66.59, energy: 0.89 }, { name: 'Drop 2', at: 90.59, energy: 0.78 }, { name: 'Bridge', at: 111.77, energy: 0.81 }, { name: 'Chorus 2', at: 135.77, energy: 0.96 }, { name: 'Break', at: 141.42, energy: 0.6 }, { name: 'Chorus 3', at: 147.06, energy: 0.87 }, { name: 'Drop 3', at: 180.94, energy: 0.8 }, { name: 'Outro', at: 226.12, energy: 0.1 }],
  },
  {
    id: 'silence-grow', title: 'Where Did the Silence Start to Grow', artist: 'Jeris feat. SackJo22', genre: 'dnb', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    page: 'https://ccmixter.org/files/VJ_Memes/34781',
    url: 'https://ccmixter.org/content/VJ_Memes/VJ_Memes_-_Where_Did_the_Silence_Start_to_Grow.mp3',
    mirror: 'songs/silence-grow.mp3',
    sha256: 'c2e09f5694ffd62f59f522eec6df62f692caf47167cbe28e3a951f5289ac0da4', bpm: 160, offset: 0.047, duration: 264.07,
    sections: [{ name: 'Verse', at: 0, energy: 0.73 }, { name: 'Chorus', at: 22.55, energy: 0.91 }, { name: 'Instrumental', at: 46.55, energy: 0.74 }, { name: 'Verse 2', at: 61.55, energy: 0.87 }, { name: 'Chorus 2', at: 85.55, energy: 0.82 }, { name: 'Bridge', at: 108.05, energy: 0.8 }, { name: 'Break', at: 130.55, energy: 0.69 }, { name: 'Verse 3', at: 145.55, energy: 0.83 }, { name: 'Chorus 3', at: 163.55, energy: 0.86 }, { name: 'Outro', at: 204.05, energy: 0.5 }],
  },
  {
    id: 'light-me-on-fire', title: 'Light Me On Fire', artist: 'Zep Hurme feat. Admiral Bob', genre: 'funk', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    page: 'https://ccmixter.org/files/zep_hurme/39887',
    url: 'https://ccmixter.org/content/zep_hurme/zep_hurme_-_Light_Me_On_Fire.mp3',
    mirror: 'songs/light-me-on-fire.mp3',
    sha256: 'c1c91687f3d2154f846d1056049c700ea307e550347fe7d45de77c9a48dbc0d7', bpm: 104, offset: 0.042, duration: 216.97,
    sections: [{ name: 'Intro', at: 0, energy: 0.26 }, { name: 'Verse', at: 4.66, energy: 0.78 }, { name: 'Chorus', at: 32.35, energy: 0.77 }, { name: 'Instrumental', at: 43.89, energy: 0.77 }, { name: 'Verse 2', at: 50.81, energy: 0.79 }, { name: 'Chorus 2', at: 78.5, energy: 0.77 }, { name: 'Instrumental 2', at: 90.04, energy: 0.71 }, { name: 'Bridge', at: 131.58, energy: 0.79 }, { name: 'Chorus 3', at: 161.58, energy: 0.8 }, { name: 'Outro', at: 180.04, energy: 0.53 }],
  },
  {
    id: 'walls-come-down', title: 'Let the Walls Come Down', artist: 'Stefan Kartenberg feat. Mr_Yesterday', genre: 'funk', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    page: 'https://ccmixter.org/files/JeffSpeed68/66038',
    url: 'https://ccmixter.org/content/JeffSpeed68/JeffSpeed68_-_Let_the_Walls_Come_Down.mp3',
    mirror: 'songs/walls-come-down.mp3',
    sha256: '0b6cedb28ae618bc898bc0bf2eecf65ca76dca7695df5ac7c2d8cf8cde7c85cd', bpm: 96, offset: 1.993, duration: 233.16,
    sections: [{ name: 'Intro', at: 0, energy: 0.56 }, { name: 'Verse', at: 21.99, energy: 0.8 }, { name: 'Instrumental', at: 54.49, energy: 0.76 }, { name: 'Verse 2', at: 61.99, energy: 0.78 }, { name: 'Chorus', at: 89.49, energy: 0.91 }, { name: 'Bridge', at: 109.49, energy: 0.79 }, { name: 'Instrumental 2', at: 144.49, energy: 0.74 }, { name: 'Verse 3', at: 161.99, energy: 0.79 }, { name: 'Chorus 2', at: 189.49, energy: 0.91 }, { name: 'Outro', at: 219.49, energy: 0.33 }],
  },
  // More metal, hard rock, punk and alternative, and reggae, pop, electro and latin. Several
  // needed a second look at the tempo: "I Saw You" is fast punk at 180 and "It's Never Enough"
  // a half-time 95 (the beat trackers said 120 and 127), and where the kick plays on every beat
  // the first downbeat is where the band and the singer come in.
  {
    id: 'panopticom', title: 'Panopticom', artist: 'Sever', genre: 'metal', vocals: true,
    license: 'CC BY-SA', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    page: 'https://www.jamendo.com/track/311484',
    url: 'https://prod-1.storage.jamendo.com/download/track/311484/mp32/',
    mirror: 'songs/panopticom.mp3',
    sha256: 'adb4750f4a974df2e24ce5d7d6885fbb3df3283ccbf50e6155b5bae4f87bc910', bpm: 152, offset: 1.093, duration: 280.18,
    sections: [{ name: 'Intro', at: 0, energy: 0.21 }, { name: 'Instrumental', at: 13.72, energy: 0.58 }, { name: 'Instrumental 2', at: 37.41, energy: 0.87 }, { name: 'Break', at: 68.99, energy: 0.22 }, { name: 'Verse', at: 73.72, energy: 0.78 }, { name: 'Chorus', at: 100.57, energy: 0.85 }, { name: 'Instrumental 3', at: 122.67, energy: 0.91 }, { name: 'Verse 2', at: 135.3, energy: 0.81 }, { name: 'Chorus 2', at: 157.41, energy: 0.84 }, { name: 'Break 2', at: 182.67, energy: 0.62 }, { name: 'Bridge', at: 188.99, energy: 0.75 }, { name: 'Build', at: 217.41, energy: 0.68 }, { name: 'Verse 3', at: 225.3, energy: 0.88 }, { name: 'Chorus 3', at: 247.41, energy: 0.88 }, { name: 'Outro', at: 275.83, energy: 0.07 }],
  },
  {
    id: 'pests', title: 'Pests', artist: 'Organic Illusion', genre: 'metal', vocals: true,
    license: 'CC BY-SA', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    page: 'https://www.jamendo.com/track/1167928',
    url: 'https://prod-1.storage.jamendo.com/download/track/1167928/mp32/',
    mirror: 'songs/pests.mp3',
    sha256: 'b47e204948f08350509fe6db6a7d4977344be4f24bd4fe7110c1e6fc86f0292b', bpm: 140, offset: 2.598, duration: 234.22,
    sections: [{ name: 'Intro', at: 0, energy: 0.28 }, { name: 'Instrumental', at: 19.74, energy: 0.86 }, { name: 'Verse', at: 50.6, energy: 0.89 }, { name: 'Chorus', at: 83.17, energy: 0.92 }, { name: 'Instrumental 2', at: 98.6, energy: 0.91 }, { name: 'Verse 2', at: 112.31, energy: 0.93 }, { name: 'Pre-chorus', at: 126.03, energy: 0.87 }, { name: 'Chorus 2', at: 144.88, energy: 0.92 }, { name: 'Solo', at: 168.88, energy: 0.94 }, { name: 'Chorus 3', at: 187.74, energy: 0.9 }],
  },
  {
    id: 'mirin-dajo', title: 'Mirin Dajo', artist: 'Zoliborz', genre: 'metal', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    page: 'https://freemusicarchive.org/music/Zoliborz/Mirin_Dajo/01_Mirin_Dajo/',
    url: 'https://files.freemusicarchive.org/storage-freemusicarchive-org/music/WFMU/Zoliborz/Mirin_Dajo/Zoliborz_-_01_-_Mirin_Dajo.mp3',
    mirror: 'songs/mirin-dajo.mp3',
    sha256: '32749a9dbed3543350f16183737b20f8c2297e60408b40678e65cd134d1c920c', bpm: 155, offset: 1.823, duration: 222,
    sections: [{ name: 'Intro', at: 0, energy: 0.91 }, { name: 'Verse', at: 21.95, energy: 0.87 }, { name: 'Chorus', at: 29.69, energy: 0.92 }, { name: 'Verse 2', at: 37.44, energy: 0.91 }, { name: 'Instrumental', at: 54.47, energy: 0.87 }, { name: 'Verse 3', at: 94.73, energy: 0.89 }, { name: 'Chorus 2', at: 104.02, energy: 0.92 }, { name: 'Verse 4', at: 111.76, energy: 0.92 }, { name: 'Solo', at: 130.34, energy: 0.85 }, { name: 'Break', at: 172.15, energy: 0.5 }, { name: 'Build', at: 176.79, energy: 0.8 }, { name: 'Bridge', at: 192.27, energy: 0.73 }, { name: 'Instrumental 2', at: 201.56, energy: 0.83 }],
  },
  {
    id: 'hard-wired', title: 'Hard Wired, Born Blind', artist: 'Stefan Kartenberg feat. Mr_Yesterday', genre: 'metal', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    page: 'https://ccmixter.org/files/JeffSpeed68/56449',
    url: 'https://ccmixter.org/content/JeffSpeed68/JeffSpeed68_-_Hard_Wired_Born_Blind.mp3',
    mirror: 'songs/hard-wired.mp3',
    sha256: 'abf8bce5ce09a7ffe2eb7815dba9af11e8d1652e921fdf455e6b269afff733ee', bpm: 156, offset: 1.554, duration: 283.08,
    sections: [{ name: 'Intro', at: 0, energy: 0.24 }, { name: 'Verse', at: 20.02, energy: 0.73 }, { name: 'Verse 2', at: 50.78, energy: 0.71 }, { name: 'Break', at: 78.48, energy: 0.57 }, { name: 'Verse 3', at: 87.71, energy: 0.71 }, { name: 'Pre-chorus', at: 115.4, energy: 0.73 }, { name: 'Chorus', at: 130.78, energy: 0.83 }, { name: 'Chorus 2', at: 156.94, energy: 0.76 }, { name: 'Break 2', at: 167.71, energy: 0.38 }, { name: 'Solo', at: 180.02, energy: 0.88 }, { name: 'Bridge', at: 204.63, energy: 0.63 }, { name: 'Chorus 3', at: 229.25, energy: 0.93 }, { name: 'Outro', at: 272.32, energy: 0.13 }],
  },
  {
    id: 'liar', title: 'Liar', artist: 'Grimoff', genre: 'metal', vocals: true,
    license: 'CC BY-SA', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    page: 'https://www.jamendo.com/track/992821',
    url: 'https://prod-1.storage.jamendo.com/download/track/992821/mp32/',
    mirror: 'songs/liar.mp3',
    sha256: '8a34702791c11a5023ca254dc87370c905c013c0676f4a564805674e7738a49e', bpm: 115, offset: 0.445, duration: 302.39,
    sections: [{ name: 'Intro', at: 0, energy: 0.63 }, { name: 'Instrumental', at: 33.84, energy: 0.58 }, { name: 'Verse', at: 48.45, energy: 0.72 }, { name: 'Pre-chorus', at: 67.23, energy: 0.89 }, { name: 'Chorus', at: 79.75, energy: 0.98 }, { name: 'Verse 2', at: 92.27, energy: 0.84 }, { name: 'Break', at: 108.97, energy: 0.6 }, { name: 'Verse 3', at: 125.66, energy: 0.76 }, { name: 'Chorus 2', at: 144.44, energy: 0.94 }, { name: 'Chorus 3', at: 167.4, energy: 0.81 }, { name: 'Solo', at: 202.88, energy: 0.9 }, { name: 'Instrumental 2', at: 248.79, energy: 0.98 }, { name: 'Chorus 4', at: 265.49, energy: 0.81 }],
  },
  {
    id: 'ready-to-go', title: 'Ready To Go', artist: 'Endtape', genre: 'hardrock', vocals: true,
    license: 'CC BY-SA', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    page: 'https://www.jamendo.com/track/1101668',
    url: 'https://prod-1.storage.jamendo.com/download/track/1101668/mp32/',
    mirror: 'songs/ready-to-go.mp3',
    sha256: '0f1953406dff1d5dc898fd0f1210677931302a99cd0afc070c02f5fbf9be403b', bpm: 134, offset: 0.943, duration: 280.43,
    sections: [{ name: 'Intro', at: 0, energy: 0.38 }, { name: 'Instrumental', at: 8.107, energy: 0.85 }, { name: 'Verse', at: 43.928, energy: 0.79 }, { name: 'Chorus', at: 76.167, energy: 0.95 }, { name: 'Instrumental 2', at: 90.495, energy: 0.9 }, { name: 'Verse 2', at: 104.824, energy: 0.85 }, { name: 'Chorus 2', at: 137.062, energy: 0.96 }, { name: 'Solo', at: 151.391, energy: 0.93 }, { name: 'Break', at: 180.047, energy: 0.6 }, { name: 'Instrumental 3', at: 187.212, energy: 0.7 }, { name: 'Build', at: 201.54, energy: 0.78 }, { name: 'Break 2', at: 215.868, energy: 0.45 }, { name: 'Chorus 3', at: 230.197, energy: 1 }, { name: 'Outro', at: 273.182, energy: 0.4 }],
    // (the stops and slams, from its loudness, bass and cymbals beat by beat)
    hits: [{ at: 8.107, kind: 'slam' }, { at: 13.48, kind: 'drums' }, { at: 73.033, kind: 'dip' }, { at: 76.167, kind: 'slam' }, { at: 88.704, kind: 'stop' }, { at: 90.495, kind: 'slam' }, { at: 133.928, kind: 'dip' }, { at: 137.062, kind: 'slam' }, { at: 149.6, kind: 'stop' }, { at: 151.391, kind: 'slam' }, { at: 187.212, kind: 'drums' }, { at: 228.406, kind: 'fill' }, { at: 230.197, kind: 'slam' }, { at: 273.182, kind: 'end' }],

  },
  {
    id: 'summer-wind', title: 'Summer Wind', artist: 'Antarhes', genre: 'hardrock', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    page: 'https://www.jamendo.com/track/479306',
    url: 'https://prod-1.storage.jamendo.com/download/track/479306/mp32/',
    mirror: 'songs/summer-wind.mp3',
    sha256: '51b0fc0f28db5aa0ea55ed6ef6236a094f94d498b7a2b27e8df6eed367808dac', bpm: 107, offset: 0.28, duration: 191.5,
    sections: [{ name: 'Intro', at: 0, energy: 0.73 }, { name: 'Verse', at: 18.22, energy: 0.82 }, { name: 'Pre-chorus', at: 45.14, energy: 0.89 }, { name: 'Chorus', at: 54.11, energy: 0.92 }, { name: 'Verse 2', at: 83.27, energy: 0.83 }, { name: 'Pre-chorus 2', at: 112.43, energy: 0.88 }, { name: 'Chorus 2', at: 121.4, energy: 0.93 }, { name: 'Solo', at: 148.32, energy: 0.92 }, { name: 'Chorus 3', at: 161.78, energy: 0.86 }],
  },
  {
    id: 'i-saw-you', title: 'I Saw You', artist: 'Predator', genre: 'rock', vocals: true,
    license: 'CC BY-SA', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    page: 'https://www.jamendo.com/track/38568',
    url: 'https://prod-1.storage.jamendo.com/download/track/38568/mp32/',
    mirror: 'songs/i-saw-you.mp3',
    sha256: '7245f3dbf47a139b899eb7f042402580ecdfc5421a26d00b669c9bab4e09ccaf', bpm: 180, offset: 0.469, duration: 195.08,
    sections: [{ name: 'Intro', at: 0, energy: 0.67 }, { name: 'Verse', at: 21.8, energy: 0.87 }, { name: 'Chorus', at: 53.8, energy: 0.77 }, { name: 'Break', at: 69.8, energy: 0.6 }, { name: 'Verse 2', at: 80.47, energy: 0.84 }, { name: 'Chorus 2', at: 112.47, energy: 0.79 }, { name: 'Instrumental', at: 128.47, energy: 0.72 }, { name: 'Verse 3', at: 139.14, energy: 0.85 }, { name: 'Chorus 3', at: 171.14, energy: 0.79 }, { name: 'Outro', at: 187.14, energy: 0.48 }],
  },
  {
    id: 'never-enough', title: 'It\'s Never Enough', artist: 'Mudskills', genre: 'alternative', vocals: true,
    license: 'CC BY-SA', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    page: 'https://www.jamendo.com/track/580687',
    url: 'https://prod-1.storage.jamendo.com/download/track/580687/mp32/',
    mirror: 'songs/never-enough.mp3',
    sha256: '89ce4a7a4a4b239b285e7e69fed8fda2e795ae2e3fa524f272c7ed22861069bd', bpm: 95, offset: 0.218, duration: 226.84,
    sections: [{ name: 'Intro', at: 0, energy: 0.35 }, { name: 'Instrumental', at: 5.27, energy: 0.88 }, { name: 'Verse', at: 12.85, energy: 0.91 }, { name: 'Chorus', at: 38.11, energy: 0.9 }, { name: 'Verse 2', at: 53.27, energy: 0.92 }, { name: 'Chorus 2', at: 73.48, energy: 0.95 }, { name: 'Solo', at: 88.64, energy: 0.89 }, { name: 'Break', at: 116.43, energy: 0.73 }, { name: 'Verse 3', at: 124.01, energy: 0.91 }, { name: 'Chorus 3', at: 139.17, energy: 0.97 }, { name: 'Instrumental 2', at: 154.32, energy: 0.83 }, { name: 'Outro', at: 192.22, energy: 0.38 }],
  },
  {
    id: 'leaving-babylon', title: 'Leaving Babylon', artist: 'Zep Hurme feat. i_rebel', genre: 'reggae', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    page: 'https://ccmixter.org/files/zep_hurme/60052',
    url: 'https://ccmixter.org/content/zep_hurme/zep_hurme_-_Leaving_Babylon.mp3',
    mirror: 'songs/leaving-babylon.mp3',
    sha256: '2a3da0d6fbf012511875366d7e610a6d554aff698418facccd56808e139205c2', bpm: 126, offset: 0.992, duration: 213.33,
    sections: [{ name: 'Intro', at: 0, energy: 0.37 }, { name: 'Chorus', at: 21.94, energy: 0.83 }, { name: 'Verse', at: 37.18, energy: 0.76 }, { name: 'Chorus 2', at: 79.09, energy: 0.81 }, { name: 'Verse 2', at: 94.33, energy: 0.78 }, { name: 'Instrumental', at: 109.56, energy: 0.7 }, { name: 'Bridge', at: 126.71, energy: 0.77 }, { name: 'Verse 3', at: 153.37, energy: 0.75 }, { name: 'Chorus 3', at: 170.52, energy: 0.81 }, { name: 'Outro', at: 202.9, energy: 0.1 }],
  },
  {
    id: 'more-more', title: 'More, more, more,...', artist: 'Reiswerk feat. i_rebel', genre: 'reggae', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    page: 'https://ccmixter.org/files/Reiswerk/50919',
    url: 'https://ccmixter.org/content/Reiswerk/Reiswerk_-_More_more_more_...feat._i_rebel.mp3',
    mirror: 'songs/more-more.mp3',
    sha256: 'f26954922e4d8c3af64d2a188a41a613870567f4031136e8f4a858197b3482a0', bpm: 124.8, offset: 1.593, duration: 178.73,
    sections: [{ name: 'Intro', at: 0, energy: 0.73 }, { name: 'Verse', at: 13.13, energy: 0.85 }, { name: 'Verse 2', at: 45.82, energy: 0.81 }, { name: 'Chorus', at: 61.21, energy: 0.88 }, { name: 'Verse 3', at: 86.21, energy: 0.82 }, { name: 'Bridge', at: 107.36, energy: 0.84 }, { name: 'Chorus 2', at: 126.59, energy: 0.88 }, { name: 'Verse 4', at: 151.59, energy: 0.82 }, { name: 'Outro', at: 170.82, energy: 0.57 }],
  },
  {
    id: 'everybody-on-your-block', title: 'Everybody On Your Block', artist: 'Lilly Wolf', genre: 'pop', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    page: 'https://www.jamendo.com/track/1093615',
    url: 'https://prod-1.storage.jamendo.com/download/track/1093615/mp32/',
    mirror: 'songs/everybody-on-your-block.mp3',
    sha256: '28e630f4f17cfbb8056405e321a2c70af8585837bca8ee8e433feeade191a80e', bpm: 128, offset: 0.015, duration: 255,
    sections: [{ name: 'Intro', at: 0, energy: 0.42 }, { name: 'Verse', at: 5.64, energy: 0.55 }, { name: 'Pre-chorus', at: 20.64, energy: 0.7 }, { name: 'Build', at: 33.77, energy: 0.64 }, { name: 'Chorus', at: 43.14, energy: 0.91 }, { name: 'Instrumental', at: 75.02, energy: 0.61 }, { name: 'Verse 2', at: 82.52, energy: 0.73 }, { name: 'Build 2', at: 110.64, energy: 0.57 }, { name: 'Chorus 2', at: 120.02, energy: 0.92 }, { name: 'Break', at: 150.01, energy: 0.37 }, { name: 'Instrumental 2', at: 157.51, energy: 0.8 }, { name: 'Break 2', at: 187.51, energy: 0.36 }, { name: 'Build 3', at: 195.01, energy: 0.61 }, { name: 'Chorus 3', at: 204.39, energy: 0.91 }, { name: 'Outro', at: 249.39, energy: 0.01 }],
  },
  {
    id: 'wont-fall-in-love', title: 'I Won\'t Fall In Love', artist: 'Jens East feat. MaryLinn', genre: 'electro', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    page: 'https://freemusicarchive.org/music/Jens_East_ft_Henk/I_Wont_Fall_In_Love_1068/Jens_East_-_I_Wont_Fall_In_Love_feat_MaryLinn_master_24bit_1625/',
    url: 'https://files.freemusicarchive.org/storage-freemusicarchive-org/music/ccCommunity/Jens_East/I_Wont_Fall_In_Love/Jens_East_-_01_-_I_Wont_Fall_In_Love_feat_MaryLinn.mp3',
    mirror: 'songs/wont-fall-in-love.mp3',
    sha256: 'b0deca44616674062b5b77ffe2fd00a3359b6701ade1708d88ce1718f01fbc28', bpm: 117, offset: 2.073, duration: 180.51,
    sections: [{ name: 'Intro', at: 0, energy: 0.66 }, { name: 'Verse', at: 10.28, energy: 0.86 }, { name: 'Build', at: 43.1, energy: 0.55 }, { name: 'Drop', at: 59.51, energy: 0.9 }, { name: 'Verse 2', at: 80.02, energy: 0.92 }, { name: 'Build 2', at: 106.69, energy: 0.49 }, { name: 'Drop 2', at: 125.15, energy: 0.9 }, { name: 'Outro', at: 170.28, energy: 0.34 }],
  },
  {
    id: 'rescue-me', title: 'Rescue Me', artist: 'L4M feat. Kaer Trouz', genre: 'electro', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    page: 'https://ccmixter.org/files/L4M/19218',
    url: 'https://ccmixter.org/content/L4M/L4M_-_Rescue_Me.mp3',
    mirror: 'songs/rescue-me.mp3',
    sha256: '65a6d4aff648fbd53014a8abfdad6a23421e7638c7ab22aeda65406875975070', bpm: 130, offset: 11.14, duration: 164.86,
    sections: [{ name: 'Intro', at: 0, energy: 0.18 }, { name: 'Verse', at: 14.83, energy: 0.93 }, { name: 'Chorus', at: 27.76, energy: 0.96 }, { name: 'Verse 2', at: 46.22, energy: 0.91 }, { name: 'Chorus 2', at: 60.99, energy: 0.92 }, { name: 'Instrumental', at: 75.76, energy: 0.88 }, { name: 'Verse 3', at: 86.83, energy: 0.89 }, { name: 'Chorus 3', at: 99.76, energy: 0.88 }, { name: 'Instrumental 2', at: 118.22, energy: 0.87 }, { name: 'Chorus 4', at: 131.14, energy: 0.87 }, { name: 'Outro', at: 162.52, energy: 0.1 }],
  },
  {
    id: 'cha-cha-man', title: 'El Cha Cha Man', artist: 'Juanitos', genre: 'latin', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    page: 'https://www.jamendo.com/track/37754',
    url: 'https://prod-1.storage.jamendo.com/download/track/37754/mp32/',
    mirror: 'songs/cha-cha-man.mp3',
    sha256: '753a4a3838797b17ed546b5f4c27877e5a39e57696d20f6dd2c77680af6f491f', bpm: 136.13, offset: 0.073, duration: 216.24,
    sections: [{ name: 'Intro', at: 0, energy: 0.7 }, { name: 'Verse', at: 14.18, energy: 0.83 }, { name: 'Instrumental', at: 42.39, energy: 0.75 }, { name: 'Verse 2', at: 56.49, energy: 0.84 }, { name: 'Instrumental 2', at: 68.83, energy: 0.89 }, { name: 'Chorus', at: 84.7, energy: 0.86 }, { name: 'Bridge', at: 112.91, energy: 0.88 }, { name: 'Chorus 2', at: 127.01, energy: 0.84 }, { name: 'Solo', at: 155.22, energy: 0.88 }, { name: 'Outro', at: 211.64, energy: 0.43 }],
  },
  {
    id: 'sambarama', title: 'Sambarama', artist: 'Juanitos', genre: 'latin', vocals: true,
    license: 'CC BY', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    page: 'https://www.jamendo.com/track/37756',
    url: 'https://prod-1.storage.jamendo.com/download/track/37756/mp32/',
    mirror: 'songs/sambarama.mp3',
    sha256: '8c45357a4dd2b4007a59ec690ba42b822baeb44978d1a2d1f22fa782be2099d6', bpm: 122.23, offset: 0.031, duration: 263.45,
    sections: [{ name: 'Intro', at: 0, energy: 0.56 }, { name: 'Instrumental', at: 11.81, energy: 0.8 }, { name: 'Verse', at: 58.94, energy: 0.78 }, { name: 'Instrumental 2', at: 94.28, energy: 0.75 }, { name: 'Chorus', at: 108.02, energy: 0.94 }, { name: 'Instrumental 3', at: 123.73, energy: 0.87 }, { name: 'Chorus 2', at: 139.44, energy: 0.94 }, { name: 'Break', at: 157.11, energy: 0.66 }, { name: 'Bridge', at: 176.75, energy: 0.76 }, { name: 'Instrumental 4', at: 216.02, energy: 0.74 }, { name: 'Chorus 3', at: 229.76, energy: 0.93 }, { name: 'Outro', at: 259.21, energy: 0.21 }],
  },
];
