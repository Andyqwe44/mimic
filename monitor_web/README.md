# Game Agent Monitor

Tauri 2 desktop app for screen capture + monitoring. Part of the TicTacToe → Visual Game AI project.

## Quick start

```bash
cd monitor_web
npm install
npm run tauri dev
```

## Architecture

```
Rust (Tauri IPC)  ←→  C++ capture_lib.lib (static linked)
  webview backend       GDI / PrintWindow / ScreenBitBlt / DesktopBlt / WGC
  overlay / TCP / log

React (TypeScript + Tailwind)
  MXU-style UI: Dashboard / Monitor / Log / Settings
```

All capture methods compiled into a single static library. Zero subprocess overhead.

```
monitor_web/
├── src/
│   └── App.tsx              # React UI (LogManager, panels, state machine)
└── src-tauri/
    ├── src/main.rs          # Rust backend (IPC, overlay, TCP, FFI wrappers)
    ├── build.rs             # Invokes MSVC to build C++ lib
    ├── tauri.conf.json      # App metadata + window config
    └── capabilities/        # Tauri permission scopes

capture/
├── src/                     # C++ capture methods (each method = separate file)
│   ├── capture_common.cpp   # Content validation + window state
│   ├── capture_gdi.cpp      # GetWindowDC
│   ├── capture_pw.cpp       # PrintWindow
│   ├── capture_screen.cpp   # ScreenBitBlt
│   ├── capture_desktop.cpp  # DesktopBlt
│   ├── capture_auto.cpp     # Auto-detect fallback chain
│   ├── capture_wgc.cpp      # WGC GPU FramePool
│   └── capture_wgc_ffi.cpp  # WGC stream FFI
├── include/                 # Public FFI headers + internal helpers
└── build_capture_lib.cmd    # MSVC build script → capture_lib.lib
```

## Default window size

Defined at top of `src-tauri/src/main.rs`:

```rust
const DEFAULT_WINDOW_W: u32 = 1280;
const DEFAULT_WINDOW_H: u32 = 720;
```

These are **physical pixels** — unaffected by OS scale factor.  
On startup the app is hidden → queries monitor scale → computes logical size → resizes → shows.  
**To change default size, edit the Rust consts — NOT `tauri.conf.json`.**

Minimum window size is set in `tauri.conf.json`: 324×216.

## Logging

All logs written to `log/` directory (project root):
- `agent_*.log` — Rust backend (Tauri main process)
- `wgc_*.log` — C++ WGC per-frame timing

`log/` is gitignored. LogManager class in App.tsx unifies in-memory + disk log views.

## Gitignore

Key entries in `.gitignore`:
- `log/` — runtime logs (not committed)
- `*.original.md` — caveman compress backups
- `**/target/`, `**/node_modules/` — build outputs
- `*.exe`, `*.lib`, `*.pdb` — binaries
