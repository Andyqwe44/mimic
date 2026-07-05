/// Stream Protocol — pure transport. Payload-agnostic.
///
/// Frame format (binary, little-endian):
///   [magic:4 "FRAM"][size:4 LE][payload: size bytes]
///
/// Keep in sync with:
///   common/include/stream_protocol.hpp
///   model/stream_protocol.py

pub const DEFAULT_TCP_PORT: u16 = 9999;
pub const DEFAULT_HOST: &str = "127.0.0.1";
pub const DEFAULT_PIPE_NAME: &str = "tictactoe_stream";

pub const FRAME_MAGIC: u32 = 0x4D415246; // "FRAM" LE
pub const FRAME_HEADER_SIZE: usize = 8;   // magic(4) + size(4)

/// Build transport header.
pub fn build_frame_header(payload_size: u32) -> [u8; 8] {
    let mut hdr = [0u8; 8];
    hdr[0..4].copy_from_slice(&FRAME_MAGIC.to_le_bytes());
    hdr[4..8].copy_from_slice(&payload_size.to_le_bytes());
    hdr
}

/// Parse transport header. Returns payload_size or None on bad magic.
pub fn parse_frame_header(data: &[u8; 8]) -> Option<u32> {
    let magic = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
    if magic != FRAME_MAGIC { return None; }
    Some(u32::from_le_bytes([data[4], data[5], data[6], data[7]]))
}

/// Send a frame: header + payload, then flush.
pub fn send_frame(writer: &mut impl std::io::Write, payload: &[u8]) -> std::io::Result<()> {
    let hdr = build_frame_header(payload.len() as u32);
    writer.write_all(&hdr)?;
    writer.write_all(payload)?;
    writer.flush()
}

/// Receive a frame: read header, then read payload.
pub fn recv_frame(reader: &mut impl std::io::Read) -> std::io::Result<Option<Vec<u8>>> {
    let mut hdr = [0u8; FRAME_HEADER_SIZE];
    if reader.read_exact(&mut hdr).is_err() { return Ok(None); }
    let Some(size) = parse_frame_header(&hdr) else {
        // Size 0 = unchanged signal from sender
        if hdr.iter().all(|&b| b == 0) { return Ok(None); }
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "bad magic"));
    };
    let mut payload = vec![0u8; size as usize];
    reader.read_exact(&mut payload)?;
    Ok(Some(payload))
}

// ── Application payload helpers (for BGRA frame payload) ──

pub const BGRA_HEADER_SIZE: usize = 16; // w(4)+h(4)+ch(4)+reserved(4)

pub fn build_bgra_payload(w: u32, h: u32, ch: u32, pixels: &[u8]) -> Vec<u8> {
    let mut payload = Vec::with_capacity(BGRA_HEADER_SIZE + pixels.len());
    payload.extend_from_slice(&w.to_le_bytes());
    payload.extend_from_slice(&h.to_le_bytes());
    payload.extend_from_slice(&ch.to_le_bytes());
    payload.extend_from_slice(&0u32.to_le_bytes()); // reserved
    payload.extend_from_slice(pixels);
    payload
}

pub fn parse_bgra_payload(payload: &[u8]) -> Option<(u32, u32, u32, &[u8])> {
    if payload.len() < BGRA_HEADER_SIZE { return None; }
    let w = u32::from_le_bytes([payload[0], payload[1], payload[2], payload[3]]);
    let h = u32::from_le_bytes([payload[4], payload[5], payload[6], payload[7]]);
    let ch = u32::from_le_bytes([payload[8], payload[9], payload[10], payload[11]]);
    Some((w, h, ch, &payload[BGRA_HEADER_SIZE..]))
}
