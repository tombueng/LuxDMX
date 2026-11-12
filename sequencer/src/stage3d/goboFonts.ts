// The symbol fonts the gobos are drawn with (gobos.ts: a cut-down Noto Sans Symbols that comes with
// the app), loaded once for the page. The 3D atlas and the programmer's gobo buttons wait for them;
// without them the system's fonts draw the symbols. (On its own: gobos.ts stays plain code, for
// the tests that read it outside a browser.)
import goboSym1 from './assets/gobo-sym1.woff2?url';
import goboSym2 from './assets/gobo-sym2.woff2?url';

let fonts: Promise<void> | undefined;
export function loadGoboFonts(): Promise<void> {
  return (fonts ??= (async () => {
    try {
      for (const [family, url] of [['LuxGoboSym1', goboSym1], ['LuxGoboSym2', goboSym2]]) {
        const face = new FontFace(family, `url(${url})`);
        await face.load(); document.fonts.add(face);
      }
    } catch { /* the system's fonts, then */ }
  })());
}
