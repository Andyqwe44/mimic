"""
protocol/protocol.py — wire format constants, shared with protocol.h + protocol.rs.

Frame: [magic:4][payload_size:4][type_tag:4][payload_body...]
"""
import struct
from enum import IntEnum

MAGIC: int = 0x4D415246
FRAME_HEADER_SIZE: int = 12  # magic(4) + size(4) + type_tag(4)

DEFAULT_TCP_PORT: int = 9999
DEFAULT_PIPE_NAME: str = "tictactoe_stream"

HEADER_STRUCT = struct.Struct("<III")  # magic, size, type_tag


class PayloadType(IntEnum):
    NONE = 0
    BGRA_FRAME = 1       # fallback only: [w][h][ch][res][pixels]
    H264_STREAM = 2      # preferred: [w][h][flags][res][annexb…] flags&1=keyframe
    CONTROL_MSG = 3      # JSON action; controlled host injects active target
    CAPABILITIES = 4     # JSON capability summary


# Peer LAN JSON (type=2) protocol version — keep in sync with protocol.h
PEER_JSON_V1 = 1  # list_windows / set_target{hwnd}
PEER_JSON_V2 = 2  # list_targets / set_target{id,...} + capabilities
PEER_JSON_VER = PEER_JSON_V2


def build_header(payload_size: int, type_tag: PayloadType) -> bytes:
    return HEADER_STRUCT.pack(MAGIC, payload_size, int(type_tag))


def parse_header(data: bytes) -> tuple[int, PayloadType] | None:
    magic, size, tag = HEADER_STRUCT.unpack(data)
    if magic != MAGIC:
        return None
    try:
        return size, PayloadType(tag)
    except ValueError:
        return None
