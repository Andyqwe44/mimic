# CLAUDE.md — TicTacToe → General Visual Game AI

## Project Vision

Build a self-organizing hierarchical visual game AI. Model interface: **pixels in, actions out**.
C++ for real-time Windows operations (capture, input, window enumeration).
Tauri 2 + React + Tailwind CSS for monitor GUI (MaaEnd/MXU style).
Python for AI model training/inference.

## Architecture

```
C++ Agent (performance-critical)
  ├── capture/       DXGI/GDI screen capture, window enumeration
  ├── input/         Interception driver / SendInput simulation
  └── agent/         pixels→actions agent loop

Rust (Tauri glue)
  └── monitor_web/src-tauri/   IPC bridge: Rust ↔ React, calls C++ subprocesses

React (GUI, monitor only — not in the work loop)
  └── monitor_web/src/         App.tsx + index.css
```

## Key Design Decisions

- **GUI is monitor-only**: C++ does actual capture+AI work. Rust reads data from C++ and displays in React.
- **C++ via subprocess**: Rust calls C++ .exe tools (window_list.exe, capture) via `std::process::Command`
- **No Slint**: tried Slint v1.17, too restrictive. Switched to Tauri+React.
- **Release builds**: `npm run tauri build` bundles frontend into exe, no localhost needed.
- **Tooltip system**: Custom React component, portal to body, 300ms delay, auto-flip, smart positioning.
- **IconBtn/ActionBtn**: `title: string` required, TypeScript compile-time enforcement.

## Project Structure

```
tictactoe/
├── common/              # Shared C++: types.hpp, signals.hpp/cpp
├── game/                # TicTacToe TUI (arrow keys, ANSI, blinking cursor)
│   ├── src/             .cpp files
│   ├── include/         .hpp files  
│   ├── build/           .obj
│   ├── main.exe
│   └── build.cmd        MSVC build
├── capture/             # Screen capture + window enumeration
│   ├── src/             capture_dxgi.cpp, window_list.cpp, process_list.cpp
│   ├── include/         capture.hpp, preprocess.hpp
│   ├── build/           window_list.exe, process_list.exe, capture_test.exe
│   └── build.cmd
├── input/               # Input simulation (SendInput + Interception)
├── agent/               # Visual agent (pixels→actions)
├── monitor_web/         # Tauri 2 + React desktop app
│   ├── src/
│   │   ├── App.tsx      # Main UI (250+ lines, all components inline)
│   │   ├── index.css    # Tailwind + CSS variables (dark/light theme)
│   │   └── main.tsx     # React entry
│   ├── src-tauri/       # Rust backend
│   │   ├── Cargo.toml   # tauri, serde, chrono, miniz_oxide
│   │   ├── src/main.rs  # list_windows, list_processes, capture_single, capture_window, logging
│   │   └── tauri.conf.json  # 1200x780 window, devUrl:1420
│   ├── package.json     # react, tailwindcss, lucide-react, clsx, tailwind-merge
│   └── vite.config.ts   # Vite + Tailwind + Tauri env
├── model/               # Python: generic_agent.py, hierarchical.py
├── ai/                  # Python AI server (MLP, TCP text protocol)
├── train/               # Training data collector
└── README.md
```

## Build Commands

```bash
# C++ modules (MSVC 2022, C:\Program Files\Microsoft Visual Studio\18\)
cd game     && build.cmd    # main.exe
cd capture  && build.cmd    # window_list.exe + capture_test.exe
cd input    && build.cmd    # input_test.exe
cd agent    && build.cmd    # agent.exe

# Tauri monitor (needs Node.js + Rust)
cd monitor_web
npm install
npm run tauri dev     # dev mode (Vite HMR via port 1420)
npm run tauri build   # release .exe (bundled frontend, no localhost)

# Rust only (no frontend rebuild)
cargo build --manifest-path monitor_web/src-tauri/Cargo.toml --release

# Python
pip install torch onnx onnxruntime numpy opencv-python
cd ai && python train.py --iters 50 --games 100
```

## Tauri Dev HMR (Hot Module Replacement)

`npm run tauri dev` 启动流程：
1. Vite dev server → `http://localhost:1420` (HMR websocket)
2. Rust cargo run → 打开 WebView2 窗口，加载 Vite 地址
3. 编辑 `.tsx`/`.css` → Vite 检测变化 → 增量编译 → 推送 WebView → 即时刷新

**前端代码（React/TSX/CSS）编辑后无需重启 Rust，即时生效。**
仅改 Rust 代码时需重新 `cargo run`（Tauri 会 watch `src-tauri/` 自动重编译）。

Release 模式下 HMR 不可用 — 前端打包嵌入 exe，无网络请求。

## Release EXE Location
`monitor_web/src-tauri/target/release/game-agent-monitor.exe`
(Bundled HTML/CSS/JS, no network needed)

## Debug Log
Each launch creates: `agent_YYYYMMDD_HHMMSS.log` next to the exe.
Max 5 log files kept. `dlog!()` macro in Rust logs before every operation with flush().

## Slint v1.17 Incompatibilities Discovered
- `padding: a b;` (multi-value) NOT supported
- `alignment: center;` on Layout NOT supported
- `vertical-alignment:` on Rectangle NOT supported  
- `@children` can only appear once at component top level
- `em` units NOT supported (use px)
- `drop-shadow-*`, `focus-ring-*` NOT supported
- `horizontal-stretch:`, `overflow:`, `opacity:` NOT supported
- `animate` blocks NOT supported
- `:=` for components deprecated
- `for` loop `idx` binding broken
- `BOOL` type not in windows 0.60 crate
- `background` on `Text` element NOT supported
- `color` on `LineEdit` NOT supported
- `placeholder-color` on `LineEdit` NOT supported
- `text.length`, `substring()`, `to-upper-case()` NOT supported
- `max()` NOT supported
- `%` width only for `width`/`height` properties, not custom properties
- `float()` conversion NOT supported

## Frontend Component Architecture (App.tsx)

All components in one file (App.tsx, ~500 lines):
- `Tooltip` — portal to body, 300ms delay, smart positioning, z-index 9999
- `IconBtn` — icon button, `title: string` REQUIRED
- `ActionBtn` — labeled button (primary/danger/outline), `title: string` REQUIRED, `min-w-[120px]`
- `ThemeBtn` — light/dark toggle
- `TopBar` — tabs (Monitor/Log) + Start/Stop + Theme + Settings gear icon
- `BottomBar` — status bar (Running/Idle, FPS, Lat, GitHub link)
- `WindowPickerModal` — categorized window selector with search + filter tabs
- `ConnectionPanel` — window title input + Select button
- `ScreenshotPanel` — Camera (single frame) + Preview button (20fps TODO)
- `LogPanel` — real-time operation log
- `SettingsPage` — Connection, Theme(6 colors), Model Context, Update, Log config, Star, Credits
- `WindowInfo` interface: `{ title, category, hwnd }`

## C++ Window Tools

### window_list.exe
- Enumerates taskbar-visible windows only (DwmGetWindowAttribute + style checks)
- JSON output: `{"hwnd":"...", "category":"desktop|window", "title":"..."}`
- Fast, small payload — loaded on every modal open

### process_list.exe
- Lists ALL visible windows (including background processes)
- Used on demand when user clicks "Process" filter tab
- JSON output: `{"hwnd":"...", "category":"process", "title":"..."}`
- No desktop entry — desktop handled by window_list.exe

### capture_single.exe
- Single-frame screenshot, raw BGRA pixels via binary stdout
- Usage: `capture_single.exe <hwnd>` (0=desktop DXGI, other=window GDI)
- Binary format: `[w:4][h:4][ch:4][pixels...]` (little-endian)
- Rust reads binary, does BGRA→RGBA, scale, PNG encode, base64 → frontend
- Agent can consume raw pixels directly (no encoding overhead)

## Current State & Next Steps

1. **DONE**: TicTacToe TUI game, C++ capture, C++ window enumeration, Tauri GUI
2. **DONE**: Tooltip system, Settings page, Config merged into Settings
3. **DONE**: Capture single frame via GDI (capture_window command with HWND)
4. **DONE**: Split window_list/process_list, Process filter tab + refresh button in window picker
5. **TODO**: Preview mode at 20fps via C++ DXGI (not GDI)
6. **TODO**: C++ Agent directly communicates with AI model (not via GUI)
7. **TODO**: GUI only monitors — reads data from C++ agent via pipe/TCP
8. **DONE**: process_list.cpp built and wired into Rust+frontend
9. **TODO**: Auto-update mechanism
10. **TODO**: Model context switching (base model + fine-tune adapter)

## Key Gotchas
- Rust release build: `current_dir()` is `src-tauri/`, NOT `monitor_web/`. Use `current_exe()`.
- Old exe must be killed before `cargo build --release` or get "access denied"
- `tauri dev` sometimes exits 127 (WebView2 conflict) — launch exe directly instead
- Test window_list.exe standalone: `capture/build/window_list.exe` prints JSON to stdout
- Frontend `npm run build` must succeed before Tauri build for bundled frontend
