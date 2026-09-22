#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$ROOT/assets/images"
SOURCE="/home/ubuntu/hy3n-rider-mobile/assets/images/rider-splash-logo.png"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Use the supplied HY3N car logo, remove only its black surround, and place it
# on a pure black canvas with an exact, readable DRIVER label beneath it.
magick "$SOURCE" -fuzz 3% -trim +repage "$WORK/logo.png"

magick -size 1024x1024 xc:'#000000' \
  \( "$WORK/logo.png" -resize 760x760 \) -gravity center -geometry +0-70 -composite \
  -font DejaVu-Sans-Bold -pointsize 74 -fill white -stroke none \
  -gravity south -annotate +0+105 'DRIVER' \
  "$ASSETS/icon.png"

magick -size 1920x1920 xc:'#000000' \
  \( "$WORK/logo.png" -resize 1320x1320 \) -gravity center -geometry +0-95 -composite \
  -font DejaVu-Sans-Bold -pointsize 118 -fill white -stroke none \
  -gravity south -annotate +0+190 'DRIVER' \
  "$ASSETS/driver-splash-artwork.png"

# Android adaptive foreground uses the same branded mark; the configured black
# adaptive background remains in android-icon-background.png.
cp "$ASSETS/icon.png" "$ASSETS/android-icon-foreground.png"
cp "$ASSETS/icon.png" "$ASSETS/android-icon-monochrome.png"
