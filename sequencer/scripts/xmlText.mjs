// XML text back to plain text, all entities in ONE pass. build-qlc-index.mjs decoded "&amp;" first
// and "&quot;" after, so "&amp;quot;" came out as a quote instead of the text "&quot;", and numeric
// ones stayed in the names ("Shocker 90 IRC&#10;QRG"). A name is one line: breaks and runs of
// spaces become one space.
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** @param {string} s @returns {string} */
export function xmlText(s) {
  return s
    .replace(/&(?:(amp|lt|gt|quot|apos)|#([0-9]+)|#x([0-9a-fA-F]+));/g, (m, name, dec, hex) => {
      if (name) return NAMED[/** @type {keyof typeof NAMED} */ (name)];
      const cp = dec ? Number(dec) : parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}
