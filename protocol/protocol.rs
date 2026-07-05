// protocol/protocol.rs — wire format constants, shared with protocol.h + protocol.py.
//
// Frame: [magic:4][payload_size:4][type_tag:4][payload_body...]
//
// This module has zero dependencies on transport or payload modules.

pub const MAGIC: u32 = 0x4D415246;
pub const FRAME_HEADER_SIZE: usize = 12; // magic(4) + size(4) + type_tag(4)

pub const DEFAULT_TCP_PORT: u16 = 9999;
pub const DEFAULT_PIPE_NAME: &str = "tictactoe_stream";

/// Payload type tags — match protocol.h PayloadType enum.
#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PayloadType {
    None        = 0,
    BgraFrame   = 1,
    H264Stream  = 2,
    ControlMsg  = 3,
    Capabilities = 4,
}

impl PayloadType {
    pub fn from_u32(v: u32) -> Option<Self> {
        match v {
            0 => Some(Self::None),
            1 => Some(Self::BgraFrame),
            2 => Some(Self::H264Stream),
            3 => Some(Self::ControlMsg),
            4 => Some(Self::Capabilities),
            _ => None,
        }
    }
}

/// Build a frame header: [magic:4][size:4][type:4]
pub fn build_header(payload_size: u32, type_tag: PayloadType) -> [u8; 12] {
    let mut h = [0u8; 12];
    h[0..4].copy_from_slice(&MAGIC.to_le_bytes());
    h[4..8].copy_from_slice(&payload_size.to_le_bytes());
    h[8..12].copy_from_slice(&(type_tag as u32).to_le_bytes());
    h
}

/// Parse header → (payload_size, type_tag). None = bad magic.
pub fn parse_header(data: &[u8; 12]) -> Option<(u32, PayloadType)> {
    let magic = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
    if magic != MAGIC { return None; }
    let size = u32::from_le_bytes([data[4], data[5], data[6], data[7]]);
    let tag  = u32::from_le_bytes([data[8], data[9], data[10], data[11]]);
    Some((size, PayloadType::from_u32(tag)?))
}
