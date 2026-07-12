#!/usr/bin/env bash
# Regenerate all LuxDMX logo derivatives from the master artwork/luxdmx-logo.png.
# Run from repo root:  bash artwork/derive-logos.sh
set -e
SRC="artwork/luxdmx-logo.png"; OUT="artwork/derived"; mkdir -p "$OUT"
python -c "from PIL import Image; Image.open('$SRC').convert('RGB').resize((256,256), Image.LANCZOS).save('$OUT/logo.webp', format='WEBP', quality=90, method=6)"  # -> src/assets/logo.webp (firmware header, ~5KB WebP vs ~117KB PNG)
ffmpeg -y -loglevel error -i "$SRC" -vf scale=240:240:flags=lanczos "$OUT/logo-docs.png"   # -> docs/logo.png (README)
ffmpeg -y -loglevel error -i "$SRC" -vf scale=48:48:flags=lanczos  "$OUT/favicon.png"       # -> src/assets/favicon.png (firmware favicon)
for s in 16 32 180 192 512; do ffmpeg -y -loglevel error -i "$SRC" -vf scale=$s:$s:flags=lanczos "$OUT/favicon-$s.png"; done  # extras: manifest / apple-touch / PWA / social
echo "derived -> $OUT"
