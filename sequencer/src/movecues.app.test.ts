// @vitest-environment happy-dom
// A cue moved to another list (the cue's menu, Move to "..."): the same cue, at the other list's end,
// and everything that played it follows: a Live button, a moment on the timeline (onto that list's
// track), another cue's "go to", a timetable entry, the look between songs. Nothing is pruned, the
// clipboard isn't used, and one Undo takes it all back. (It was a cut and a paste: the cut deleted
// every button and timeline moment for the cue, the paste gave it a new id.)
import { describe, expect, it } from 'vitest';
import { freshApp, smallShow } from './app.harness';

describe('moving cues to another list', { timeout: 30000 }, () => {
  it('keeps the cue and moves what plays it along', async () => {
    const { app } = await freshApp();
    smallShow(app);
    const other = app.newList('Other');
    const s = app.show;
    s.pages.push({ id: 'pg', name: 'Live', widgets: [{ id: 'w1', type: 'cue', list: 'L', cue: 'c2' }] });
    s.timeline = { duration: 60, items: [{ id: 't1', at: 4, lane: 'list:L', do: { do: 'goto', list: 'L', cue: 'c2' } },
      { id: 't2', at: 8, lane: 'list:L', do: { do: 'goto', list: 'L', cue: 'c1' } }] };
    s.cueLists[0].cues[0].actions = [{ do: 'goto', list: 'L', cue: 'c2' }];
    s.settings.schedule = [{ id: 'e1', at: '20:00', do: { do: 'goto', list: 'L', cue: 'c2' } }];
    (s as any).setlist = { before: [], after: [], between: { list: 'L', cue: 'c2' } };
    app.checkpoint();
    const cue = s.cueLists[0].cues[1];

    expect(app.moveCuesToList(['c2'], other.id)).toBe(1);

    expect(s.cueLists[0].cues.map((c: any) => c.id)).toEqual(['c1']);
    const moved = s.cueLists.find((l: any) => l.id === other.id).cues;
    expect(moved.map((c: any) => c.id)).toEqual(['c2']);
    expect(moved[0].values).toEqual(cue.values);
    expect(s.pages.find((p: any) => p.id === 'pg').widgets.find((w: any) => w.id === 'w1')).toMatchObject({ list: other.id, cue: 'c2' });
    expect(s.timeline.items[0]).toMatchObject({ lane: `list:${other.id}`, do: { list: other.id, cue: 'c2' } });
    expect(s.timeline.items[1]).toMatchObject({ lane: 'list:L', do: { list: 'L', cue: 'c1' } });
    expect(s.cueLists[0].cues[0].actions).toEqual([{ do: 'goto', list: other.id, cue: 'c2' }]);
    expect(s.settings.schedule[0].do).toEqual({ do: 'goto', list: other.id, cue: 'c2' });
    expect((s as any).setlist.between).toEqual({ list: other.id, cue: 'c2' });
    expect(app.currentList).toBe(other.id);
    expect(app.cueSel).toEqual(['c2']);

    // one Undo: back where it was, all of it
    app.undo();
    const back = app.show;
    expect(back.cueLists[0].cues.map((c: any) => c.id)).toEqual(['c1', 'c2']);
    expect(back.timeline.items[0]).toMatchObject({ lane: 'list:L', do: { list: 'L', cue: 'c2' } });
    expect(back.pages.find((p: any) => p.id === 'pg').widgets.find((w: any) => w.id === 'w1')).toMatchObject({ list: 'L' });
  });

  it('into the same list, or with nothing picked, does nothing', async () => {
    const { app } = await freshApp();
    smallShow(app);
    expect(app.moveCuesToList(['c1'], 'L')).toBe(0);
    expect(app.moveCuesToList([], 'L')).toBe(0);
    expect(app.show.cueLists[0].cues).toHaveLength(2);
  });
});
