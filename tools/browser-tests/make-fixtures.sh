#!/usr/bin/env bash
# Makes two 3-second test videos: A is red with a 440 Hz tone, B is blue with an 880 Hz tone (VP8 + Vorbis, 320x180, 30 fps).
set -euo pipefail
cd "$(dirname "$0")"
mk() { ffmpeg -v error -y -f lavfi -i "color=c=$2:s=320x180:r=30:d=3" -f lavfi -i "sine=frequency=$3:sample_rate=48000:duration=3" -c:v libvpx -b:v 400k -c:a libvorbis -ac 1 -shortest "fixtures/$1.webm"; }
mkdir -p fixtures
mk a 0xE02020 440
mk b 0x2040E0 880
echo "fixtures/a.webm and fixtures/b.webm written"
