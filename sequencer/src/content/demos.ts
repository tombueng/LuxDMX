// The demos you can start from the welcome or the command palette: the festival stage, a DJ in a
// club, a house party under a square of truss, and an empty test truss. Each is a whole show (a rig,
// looks, a timeline) in its own room of the 3D stage; `song` is the catalog song it's cued to by
// default (built without one, it runs on the demo beat).
import type { Show } from '../model/types';
import type { RoomId } from '../stage3d/geometry';
import { DEMO_SONG } from '../timeline/beat';
import { buildDemo, type DemoSong } from './demo';
import { buildClub, CLUB_SONG } from './club';
import { buildParty, PARTY_SONG } from './party';
import { buildTrussTest } from './trussTest';

export interface DemoInfo { id: string; name: string; blurb: string; icon: string; room: RoomId; song?: string; build: (song?: DemoSong) => Show }

export const DEMOS: DemoInfo[] = [
  {
    id: 'festival', name: 'Festival stage', icon: 'mover', room: 'hall', song: DEMO_SONG, build: (song) => buildDemo(song),
    blurb: 'A band on a big stage in a hall: over a hundred moving heads hitting the beat, every effect machine, a crowd of hundreds. Cued to a hard rock song.',
  },
  {
    id: 'club', name: 'DJ in a club', icon: 'music', room: 'club', song: CLUB_SONG, build: (song) => buildClub(song),
    blurb: 'A DJ at the decks with 20 moving heads, pixel strips and LED bars round the stage, fog behind the booth. Cued to a techno track.',
  },
  {
    id: 'party', name: 'House party', icon: 'bolt', room: 'party', song: PARTY_SONG, build: (song) => buildParty(song),
    blurb: 'No stage: a square of truss over the crowd with moving heads all round it, speakers in the corners, CO2 and confetti. Cued to a house track.',
  },
  {
    id: 'truss', name: 'Test truss', icon: 'par', room: 'truss', build: () => buildTrussTest(),
    blurb: 'An empty room with one truss: two of every kind of light and every machine, a cue for each to check, a chase and a button per machine.',
  },
];
export const demoById = (id: string) => DEMOS.find((d) => d.id === id);
