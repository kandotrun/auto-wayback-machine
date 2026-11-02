#!/usr/bin/env python3
"""Verify generated icon bytes, sizes and PNG chunk checksums."""
import struct
import zlib
from pathlib import Path
from generate_icons import make_png

for size in (16, 32, 48, 128):
    path = Path(__file__).resolve().parent.parent / "extension" / "icons" / f"icon{size}.png"
    data = path.read_bytes()
    assert data == make_png(size), path
    assert data[:8] == b"\x89PNG\r\n\x1a\n", path
    assert struct.unpack(">II", data[16:24]) == (size, size), path
    offset = 8
    while offset < len(data):
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        chunk = data[offset + 4:offset + 8 + length]
        crc = struct.unpack(">I", data[offset + 8 + length:offset + 12 + length])[0]
        assert zlib.crc32(chunk) & 0xFFFFFFFF == crc, path
        offset += 12 + length
    assert offset == len(data), path
print("Generated PNG bytes, dimensions and checksums: OK")
