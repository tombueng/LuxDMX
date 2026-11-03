// A cue action in words (the cue sheet, the timetable): "play "House full" on House lights".
import { cueNumber } from './cuenum';
import type { CueAction, Show } from './types';

// Short, for a chip: "Choir practice", "Hall on", "Everything off".
export function actionShort(show: Show, a: CueAction): string {
  const list = 'list' in a ? show.cueLists.find((l) => l.id === a.list) : undefined;
  switch (a.do) {
    case 'goto': return list?.cues.find((c) => c.id === a.cue)?.name ?? 'a cue that\'s gone';
    case 'start': case 'go': return `${list?.name ?? '?'} on`;
    case 'release': case 'stop': return `${list?.name ?? '?'} out`;
    case 'off': return 'Everything off';
    case 'blackout': return a.on ? 'Blackout' : 'Blackout off';
    case 'master': return `${list?.name ?? '?'} ${Math.round(a.level * 100)}%`;
  }
}

export function actionText(show: Show, a: CueAction): string {
  const list = 'list' in a ? show.cueLists.find((l) => l.id === a.list) : undefined;
  const ln = list?.name ?? '?';
  switch (a.do) {
    case 'blackout': return `blackout ${a.on ? 'on' : 'off'}`;
    case 'off': return 'everything off';
    case 'master': return `level of ${ln} to ${Math.round(a.level * 100)}%`;
    case 'goto': {
      const i = list ? list.cues.findIndex((c) => c.id === a.cue) : -1;
      return i >= 0 ? `play ${cueNumber(list!, i)}. ${list!.cues[i].name} (${ln})` : `play a cue that's gone (${ln})`;
    }
    default: return `${{ start: 'start', go: 'GO on', release: 'fade out', stop: 'stop' }[a.do]} ${ln}`;
  }
}
