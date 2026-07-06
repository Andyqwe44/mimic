/**
 * capture_wgc_ffi.h — C-compatible FFI wrapper for WgcCapture.
 * Called from Rust via extern "C". No C++ types in the interface.
 */
#pragma once
#include <windows.h>
#include <cstdint>

#ifdef __cplusplus
extern "C" {
#endif

/// Opaque handle to a WGC stream session.
typedef struct WgcStreamHandle WgcStreamHandle;

/// Start a WGC capture stream for the given window.
/// Returns handle on success, nullptr on failure.
WgcStreamHandle* wgc_stream_start(HWND hwnd, int max_dim);

/// Read the latest frame from the stream.
/// Copies pixel data into buf (must be at least buf_size bytes).
/// Returns number of bytes written (0 = no new frame yet).
/// w/h/ch are filled with the frame dimensions (BGRA, 4 channels).
int wgc_stream_read(WgcStreamHandle* h, uint8_t* buf, int buf_size,
                    int* out_w, int* out_h, int* out_ch);

/// Check if the stream is still running and healthy.
int wgc_stream_is_ok(WgcStreamHandle* h);

/// Stop the stream and release all resources.
void wgc_stream_stop(WgcStreamHandle* h);

/// Single-frame capture (no streaming). Returns 0 on failure.
int wgc_capture_single(HWND hwnd, uint8_t* buf, int buf_size,
                       int* out_w, int* out_h, int* out_ch);

#ifdef __cplusplus
}
#endif
