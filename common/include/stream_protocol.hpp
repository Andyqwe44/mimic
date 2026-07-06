/**
 * Stream Protocol — pure transport layer. No knowledge of payload content.
 *
 * Frame format (binary, little-endian):
 *   [magic:4 "FRAM"][size:4 LE][payload: size bytes]
 *
 * magic = 0x4D415246 ("FRAM" in LE)
 * size  = payload byte count
 *
 * The payload is opaque bytes. Application layer defines its own format
 * (e.g. BGRA pixels with dimensions, H.264 NAL units, JSON, etc.)
 *
 * Keep in sync with:
 *   monitor_web/src-tauri/src/stream_protocol.rs
 *   model/stream_protocol.py
 */
#pragma once
#include <cstdint>

namespace stream_protocol {

// ── Network ─────────────────────────────────────────────
constexpr uint16_t DEFAULT_TCP_PORT   = 9999;
constexpr char     DEFAULT_HOST[]     = "127.0.0.1";

// ── Pipe ────────────────────────────────────────────────
constexpr char     DEFAULT_PIPE_NAME[] = "tictactoe_stream";

// ── Frame header ────────────────────────────────────────
constexpr uint32_t FRAME_MAGIC        = 0x5354524D;  // "STRM" LE (distinct from protocol/ magic "FRAM")
constexpr uint32_t FRAME_HEADER_SIZE  = 8;            // magic(4) + size(4)

// ── Application payload format (defined here for convenience, not enforced) ──
constexpr int      MAX_FRAME_DIM      = 640;
constexpr uint32_t FRAME_CH_BGRA      = 4;

// ── Helper: build frame header [magic:4][size:4] ───────
inline void build_frame_header(uint8_t* hdr, uint32_t payload_size) {
    hdr[0] = (uint8_t)(FRAME_MAGIC & 0xFF);
    hdr[1] = (uint8_t)((FRAME_MAGIC >> 8) & 0xFF);
    hdr[2] = (uint8_t)((FRAME_MAGIC >> 16) & 0xFF);
    hdr[3] = (uint8_t)((FRAME_MAGIC >> 24) & 0xFF);
    hdr[4] = (uint8_t)(payload_size & 0xFF);
    hdr[5] = (uint8_t)((payload_size >> 8) & 0xFF);
    hdr[6] = (uint8_t)((payload_size >> 16) & 0xFF);
    hdr[7] = (uint8_t)((payload_size >> 24) & 0xFF);
}

// ── Helper: parse header → (ok, payload_size) ──────────
inline bool parse_frame_header(const uint8_t* hdr, uint32_t& payload_size) {
    uint32_t magic = (uint32_t)hdr[0] | ((uint32_t)hdr[1]<<8)
                   | ((uint32_t)hdr[2]<<16) | ((uint32_t)hdr[3]<<24);
    if (magic != FRAME_MAGIC) return false;
    payload_size = (uint32_t)hdr[4] | ((uint32_t)hdr[5]<<8)
                 | ((uint32_t)hdr[6]<<16) | ((uint32_t)hdr[7]<<24);
    return true;
}

// ── Application payload helpers (optional, for BGRA frame payload) ──
// NOTE: canonical BGRA pack/unpack lives in common/payload/bgra.hpp (payload::bgra_pack/unpack).
// Prefer payload/bgra.hpp for new code. These are kept for backward compat with examples/.
constexpr uint32_t BGRA_HEADER_SIZE   = 16;  // w(4)+h(4)+ch(4)+reserved(4)
inline void build_bgra_payload_header(uint8_t* hdr, uint32_t w, uint32_t h, uint32_t ch) {
    auto w32 = [&](uint32_t v) { *hdr++ = (uint8_t)v; *hdr++ = (uint8_t)(v>>8); *hdr++ = (uint8_t)(v>>16); *hdr++ = (uint8_t)(v>>24); };
    w32(w); w32(h); w32(ch); w32(0);  // reserved
}
inline void parse_bgra_payload_header(const uint8_t* hdr, uint32_t& w, uint32_t& h, uint32_t& ch) {
    auto r32 = [](const uint8_t* p) -> uint32_t { return (uint32_t)p[0]|((uint32_t)p[1]<<8)|((uint32_t)p[2]<<16)|((uint32_t)p[3]<<24); };
    w = r32(hdr); h = r32(hdr+4); ch = r32(hdr+8);
}

} // namespace stream_protocol
