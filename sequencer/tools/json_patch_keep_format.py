#!/usr/bin/env python3
"""Carry the content of NEW json into the text of OLD json, keeping OLD's formatting.

Only the values that changed are rewritten (compactly, in the file's own one-line style); new keys
are added at the end of their object. Usage: json_patch_keep_format.py OLD NEW OUT
"""
import json, sys

def fmt(v):
    if isinstance(v, dict):
        return '{}' if not v else '{ ' + ', '.join(f'{json.dumps(k, ensure_ascii=False)}: {fmt(x)}' for k, x in v.items()) + ' }'
    if isinstance(v, list):
        return '[' + ', '.join(fmt(x) for x in v) + ']'
    return json.dumps(v, ensure_ascii=False)

class P:
    def __init__(self, s): self.s = s; self.i = 0
    def ws(self):
        while self.i < len(self.s) and self.s[self.i] in ' \t\r\n': self.i += 1
    def val(self):
        self.ws(); start = self.i; c = self.s[self.i]
        if c == '{':
            self.i += 1; kids = {}
            self.ws()
            if self.s[self.i] == '}': self.i += 1; return ('obj', start, self.i, kids)
            while True:
                self.ws(); k = self.string(); self.ws(); assert self.s[self.i] == ':'; self.i += 1
                kids[k] = self.val(); self.ws()
                if self.s[self.i] == ',': self.i += 1; continue
                assert self.s[self.i] == '}'; self.i += 1; return ('obj', start, self.i, kids)
        if c == '[':
            self.i += 1; items = []
            self.ws()
            if self.s[self.i] == ']': self.i += 1; return ('arr', start, self.i, items)
            while True:
                items.append(self.val()); self.ws()
                if self.s[self.i] == ',': self.i += 1; continue
                assert self.s[self.i] == ']'; self.i += 1; return ('arr', start, self.i, items)
        if c == '"': self.string(); return ('lit', start, self.i, None)
        while self.i < len(self.s) and self.s[self.i] not in ',}] \t\r\n': self.i += 1
        return ('lit', start, self.i, None)
    def string(self):
        assert self.s[self.i] == '"'; j = self.i + 1
        while self.s[j] != '"': j += 2 if self.s[j] == '\\' else 1
        k = json.loads(self.s[self.i:j + 1]); self.i = j + 1; return k

def main(old_p, new_p, out_p):
    text = open(old_p).read(); old = json.loads(text); new = json.load(open(new_p))
    edits = []   # (start, end, replacement)
    def walk(node, a, b):
        kind, s, e, kids = node
        if a == b: return
        if kind == 'obj' and isinstance(a, dict) and isinstance(b, dict):
            for k in a:
                if k not in b: raise SystemExit(f'removed key {k!r}: not handled')
            for k in a:
                walk(kids[k], a[k], b[k])
            added = [k for k in b if k not in a]
            if added:
                close = e - 1
                ins = ''.join(f', {json.dumps(k, ensure_ascii=False)}: {fmt(b[k])}' for k in added)
                if not a: ins = ins[2:]
                # (before the closing brace, after the last value: keep the brace's own line)
                last = max((kids[k][2] for k in kids), default=s + 1)
                edits.append((last, last, ins))
            return
        edits.append((s, e, fmt(b)))
    walk(P(text).val(), old, new)
    for s, e, r in sorted(edits, key=lambda x: x[0], reverse=True): text = text[:s] + r + text[e:]
    assert json.loads(text) == new, 'result differs from NEW'
    open(out_p, 'w').write(text)
    print(f'{len(edits)} edits')

if __name__ == '__main__': main(*sys.argv[1:4])
