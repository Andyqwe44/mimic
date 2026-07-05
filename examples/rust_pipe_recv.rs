//! 示例: Rust 接收 pipe → 解析 BGRA payload
//!
//! 运行: ./cpp_pipe_send.exe | ./rust_pipe_recv

use std::io::{self, Read};

const FRAME_MAGIC: u32 = 0x4D415246;
const HDR_SIZE: usize = 8;  // magic(4) + size(4)
const BGRA_HDR_SIZE: usize = 16; // w(4)+h(4)+ch(4)+reserved(4)

fn read_frame(reader: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
    let mut hdr = [0u8; HDR_SIZE];
    if reader.read_exact(&mut hdr).is_err() { return Ok(None); }
    let magic = u32::from_le_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]);
    if magic != FRAME_MAGIC { return Err(io::Error::new(io::ErrorKind::InvalidData, "bad magic")); }
    let size = u32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]);
    let mut payload = vec![0u8; size as usize];
    reader.read_exact(&mut payload)?;
    Ok(Some(payload))
}

fn main() {
    let mut reader = io::stdin().lock();
    let mut frames = 0u64;

    while let Ok(Some(payload)) = read_frame(&mut reader) {
        frames += 1;
        // ── 应用层: 解析 BGRA payload ──
        if payload.len() >= BGRA_HDR_SIZE {
            let w = u32::from_le_bytes([payload[0], payload[1], payload[2], payload[3]]);
            let h = u32::from_le_bytes([payload[4], payload[5], payload[6], payload[7]]);
            let ch = u32::from_le_bytes([payload[8], payload[9], payload[10], payload[11]]);
            let px = payload.len() - BGRA_HDR_SIZE;
            eprintln!("[rust] frame {}: {}x{} ch={} pixels={}B payload={}B",
                frames, w, h, ch, px, payload.len());
        } else {
            eprintln!("[rust] frame {}: raw payload {}B", frames, payload.len());
        }
    }
    eprintln!("[rust] done: {} frames", frames);
}
