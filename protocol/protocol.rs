// protocol/protocol.rs — wire format constants, shared with protocol.h + protocol.py.
//
// Frame: [magic:4][payload_size:4][type_tag:4][payload_body...]
//
// This module has zero dependencies on transport or payload modules.
// Some items are unused within the Rust binary but kept for cross-language protocol parity.

#![allow(dead_code)]

pub const MAGIC: u32 = 0x4D415246;
pub const DEFAULT_TCP_PORT: u16 = 9999;

/// Payload type tags — match protocol.h PayloadType enum.
#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PayloadType {
    BgraFrame   = 1,
}

/// Build a frame header: [magic:4][size:4][type:4]
pub fn build_header(payload_size: u32, type_tag: PayloadType) -> [u8; 12] {
    let mut h = [0u8; 12];
    h[0..4].copy_from_slice(&MAGIC.to_le_bytes());
    h[4..8].copy_from_slice(&payload_size.to_le_bytes());
    h[8..12].copy_from_slice(&(type_tag as u32).to_le_bytes());
    h
}
