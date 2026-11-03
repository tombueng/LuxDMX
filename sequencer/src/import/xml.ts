// Small helpers for the XML formats (QLC+, GDTF). Element names are compared by localName, since
// QLC+ files carry a default namespace.
export function parseXml(text: string): Document {
  // The <?xml ...?> line says nothing a string needs, and some parsers reject a valid single-quoted
  // one (QLC+ writes those): drop it.
  const doc = new DOMParser().parseFromString(text.replace(/^\uFEFF?\s*<\?xml[^>]*\?>/, ''), 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error('not valid XML: ' + (err.textContent ?? '').slice(0, 120));
  return doc;
}
export const kids = (el: Element | null | undefined, name?: string): Element[] =>
  el ? [...el.children].filter((c) => !name || c.localName === name) : [];
export const kid = (el: Element | null | undefined, name: string): Element | undefined => kids(el, name)[0];
export const text = (el: Element | null | undefined) => (el?.textContent ?? '').trim();
export const num = (s: string | null | undefined, fallback = 0) => {
  const n = parseFloat(s ?? '');
  return Number.isFinite(n) ? n : fallback;
};
