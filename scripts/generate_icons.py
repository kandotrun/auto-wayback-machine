#!/usr/bin/env python3
"""Generate the extension icons with only the Python standard library.

Chrome manifest icons must be PNG files, but keeping binaries out of the
git repository keeps pushes simple — so the icons are generated locally
by install.sh instead of being committed.
"""
import math
import struct
import zlib
from pathlib import Path

BG = (43, 108, 176, 255)      # blue tile
FG = (255, 255, 255, 255)     # white clock face
HAND = (43, 108, 176, 255)    # blue hands


def dist_to_segment(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    if dx == dy == 0:
        return math.hypot(px - x1, py - y1)
    t = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))


def make_png(size: int) -> bytes:
    c = size / 2
    r = size * 0.32
    hand_w = max(1.2, size / 16)
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter: none
        for x in range(size):
            px = BG
            if math.hypot(x - c, y - c) <= r:
                px = FG
                if (dist_to_segment(x, y, c, c, c, size * 0.32) <= hand_w / 2
                        or dist_to_segment(x, y, c, c, size * 0.66, c) <= hand_w / 2):
                    px = HAND
            raw.extend(px)

    def chunk(tag, data):
        out = struct.pack(">I", len(data)) + tag + data
        return out + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))


def main():
    out_dir = Path(__file__).resolve().parent.parent / "extension" / "icons"
    out_dir.mkdir(exist_ok=True)
    for size in (16, 32, 48, 128):
        (out_dir / f"icon{size}.png").write_bytes(make_png(size))
    print(f"icons written to {out_dir}")


if __name__ == "__main__":
    main()
