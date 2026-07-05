"""
Stream Protocol — pure transport layer. Payload-agnostic.

Frame format (binary, little-endian):
  [magic:4 "FRAM"][size:4 LE][payload: size bytes]

Payload is opaque bytes. Application layer defines its own format.
For BGRA frame payload: [w:4][h:4][ch:4][reserved:4][pixels: w*h*ch bytes]

Keep in sync with:
  common/include/stream_protocol.hpp
  monitor_web/src-tauri/src/stream_protocol.rs
"""
import struct
import socket
from dataclasses import dataclass
from typing import Iterator, Optional

# ── Transport constants ──────────────────────────────────
DEFAULT_TCP_PORT: int = 9999
DEFAULT_HOST: str = "127.0.0.1"
DEFAULT_PIPE_NAME: str = "tictactoe_stream"

FRAME_MAGIC: int = 0x4D415246  # "FRAM" LE
FRAME_HEADER_SIZE: int = 8     # magic(4) + size(4)

TRANSPORT_HEADER = struct.Struct("<II")  # magic, size

# ── Application payload: BGRA frame ──────────────────────
BGRA_HEADER_SIZE: int = 16  # w(4) + h(4) + ch(4) + reserved(4)
BGRA_HEADER = struct.Struct("<IIII")  # w, h, ch, reserved


# ═══ Transport layer ═══════════════════════════════════════

def build_frame_header(payload_size: int) -> bytes:
    return TRANSPORT_HEADER.pack(FRAME_MAGIC, payload_size)

def parse_frame_header(data: bytes) -> Optional[int]:
    """Returns payload_size or None if bad magic."""
    magic, size = TRANSPORT_HEADER.unpack(data)
    if magic != FRAME_MAGIC:
        return None
    return size

def send_frame(sock: socket.socket, payload: bytes) -> None:
    sock.sendall(build_frame_header(len(payload)))
    sock.sendall(payload)

def recv_frame(sock: socket.socket) -> Optional[bytes]:
    """Receive one frame. Returns None on EOF."""
    hdr = _recv_exact(sock, FRAME_HEADER_SIZE)
    if not hdr:
        return None
    size = parse_frame_header(hdr)
    if size is None:
        # All-zero header = unchanged signal from sender
        if hdr == b"\x00" * FRAME_HEADER_SIZE:
            return None  # unchanged
        raise ValueError(f"Bad magic in frame header")
    return _recv_exact(sock, size)

def _recv_exact(sock: socket.socket, n: int) -> Optional[bytes]:
    buf = b""
    while len(buf) < n:
        try:
            chunk = sock.recv(n - len(buf))
            if not chunk:
                return None
            buf += chunk
        except (ConnectionError, OSError):
            return None
    return buf


# ═══ Application layer: BGRA frame payload ─────────────────

@dataclass
class Frame:
    width: int; height: int; channels: int; pixels: bytes

    def to_numpy(self):
        import numpy as np
        return np.frombuffer(self.pixels, dtype=np.uint8).reshape(
            (self.height, self.width, self.channels))

def pack_bgra_payload(w: int, h: int, ch: int, pixels: bytes) -> bytes:
    return BGRA_HEADER.pack(w, h, ch, 0) + pixels

def unpack_bgra_payload(payload: bytes) -> Frame:
    w, h, ch, _ = BGRA_HEADER.unpack(payload[:BGRA_HEADER_SIZE])
    return Frame(width=w, height=h, channels=ch, pixels=payload[BGRA_HEADER_SIZE:])


# ═══ Convenience client ────────────────────────────────────

class StreamClient:
    """Connect to TCP stream, iterate application-level Frames."""

    def __init__(self, host: str = DEFAULT_HOST, port: int = DEFAULT_TCP_PORT):
        self.host = host; self.port = port; self._sock: socket.socket | None = None

    def connect(self) -> None:
        self._sock = socket.create_connection((self.host, self.port), timeout=5.0)

    def close(self) -> None:
        if self._sock: self._sock.close(); self._sock = None

    def __enter__(self): self.connect(); return self
    def __exit__(self, *args): self.close()

    def read_frame(self) -> Optional[Frame]:
        payload = recv_frame(self._sock)
        if payload is None or len(payload) == 0:
            return None
        return unpack_bgra_payload(payload)

    def frames(self) -> Iterator[Frame]:
        while True:
            frame = self.read_frame()
            if frame is None: break
            yield frame
