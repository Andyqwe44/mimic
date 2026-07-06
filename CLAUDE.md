# CLAUDE.md — TicTacToe → General Visual Game AI

## 语言偏好
用中文思考和回答。代码、commit、PR 描述用英文。

## Project Vision

Build self-organizing hierarchical visual game AI. Model interface: **pixels in, actions out**.
C++ for real-time capture + future agent. Rust for monitor GUI + capture IPC.
Python for AI model training/inference.

## Architecture

```
┌─ monitor_web (Tauri 2) ────────────────────────────────────┐
│  React (TypeScript + Tailwind)  ←→  Rust (IPC)            │
│       MXU-style UI               │  Win32 API 直调         │
│       Dashboard/Monitor/Log       │  TCP server :9999       │
└──────────────────┬────────────────┴────────────────────────┘
                   │
     ┌─────────────┼──────────────┐
     ▼             ▼              ▼
  Rust            C++ static lib  TCP :9999
  EnumWindows     GDI+WGC+DXGI    (agent.exe / Python)
  (0ms)           (capture_lib)    binary frames
```

## Project Structure

```
tictactoe/
├── protocol/                    # Wire format — shared across C++/Rust/Python
│   ├── protocol.h / .rs / .py
├── common/                      # Shared C++ modules
│   ├── include/
│   │   ├── types.hpp            Shared types (Rect, sleep_ms)
│   │   └── capture_helpers.hpp  ScaleBgra, IsSolidColor, etc.
│   ├── payload/bgra.hpp         BGRA pixel frame pack/unpack
│   └── transport/               pipe.hpp, tcp.hpp
├── capture/                     # C++ screen capture (static lib + standalone tools)
│   ├── src/
│   │   ├── capture_common.cpp   Content validation + window state (FFI)
│   │   ├── capture_gdi.cpp      GetWindowDC (FFI)
│   │   ├── capture_pw.cpp       PrintWindow + magenta sentinel (FFI)
│   │   ├── capture_screen.cpp   ScreenBitBlt (FFI)
│   │   ├── capture_desktop.cpp  DesktopBlt (FFI)
│   │   ├── capture_auto.cpp     Auto-detect fallback chain (FFI)
│   │   ├── capture_wgc.cpp      WGC GPU FramePool (D3D11+WinRT)
│   │   ├── capture_wgc_ffi.cpp  WGC stream FFI wrapper
│   │   ├── capture_dxgi.cpp     DXGI Desktop Duplication backend
│   │   ├── capture_single.cpp   Standalone: single-frame screenshot
│   │   ├── capture_stream.cpp   Standalone: stream with frame-differ
│   │   └── capture_wgc_main.cpp Standalone: WGC CLI (single/stream)
│   ├── include/
│   │   ├── capture_methods.h    Public FFI header (all methods)
│   │   ├── capture_wgc_ffi.h    WGC stream FFI header
│   │   ├── capture_internal.h   Shared GDI inline helpers
│   │   ├── capture_wgc.hpp      WGC C++ class
│   │   └── capture.hpp          ICaptureBackend (DXGI + GDI)
│   ├── build.cmd                MSVC build (standalone exes)
│   └── build_capture_lib.cmd    MSVC → capture_lib.lib (8 FFI files)
├── monitor_web/                 # Tauri 2 + React desktop app
│   ├── src/
│   │   └── App.tsx              Main UI (MXU-style, Dashboard/Screenshot/Log)
│   └── src-tauri/
│       └── src/main.rs          Rust backend (C++ FFI, overlay, TCP)
├── model/                       # Python
│   ├── __init__.py               Re-exports public API
│   ├── action_space.py           Token vocabulary + serialization (LE)
│   ├── generic_agent.py          VisionEncoder + ActionDecoder + GenericAgent
│   ├── hierarchical.py           PerceptionSpecialist + StrategicReasoner
│   └── payload/
│       └── bgra.py               Canonical BGRA pack/unpack for Python
├── examples/                    # Protocol examples + Benchmark
│   ├── wgc_bench_send.cpp       WGC→TCP benchmark (C++)
│   ├── wgc_bench_recv.rs        TCP→file benchmark (Rust)
│   └── run_bench.bat
└── log/                         # Unified logs
    ├── agent_*.log               Rust (Tauri main process)
    └── wgc_*.log                 C++ (WGC subprocess)
```

## Wire Protocol (protocol/)

```
Frame: [magic:4 "FRAM"][body_size:4 LE][type_tag:4 LE][body: body_size bytes]

type_tag 1 (BGRA): [w:4][h:4][ch:4][reserved:4][pixels: w*h*ch]

DEFAULT_TCP_PORT=9999, MAGIC=0x4D415246, FRAME_HEADER_SIZE=12
```

`body_size` = body bytes only (NOT including type_tag). Matches Rust `build_header(payload.len(), type_tag)`.

### BGRA payload

Canonical implementations (use for new code):
- C++: `common/payload/bgra.hpp` (`payload::bgra_pack/unpack`)
- Rust: `monitor_web/src-tauri/src/payload/bgra.rs` (`payload::bgra::pack/unpack`)
- Python: `model/payload/bgra.py` (`pack/unpack`)

## Build Commands

```bash
cd capture  && build.cmd          # Standalone C++ tools (capture_wgc.exe etc.)
cd capture  && build_capture_lib.cmd  # Static lib (Rust build.rs calls this automatically)
cd monitor_web
npm install && npm run tauri dev  # Vite HMR + Cargo watch (auto-builds capture_lib.lib)
npm run tauri build               # Release .exe (statically linked)
```

## Capture Methods

### WGC (Windows.Graphics.Capture) — Window capture

GPU-accelerated FramePool. ~7ms/frame (140+ FPS capable).
- Works for occluded/background windows (NOT minimized)
- Event-driven: frames only produced when content changes
- `capture_stream_start` calls WGC FFI directly (static lib, zero subprocess)
- Falls back to GDI if WGC init fails
- Triple-buffered staging textures for GPU/CPU overlap
- C++ writes per-frame timing to `log/wgc_*.log`

### GDI — Desktop / fallback

3-method chain: `GetWindowDC → PrintWindow(magenta sentinel) → ScreenBitBlt`

### DXGI Desktop Duplication — Desktop only

Full desktop capture at monitor refresh rate. Used via `bench_send.exe 0`.

## Frontend (App.tsx)

Single-file React app. Key components:
- `TopBar` — MXU-style tabs: Dashboard | Monitor | Log + Start/Stop + Theme + Settings
- `ConnectionPanel` — Fixed-width, `justify-between`. Title(144px)+X(32px) left, Select right. IP(184px) left, Port(80px) right
- `ScreenshotPanel` — Canvas rendering (BGRA→RGBA, no BMP). Dynamic `aspectRatio` from screen resolution. Play/Stop streaming + Camera single-shot. Method selector in header.
- `LogPanel` — Dual mode: compact right-sidebar shows current session (max 100); Log tab shows full-card layout with historical files from disk via `read_logs`
- `DashboardView` — System info, Capture Pipeline, Update (check + source selector), Resources
- `SettingsPage` — `SettingsCard` collapsible cards: Connection (with method selector), Theme, Model, Update, Log, Project
- `WindowPickerModal` — Window/desktop/process selection with search

### Capture method selector

Choose capture method in Settings → Connection:
- `Auto` — fallback chain (WGC → GetWindowDC → PrintWindow → ScreenBitBlt)
- `WGC` — GPU FramePool (stream via subprocess, single-frame via `--single`)
- `DXGI` — desktop GDI BitBlt
- `GDI` — GetWindowDC only, no solid-color check
- `PrintWindow` / `ScreenBlt` — single method, no fallback

Method flows as `forceMethod` through: App state → ScreenshotPanel props → invoke calls → Rust backend. All user actions logged via `addLog()`.

### User action logging

All interactions logged: tab switches, Start/Stop, theme toggle, method selection, capture preview, screenshot, clear logs. Log tab loads historical `agent_*.log` files as full-card tiles via `read_logs`.

### MXU-style design patterns
- Cards: `bg-bg-secondary rounded-xl ring-1 ring-inset ring-border overflow-hidden`
- Header: `<div role="button">` with icon + title + status + chevron
- Expand/collapse: `grid` animation (`grid-template-rows: 1fr ↔ 0fr`)
- Action buttons: individual `e.stopPropagation()`, chevron without (allows toggle)
- TopBar tabs: `border-b-[3px]` active indicator, icons + labels

### Right panel sizing
- Default width: 324px, min: 324px, max: 400px
- Drag resize capped by `Math.max(324, Math.min(400, w))`

## Rust Backend (main.rs)

Rust is the webview/IPC layer — all capture logic lives in C++ static lib (see Capture Library).

### Default window size

Defined at top of `src-tauri/src/main.rs`:
```rust
const DEFAULT_WINDOW_W: u32 = 1280;
const DEFAULT_WINDOW_H: u32 = 720;
```
These are **physical pixels** (unaffected by OS scale factor). Setup queries monitor scale → computes logical size → `set_size` → `show()`.
To change default size, edit these consts — NOT `tauri.conf.json`.

### Key commands
- `list_windows` / `list_processes` — Win32 enumeration (pure Rust, no subprocess)
- `capture_window(hwnd, method)` — Single-frame via C++ FFI. Auto uses 3-method fallback chain in C++.
- `capture_stream_start(app, hwnd, tcp_port, method)` — Stream preview. WGC FFI or GDI FFI loop in thread.
- `stream_poll` — Returns JSON `{p: base64, w, h, m: method}` for Canvas
- `highlight_window` — Yellow border overlay on target window
- `screen_info` — Returns `{w, h}` for screen resolution
- `read_logs(max_files)` — Reads newest N `agent_*.log` files, returns `[{name, lines}]`
- `log_ui_event` / `clear_log` — Frontend → disk log bridge
- `window_state` — Proxy to C++ `capture_query_window_state`
- `benchmark_methods` — Test all methods, return timings

### Capture Library (C++ static lib)

All capture methods are C++ `extern "C"` functions in `capture_lib.lib` (linked at build time, zero subprocess):

```
capture/src/
├── capture_common.cpp    # Content validation + window state
├── capture_gdi.cpp       # GetWindowDC
├── capture_pw.cpp        # PrintWindow
├── capture_screen.cpp    # ScreenBitBlt
├── capture_desktop.cpp   # DesktopBlt
├── capture_auto.cpp      # Auto-detect fallback chain
├── capture_wgc.cpp       # WGC GPU FramePool (D3D11 + WinRT)
├── capture_wgc_ffi.cpp   # WGC stream FFI wrapper
capture/include/
├── capture_methods.h     # Public FFI header (all methods)
├── capture_wgc_ffi.h     # WGC stream FFI header
├── capture_wgc.hpp       # WGC C++ class
└── capture_internal.h    # Shared GDI inline helpers
```

Build: `build_capture_lib.cmd` (MSVC) → `capture_lib.lib` → linked via `build.rs`.

### Yellow border overlay
- 4 thin STATIC popup windows (top/bottom/left/right, 3px, yellow GDI FillRect)
- `SetWinEventHook` — event-driven reposition
- Z-order: `SetWindowPos(h, target)` — follows target
- Inset: `BORDER_INSET=1` shrinks border inward for tight fit

### Frame pipeline
- WGC: BGRA pixels (C++ FFI) → `bgra_to_rgba()` → store in `STREAM_FRAME`
- GDI: BGRA pixels (C++ FFI) → `bgra_to_rgba()` → store in `STREAM_FRAME`
- `stream_poll()`: base64-encode raw RGBA → JSON → frontend Canvas ImageData
- TCP broadcast: raw BGRA frames on `127.0.0.1:9999` for external consumers (Python agent)

## Logging

- Rust: `dlog!()` macro → `agent_*.log` (session-based, max 5 files kept)
- C++: WGC per-frame timing → `log/wgc_*.log`
- Frontend: `LogManager` class → in-memory array + `invoke('log_ui_event')` → disk
- Three views (right panel compact, Log tab, disk file) are unified via LogManager
- Clear button: archives current log file, opens new session file
- All `log/` files are gitignored — not committed to repo

## Known Issues

1. **DXGI desktop**: returns solid black on virtual display adapters
2. **Yellow border color**: GDI FillRect on STATIC — repaints white on window invalidation, may flicker
3. **WGC init latency**: ~300ms for first frame after session start
4. **WGC FPS**: Limited by window content change rate. Static window = 0-5 FPS. Dynamic = 60+ FPS. By design (event-driven)
5. **Overlay orphan risk**: Yellow overlay STATIC windows may persist if app crashes without `destroy_overlay_bars()` cleanup.
