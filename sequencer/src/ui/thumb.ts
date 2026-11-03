// A little SVG of the stage for a look: every fixture where it hangs, in its colour, glowing with
// its intensity; moving heads with a short beam. Used for cue cards and show thumbnails, so it's a
// plain string (cheap, cacheable, storable).
import type { Fixture, Resolved } from '../model/types';
import type { FixtureKind } from '../model/library';
import { lookColor } from '../engine/cuelook';

// The picture as an image: one element on the page, drawn once, instead of a shape per light (a
// card deck of 40 cues on a 300-light rig was 14,000 elements: seconds of layout on every tab
// switch). Remembered by its markup (the same look, the same picture).
const urls = new Map<string, string>();
export function svgImage(svg: string): string {
  let u = urls.get(svg);
  if (u === undefined) {
    u = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    if (urls.size > 600) urls.delete(urls.keys().next().value!);
    urls.set(svg, u);
  }
  return u;
}

// `own`: a look of a list of looks: a light it doesn't name is drawn as an outline (it stays as it
// is), one it switches off as a dark light, so the card tells "off" from "not in this look".
export function stageSvg(fixtures: Fixture[], looks: Record<string, Resolved>, kinds: Record<string, FixtureKind>, w = 160, h = 90, own = false): string {
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
    `<rect width="${w}" height="${h}" rx="6" fill="#0b0f15"/>`];
  const r = Math.max(2.2, Math.min(7, 90 / Math.sqrt(fixtures.length + 4)));
  for (const f of fixtures) {
    const l = looks[f.id];
    const { css, glow } = lookColor(l);
    const x = (f.x * w).toFixed(1), y = (f.y * h).toFixed(1);
    if (own && !l) {
      parts.push(`<circle cx="${x}" cy="${y}" r="${(r * 0.85).toFixed(1)}" fill="none" stroke="#5a6472" stroke-width="1.3" stroke-dasharray="2.2 1.8"/>`);
      continue;
    }
    if (kinds[f.id] === 'fog' || kinds[f.id] === 'sfx') {
      const fog = l?.fog ?? l?.haze ?? 0;
      if (fog > 0.02) parts.push(`<circle cx="${x}" cy="${y}" r="${(r * 2.6).toFixed(1)}" fill="#cfd8e3" opacity="${(0.25 * fog).toFixed(2)}"/>`);
      parts.push(`<rect x="${(+x - r).toFixed(1)}" y="${(+y - r * 0.6).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 1.2).toFixed(1)}" rx="1.2" fill="#1c232d" stroke="#3b4450" stroke-width="0.6"/>`);
      continue;
    }
    if (kinds[f.id] === 'mover' && glow > 0.02) {
      const pan = ((l?.pan ?? 0.5) - 0.5) * 1.6, len = h * (0.12 + 0.22 * (l?.tilt ?? 0.5));
      const ex = (+x + Math.sin(pan) * len).toFixed(1), ey = (+y + Math.cos(pan) * len).toFixed(1);
      parts.push(`<line x1="${x}" y1="${y}" x2="${ex}" y2="${ey}" stroke="${css}" stroke-width="${(r * 0.7).toFixed(1)}" stroke-linecap="round" opacity="${(0.15 + 0.25 * glow).toFixed(2)}"/>`);
    }
    if (glow > 0.02) parts.push(`<circle cx="${x}" cy="${y}" r="${(r * 1.9).toFixed(1)}" fill="${css}" opacity="${(0.25 * glow).toFixed(2)}"/>`);
    if (kinds[f.id] === 'bar') {
      // A bar is a bar: its cells side by side (one colour unless an effect gave them their own).
      const cells = l?.cells?.length ? l.cells : [l];
      const bw = r * 4.4, cw = bw / cells.length;
      parts.push(`<rect x="${(+x - bw / 2).toFixed(1)}" y="${(+y - r * 0.6).toFixed(1)}" width="${bw.toFixed(1)}" height="${(r * 1.2).toFixed(1)}" rx="1.5" fill="#1c232d" stroke="#3b4450" stroke-width="0.6"/>`);
      cells.forEach((c, i) => {
        const cc = lookColor(c);
        if (cc.glow > 0.02) parts.push(`<rect x="${(+x - bw / 2 + i * cw + 0.4).toFixed(1)}" y="${(+y - r * 0.45).toFixed(1)}" width="${Math.max(0.6, cw - 0.8).toFixed(1)}" height="${(r * 0.9).toFixed(1)}" fill="${cc.css}"/>`);
      });
      continue;
    }
    parts.push(`<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="${glow > 0.02 ? css : '#1c232d'}" stroke="#3b4450" stroke-width="0.6"/>`);
  }
  parts.push('</svg>');
  return parts.join('');
}
