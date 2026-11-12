import { describe, expect, it } from 'vitest';
import { parseCommand } from './command';

const P = (fixtures: number[] = [], groups: number[] = [], cells: { fixture: number; cells: number[] }[] = [], all?: boolean) => ({ fixtures, groups, cells, ...(all ? { all } : {}) });
const add = (p: ReturnType<typeof P>) => ({ sign: '+', pick: p });
const sub = (p: ReturnType<typeof P>) => ({ sign: '-', pick: p });

describe('the command line', () => {
  it('lights by number, runs, adding and taking out in the order said, a level', () => {
    expect(parseCommand('1 thru 4 @ 50')).toEqual({ steps: [add(P([1, 2, 3, 4]))], base: 'new', level: { abs: 0.5 } });
    expect(parseCommand('1>3+7@full')).toEqual({ steps: [add(P([1, 2, 3, 7]))], base: 'new', level: { abs: 1 } });
    expect(parseCommand('1-4')).toEqual({ steps: [add(P([1])), sub(P([4]))], base: 'new' });                // as on MA and Eos: minus
    expect(parseCommand('1+3-5')).toEqual({ steps: [add(P([1, 3])), sub(P([5]))], base: 'new' });
    expect(parseCommand('1 thru 10-5')).toEqual({ steps: [add(P([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])), sub(P([5]))], base: 'new' });
    expect(parseCommand('1 thru 10 - 5 @ out')).toEqual({ steps: [add(P([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])), sub(P([5]))], base: 'new', level: { abs: 0 } });
    expect(parseCommand('+ 1 thru 10 - 5')).toEqual({ steps: [add(P([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])), sub(P([5]))], base: 'current' });
    expect(parseCommand('- 1 thru 10 + 5')).toEqual({ steps: [sub(P([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])), add(P([5]))], base: 'current' });
    expect(parseCommand('4 thru 1')).toEqual({ steps: [add(P([4, 3, 2, 1]))], base: 'new' });          // (backwards: the order a fan or rainbow takes)
  });
  it('groups (in the order said), all, cells of a light', () => {
    expect(parseCommand('group 2 @ 75')).toEqual({ steps: [add(P([], [2]))], base: 'new', level: { abs: 0.75 } });
    expect(parseCommand('g 3 thru 1')).toEqual({ steps: [add(P([], [3, 2, 1]))], base: 'new' });
    expect(parseCommand('all @ out')).toEqual({ steps: [add(P([], [], [], true))], base: 'new', level: { abs: 0 } });
    expect(parseCommand('1.3 thru 1.6 @ full')).toEqual({ steps: [add(P([], [], [{ fixture: 1, cells: [2, 3, 4, 5] }]))], base: 'new', level: { abs: 1 } });
    expect(parseCommand('1.3 + 2.5')).toEqual({ steps: [add(P([], [], [{ fixture: 1, cells: [2] }, { fixture: 2, cells: [4] }]))], base: 'new' });
  });
  it('levels as on ETC and ChamSys desks: one digit is tens; 05 and 5% are five; full and out without @', () => {
    expect(parseCommand('@ 5')).toEqual({ level: { abs: 0.5 } });
    expect(parseCommand('@ 05')).toEqual({ level: { abs: 0.05 } });
    expect(parseCommand('@ 5%')).toEqual({ level: { abs: 0.05 } });
    expect(parseCommand('@ 50 %')).toEqual({ level: { abs: 0.5 } });
    expect(parseCommand('at + 10')).toEqual({ level: { rel: 0.1 } });
    expect(parseCommand('@-25')).toEqual({ level: { rel: -0.25 } });
    expect(parseCommand('@ 12.5')).toEqual({ level: { abs: 0.125 } });
    expect(parseCommand('@ 150')).toEqual({ level: { abs: 1 } });
    expect(parseCommand('1 thru 4 full')).toEqual({ steps: [add(P([1, 2, 3, 4]))], base: 'new', level: { abs: 1 } });
    expect(parseCommand('2 out')).toEqual({ steps: [add(P([2]))], base: 'new', level: { abs: 0 } });
  });
  it('words on their own, lists by number', () => {
    expect(parseCommand('clear')).toEqual({ action: 'clear' });
    expect(parseCommand('rec')).toEqual({ action: 'record' });
    expect(parseCommand('go 2')).toEqual({ action: 'go', list: 2 });
    expect(parseCommand('release list 3')).toEqual({ action: 'release', list: 3 });
    expect(parseCommand('bo')).toEqual({ action: 'blackout' });
    // cues by number, in a list or the one Live plays
    expect(parseCommand('goto cue 5')).toEqual({ action: 'goto', cue: 5 });
    expect(parseCommand('goto 2.5')).toEqual({ action: 'goto', cue: 2.5 });
    expect(parseCommand('go list 2 cue 3')).toEqual({ action: 'goto', list: 2, cue: 3 });
    expect(parseCommand('list 2 goto cue 3')).toEqual({ action: 'goto', list: 2, cue: 3 });
    expect(parseCommand('record cue 7 time 3')).toEqual({ action: 'record', cue: 7, time: 3 });
    expect(parseCommand('update cue 4')).toEqual({ action: 'update', cue: 4 });
    expect(parseCommand('delete cue 4')).toEqual({ action: 'delete', cue: 4 });
    expect(parseCommand('cue 4 time 0.5')).toEqual({ action: 'time', cue: 4, time: 0.5 });
    expect(parseCommand('q 4 time 2')).toEqual({ action: 'time', cue: 4, time: 2 });
    expect(parseCommand('next')).toEqual({ action: 'next' });
    expect(parseCommand('oops')).toEqual({ action: 'undo' });
    expect(parseCommand('?')).toEqual({ action: 'help' });
    expect(parseCommand('undo 3').error).toMatch(/nothing after it/);
    expect(parseCommand('cue 4').error).toMatch(/cue 4 what\?/);
    expect(parseCommand('delete').error).toMatch(/takes a cue/);
    expect(parseCommand('go 2 time 3').error).toMatch(/list number or nothing/);
    expect(parseCommand('update cue 4 time 3').error).toMatch(/goes with a cue/);
    expect(parseCommand('cue 0 time 3').error).toMatch(/cue takes a number/);
    // as on ETC desks: a number straight after record, update, delete is the cue
    expect(parseCommand('record 5')).toEqual({ action: 'record', cue: 5 });
    expect(parseCommand('update 2.5')).toEqual({ action: 'update', cue: 2.5 });
    expect(parseCommand('delete 3')).toEqual({ action: 'delete', cue: 3 });
    // a typo'd run is said, not built
    expect(parseCommand('1 thru 999999999').error).toBeTruthy();
    expect(parseCommand('1.1 thru 1.200000').error).toBeTruthy();
    expect(parseCommand('1 thru 20000').error).toMatch(/at most/);
    expect(parseCommand('1 thru 9000').steps![0].pick.fixtures.length).toBe(9000);
  });
  it('says what it can\'t read', () => {
    expect(parseCommand('1 thru')).toEqual({ error: '"thru" takes a number after it' });
    expect(parseCommand('@').error).toMatch(/takes a level/);
    expect(parseCommand('banana')).toEqual({ error: '"banana"? Try 1 thru 4 @ 50, group 2, goto cue 5, go, clear' });
    expect(parseCommand('1.3 thru 2.4')).toEqual({ error: 'a run of cells stays in one light' });
    expect(parseCommand('clear 3')).toEqual({ error: '"clear" takes nothing after it' });
    expect(parseCommand('0 @ 50')).toEqual({ error: 'lights count from 1' });
    expect(parseCommand('group 0')).toEqual({ error: 'group takes a number from 1' });
    expect(parseCommand('1 full 2').error).toMatch(/nothing goes after/);
    expect(parseCommand('')).toEqual({});
  });
});

describe('numbers too big to be one', () => {
  it('a run of twenty-digit numbers is said, not counted to', () => {
    expect(parseCommand('9007199254740992 thru 9007199254740994').error).toBeTruthy();
    expect(parseCommand('99999 @ full').steps![0].pick.fixtures).toEqual([99999]);
    expect(parseCommand('100000 @ full').error).toBeTruthy();
  });
});
