# CLAUDE.md — TicTacToe → General Visual Game AI

## 语言偏好
用中文思考和回答。代码、commit、PR 描述用英文。

## Project Vision

Build self-organizing hierarchical visual game AI. Model interface: **pixels in, actions out**.
C++ for all real-time work: capture + WebView2 GUI + HTTP server + logging.
Python for AI model training/inference.

## Architecture

```
┌─ monitor_app (C++ Win32) ──────────────────────────────────────────┐
│  React (TypeScript + Tailwind)  ←→  C++ backend (same process)    │
│       MXU-style UI               │  WebView2 COM 直接创建          │
│       Dashboard/Monitor/Log       │  SharedBuffer 直推              │
│  Browser: <img>/<canvas>/<video>  │  MJPEG/H.264 HTTP server       │
│  Build: Vite → dist/  C++ serve in prod                            │
│  Dev: Vite :5173  WebView2.Navigate("http://localhost:5173")       │
└──────────────────┬─────────────────────────────────────────────────┘
                   │
     ┌─────────────┼──────────────┐
     ▼             ▼              ▼
  C++ capture     C++ logger     TCP :9999
  GDI+WGC+DXGI    (logger/)      (agent.exe / Python)
  (capture/)                      binary frames
```

| Language | Role |
|----------|------|
| C++ | Host process: window, WebView2, capture, MJPEG/H.264 server, logging |
| TypeScript/React | UI (runs inside WebView2, same code regardless of host language) |
| Python | AI model training/inference (separate process, TCP :9999) |

## Why pure C++ (no Rust/Tauri)

- WebView2 is a native C++ COM API — C++ host eliminates Rust FFI layer entirely
- Capture methods already written in C++ — no cross-language marshaling
- SharedBuffer zero-copy: C++ COM → C++ COM, no transmute/vtable hacking
- Single build system: MSVC cl.exe + lib.exe, no cargo/npm build orchestration
- UI unchanged: React runs inside the SAME WebView2 control, host language irrelevant
- Vite HMR works by navigating WebView2 to `http://localhost:5173` during dev

## Project Structure

```
tictactoe/
├── logger/                       # Unified C++ logging engine (C API)
│   ├── logger.h                  capture_log_write_msg — THE ONE write function
│   ├── logger.cpp                Thread-safe file + ring buffer implementation
│   ├── logger.rs                 Rust FFI bindings (deprecated — to be removed)
│   └── build_logger_lib.cmd      MSVC → logger.lib
├── protocol/                     # Wire format — shared across C++/Python
│   ├── protocol.h / .py
├── common/                       # Shared C++ modules
│   ├── include/
│   │   ├── types.hpp             Shared types (Rect, sleep_ms)
│   │   └── capture_helpers.hpp   ScaleBgra, IsSolidColor, etc.
│   ├── payload/bgra.hpp          BGRA pixel frame pack/unpack
│   └── transport/                pipe.hpp, tcp.hpp
├── capture/                      # C++ screen capture (static libs + standalone tools)
│   ├── src/
│   │   ├── capture_common.cpp    Content validation + window state (FFI)
│   │   ├── capture_gdi.cpp       GetWindowDC (DPI-aware)
│   │   ├── capture_pw.cpp        PrintWindow + magenta sentinel (DPI-aware)
│   │   ├── capture_screen.cpp    ScreenBitBlt (virtual screen DC)
│   │   ├── capture_desktop.cpp   DesktopBlt (virtual screen DC)
│   │   ├── capture_auto.cpp      Auto-detect fallback chain (standalone tools only)
│   │   ├── capture_wgc.cpp       WGC GPU FramePool (D3D11+WinRT, OBS patterns)
│   │   ├── capture_wgc_ffi.cpp   WGC stream FFI wrapper
│   │   ├── capture_dxgi.cpp      DXGI Desktop Duplication backend
│   │   ├── capture_single.cpp    Standalone: single-frame screenshot
│   │   ├── capture_stream.cpp    Standalone: stream with frame-differ
│   │   └── capture_wgc_main.cpp  Standalone: WGC CLI (single/stream)
│   ├── include/
│   │   ├── capture_methods.h     Public FFI header (all methods)
│   │   ├── capture_wgc_ffi.h     WGC stream FFI header
│   │   ├── capture_internal.h    Shared GDI inline helpers + DpiGuard RAII
│   │   ├── capture_wgc.hpp       WGC C++ class (FrameArrived + condition_variable)
│   │   └── capture.hpp           ICaptureBackend (DXGI + GDI)
│   ├── build.cmd                 MSVC build (standalone exes)
│   └── build_capture_lib.cmd     MSVC → per-method .lib files (common, wgc, gdi, pw, screen, desktop)
├── monitor_app/                  # C++ host + React UI (WIP — will replace monitor_web/)
│   ├── src/
│   │   ├── main.cpp              Win32 window + WebView2 + command dispatch
│   │   ├── webview_setup.cpp     WebView2 init + SharedBuffer pipeline
│   │   ├── http_server.cpp       MJPEG HTTP server (replaces mjpeg_server.rs)
│   │   └── h264_encoder.cpp      H.264 MFT encoder (replaces h264_encoder.rs)
│   ├── ui/                       # React frontend (copied from monitor_web/src/)
│   │   ├── App.tsx               MXU-style UI (Dashboard/Monitor/Log/Settings)
│   │   └── ...
│   └── build.cmd                 MSVC → monitor_app.exe
├── monitor_web/                  # Tauri 2 + React (LEGACY — being replaced by monitor_app/)
│   ├── src/
│   │   └── App.tsx               Main UI (will move to monitor_app/ui/)
│   └── src-tauri/
│       ├── src/
│       │   ├── main.rs           Rust backend (being phased out)
│       │   ├── mjpeg_server.rs   MJPEG HTTP server (being ported to C++)
│       │   ├── h264_encoder.rs   H.264 MFT encoder (being ported to C++)
│       │   └── shared_texture.rs SharedBuffer (being ported to C++)
│       ├── Cargo.toml
│       └── tauri.conf.json
├── model/                        # Python
│   ├── action_space.py           Token vocabulary + serialization (LE)
│   ├── generic_agent.py          VisionEncoder + ActionDecoder + GenericAgent
│   ├── hierarchical.py           PerceptionSpecialist + StrategicReasoner
│   └── payload/bgra.py           Canonical BGRA pack/unpack for Python
├── test/                         # Test artifacts
│   ├── frames/                   Debug BGRA dumps (gitignored)
│   │   └── .gitkeep
│   ├── view_frame.py             Python frame viewer
│   ├── wgc_bench_capture.cpp     WGC capture-only benchmark
│   └── analyze_bench.py          Benchmark result analyzer
├── examples/                     # Protocol examples
│   ├── wgc_bench_send.cpp        WGC→TCP benchmark (C++)
│   ├── wgc_bench_recv.rs         TCP→file benchmark (Rust, legacy)
│   └── run_bench.bat
└── log/                          # Unified logs (gitignored)
    ├── agent_*.log
    └── wgc_*.log
```

## Build Commands

### Current (Tauri/Rust — legacy)
```bash
cd capture             && build_capture_lib.cmd   # Static libs per method
cd capture             && build.cmd                # Standalone C++ tools
cd monitor_web
npm install && npm run tauri dev                   # Vite HMR + Cargo watch
npm run tauri build                                # Release .exe
```

### Future (pure C++ — WIP)
```bash
cd logger              && build_logger_lib.cmd     # logger.lib
cd capture             && build_capture_lib.cmd    # per-method .lib files
cd monitor_app/app-ui  && npm run build            # Vite → dist/
cd monitor_app         && build.cmd                # MSVC → monitor_app.exe
```
Dev mode: run Vite dev server, then `monitor_app.exe --dev`.
Vite HMR works — WebView2 navigates to `http://localhost:5173`.

## Version

Currently `v0.2.0` (defined in `Cargo.toml`). Will move to a C++ header or build.cmd define.

## Wire Protocol (protocol/)

```
Frame: [magic:4 "FRAM"][body_size:4 LE][type_tag:4 LE][body: body_size bytes]

type_tag 1 (BGRA): [w:4][h:4][ch:4][reserved:4][pixels: w*h*ch]

DEFAULT_TCP_PORT=9999, MAGIC=0x4D415246, FRAME_HEADER_SIZE=12
```

## Capture Pipeline

### Streaming preview (WGC → SharedBuffer / MJPEG)

```
WGC GPU FramePool (D3D11+WinRT, OBS patterns)
  → FrameArrived event → condition_variable
  → TryGetNextFrame → CopyResource(GPU) → Map(CPU readback)
  → C++ SharedBuffer: CreateSharedBuffer(w*h*4) → memcpy → PostSharedBufferToScript
  → Frontend: chrome.webview.sharedbufferreceived → Canvas putImageData
  OR
  → MJPEG fallback: BGRA→RGB → JPEG encode → HTTP multipart → <img>
```

### Single-frame capture

Methods: WGC / DesktopBlt / GetWindowDC / PrintWindow / ScreenBitBlt.
Fallback chain (Rust side for now, moving to C++): DesktopBlt → GetWindowDC → PrintWindow → ScreenBitBlt.

### Transport methods

| Transport | Encoding | Transfer | Browser | Status |
|-----------|----------|----------|---------|--------|
| SharedBuffer | None (raw BGRA) | COM shared memory | Canvas ImageData | primary |
| MJPEG | CPU JPEG ~5ms | HTTP port 9998 | `<img>` GPU | fallback |
| H.264 | GPU MFT (wip) | MP4 port 9997 | `<video>` | experimental |

### WGC Internals

- WinRT MTA initialized on daemon thread
- DispatcherQueue created per capture thread (required for FrameArrived)
- Condition variable for efficient frame waiting (no busy-poll)
- Triple-buffered staging textures for GPU/CPU overlap
- FrameArrived event registered → callback sets `frame_ready_` + notifies CV
- `wait_frame()` blocks on CV with 100ms timeout
- `TryGetNextFrame` false does NOT reset `frame_ready_` (race fix)
- `signal_stop()` for non-blocking shutdown
- Win11 borderless capture (`IsBorderRequired(false)`)

### H.264 MFT Internals

- MFT encoder on dedicated thread (IMFSinkWriter COM threading requirements)
- SinkWriter → MP4 file, HTTP server serves for `<video>` progressive download

## Frontend (App.tsx)

Single-file React app. Host-language agnostic — runs identically in Tauri or C++ WebView2.

Key components:
- `TopBar` — MXU-style tabs: Dashboard | Monitor | Log + Start/Stop + Theme + Settings
- `ConnectionPanel` — Window selector, method, capture mode, IP/Port
- `ScreenshotPanel` — MJPEG `<img>` preview + Canvas (SharedBuffer) + PNG `<img>` (single-frame)
- `LogPanel` — Unified log view (in-memory `[live]` + disk files)
- `DashboardView` — System info, Capture Pipeline, Update, Resources
- `SettingsPage` — Connection, Transport, Theme, Model, Update, Log, Project
- `WindowPickerModal` — Window/desktop/process selection with search

Right panel: default 324px, min 324px, max 400px. Auto-collapse chain: Log → Screenshot → Connection.

### SharedBuffer integration (App.tsx)

```ts
// Event listener — identical regardless of C++ or Rust host
chrome.webview.addEventListener('sharedbufferreceived', (e) => {
    const buf = e.getBuffer();
    const arr = new Uint8ClampedArray(buf, 0, w * h * 4);
    ctx.putImageData(new ImageData(arr, w, h), 0, 0);
});
```

## Known Issues

1. **WGC FPS**: Event-driven — static content = low FPS. Dynamic window = 60+.
2. **H.264 MFT**: Encoder creates MP4 for progressive download but `<video>` needs full file. MSE + fMP4 needed for true live streaming.
3. **Yellow border**: GDI FillRect flickers on window invalidation.
4. **Overlay orphan**: Yellow overlay STATIC windows may persist if app crashes.
5. **Chromium background tab throttling**: WebView2 may throttle rendering when app loses focus. 
6. **DXGI + D3D11 cross-API sharing**: DXGI Desktop Duplication and WGC may conflict on shared GPU resources under heavy load.
