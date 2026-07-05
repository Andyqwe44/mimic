//! hello_rust_recv.rs — Rust reads pipe, prints received text.
//!
//! 运行: ./hello_cpp_send.exe | rustc hello_rust_recv.rs && ./hello_rust_recv
//!
//! 流程:
//!   收 header → 读 type_tag → type=3 = CONTROL_MSG → 打印为字符串

use std::io::{self, Read};

// ── 协议常量 (直接内联, 零依赖) ──
const MAGIC: u32 = 0x4D415246;
const HDR_SIZE: usize = 12;

fn recv_frame(reader: &mut impl Read) -> io::Result<Option<(u32, Vec<u8>)>> {
    let mut hdr = [0u8; HDR_SIZE];
    if reader.read_exact(&mut hdr).is_err() { return Ok(None); }
    let magic = u32::from_le_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]);
    if magic != MAGIC { return Err(io::Error::new(io::ErrorKind::InvalidData, "bad magic")); }
    let size = u32::from_le_bytes([hdr[4], hdr[5], hdr[6], hdr[7]]);
    let tag  = u32::from_le_bytes([hdr[8], hdr[9], hdr[10], hdr[11]]);
    let mut payload = vec![0u8; size as usize];
    if size > 0 { reader.read_exact(&mut payload)?; }
    Ok(Some((tag, payload)))
}

fn type_name(tag: u32) -> &'static str {
    match tag { 0=>"NONE", 1=>"BGRA_FRAME", 2=>"H264", 3=>"CONTROL_MSG", _=>"UNKNOWN" }
}

fn main() {
    let mut reader = io::stdin().lock();
    while let Ok(Some((tag, payload))) = recv_frame(&mut reader) {
        let text = String::from_utf8_lossy(&payload);
        eprintln!("[rust] type={} ({}) payload={}B \"{}\"", tag, type_name(tag), payload.len(), text);
    }
    eprintln!("[rust] done");
}
