// @vitest-environment happy-dom
// The 3D selection frame: where the pointer (or the keyboard) is says whether it shows. Places
// where lights are picked show it, places where their look is worked on fade it, anywhere else
// leaves it as it was.
import { describe, expect, it } from 'vitest';
import { ui } from './ui.svelte';

describe('the selection frame follows where you work', () => {
  it('shows in a show place, fades in a hide place, nested places win, others leave it', () => {
    document.body.innerHTML = `
      <div id="stage" data-marks="show"><canvas id="cv"></canvas></div>
      <div id="prog" data-marks="hide"><button id="knob"></button>
        <section id="cells" data-marks="show"><span id="cell"></span></section></div>
      <div id="top"><button id="tab"></button></div>`;
    const at = (id: string) => document.getElementById(id);
    ui.selMarks = true;
    ui.marksFrom(at('knob')); expect(ui.selMarks).toBe(false);          // the programmer: away
    ui.marksFrom(at('tab')); expect(ui.selMarks).toBe(false);           // the top bar: as it was
    ui.marksFrom(at('cell')); expect(ui.selMarks).toBe(true);           // the cell picker in it: back
    ui.marksFrom(at('prog')); expect(ui.selMarks).toBe(false);
    ui.marksFrom(at('cv')); expect(ui.selMarks).toBe(true);             // the 3D stage: back
    ui.marksFrom(at('tab')); expect(ui.selMarks).toBe(true);
    // (not an element: nothing changes, nothing throws)
    ui.marksFrom(null); ui.marksFrom(window); expect(ui.selMarks).toBe(true);
  });
});
