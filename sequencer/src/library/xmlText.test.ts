// The QLC+ index's names come out of FixturesMap.xml as plain text (scripts/build-qlc-index.mjs):
// every entity decoded once, in one pass. (CodeQL js/double-escaping: "&amp;" was decoded before
// "&quot;", so the text "&quot;" written as "&amp;quot;" became a quote; "&#10;" stayed in a name.)
import { describe, expect, it } from 'vitest';
import { xmlText } from '../../scripts/xmlText.mjs';

describe('xmlText', () => {
  it('decodes the five named entities', () => {
    expect(xmlText('Beam &amp; Wash &quot;Pro&quot; &lt;3&gt; it&apos;s')).toBe('Beam & Wash "Pro" <3> it\'s');
  });
  it('decodes each entity once: an escaped ampersand stays an ampersand', () => {
    expect(xmlText('&amp;quot;')).toBe('&quot;');
    expect(xmlText('&amp;amp;')).toBe('&amp;');
    expect(xmlText('&amp;#10;')).toBe('&#10;');
  });
  it('decodes numeric entities, a name stays on one line', () => {
    expect(xmlText('Shocker 90 IRC&#10;QRG')).toBe('Shocker 90 IRC QRG');
    expect(xmlText('Caf&#xE9;  Par&#233;')).toBe('Café Paré');
  });
  it('leaves what is not an entity as it is', () => {
    expect(xmlText('R&D 5 & 6 &nbsp; &#0; &#x110000;')).toBe('R&D 5 & 6 &nbsp; &#0; &#x110000;');
  });
});
