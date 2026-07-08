/**
 * commands.h — Backend command dispatch (replaces Tauri invoke).
 *
 * Each command receives parsed JSON args and returns a JSON result string.
 * Thread-safe for stream commands (start/stop from UI thread).
 */
#pragma once
#include <string>
#include <objbase.h>  // IStream

// Fwd declarations (avoid pulling in full WebView2.h in header)
struct ICoreWebView2Environment12;
struct ICoreWebView2_17;
struct IGlobalInterfaceTable;

/// Dispatch a WebMessage JSON command. Returns JSON response (or empty if fire-and-forget).
std::string dispatch_command(const std::string& json);

/// Push a BGRA frame to the WebView2 frontend via SharedBuffer (zero-copy).
/// Called from stream thread and single-frame capture.
/// Optional env12/wv17 for cross-thread use (stream thread provides its own).
void shared_buffer_push_frame(const uint8_t* bgra, int w, int h,
    ICoreWebView2Environment12* env12 = nullptr,
    ICoreWebView2_17* wv17 = nullptr);

/// Get GIT cookies for cross-thread WebView2 interface access.
/// Stream thread retrieves interfaces via GIT (IGlobalInterfaceTable).
void shared_buffer_marshal_for_stream(DWORD* out_env_cookie, DWORD* out_wv_cookie);
IGlobalInterfaceTable* shared_buffer_get_git();

/// Stream thread → main thread frame bridge.
/// Copies frame data, posts WM_STREAM_FRAME to main window.
/// Main WndProc calls shared_buffer_push_frame on STA thread.
void stream_bridge_push_frame(const uint8_t* bgra, int w, int h);

/// Initialize backend subsystems (logger, COM, WGC apartment).
void backend_init();

/// Shutdown backend (stop streams, flush logger).
void backend_shutdown();
