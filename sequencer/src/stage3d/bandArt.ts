// The band on the banners: their own artwork (the "We Are Not The Band" banner, a picture the band
// gave us) on the backdrop and the side scrims, or, when the show names a band (settings.bandName),
// that name painted in the picture's style (textures.ts paintBandName). Loaded with the 3D stage's
// chunk; until it's in (or in a test runner without pictures) the painted banner shows instead.
import * as THREE from 'three';
import bannerUrl from './assets/band-banner.jpg';
import { paintBandName } from './textures';

const PIC = 774 / 340;                       // the picture's shape (width / height)
let image: HTMLImageElement | undefined, loading = false;
const waiting: (() => void)[] = [];

// a canvas of a surface's shape (width / height), 2048 wide
function canvasFor(aspect: number) {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = Math.round(2048 / aspect);
  return c;
}
// the picture laid out on a canvas of the surface's own shape: filled edge to edge when the shapes
// are close (a little cut off), whole on the banner's dark ground when they aren't (never the band
// name cut in half)
function compose(img: HTMLImageElement, aspect: number) {
  const c = canvasFor(aspect), w = c.width, h = c.height;
  const g = c.getContext('2d');
  if (!g) return img;
  g.fillStyle = '#0d0d0f'; g.fillRect(0, 0, w, h);
  const cover = Math.abs(Math.log(aspect / PIC)) < 0.15;
  const k = cover ? Math.max(w / img.width, h / img.height) : Math.min(w / img.width, (h * 0.92) / img.height);
  const dw = img.width * k, dh = img.height * k;
  g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return c;
}
// the name painted on a canvas of the surface's shape
function named(name: string, aspect: number) {
  const c = canvasFor(aspect), g = c.getContext('2d');
  if (g) paintBandName(g, c.width, c.height, name);
  return c;
}

export interface BandSurface {
  t: THREE.Texture;
  // what it shows: the name, or (empty) the picture
  show: (name?: string) => void;
  shown: () => string;
}
// A surface of this shape (width / height) showing the band: one texture for its life, its picture
// swapped in place (the baked meshes keep using it). `fallback`: what shows until the picture is in.
export function bandSurface(aspect: number, fallback: THREE.Texture): BandSurface {
  const t = new THREE.Texture();
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  let name = '';
  // (a picture of another size than the one before needs a fresh upload: dispose, then update;
  // updating alone writes it into a corner of the old one)
  const put = (img: TexImageSource | HTMLCanvasElement) => { if (t.image) t.dispose(); t.image = img; t.needsUpdate = true; };
  const picture = () => (image ? compose(image, aspect) : fallback.image as HTMLCanvasElement);
  const show = (n?: string) => {
    const next = (n ?? '').trim();
    if (next === name && t.image) return;
    name = next; t.userData.band = name;
    put(name ? named(name, aspect) : picture());
  };
  show();
  if (!image && import.meta.env.MODE !== 'test') {
    waiting.push(() => { if (!name) put(compose(image!, aspect)); });
    if (!loading) {
      loading = true;
      new THREE.ImageLoader().load(bannerUrl, (img) => { image = img; for (const w of waiting.splice(0)) w(); });
    }
  }
  return { t, show, shown: () => name };
}
