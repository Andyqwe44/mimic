"""
payload/bgra.py — BGRA pixel frame payload (PayloadType.BGRA_FRAME).

Depends on: protocol.protocol (for PayloadType).
Does NOT depend on transport.

Payload body: [w:4 LE][h:4 LE][ch:4 LE][reserved:4][pixels...]
"""
import struct
from dataclasses import dataclass

HEADER_SIZE: int = 16
HEADER_STRUCT = struct.Struct("<IIII")  # w, h, ch, reserved


@dataclass
class BgraFrame:
    width: int
    height: int
    channels: int
    pixels: bytes

    def to_numpy(self):
        import numpy as np
        return np.frombuffer(self.pixels, dtype=np.uint8).reshape(
            (self.height, self.width, self.channels))


def pack(w: int, h: int, ch: int, pixels: bytes) -> bytes:
    """Pack BGRA pixels → payload bytes."""
    return HEADER_STRUCT.pack(w, h, ch, 0) + pixels


def unpack(payload: bytes) -> BgraFrame | None:
    """Unpack payload bytes → BgraFrame."""
    if len(payload) < HEADER_SIZE:
        return None
    w, h, ch, _ = HEADER_STRUCT.unpack(payload[:HEADER_SIZE])
    expected = w * h * ch
    pixels = payload[HEADER_SIZE:HEADER_SIZE + expected]
    if len(pixels) != expected:
        return None
    return BgraFrame(width=w, height=h, channels=ch, pixels=pixels)
