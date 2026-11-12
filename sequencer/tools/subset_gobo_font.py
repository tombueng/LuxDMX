#!/usr/bin/env python3
"""Cut the gobo symbols out of the Noto symbol fonts (SIL Open Font License 1.1).

The 3D stage draws the symbol gobos (src/stage3d/gobos.ts) with these two small fonts, so every
computer draws the same pattern. Reads the glyphs gobos.ts uses, takes each from Noto Sans
Symbols 2 where it has it, else from Noto Sans Symbols, and writes two WOFF2 files plus the licence
next to them. Run it again after adding a symbol gobo:

    python3 tools/subset_gobo_font.py [path/to/noto/fonts]

Needs fonttools and brotli (pip install fonttools brotli). The family is renamed (a cut-down font
is a modified version under the OFL).
"""
import re, sys, pathlib
from fontTools.ttLib import TTFont
from fontTools import subset

here = pathlib.Path(__file__).resolve().parent.parent
fonts = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/usr/share/fonts/truetype/noto')
src = (here / 'src/stage3d/gobos.ts').read_text(encoding='utf-8')
glyphs = sorted(set(re.findall(r"'D'|'D:[a-z]+'|'(.)'\],", src)) - {''})
out = here / 'src/stage3d/assets'
files = {'2': fonts / 'NotoSansSymbols2-Regular.ttf', '1': fonts / 'NotoSansSymbols-Regular.ttf'}
cmaps = {k: TTFont(str(f)).getBestCmap() for k, f in files.items()}
pick = {'2': [], '1': []}
missing = []
for g in glyphs:
    c = ord(g)
    k = '2' if c in cmaps['2'] else '1' if c in cmaps['1'] else None
    (pick[k] if k else missing).append(g)
if missing:
    sys.exit('not in either font: ' + ' '.join(missing))
for k, chars in pick.items():
    if not chars:
        continue
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = []
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    opts.notdef_outline = True
    font = TTFont(str(files[k]))
    s = subset.Subsetter(opts)
    s.populate(unicodes=[ord(c) for c in chars])
    s.subset(font)
    family = f'LuxGoboSym{k}'
    for rec in font['name'].names:
        if rec.nameID in (1, 4, 16):
            rec.string = family
        elif rec.nameID == 6:
            rec.string = family + '-Regular'
        elif rec.nameID == 3:
            rec.string = family + ' (a subset of Noto Sans Symbols' + (' 2' if k == '2' else '') + ')'
    path = out / f'gobo-sym{k}.woff2'
    font.flavor = 'woff2'
    font.save(str(path))
    print(path.name, len(chars), 'glyphs,', path.stat().st_size, 'bytes:', ''.join(chars))
# the licence, as the OFL asks: it goes with the font files
cr = pathlib.Path('/usr/share/doc/fonts-noto-core/copyright').read_text(encoding='utf-8')
body = cr[cr.index('License: OFL-1.1\n PREAMBLE'):].split('\n')[1:]
text = []
for line in body:
    if line and not line.startswith(' '):
        break
    text.append('' if line.strip() == '.' else line[1:])
(out / 'gobo-symbols-OFL.txt').write_text(
    'gobo-sym1.woff2 and gobo-sym2.woff2 are subsets of Noto Sans Symbols and Noto Sans Symbols 2\n'
    '(https://github.com/notofonts), Copyright 2010-2020 Google Inc. / Google LLC, renamed LuxGoboSym1\n'
    'and LuxGoboSym2, made with tools/subset_gobo_font.py. They are licensed under the SIL Open Font\n'
    'License, Version 1.1:\n\n' + '\n'.join(text).strip() + '\n', encoding='utf-8')
print('gobo-symbols-OFL.txt written')
