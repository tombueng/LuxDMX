// The dev server holds its hot updates while a page renders or records (vite.config.ts): none go
// out meanwhile, one reload when it's done, or when its tab goes.
import { describe, expect, it } from 'vitest';
import { holdWhileBusy } from './holdWhileBusy';

function server() {
  const on: Record<string, (d: unknown, c: unknown) => void> = {}, sent: unknown[] = [];
  return { on, sent, ws: { on: (ev: string, f: (d: unknown, c: unknown) => void) => { on[ev] = f; }, send: (p: unknown) => sent.push(p) } };
}
const tab = () => { let close: () => void = () => {}; return { socket: { once: (_: string, f: () => void) => { close = f; } }, close: () => close() }; };

describe('hot updates held while busy', () => {
  it('none while a page is busy, one reload after; none held: nothing sent', () => {
    const p = holdWhileBusy() as any, s = server();
    p.configureServer(s);
    expect(p.handleHotUpdate()).toBeUndefined();                 // (not busy: as usual)
    const c = tab();
    s.on['luxdmx:busy']({ id: 'a', on: true }, c);
    expect(p.handleHotUpdate()).toEqual([]);
    expect(p.handleHotUpdate()).toEqual([]);
    expect(s.sent).toEqual([]);
    s.on['luxdmx:busy']({ id: 'a', on: false }, c);
    expect(s.sent).toEqual([{ type: 'full-reload' }]);
    s.on['luxdmx:busy']({ id: 'a', on: true }, c); s.on['luxdmx:busy']({ id: 'a', on: false }, c);
    expect(s.sent.length).toBe(1);                                 // (nothing changed meanwhile: no reload)
  });
  it('two pages busy: held until both are done; a busy tab closed counts as done', () => {
    const p = holdWhileBusy() as any, s = server(), a = tab(), b = tab();
    p.configureServer(s);
    s.on['luxdmx:busy']({ id: 'a', on: true }, a); s.on['luxdmx:busy']({ id: 'b', on: true }, b);
    expect(p.handleHotUpdate()).toEqual([]);
    s.on['luxdmx:busy']({ id: 'a', on: false }, a);
    expect(s.sent).toEqual([]);
    b.close();
    expect(s.sent).toEqual([{ type: 'full-reload' }]);
  });
});
