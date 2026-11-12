// Gobos for the 3D stage: a light's gobo wheel shows the real pattern in its beam and on what it
// hits. Which pattern a slot is comes from its name (the fixture file's "Stars", "Punkte", "Gobo 3
// (flower)"): words in English and German, first match wins (the specific ones before the general
// ones). A slot whose name says nothing ("Gobo 5") gets a pattern of its own from a fixed list, so
// the slots of one wheel still look different from each other; "Open" is no gobo at all.
// The patterns: symbols from a font that comes with the app (a cut-down Noto Sans Symbols, so every
// computer draws the same), and the classics drawn here (dots, breakup, leaves, water, lines,
// windows, rays, spirals, tunnels). All of them are drawn once into one texture (the atlas) that
// the beams and the light on the floor read.

type Draw = (c: CanvasRenderingContext2D, r: number, rnd: () => number) => void;
export interface Gobo { id: string; name: string; words?: RegExp; glyph?: string; draw?: Draw; glass?: boolean }

const TAU = Math.PI * 2;
// (the same "random" pattern every time: a breakup is a piece of metal, not noise)
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const disc = (c: CanvasRenderingContext2D, x: number, y: number, r: number) => { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); };
const ring = (c: CanvasRenderingContext2D, r: number, w: number) => { c.lineWidth = w; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke(); };
const poly = (c: CanvasRenderingContext2D, pts: [number, number][]) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill(); };
const ngon = (n: number, r: number, turn = -Math.PI / 2): [number, number][] => Array.from({ length: n }, (_, i) => [r * Math.cos(turn + (i * TAU) / n), r * Math.sin(turn + (i * TAU) / n)]);

// the drawn ones (white is where light goes through)
const D: Record<string, Draw> = {
  dots: (c, r) => { const s = r / 4.2; for (let y = -r; y <= r; y += s) for (let x = -r; x <= r; x += s) if (Math.hypot(x, y) < r * 0.88) disc(c, x, y, s * 0.28); },
  bigdots: (c, r) => { const s = r / 2.2; for (let y = -r; y <= r; y += s) for (let x = -r; x <= r; x += s) if (Math.hypot(x, y) < r * 0.8) disc(c, x, y, s * 0.3); },
  dotring: (c, r) => { for (let i = 0; i < 10; i++) disc(c, Math.cos((i * TAU) / 10) * r * 0.66, Math.sin((i * TAU) / 10) * r * 0.66, r * 0.13); },
  dotrings: (c, r) => { disc(c, 0, 0, r * 0.12); for (const [n, k] of [[8, 0.42], [14, 0.78]] as const) for (let i = 0; i < n; i++) disc(c, Math.cos((i * TAU) / n) * r * k, Math.sin((i * TAU) / n) * r * k, r * 0.09); },
  starfield: (c, r, rnd) => { for (let i = 0; i < 70; i++) { const a = rnd() * TAU, d = Math.sqrt(rnd()) * r * 0.9; disc(c, Math.cos(a) * d, Math.sin(a) * d, r * (0.012 + rnd() * 0.035)); } },
  galaxy: (c, r, rnd) => { for (let arm = 0; arm < 3; arm++) for (let i = 0; i < 40; i++) { const t = i / 40, a = arm * (TAU / 3) + t * 4.2 + rnd() * 0.25, d = t * r * 0.88; disc(c, Math.cos(a) * d, Math.sin(a) * d, r * (0.05 - t * 0.035)); } },
  breakup: (c, r, rnd) => { for (let i = 0; i < 26; i++) { const a = rnd() * TAU, d = Math.sqrt(rnd()) * r * 0.85; c.beginPath(); c.ellipse(Math.cos(a) * d, Math.sin(a) * d, r * (0.05 + rnd() * 0.12), r * (0.03 + rnd() * 0.07), rnd() * Math.PI, 0, TAU); c.fill(); } },
  leaves: (c, r, rnd) => {
    for (let i = 0; i < 18; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * r * 0.82, x = Math.cos(a) * d, y = Math.sin(a) * d, l = r * (0.14 + rnd() * 0.1), w = l * 0.42;
      c.save(); c.translate(x, y); c.rotate(rnd() * TAU); c.beginPath(); c.moveTo(-l, 0); c.quadraticCurveTo(0, -w * 1.6, l, 0); c.quadraticCurveTo(0, w * 1.6, -l, 0); c.fill(); c.restore();
    }
  },
  water: (c, r, rnd) => { c.lineCap = 'round'; for (let y = -r; y < r; y += r / 5.5) { c.lineWidth = r * (0.05 + rnd() * 0.05); c.beginPath(); for (let x = -r; x <= r; x += r / 20) { const yy = y + Math.sin(x / r * 7 + y) * r * 0.06 + Math.sin(x / r * 13) * r * 0.02; x === -r ? c.moveTo(x, yy) : c.lineTo(x, yy); } c.stroke(); } },
  clouds: (c, r, rnd) => { for (let i = 0; i < 9; i++) { const a = rnd() * TAU, d = rnd() * r * 0.6, g = c.createRadialGradient(Math.cos(a) * d, Math.sin(a) * d, 0, Math.cos(a) * d, Math.sin(a) * d, r * (0.25 + rnd() * 0.2)); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(-r, -r, 2 * r, 2 * r); } c.fillStyle = '#fff'; },
  lines: (c, r) => { const w = r / 6; for (let x = -r + w * 0.5; x < r; x += w * 2) c.fillRect(x, -r, w, 2 * r); },
  finelines: (c, r) => { const w = r / 14; for (let x = -r + w * 0.5; x < r; x += w * 2) c.fillRect(x, -r, w, 2 * r); },
  grid: (c, r) => { c.fillRect(-r, -r, 2 * r, 2 * r); c.fillStyle = '#000'; const w = r / 9; for (let k = -r; k < r; k += r / 2.5) { c.fillRect(k, -r, w, 2 * r); c.fillRect(-r, k, 2 * r, w); } c.fillStyle = '#fff'; },
  window: (c, r) => { const g = r * 0.07, s = (r * 1.3 - g) / 2; for (const x of [-1, 1]) for (const y of [-1, 1]) c.fillRect(x < 0 ? -s - g / 2 : g / 2, y < 0 ? -s - g / 2 : g / 2, s, s); },
  church: (c, r) => { c.beginPath(); c.moveTo(-r * 0.4, r * 0.7); c.lineTo(-r * 0.4, -r * 0.2); c.arc(0, -r * 0.2, r * 0.4, Math.PI, 0); c.lineTo(r * 0.4, r * 0.7); c.closePath(); c.fill(); c.fillStyle = '#000'; c.fillRect(-r * 0.03, -r * 0.6, r * 0.06, r * 1.3); c.fillRect(-r * 0.4, r * 0.05, r * 0.8, r * 0.06); c.fillStyle = '#fff'; },
  spokes: (c, r) => { for (let i = 0; i < 12; i++) { const a = (i * TAU) / 12; poly(c, [[0, 0], [Math.cos(a - 0.11) * r, Math.sin(a - 0.11) * r], [Math.cos(a + 0.11) * r, Math.sin(a + 0.11) * r]]); } },
  fan: (c, r) => { for (let i = 0; i < 6; i++) { const a = (i * TAU) / 6; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, r, a, a + 0.5); c.closePath(); c.fill(); } },
  spiral: (c, r) => { c.lineWidth = r * 0.12; c.lineCap = 'round'; c.beginPath(); for (let t = 0; t < 1; t += 0.004) { const a = t * TAU * 3, d = t * r * 0.9; t ? c.lineTo(Math.cos(a) * d, Math.sin(a) * d) : c.moveTo(0, 0); } c.stroke(); },
  vortex: (c, r) => { for (let arm = 0; arm < 4; arm++) { c.lineWidth = r * 0.1; c.lineCap = 'round'; c.beginPath(); for (let t = 0; t < 1; t += 0.01) { const a = arm * (TAU / 4) + t * 3, d = t * r * 0.9; t ? c.lineTo(Math.cos(a) * d, Math.sin(a) * d) : c.moveTo(0, 0); } c.stroke(); } },
  tunnel: (c, r) => { for (let k = 0.15; k < 0.95; k += 0.17) ring(c, r * k, r * 0.07); },
  rings2: (c, r) => { ring(c, r * 0.35, r * 0.12); ring(c, r * 0.75, r * 0.12); },
  triangles: (c, r) => { for (let i = 0; i < 8; i++) { const a = (i * TAU) / 8, x = Math.cos(a) * r * 0.62, y = Math.sin(a) * r * 0.62; c.save(); c.translate(x, y); c.rotate(a + Math.PI / 2); poly(c, ngon(3, r * 0.16)); c.restore(); } },
  honeycomb: (c, r) => { c.lineWidth = r * 0.05; const s = r / 3.4; for (let y = -r; y <= r; y += s * 1.5) for (let x = -r; x <= r; x += s * Math.sqrt(3)) { const ox = (Math.round(y / (s * 1.5)) & 1) * s * Math.sqrt(3) / 2; c.beginPath(); ngon(6, s * 0.9, Math.PI / 6).forEach(([px, py], i) => (i ? c.lineTo(x + ox + px, y + py) : c.moveTo(x + ox + px, y + py))); c.closePath(); c.stroke(); } },
  checker: (c, r) => { const s = r / 3; for (let y = -r; y < r; y += s) for (let x = -r; x < r; x += s) if (((Math.round(x / s) + Math.round(y / s)) & 1) === 0) c.fillRect(x, y, s, s); },
  zigzag: (c, r) => { c.lineWidth = r * 0.08; c.lineJoin = 'miter'; for (let y = -r; y < r; y += r / 3) { c.beginPath(); for (let x = -r, k = 0; x <= r; x += r / 5, k++) (k ? c.lineTo(x, y + (k & 1 ? r * 0.12 : 0)) : c.moveTo(x, y)); c.stroke(); } },
  bubbles: (c, r, rnd) => { for (let i = 0; i < 18; i++) { const a = rnd() * TAU, d = Math.sqrt(rnd()) * r * 0.8; c.lineWidth = r * 0.03; c.beginPath(); c.arc(Math.cos(a) * d, Math.sin(a) * d, r * (0.05 + rnd() * 0.13), 0, TAU); c.stroke(); } },
  half: (c, r) => { c.fillRect(-r, -r, r, 2 * r); },
  fire: (c, r, rnd) => { for (let i = 0; i < 7; i++) { const x = -r * 0.75 + (i * r * 1.5) / 6, h = r * (0.7 + rnd() * 0.8), w = r * 0.16; c.beginPath(); c.moveTo(x - w, r); c.quadraticCurveTo(x - w * 1.3, r - h * 0.5, x + (rnd() - 0.5) * w, r - h); c.quadraticCurveTo(x + w * 1.3, r - h * 0.5, x + w, r); c.closePath(); c.fill(); } },
  tree: (c, r, rnd) => {
    c.lineCap = 'round';
    const branch = (x: number, y: number, a: number, l: number, w: number, d: number) => {
      if (d === 0 || l < r * 0.03) return;
      const x2 = x + Math.cos(a) * l, y2 = y + Math.sin(a) * l;
      c.lineWidth = w; c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.stroke();
      branch(x2, y2, a - 0.45 - rnd() * 0.2, l * 0.72, w * 0.68, d - 1); branch(x2, y2, a + 0.45 + rnd() * 0.2, l * 0.72, w * 0.68, d - 1);
    };
    branch(0, r * 0.95, -Math.PI / 2, r * 0.42, r * 0.11, 7);
  },
  net: (c, r) => { c.lineWidth = r * 0.04; for (let k = -2 * r; k < 2 * r; k += r / 3.5) { c.beginPath(); c.moveTo(k, -r); c.lineTo(k + 2 * r, r); c.stroke(); c.beginPath(); c.moveTo(k, r); c.lineTo(k + 2 * r, -r); c.stroke(); } },
  slots: (c, r) => { for (let i = 0; i < 16; i++) { c.save(); c.rotate((i * TAU) / 16); c.fillRect(r * 0.35, -r * 0.035, r * 0.55, r * 0.07); c.restore(); } },
  crosslines: (c, r) => { c.fillRect(-r, -r * 0.06, 2 * r, r * 0.12); c.fillRect(-r * 0.06, -r, r * 0.12, 2 * r); },
};

// Glass gobos: a picture in colour (dichroic glass), not a cut-out in metal. Drawn here; the beam
// takes its colours (white light through it is the glass's colours).
const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
const blobs = (c: CanvasRenderingContext2D, r: number, rnd: () => number, n: number, col: () => string, size = 0.35) => {
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, d = Math.sqrt(rnd()) * r * 0.85, x = Math.cos(a) * d, y = Math.sin(a) * d, rr = r * (size * 0.4 + rnd() * size);
    const g = c.createRadialGradient(x, y, 0, x, y, rr); const k = col(); g.addColorStop(0, k); g.addColorStop(1, k.replace(/,[\d.]+\)$/, ',0)'));
    c.fillStyle = g; c.fillRect(-r, -r, 2 * r, 2 * r);
  }
};
const GLASS: Record<string, Draw> = {
  rainbow: (c, r) => { for (let i = 0; i < 12; i++) { c.fillStyle = hsl(i * 30, 95, 55); c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, r, (i * TAU) / 12, ((i + 1) * TAU) / 12 + 0.01); c.closePath(); c.fill(); } },
  nebula: (c, r, rnd) => { c.fillStyle = '#000'; c.fillRect(-r, -r, 2 * r, 2 * r); c.globalCompositeOperation = 'lighter'; blobs(c, r, rnd, 14, () => hsl(250 + rnd() * 90, 90, 45, 0.8)); c.fillStyle = '#fff'; for (let i = 0; i < 40; i++) disc(c, (rnd() - 0.5) * 1.8 * r, (rnd() - 0.5) * 1.8 * r, r * 0.012 + rnd() * r * 0.012); c.globalCompositeOperation = 'source-over'; },
  fireglass: (c, r, rnd) => { c.globalCompositeOperation = 'lighter'; blobs(c, r, rnd, 18, () => hsl(rnd() * 45, 100, 50, 0.75), 0.3); c.globalCompositeOperation = 'source-over'; },
  ocean: (c, r, rnd) => { c.globalCompositeOperation = 'lighter'; blobs(c, r, rnd, 16, () => hsl(175 + rnd() * 50, 90, 45, 0.7), 0.35); c.strokeStyle = hsl(185, 90, 80, 0.9); c.lineWidth = r * 0.03; for (let y = -r; y < r; y += r / 4) { c.beginPath(); for (let x = -r; x <= r; x += r / 16) { const yy = y + Math.sin(x / r * 8 + y) * r * 0.07; x === -r ? c.moveTo(x, yy) : c.lineTo(x, yy); } c.stroke(); } c.globalCompositeOperation = 'source-over'; },
  aurora: (c, r) => { for (let k = 0; k < 5; k++) { const g = c.createLinearGradient(0, -r, 0, r); g.addColorStop(0, hsl(140 + k * 25, 90, 50, 0)); g.addColorStop(0.5, hsl(140 + k * 25, 90, 55, 0.8)); g.addColorStop(1, hsl(280, 80, 50, 0)); c.fillStyle = g; c.beginPath(); for (let x = -r; x <= r; x += r / 20) { const y = -r * 0.2 + Math.sin(x / r * 3 + k) * r * 0.3 + k * r * 0.1; x === -r ? c.moveTo(x, y) : c.lineTo(x, y); } c.lineTo(r, r); c.lineTo(-r, r); c.closePath(); c.globalCompositeOperation = 'lighter'; c.fill(); } c.globalCompositeOperation = 'source-over'; },
  stained: (c, r, rnd) => { const s = r / 2.2; for (let y = -r; y < r; y += s) for (let x = -r; x < r; x += s) { c.fillStyle = hsl([0, 45, 120, 210, 280][Math.floor(rnd() * 5)], 85, 50); c.fillRect(x + r * 0.03, y + r * 0.03, s - r * 0.06, s - r * 0.06); } },
  galaxyglass: (c, r, rnd) => { c.globalCompositeOperation = 'lighter'; for (let arm = 0; arm < 3; arm++) for (let i = 0; i < 60; i++) { const t = i / 60, a = arm * (TAU / 3) + t * 4 + rnd() * 0.3, d = t * r * 0.9; c.fillStyle = hsl(200 + t * 100, 90, 60, 0.9); disc(c, Math.cos(a) * d, Math.sin(a) * d, r * (0.06 - t * 0.045)); } c.globalCompositeOperation = 'source-over'; },
  sunset: (c, r) => { const g = c.createLinearGradient(0, -r, 0, r); g.addColorStop(0, hsl(260, 80, 35)); g.addColorStop(0.45, hsl(330, 90, 50)); g.addColorStop(0.7, hsl(25, 100, 55)); g.addColorStop(1, hsl(48, 100, 60)); c.fillStyle = g; c.fillRect(-r, -r, 2 * r, 2 * r); c.fillStyle = hsl(50, 100, 80); disc(c, 0, r * 0.35, r * 0.22); },
};

// [id, name, words, glyph or a drawn one]. Order matters: the first whose words match a slot's name
// wins, so the specific ones come first.
const G: [string, string, string, string][] = [
  ['rainbow', 'Rainbow glass', 'rainbow|regenbogen|multi ?colou?r|colou?r ?wheel glass|prism glass|spectrum', 'G:rainbow'],
  ['nebula', 'Nebula glass', 'nebula glass|space glass|cosmos|kosmos|universe|weltall', 'G:nebula'],
  ['fireglass', 'Fire glass', 'fire glass|flame glass|feuerglas|lava glass|inferno', 'G:fireglass'],
  ['ocean', 'Ocean glass', 'ocean glass|water glass|sea glass|blue water|unterwasser glas|aquarium', 'G:ocean'],
  ['aurora', 'Aurora glass', 'aurora|northern lights|nordlicht|polarlicht', 'G:aurora'],
  ['stained', 'Stained glass', 'stained|buntglas|bleiglas|mosaic|mosaik|kirchenglas|tiffany', 'G:stained'],
  ['galaxyglass', 'Galaxy glass', 'galaxy glass|milky way glass|galaxie glas|colou?r galaxy', 'G:galaxyglass'],
  ['sunset', 'Sunset glass', 'sunset|sonnenuntergang|sunrise|sonnenaufgang|dusk|dawn|abendrot', 'G:sunset'],
  ['starfield', 'Star field', 'star ?field|stars ?field|sternen(himmel|feld)|night sky|sky|himmel|sternenhimmel|milky', 'D'],
  ['galaxy', 'Galaxy', 'galax|nebula|nebel', 'D'],
  ['comet', 'Comet', 'comet|komet|meteor|shooting star|sternschnuppe', '☄'],
  ['crescentstar', 'Crescent and star', 'crescent star|hilal|islam', '☪'],
  ['davidstar', 'Star of David', 'david|hexagram|magen', '✡'],
  ['staroutline', 'Star outline', 'star outline|open star', '☆'],
  ['bigstar', 'Star 4', 'four ?point|4 ?point|cross star|vierzack', '✧'],
  ['stars', 'Stars', 'stars|sterne|multi ?star|star ?burst', '✶'],
  ['star8', 'Eight-point star', 'eight|8 ?point|compass|kompass|rose des vents|windrose', '✴'],
  ['star12', 'Twelve-point star', 'twelve|12 ?point', '✹'],
  ['sparkle', 'Sparkle', 'sparkle|twinkle|glitter|funkel|glanz|shine', '✦'],
  ['star', 'Star', 'star|stern|pentagram', '★'],
  ['snowflake3', 'Snowflake 3', 'frost flower|eisblume', '❆'],
  ['snowflake2', 'Snowflake 2', 'crystal|kristall', '❅'],
  ['snowflake', 'Snowflake', 'snow|schnee|flake|flocke|ice|eis|winter|christmas|weihnacht|frozen', '❄'],
  ['flower2', 'Flower 2', 'flower 2|flowers|blüten|floral', '❀'],
  ['sunflower', 'Sunflower', 'sunflower|sonnenblume', '✾'],
  ['flower', 'Flower', 'flower|blume|blumen|blossom|blüte|bluete|daisy|gänseblüm|petal', '✿'],
  ['rose', 'Rose', 'rose|lotus', '❁'],
  ['florette', 'Florette', 'florette|ornament|propeller', '❋'],
  ['sunburst', 'Sunburst', 'sunburst|rays|strahlen|spokes|speichen|burst|explosion|radial|beams', 'D:spokes'],
  ['fan', 'Fan', 'fan|fächer|faecher|blades|windmill|windmühle|ventil', 'D'],
  ['sun', 'Sun', 'sun|sonne|solar', '☀'],
  ['moon', 'Moon', 'moon|mond|crescent|halbmond|luna', '☾'],
  ['heartoutline', 'Heart outline', 'heart outline|open heart', '♡'],
  ['heart', 'Heart', 'heart|herz|love|liebe|valentin', '♥'],
  ['spade', 'Spade', 'spade|pik', '♠'],
  ['club', 'Club', 'club|kreuz \\(karten|treff', '♣'],
  ['suitdiamond', 'Diamond (cards)', 'karo|card diamond', '♦'],
  ['shamrock', 'Shamrock', 'shamrock|clover|klee|irish|irland|patrick', '☘'],
  ['maltese', 'Maltese cross', 'maltese|malteser|iron cross|eisernes', '✠'],
  ['latincross', 'Latin cross', 'latin cross|church cross|christian|kirchenkreuz|crucifix', '✝'],
  ['crosslines', 'Crosshair', 'crosshair|fadenkreuz|cross lines', 'D'],
  ['x', 'X', '\\bx\\b|saltire|andreas', '✖'],
  ['cross', 'Cross', 'cross|kreuz|plus', '✚'],
  ['triangleoutline', 'Triangle outline', 'triangle outline|open triangle', '△'],
  ['triangles', 'Triangles', 'triangles|dreiecke|pyramids', 'D'],
  ['triangle', 'Triangle', 'triangle|dreieck|pyramid|delta', '▲'],
  ['squareoutline', 'Square outline', 'square outline|frame|rahmen', '□'],
  ['square', 'Square', 'square|quadrat|box|block|rectangle|rechteck', '■'],
  ['church', 'Church window', 'church window|kirchenfenster|gothic|gotisch|arch|bogen', 'D'],
  ['window', 'Window', 'window|fenster|panes|scheiben', 'D'],
  ['net', 'Net', 'net|netz|diamond mesh|chain|fence|zaun', 'D'],
  ['grid', 'Grid', 'grid|raster|gitter|lattice|grill|mesh', 'D'],
  ['honeycomb', 'Honeycomb', 'honeycomb|wabe|waben|hexagons|hive|bienen', 'D'],
  ['hexagon', 'Hexagon', 'hexagon|hex|sechseck', '⬢'],
  ['pentagon', 'Pentagon', 'pentagon|fünfeck|fuenfeck', '⬟'],
  ['diamond', 'Diamond', 'diamond|raute|rhomb|gem|edelstein|jewel', '◆'],
  ['bullseye', 'Bullseye', 'bullseye|bulls eye|target|ziel|zielscheibe', '◎'],
  ['dotrings', 'Dot rings', 'dot rings|dots rings|punkte ?ringe', 'D'],
  ['dotring', 'Ring of dots', 'ring of dots|dot ring|dots ring|dot circle|punktring|punktekreis|necklace|kette|pearls|perlen', 'D'],
  ['bigdots', 'Big dots', 'big dots|large dots|große punkte|grosse punkte|polka', 'D'],
  ['dots', 'Dots', 'dots|punkte|dotted|pin ?spot|pixel|spots|tupfen|confetti', 'D'],
  ['rings2', 'Two rings', 'two rings|double ring|doppelring', 'D'],
  ['tunnel', 'Tunnel', 'tunnel|cone|kegel|concentric|konzentr|rings|ringe|circles|kreise|vortex rings|ripples', 'D'],
  ['ring', 'Ring', 'ring|donut|halo|annulus', '○'],
  ['circle', 'Circle', 'circle|kreis|disc|disk|scheibe|round|rund|dot|punkt|ball', '●'],
  ['breakup', 'Breakup', 'break ?up|breakup|texture|textur|random|abstract|abstrakt|splatter|splash|sprenkel|aufbruch|organic|stone|stein|rock|cells', 'D'],
  ['leaves', 'Leaves', 'leaves|leaf|blätter|blaetter|blatt|foliage|laub|forest|wald|jungle|dschungel|tree shadow|branches|zweige', 'D'],
  ['tree', 'Tree', 'tree|baum|bäume|baeume', 'D'],
  ['water', 'Water', 'water|wasser|waves|wellen|wave|welle|ocean|ozean|sea|meer|caustic|river|fluss|lake|aqua|underwater', 'D'],
  ['clouds', 'Clouds', 'cloud|wolke|wolken|fog|mist|haze|smoke|rauch|sky', 'D'],
  ['fire', 'Fire', 'fire|feuer|flame|flamme|flames|flammen|burn|brand|hell|hölle|hoelle|lava', 'D'],
  ['finelines', 'Fine lines', 'fine lines|feine linien|pinstripe|scan|scanlines|rain|regen', 'D'],
  ['lines', 'Lines', 'lines|linien|bars|balken|stripes|streifen|grating|blinds|jalousie|lamellen|slats|prison|gitterstäbe', 'D'],
  ['zigzag', 'Zigzag', 'zig ?zag|zickzack|chevron|lightning bars', 'D'],
  ['checker', 'Checker', 'checker|chess board|schach|karomuster|checkered|kariert', 'D'],
  ['spiral', 'Spiral', 'spiral|spirale|swirl|wirbel|twirl|twist|helix|snail|schnecke', 'D'],
  ['vortex', 'Vortex', 'vortex|whirl|strudel|twister|tornado|hurricane|galactic', 'D'],
  ['bubbles', 'Bubbles', 'bubble|blasen|blase|foam|schaum|champagne|sekt', 'D'],
  ['slots', 'Slots', 'slots|slits|schlitze|radial lines|teeth', 'D'],
  ['half', 'Half', 'half|halb|split|splitter|semi', 'D'],
  ['note', 'Music note', 'music|musik|note|noten|song|melody|melodie|disco', '♫'],
  ['peace', 'Peace', 'peace|frieden|hippie', '☮'],
  ['yinyang', 'Yin yang', 'yin|yang|tao|balance', '☯'],
  ['atom', 'Atom', 'atom|science|wissenschaft|physics|nuclear', '⚛'],
  ['dharma', 'Wheel', 'dharma|ship wheel|steuerrad|helm', '☸'],
  ['gear', 'Gear', 'gear|cog|zahnrad|wheel|machine|maschine|industrial|steampunk|technik', '⚙'],
  ['radiation', 'Radiation', 'radiation|radioactive|radioaktiv|strahlung', '☢'],
  ['biohazard', 'Biohazard', 'biohazard|bio ?hazard|toxic|giftig', '☣'],
  ['skull', 'Skull', 'skull|totenkopf|schädel|schaedel|pirate|pirat|death|tod|halloween|horror', '☠'],
  ['smiley', 'Smiley', 'smile|smiley|happy|face|gesicht|lachen', '☺'],
  ['lightning', 'Lightning', 'lightning|blitz|bolt|thunder|donner|storm|sturm|electric|elektr|energy|power', '⚡'],
  ['anchor', 'Anchor', 'anchor|anker|marine|navy|sailor|seemann', '⚓'],
  ['crown', 'Crown', 'crown|krone|king|könig|koenig|queen|royal', '♛'],
  ['arrow', 'Arrow', 'arrow|pfeil|direction|richtung', '➤'],
  ['recycle', 'Recycle', 'recycl|eco|umwelt', '♻'],
  ['infinity', 'Infinity', 'infinity|unendlich|endless|forever', '♾'],
  ['umbrella', 'Umbrella', 'umbrella|schirm', '☂'],
  ['snowman', 'Snowman', 'snowman|schneemann', '☃'],
  ['plane', 'Plane', 'plane|flugzeug|aircraft|airplane|flight', '✈'],
  ['scissors', 'Scissors', 'scissors|schere|cut', '✂'],
  ['fleur', 'Fleur-de-lis', 'fleur|lilie|lily|lis|scout', '⚜'],
  ['flowerstar', 'Flower star', 'asterisk|stern ?chen|sternchen', '✱'],
  ['burst', 'Burst', 'flash|firework|feuerwerk|explode|blast|bang|pop', '✺'],
  ['shield', 'Rosette', 'rosette|rosace|medallion|medaillon|mandala|kaleido', '❂'],
];
export const GOBOS: Gobo[] = G.map(([id, name, words, g]) => ({
  id, name, words: new RegExp(`(^|[^a-zäöüß])(${words})`, 'i'),
  ...(g.startsWith('G:') ? { draw: GLASS[g.slice(2)], glass: true } : g.startsWith('D') ? { draw: D[g.slice(2) || id] } : { glyph: g }),
}));
const INDEX = new Map(GOBOS.map((g, i) => [g.id, i]));
export const goboIndex = (id: string) => INDEX.get(id) ?? -1;

// For slots whose names say nothing ("Gobo 5"): a pattern each, in this order (common looks first)
const UNNAMED = ['dotring', 'sunburst', 'star', 'breakup', 'flower', 'tunnel', 'triangles', 'lines', 'snowflake', 'spiral', 'dots', 'leaves', 'starfield', 'window', 'gear', 'sun', 'water', 'honeycomb', 'vortex', 'grid'];
const OPEN = /(^|[^a-z])(open|offen|no gobo|kein gobo|white|weiß|weiss|blank|leer|clear|none|aus)($|[^a-z])/i;

// The pattern of each slot of a wheel (from the slots' names): an index into GOBOS, or null for open
export function wheelPatterns(labels: string[]): (number | null)[] {
  const out: (number | null)[] = [], used = new Set<number>();
  const said = labels.map((l) => {
    const s = (l ?? '').replace(/[_-]+/g, ' ').trim();
    if (!s || OPEN.test(s)) return null;
    const i = GOBOS.findIndex((g) => g.words!.test(s));
    return i >= 0 ? i : undefined;
  });
  for (const i of said) if (typeof i === 'number') used.add(i);
  let next = 0;
  for (const i of said) {
    if (i !== undefined) { out.push(i); continue; }
    // (the next of the list not on this wheel already)
    let k = -1;
    for (let tries = 0; tries < UNNAMED.length; tries++) { const c = goboIndex(UNNAMED[next++ % UNNAMED.length]); if (!used.has(c)) { k = c; break; } }
    if (k < 0) k = goboIndex(UNNAMED[next++ % UNNAMED.length]);
    used.add(k); out.push(k);
  }
  return out;
}
// A wheel with no named slots at all (a plain level on its channel): a few patterns spread over it
export const PLAIN_WHEEL = UNNAMED.slice(0, 8).map(goboIndex);

// the seed a pattern's "random" parts are drawn with (the same in the atlas and on a button)
export const goboSeed = (i: number) => 7919 * (i + 1);

// ---- the atlas: every pattern in one square texture, CELLS x CELLS of SIZE pixels
export const ATLAS_CELLS = 11, ATLAS_SIZE = 128;
export const FONT_FAMILY = 'LuxGoboSym2, LuxGoboSym1';
export function drawGobo(c: CanvasRenderingContext2D, g: Gobo, size: number, seed: number) {
  const r = size * 0.46;
  c.save();
  c.fillStyle = '#000'; c.fillRect(-size / 2, -size / 2, size, size);
  c.beginPath(); c.arc(0, 0, r, 0, TAU); c.clip();                // (the gobo's plate: round)
  c.fillStyle = '#fff'; c.strokeStyle = '#fff';
  if (g.draw) g.draw(c, r, seeded(seed));
  else if (g.glyph) {
    // the symbol as big as fits the plate, centred on what it really covers
    const px = size;
    c.font = `${px}px ${FONT_FAMILY}`; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    const m = c.measureText(g.glyph);
    const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    const k = w > 0 && h > 0 ? (r * 1.62) / Math.max(w, h) : 0.7;
    c.scale(k, k);
    c.fillText(g.glyph, -(m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2, (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  }
  c.restore();
}
export function drawAtlas(canvas: HTMLCanvasElement | OffscreenCanvas): void {
  const n = ATLAS_CELLS, s = ATLAS_SIZE;
  canvas.width = canvas.height = n * s;
  const c = canvas.getContext('2d') as CanvasRenderingContext2D;
  c.fillStyle = '#000'; c.fillRect(0, 0, n * s, n * s);
  GOBOS.forEach((g, i) => { c.save(); c.translate((i % n) * s + s / 2, Math.floor(i / n) * s + s / 2); drawGobo(c, g, s, goboSeed(i)); c.restore(); });
}

// the other way round, as fixture files say it: CCW, counter-clockwise, reverse, backwards, rückwärts
export const CCW_WORDS = /ccw|counter|anti|gegen|left|links|reverse|\brev\b|backward|\bback\b|rückwärts|rueckwaerts|retour/i;
// A gobo rotation channel as the wheel does it: a fixed angle (an index range), or turning one way
// or the other, slow to fast as its range says ("Rotation fast CW..slow CW", "CCW slow > fast",
// "Index 0..360", "Stop"). Without ranges: 0 is still, up to two turns a second clockwise.
// speed in radians a second (clockwise positive), angle in radians.
export function rotationOf(ranges: { from: number; to: number; label?: string }[] | undefined, x: number): { speed: number } | { angle: number } {
  const v = x > 0 ? (x < 1 ? x : 1) : 0, b = Math.round(v * 255);
  const r = ranges?.find((q) => b >= q.from && b <= q.to);
  if (!r) return { speed: v * 2 * TAU };
  const l = (r.label ?? '').toLowerCase(), k = r.to > r.from ? (b - r.from) / (r.to - r.from) : 0;
  const turning = /\bc?cw\b|clockwise|counter|anti|gegen|uhrzeiger|rotat|spin|dreh|speed|reverse|backward|forward|rückwärts|rueckwaerts|vorwärts|vorwaerts/.test(l);
  if (/index|angle|position|deg|°|winkel|grad/.test(l) && !/\bc?cw\b|speed|fast|slow|schnell|langsam/.test(l)) return { angle: k * TAU };
  if (/stop|still|halt|no rotation|no function|keine/.test(l) || !turning) return { speed: 0 };
  const ccw = CCW_WORDS.test(l);
  // how fast along the range: by its words, or by its numbers (100%..0%)
  const pc = /(\d+(?:\.\d+)?)\s*%?.*?\.\.+\s*(\d+(?:\.\d+)?)/.exec(l);
  let s = k;
  if (/fast.*slow|schnell.*langsam/.test(l)) s = 1 - k;
  else if (pc && /%|rpm|hz/.test(l)) { const a = +pc[1], z = +pc[2], top = Math.max(a, z) || 1; s = (a + (z - a) * k) / top; }
  return { speed: (ccw ? -1 : 1) * (0.1 + 1.9 * s) * Math.PI };
}

// A prism channel as the head does it: out (null), or in with so many facets, round or in a line.
// From the range it's in ("3-facet prism", "5 facet linear", "8-fach", "Prism 2"); a plain level
// (no ranges): in from a little up, three facets round.
export function prismOf(ranges: { from: number; to: number; label?: string }[] | undefined, x: number): { facets: number; linear: boolean } | null {
  const v = x > 0 ? (x < 1 ? x : 1) : 0, b = Math.round(v * 255);
  if (!ranges?.length) return v > 0.02 ? { facets: 3, linear: false } : null;
  const r = ranges.find((q) => b >= q.from && b <= q.to);
  const l = (r?.label ?? '').toLowerCase();
  if (!r || /(^|[^a-z])(open|out|off|no prism|kein|aus|none)($|[^a-z])/.test(l) || (!/prism|facet|fach|\d/.test(l))) return null;
  const n = /(\d+)\s*-?\s*(facet|fach|f\b|x\b|way|beam|strahl)/.exec(l)?.[1] ?? (/prism\s*(\d+)/.exec(l) ? '3' : undefined);
  const facets = Math.max(2, Math.min(8, +(n ?? 3)));
  return { facets, linear: /linear|\blin\b|row|reihe|line/.test(l) };
}
