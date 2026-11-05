"""Rebuild the deterministic CRT grain/scanline engineering lookup texture."""
from pathlib import Path
import struct
import zlib

state = 0x4D414245
noise = []
for _ in range(256 * 256):
    state ^= (state << 13) & 0xFFFFFFFF
    state ^= state >> 17
    state ^= (state << 5) & 0xFFFFFFFF
    state &= 0xFFFFFFFF
    noise.append(state & 255)
raw = b"".join(b"\0" + bytes(value for x in range(256) for value in (
    noise[y * 256 + x], 255 if y % 2 == 0 else 0,
    noise[(y // 5) * 256 + x // 5], 255)) for y in range(256))

def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

path = Path(__file__).resolve().parents[1] / "assets/textures/crt-grain.png"
path.parent.mkdir(exist_ok=True)
path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 256, 256, 8, 6, 0, 0, 0))
    + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
