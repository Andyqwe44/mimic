#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// ── Default window size in physical pixels (unaffected by OS scale factor) ──
const DEFAULT_WINDOW_W: u32 = 1280;
const DEFAULT_WINDOW_H: u32 = 720;

// ── Capture C++ FFI (static linked, all methods in one .lib) ──
extern "C" {
    // GDI capture methods
    fn capture_gdi_getwindowdc(hwnd: isize, buf: *mut u8, buf_size: i32,
                               w: *mut i32, h: *mut i32) -> i32;
    fn capture_printwindow(hwnd: isize, buf: *mut u8, buf_size: i32,
                           w: *mut i32, h: *mut i32) -> i32;
    fn capture_screen_bitblt(hwnd: isize, buf: *mut u8, buf_size: i32,
                             w: *mut i32, h: *mut i32) -> i32;
    fn capture_desktop_bitblt(buf: *mut u8, buf_size: i32,
                              w: *mut i32, h: *mut i32) -> i32;
    fn capture_auto_detect(hwnd: isize, buf: *mut u8, buf_size: i32,
                           w: *mut i32, h: *mut i32, method_out: *mut *const std::ffi::c_char) -> i32;
    fn capture_query_window_state(hwnd: isize) -> *const std::ffi::c_char;
    fn capture_is_solid_color(pixels: *const u8, len: i32) -> i32;
    fn capture_has_magenta(pixels: *const u8, len: i32) -> i32;

    // WGC capture methods
    fn wgc_stream_start(hwnd: isize, max_dim: i32) -> *mut std::ffi::c_void;
    fn wgc_stream_read(h: *mut std::ffi::c_void, buf: *mut u8, buf_size: i32,
                       out_w: *mut i32, out_h: *mut i32, out_ch: *mut i32) -> i32;
    fn wgc_stream_is_ok(h: *mut std::ffi::c_void) -> i32;
    fn wgc_stream_stop(h: *mut std::ffi::c_void);
    fn wgc_capture_single(hwnd: isize, buf: *mut u8, buf_size: i32,
                          out_w: *mut i32, out_h: *mut i32, out_ch: *mut i32) -> i32;
}

use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;
use std::thread;
use serde::Serialize;
use tauri::Emitter;
use std::time::Instant;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextW, GetWindowLongPtrW, IsWindowVisible,
    GetDesktopWindow, GetWindow, GetWindowRect, GetSystemMetrics, IsWindow,
    GW_OWNER, GWL_STYLE, GWL_EXSTYLE, WS_CAPTION, WS_EX_TOOLWINDOW,
    SM_CXSCREEN, SM_CYSCREEN,
};
use windows::Win32::Foundation::{RECT, HWND, BOOL, TRUE, LPARAM};

mod protocol;
mod payload;
mod transport;

// ── Session-based debug logging ──
// Each launch creates a new log file: agent_20260704_174500.log, max 5 kept
static LOG_FILE: Mutex<Option<std::fs::File>> = Mutex::new(None);

macro_rules! dlog {
    ($($arg:tt)*) => {
        if let Ok(mut guard) = $crate::LOG_FILE.lock() {
            if let Some(ref mut f) = *guard {
                let _ = writeln!(f, "[{}] {}", chrono::Local::now().format("%H:%M:%S%.3f"), format!($($arg)*));
                let _ = f.flush(); // flush immediately so crash doesn't lose log
            }
        }
    }
}

fn find_project_log_dir() -> std::path::PathBuf {
    // Walk up from exe dir looking for existing log/ directory (at project root)
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().unwrap_or(&exe).to_path_buf();
        for _ in 0..8 {
            let candidate = dir.join("log");
            if candidate.is_dir() { return candidate; }
            if !dir.pop() { break; }
        }
    }
    // Fallback: create log/ in CWD
    let d = std::path::PathBuf::from("log");
    let _ = std::fs::create_dir_all(&d);
    d
}

fn init_log(max_logs: usize) {
    let log_dir = find_project_log_dir();

    // Create per-session log filename with timestamp
    let ts = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let log_path = log_dir.join(format!("agent_{}.log", ts));

    // Clean old logs: keep only the newest max_logs-1 (plus current = max_logs total)
    if let Ok(entries) = std::fs::read_dir(&log_dir) {
        let mut log_files: Vec<_> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("agent_") && e.file_name().to_string_lossy().ends_with(".log"))
            .collect();
        log_files.sort_by_key(|e| e.metadata().map(|m| m.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH)).unwrap_or(std::time::SystemTime::UNIX_EPOCH));
        while log_files.len() >= max_logs {
            if let Some(old) = log_files.first() {
                let _ = std::fs::remove_file(old.path());
                log_files.remove(0);
            }
        }
    }

    match OpenOptions::new().create(true).append(true).open(&log_path) {
        Ok(f) => {
            let _ = writeln!(&f, "=== Game Agent Monitor v0.1.0 ===");
            let _ = writeln!(&f, "Session: {} | PID: {}", ts, std::process::id());
            let _ = writeln!(&f, "Log: {}", log_path.display());
            *LOG_FILE.lock().unwrap() = Some(f);
        }
        Err(_) => {}
    }
}

#[derive(Clone, Serialize)]
struct WindowInfo { title: String, category: String, hwnd: u64 }

#[tauri::command]
fn list_processes() -> Vec<WindowInfo> {
    let t0 = Instant::now();
    let mut result = Vec::new();
    unsafe {
        use windows::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW,
            TH32CS_SNAPPROCESS, PROCESSENTRY32W,
        };
        use windows::Win32::Foundation::CloseHandle;
        let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(h) => h,
            Err(_) => { dlog!("list_processes: CreateToolhelp32Snapshot failed"); return result; }
        };
        let mut pe = PROCESSENTRY32W::default();
        pe.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snapshot, &mut pe).is_ok() {
            loop {
                let name = String::from_utf16_lossy(
                    &pe.szExeFile[..pe.szExeFile.iter().position(|&c| c == 0).unwrap_or(pe.szExeFile.len())]
                );
                if !name.is_empty() {
                    result.push(WindowInfo {
                        title: name,
                        category: "process".into(),
                        hwnd: pe.th32ProcessID as u64,
                    });
                }
                if Process32NextW(snapshot, &mut pe).is_err() { break; }
            }
        }
        let _ = CloseHandle(snapshot);
    }
    dlog!("list_processes: {} entries in {:.0}ms", result.len(), t0.elapsed().as_millis());
    result
}

#[tauri::command]
fn list_windows() -> Vec<WindowInfo> {
    let t0 = Instant::now();
    let mut result = Vec::new();

    // Desktop always first
    result.push(WindowInfo {
        title: " Entire Desktop".into(),
        category: "desktop".into(),
        hwnd: 0,
    });

    // Enumerate taskbar-visible windows via Win32 API (no subprocess)
    unsafe {
        let _ = EnumWindows(Some(enum_window_callback), LPARAM(&mut result as *mut _ as isize));
    }

    dlog!("list_windows: {} entries in {:.0}ms", result.len(), t0.elapsed().as_millis());
    result
}

unsafe extern "system" fn enum_window_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let result = &mut *(lparam.0 as *mut Vec<WindowInfo>);

    if !IsWindowVisible(hwnd).as_bool() { return TRUE; }

    let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
    let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;

    // Must have title bar, not a tool window
    if style & (WS_CAPTION.0 as u32) == 0 { return TRUE; }
    if ex_style & (WS_EX_TOOLWINDOW.0 as u32) != 0 { return TRUE; }

    // Not cloaked
    let mut cloaked: u32 = 0;
    windows::Win32::Graphics::Dwm::DwmGetWindowAttribute(
        hwnd,
        windows::Win32::Graphics::Dwm::DWMWA_CLOAKED,
        &mut cloaked as *mut _ as *mut _,
        std::mem::size_of::<u32>() as u32,
    ).ok();
    if cloaked != 0 { return TRUE; }

    // Has non-zero size
    let mut rect = RECT::default();
    if GetWindowRect(hwnd, &mut rect).is_err() { return TRUE; }
    if rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0 { return TRUE; }

    // No owner window (GetWindow returns Result<HWND>)
    if let Ok(owner) = GetWindow(hwnd, GW_OWNER) {
        if !owner.0.is_null() { return TRUE; }
    }

    // Get title
    let mut buf = [0u16; 256];
    let len = GetWindowTextW(hwnd, &mut buf);
    if len == 0 { return TRUE; }
    let title = String::from_utf16_lossy(&buf[..len as usize]);
    let title = title.trim();
    if title.is_empty() || title == "Program Manager" { return TRUE; }

    result.push(WindowInfo {
        title: title.to_string(),
        category: "window".into(),
        hwnd: hwnd.0 as u64,
    });

    TRUE
}

// ── Screenshot: multi-method capture with diagnostics ──

// ── Screenshot: FFI to C++ capture library ──

const MAX_PX: usize = 3840 * 2160 * 4; // 4K BGRA

/// Call C++ capture lib with a specific method. Returns (pixels, w, h, method_name).
unsafe fn call_capture_method(hwnd: u64, method: &str) -> Option<(Vec<u8>, i32, i32, &'static str)> {
    let mut buf = vec![0u8; MAX_PX];
    let (mut w, mut h) = (0i32, 0i32);
    let (size, label): (i32, &'static str) = match method {
        "GDI(GetWindowDC)" => (capture_gdi_getwindowdc(hwnd as isize, buf.as_mut_ptr(), MAX_PX as i32, &mut w, &mut h), "GDI(GetWindowDC)"),
        "PrintWindow" | "PrintWindow(minimized)" => (capture_printwindow(hwnd as isize, buf.as_mut_ptr(), MAX_PX as i32, &mut w, &mut h), "PrintWindow"),
        "ScreenBitBlt" => (capture_screen_bitblt(hwnd as isize, buf.as_mut_ptr(), MAX_PX as i32, &mut w, &mut h), "ScreenBitBlt"),
        "DesktopBlt" => (capture_desktop_bitblt(buf.as_mut_ptr(), MAX_PX as i32, &mut w, &mut h), "DesktopBlt"),
        "WGC" => (wgc_capture_single(hwnd as isize, buf.as_mut_ptr(), MAX_PX as i32, &mut w, &mut h, &mut 4), "WGC"),
        _ => return None,
    };
    if size <= 0 || w <= 0 || h <= 0 { return None; }
    buf.truncate(size as usize);
    Some((buf, w, h, label))
}

/// Auto-detect with 3-method fallback (GetWindowDC → PrintWindow → ScreenBitBlt).
unsafe fn capture_auto_detect_ffi(hwnd: u64) -> Option<(Vec<u8>, i32, i32, String)> {
    let mut buf = vec![0u8; MAX_PX];
    let (mut w, mut h) = (0i32, 0i32);
    let mut method_ptr: *const std::ffi::c_char = std::ptr::null();
    let size = capture_auto_detect(hwnd as isize, buf.as_mut_ptr(), MAX_PX as i32, &mut w, &mut h, &mut method_ptr);
    if size <= 0 || w <= 0 || h <= 0 { return None; }
    buf.truncate(size as usize);
    let method = if method_ptr.is_null() { "ALL_FAILED".to_string() }
        else { std::ffi::CStr::from_ptr(method_ptr).to_string_lossy().to_string() };
    Some((buf, w, h, method))
}

fn capture_to_json(pixels: &[u8], w: i32, h: i32, x: i32, y: i32, screen_w: i32, screen_h: i32, method: &str, total_ms: u128) -> String {
    let t0 = Instant::now();
    let scale = (640.0 / w as f32).min(1.0);
    let sw = (w as f32 * scale) as i32;
    let sh = (h as f32 * scale) as i32;
    let mut rgba = vec![0u8; (sw * sh * 4) as usize];
    for y in 0..sh { let sy = (y as f32 / scale) as usize;
        for x in 0..sw { let sx = (x as f32 / scale) as usize;
            let di = (y * sw + x) as usize * 4; let si = (sy * w as usize + sx) * 4;
            rgba[di]=pixels[si+2]; rgba[di+1]=pixels[si+1]; rgba[di+2]=pixels[si]; rgba[di+3]=255; } }
    let mut out = Vec::new();
    out.extend_from_slice(&[137,80,78,71,13,10,26,10]);
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&(sw as u32).to_be_bytes()); ihdr.extend_from_slice(&(sh as u32).to_be_bytes());
    ihdr.extend_from_slice(&[8,6,0,0,0]); write_png_chunk(&mut out, b"IHDR", &ihdr);
    let mut raw = Vec::new();
    for y in 0..sh { raw.push(0); raw.extend_from_slice(&rgba[(y*sw)as usize*4..(y*sw+sw)as usize*4]); }
    let compressed = miniz_oxide::deflate::compress_to_vec_zlib(&raw, 6);
    write_png_chunk(&mut out, b"IDAT", &compressed); write_png_chunk(&mut out, b"IEND", &[]);
    let encode_ms = t0.elapsed().as_millis();
    let b64 = base64_encode(&out);
    dlog!("capture: total={}ms encode={}ms method={}", total_ms, encode_ms, method);
    serde_json::json!({
        "image": b64, "w": w, "h": h,
        "x": x, "y": y,
        "screen_w": screen_w, "screen_h": screen_h,
        "method": method
    }).to_string()
}

#[tauri::command]
fn capture_single() -> String {
    let t0 = Instant::now();
    dlog!("capture_single: desktop...");
    unsafe {
        let screen_w = GetSystemMetrics(SM_CXSCREEN);
        let screen_h = GetSystemMetrics(SM_CYSCREEN);
        if let Some((pixels, w, h, method)) = capture_auto_detect_ffi(0) {
            let json = capture_to_json(&pixels, w, h, 0, 0, screen_w, screen_h, &method, t0.elapsed().as_millis());
            dlog!("capture_single: {}x{} method={} → {}b, total={:.0}ms", w, h, method, json.len(), t0.elapsed().as_millis());
            json
        } else {
            dlog!("capture_single: FAILED");
            String::new()
        }
    }
}

#[tauri::command]
fn capture_window(hwnd: u64, method: Option<String>) -> String {
    let t0 = Instant::now();
    let method_str = method.as_deref().unwrap_or("auto");
    let log_method = normalize_method(method_str);
    dlog!("capture_window: hwnd={} method={}...", hwnd, log_method);
    unsafe {
        let result = if method_str == "auto" || method_str.is_empty() {
            capture_auto_detect_ffi(hwnd)
        } else {
            call_capture_method(hwnd, normalize_method(method_str))
                .map(|(p, w, h, m)| (p, w, h, m.to_string()))
        };
        if let Some((pixels, w, h, method)) = result {
            let screen_w = GetSystemMetrics(SM_CXSCREEN);
            let screen_h = GetSystemMetrics(SM_CYSCREEN);
            let (wx, wy) = if hwnd != 0 {
                let hwnd_ptr = HWND(std::ptr::with_exposed_provenance_mut::<std::ffi::c_void>(hwnd as usize));
                let mut wr = RECT::default();
                if GetWindowRect(hwnd_ptr, &mut wr).is_ok() { (wr.left, wr.top) } else { (0, 0) }
            } else { (0, 0) };
            let json = capture_to_json(&pixels, w, h, wx, wy, screen_w, screen_h, &method, t0.elapsed().as_millis());
            dlog!("capture_window: {}x{} @({},{}) method={} size={} total={:.0}ms", w, h, wx, wy, method, json.len(), t0.elapsed().as_millis());
            json
        } else {
            dlog!("capture_window: FAILED");
            String::new()
        }
    }
}

// ── PNG helpers ────────────────────────────────────────
fn write_png_chunk(out: &mut Vec<u8>, name: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(name);
    out.extend_from_slice(data);
    let crc = crc32(name, data);
    out.extend_from_slice(&crc.to_be_bytes());
}

fn crc32(name: &[u8; 4], data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFFFFFF;
    for &b in name.iter().chain(data) {
        crc ^= b as u32;
        for _ in 0..8 { crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB88320 } else { crc >> 1 }; }
    }
    !crc
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[((n >> 18) & 0x3F) as usize] as char);
        out.push(CHARS[((n >> 12) & 0x3F) as usize] as char);
        out.push(if chunk.len() > 1 { CHARS[((n >> 6) & 0x3F) as usize] } else { b'=' } as char);
        out.push(if chunk.len() > 2 { CHARS[(n & 0x3F) as usize] } else { b'=' } as char);
    }
    out
}

// ── Capture Stream (Rust-native, multi-method, BMP → frontend <img>) ──

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::net::{TcpListener, TcpStream};

struct StreamState {
    running: Arc<AtomicBool>,
}

// ── Yellow highlight overlay ──────────────────────────
static OVERLAY_TARGET: Mutex<isize> = Mutex::new(0);
static OVERLAY_RUNNING: AtomicBool = AtomicBool::new(false);
static OVERLAY_BARS: Mutex<[isize; 4]> = Mutex::new([0, 0, 0, 0]);

const BORDER_W: i32 = 3;
const BORDER_INSET: i32 = 1;
const YELLOW_COLOR: u32 = 0x0000FFFFu32;

unsafe fn destroy_overlay_bars() {
    let mut bars = OVERLAY_BARS.lock().unwrap();
    for i in 0..4 {
        if bars[i] != 0 {
            let _ = windows::Win32::UI::WindowsAndMessaging::DestroyWindow(
                windows::Win32::Foundation::HWND(std::ptr::with_exposed_provenance_mut::<std::ffi::c_void>(bars[i] as usize)));
            bars[i] = 0;
        }
    }
}

unsafe fn reposition_overlay() {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, GetWindowRect, IsWindow, IsIconic, IsWindowVisible,
        ShowWindow, SWP_NOACTIVATE, SW_HIDE, SW_SHOWNOACTIVATE, GetSystemMetrics,
        SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
    };
    use windows::Win32::Graphics::Gdi::{GetDC, ReleaseDC, CreateSolidBrush, FillRect, DeleteObject};
    use windows::Win32::Foundation::{RECT, HWND, COLORREF};

    let hwnd = *OVERLAY_TARGET.lock().unwrap();
    if hwnd == 0 { return; }
    let target = HWND(std::ptr::with_exposed_provenance_mut::<std::ffi::c_void>(hwnd as usize));

    if !IsWindow(target).as_bool() { destroy_overlay_bars(); OVERLAY_RUNNING.store(false, Ordering::Relaxed); return; }

    let bars = OVERLAY_BARS.lock().unwrap();
    let bar_hwnds = [bars[0], bars[1], bars[2], bars[3]];
    drop(bars);

    if IsIconic(target).as_bool() || !IsWindowVisible(target).as_bool() {
        for &b in &bar_hwnds { if b != 0 { let _ = ShowWindow(HWND(std::ptr::with_exposed_provenance_mut::<std::ffi::c_void>(b as usize)), SW_HIDE); } }
        return;
    }

    let mut r = RECT::default();
    if GetWindowRect(target, &mut r).is_err() { return; }
    let w = r.right - r.left; let h = r.bottom - r.top;
    if w <= BORDER_W * 2 || h <= BORDER_W * 2 { return; }

    let sx = GetSystemMetrics(SM_XVIRTUALSCREEN); let sy = GetSystemMetrics(SM_YVIRTUALSCREEN);
    let sw = GetSystemMetrics(SM_CXVIRTUALSCREEN); let sh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
    let bx = (r.left + BORDER_INSET).max(sx); let by = (r.top + BORDER_INSET).max(sy);
    let br = (r.left + w - BORDER_INSET).min(sx + sw); let bb = (r.top + h - BORDER_INSET).min(sy + sh);

    let positions = [
        (bx, by, br - bx, BORDER_W),
        (bx, bb - BORDER_W, br - bx, BORDER_W),
        (bx, by, BORDER_W, bb - by),
        (br - BORDER_W, by, BORDER_W, bb - by),
    ];
    for i in 0..4 {
        if bar_hwnds[i] != 0 {
            let bar_h = HWND(std::ptr::with_exposed_provenance_mut::<std::ffi::c_void>(bar_hwnds[i] as usize));
            let (px, py, pw, ph) = positions[i];
            let _ = SetWindowPos(bar_h, target, px, py, pw, ph, SWP_NOACTIVATE);
            let dc = GetDC(bar_h);
            if !dc.0.is_null() {
                let brush = CreateSolidBrush(COLORREF(YELLOW_COLOR));
                let fill_r = RECT { left: 0, top: 0, right: pw, bottom: ph };
                FillRect(dc, &fill_r, brush);
                let _ = DeleteObject(brush); let _ = ReleaseDC(bar_h, dc);
            }
            let _ = ShowWindow(bar_h, SW_SHOWNOACTIVATE);
        }
    }
}

unsafe fn create_overlay_bars(hwnd: isize) {
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, ShowWindow, SetWindowPos, GetSystemMetrics,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_SHOWNOACTIVATE,
        WS_EX_TRANSPARENT, WS_EX_TOOLWINDOW, WS_POPUP,
        GetWindowRect, IsWindow,
        SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
    };
    use windows::Win32::Graphics::Gdi::{GetDC, ReleaseDC, CreateSolidBrush, FillRect, DeleteObject};
    use windows::Win32::Foundation::{RECT, HWND, COLORREF};

    destroy_overlay_bars();
    if hwnd == 0 { OVERLAY_RUNNING.store(false, Ordering::Relaxed); return; }

    let target = HWND(std::ptr::with_exposed_provenance_mut::<std::ffi::c_void>(hwnd as usize));
    if !IsWindow(target).as_bool() { OVERLAY_RUNNING.store(false, Ordering::Relaxed); return; }

    let mut r = RECT::default();
    if GetWindowRect(target, &mut r).is_err() { return; }
    let w = r.right - r.left; let h = r.bottom - r.top;
    if w <= BORDER_W * 2 || h <= BORDER_W * 2 { return; }

    let sx = GetSystemMetrics(SM_XVIRTUALSCREEN); let sy = GetSystemMetrics(SM_YVIRTUALSCREEN);
    let sw = GetSystemMetrics(SM_CXVIRTUALSCREEN); let sh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
    let bx = (r.left + BORDER_INSET).max(sx); let by = (r.top + BORDER_INSET).max(sy);
    let br = (r.left + w - BORDER_INSET).min(sx + sw); let bb = (r.top + h - BORDER_INSET).min(sy + sh);

    let create_bar = |cx: i32, cy: i32, cw: i32, ch: i32| -> isize {
        match CreateWindowExW(
            WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW,
            windows::core::w!("STATIC"), windows::core::w!(""), WS_POPUP,
            cx, cy, cw.max(1), ch.max(1), None, None, None, None,
        ) {
            Ok(h) => {
                let dc = GetDC(h);
                if !dc.0.is_null() {
                    let brush = CreateSolidBrush(COLORREF(YELLOW_COLOR));
                    FillRect(dc, &RECT{left:0,top:0,right:cw,bottom:ch}, brush);
                    let _ = DeleteObject(brush); let _ = ReleaseDC(h, dc);
                }
                let _ = ShowWindow(h, SW_SHOWNOACTIVATE);
                let _ = SetWindowPos(h, target, 0, 0, 0, 0, SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE);
                std::mem::transmute_copy(&h)
            }
            Err(_) => 0,
        }
    };

    let mut bars = OVERLAY_BARS.lock().unwrap();
    bars[0] = create_bar(bx, by, br - bx, BORDER_W);
    bars[1] = create_bar(bx, bb - BORDER_W, br - bx, BORDER_W);
    bars[2] = create_bar(bx, by, BORDER_W, bb - by);
    bars[3] = create_bar(br - BORDER_W, by, BORDER_W, bb - by);
    *OVERLAY_TARGET.lock().unwrap() = hwnd;
    OVERLAY_RUNNING.store(true, Ordering::Relaxed);
}

fn start_overlay_tracker() {
    std::thread::spawn(|| unsafe {
        use windows::Win32::UI::Accessibility::{
            SetWinEventHook, UnhookWinEvent,
        };
        use windows::Win32::UI::WindowsAndMessaging::{
            GetMessageW, DispatchMessageW, MSG,
            EVENT_SYSTEM_MOVESIZEEND, EVENT_OBJECT_LOCATIONCHANGE,
            WINEVENT_OUTOFCONTEXT,
        };
        let hook = SetWinEventHook(
            EVENT_SYSTEM_MOVESIZEEND, EVENT_OBJECT_LOCATIONCHANGE,
            None, Some(overlay_win_event_proc), 0, 0, WINEVENT_OUTOFCONTEXT,
        );
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() { let _ = DispatchMessageW(&msg); }
        let _ = UnhookWinEvent(hook);
    });
}

unsafe extern "system" fn overlay_win_event_proc(
    _hook: windows::Win32::UI::Accessibility::HWINEVENTHOOK, _event: u32,
    hwnd: windows::Win32::Foundation::HWND, _id_object: i32, _id_child: i32,
    _event_thread: u32, _event_time: u32,
) {
    let target = *OVERLAY_TARGET.lock().unwrap();
    if target != 0 && hwnd.0 as isize == target { reposition_overlay(); }
}

#[tauri::command]
fn highlight_window(hwnd: u64) {
    unsafe { create_overlay_bars(hwnd as isize); }
    dlog!("highlight: hwnd={}", hwnd);
}

static STREAM: Mutex<Option<StreamState>> = Mutex::new(None);/// BGRA→RGBA for frontend Canvas. Swaps R↔B in-place.
fn bgra_to_rgba(pixels: &[u8]) -> Vec<u8> {
    let mut rgba = pixels.to_vec();
    for i in (0..rgba.len()).step_by(4) {
        rgba.swap(i, i + 2); // B↔R, G and A stay
    }
    rgba
}

/// Nearest-neighbor downscale BGRA → RGBA. Integer arithmetic, no f64.
fn scale_bgra_to_rgba(pixels: &[u8], w: i32, h: i32, max_dim: i32) -> (Vec<u8>, i32, i32) {
    let max_src = w.max(h);
    if max_src <= max_dim {
        let mut rgba = pixels.to_vec();
        for i in (0..rgba.len()).step_by(4) { rgba.swap(i, i + 2); }
        return (rgba, w, h);
    }
    // Fixed-point step: step = src_dim * 65536 / dst_dim
    let nw = (w as u64 * max_dim as u64 / max_src as u64) as i32;
    let nh = (h as u64 * max_dim as u64 / max_src as u64) as i32;
    let step_y = ((h as u64) << 16) / (nh as u64).max(1);
    let step_x = ((w as u64) << 16) / (nw as u64).max(1);
    let mut out = vec![0u8; (nw * nh * 4) as usize];
    let mut sy_fp = 0u64;
    for y in 0..nh {
        let sy = (sy_fp >> 16) as i32;
        sy_fp += step_y;
        let row_base = (sy * w * 4) as usize;
        let mut sx_fp = 0u64;
        let di_row = (y * nw * 4) as usize;
        for x in 0..nw {
            let sx = (sx_fp >> 16) as i32;
            sx_fp += step_x;
            let si = row_base + (sx * 4) as usize;
            let di = di_row + (x * 4) as usize;
            out[di] = pixels[si + 2];     // B → R
            out[di + 1] = pixels[si + 1]; // G → G
            out[di + 2] = pixels[si];     // R → B
            out[di + 3] = pixels[si + 3]; // A → A
        }
    }
    (out, nw, nh)
}

/// BGRA pixels (raw), w, h, method. No BMP/base64 until poll time.
static STREAM_FRAME: Mutex<(Vec<u8>, i32, i32, String)> = Mutex::new((Vec::new(), 0, 0, String::new()));
// Raw BGRA pixels for TCP clients (scaled, uncompressed).
static RAW_FRAME: Mutex<(Vec<u8>, i32, i32)> = Mutex::new((Vec::new(), 0, 0));


/// TCP broadcast thread: accepts clients, broadcasts latest frame to all
fn tcp_broadcast_thread(
    port: u16,
    running: Arc<AtomicBool>,
) {
    let listener = match TcpListener::bind(("127.0.0.1", port)) {
        Ok(l) => l,
        Err(e) => { dlog!("tcp: bind :{} failed: {}", port, e); return; }
    };
    // Non-blocking accept
    let _ = listener.set_nonblocking(true);
    dlog!("tcp: listening on 127.0.0.1:{}", port);

    let mut clients: Vec<TcpStream> = Vec::new();

    while running.load(Ordering::Relaxed) {
        // Accept new connections
        match listener.accept() {
            Ok((stream, addr)) => {
                let _ = stream.set_nonblocking(true);
                dlog!("tcp: client connected from {}", addr);
                clients.push(stream);
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => {}
        }

        // Get latest frame — clone and release lock before I/O
        let snapshot = {
            if let Ok(guard) = RAW_FRAME.lock() {
                let (ref pixels, w, h) = *guard;
                if pixels.is_empty() { None }
                else { Some((pixels.clone(), w, h)) }
            } else { None }
        };
        if let Some((ref payload, _, _)) = snapshot {
            clients.retain_mut(|client| {
                if transport::pipe::send_frame(client, protocol::PayloadType::BgraFrame, payload).is_err() { false } else { true }
            });
        }

        std::thread::sleep(std::time::Duration::from_millis(1));
    }

    dlog!("tcp: broadcast thread exiting");
}


/// Normalize user-facing method strings to canonical capture method names.
/// All method routing MUST go through this function — single source of truth.
fn normalize_method(input: &str) -> &'static str {
    match input {
        "wgc" | "WGC" => "WGC",
        "gdi" | "GDI" | "GDI(GetWindowDC)" => "GDI(GetWindowDC)",
        "printwindow" | "PrintWindow" | "PrintWindow(minimized)" => "PrintWindow",
        "screenbitblt" | "ScreenBitBlt" => "ScreenBitBlt",
        // "dxgi"/"DXGI" is NOT real DXGI — it's GDI BitBlt from screen DC.
        // Name it honestly so logs are not misleading.
        "dxgi" | "DXGI" | "DesktopBlt" | "desktopblt" => "DesktopBlt",
        // Auto-detect strings from capture_window_internal — pass through as literals
        "auto" => "auto",
        "None" => "None",
        "ALL_FAILED" => "ALL_FAILED",
        other => {
            dlog!("normalize_method: unknown method '{}' → fallback to DesktopBlt", other);
            "DesktopBlt"
        }
    }
}

/// Dispatch to C++ capture lib for a specific method (used by stream loop).
unsafe fn capture_fast_ffi(hwnd: u64, method: &str) -> Option<(Vec<u8>, i32, i32)> {
    call_capture_method(hwnd, method).map(|(p, w, h, _)| (p, w, h))
}

/// Single-method capture via FFI — no fallback, no solid-color/magenta checks.
unsafe fn capture_with_method_ffi(hwnd: u64, method: &str) -> Option<(Vec<u8>, i32, i32)> {
    let canonical = normalize_method(method);
    capture_fast_ffi(hwnd, canonical)
}

// ── WGC capture via static-linked C++ FFI ───────────────
/// Call into C++ WgcCapture library, feed frames into
/// STREAM_FRAME / RAW_FRAME / stream-tick pipeline.
fn run_wgc_stream(
    hwnd: u64,
    app: tauri::AppHandle,
    running: Arc<AtomicBool>,
) {
    let max_px = 3840 * 2160 * 4; // 4K BGRA
    let mut buf = vec![0u8; max_px];
    let handle = unsafe { wgc_stream_start(hwnd as isize, 1280) };
    if handle.is_null() {
        dlog!("wgc: failed to start stream for hwnd={}", hwnd);
        return;
    }
    dlog!("wgc: stream started for hwnd={}", hwnd);

    let mut frames: u64 = 0;
    let fps_t0 = Instant::now();

    while running.load(Ordering::Relaxed) {
        if unsafe { wgc_stream_is_ok(handle) } == 0 { break; }

        let (mut w, mut h, mut ch) = (0i32, 0i32, 0i32);
        let size = unsafe {
            wgc_stream_read(handle, buf.as_mut_ptr(), max_px as i32,
                            &mut w, &mut h, &mut ch)
        };
        if size <= 0 || w <= 0 || h <= 0 || ch <= 0 {
            std::thread::sleep(std::time::Duration::from_millis(1));
            continue;
        }
        let pixels = &buf[..size as usize];
        let t0 = Instant::now();

        // Pack raw BGRA for TCP broadcast
        let payload = payload::bgra::pack(pixels, w as u32, h as u32, ch as u32);
        if let Ok(mut raw) = RAW_FRAME.lock() {
            *raw = (payload, w, h);
        }

        // Raw RGBA for frontend Canvas (BGRA→RGBA swap)
        let rgba = bgra_to_rgba(pixels);
        if let Ok(mut state) = STREAM_FRAME.lock() {
            *state = (rgba, w, h, "WGC".to_string());
        }

        let _ = app.emit("stream-tick", serde_json::json!({"method": "WGC"}));
        frames += 1;

        if frames % 60 == 0 {
            dlog!("wgc: {} frames bmp={}us", frames, t0.elapsed().as_micros());
        }
        if frames > 0 && frames % 120 == 0 {
            let elapsed = fps_t0.elapsed().as_secs_f64();
            dlog!("wgc: {} frames in {:.1}s = {:.0}fps", frames, elapsed, frames as f64 / elapsed);
        }
    }

    unsafe { wgc_stream_stop(handle); }
    dlog!("wgc: stream exited after {} frames", frames);
}

#[tauri::command]
fn capture_stream_start(app: tauri::AppHandle, hwnd: u64, tcp_port: Option<u16>, method: Option<String>) -> Result<String, String> {
    let _ = capture_stream_stop();

    let port = tcp_port.unwrap_or(protocol::DEFAULT_TCP_PORT);
    let method_str = method.as_deref().unwrap_or("auto");

    let running = Arc::new(AtomicBool::new(true));
    let running_clone = running.clone();

    // WGC is statically linked — always available
    let use_wgc = if method_str == "wgc" {
        true
    } else if method_str == "auto" || method_str.is_empty() {
        hwnd != 0
    } else {
        false
    };

    dlog!("stream_start: hwnd={} port={} method={} use_wgc={}", hwnd, port, method_str, use_wgc);

    // Start TCP broadcast server (works for both WGC and GDI)
    let tcp_running = running.clone();
    thread::spawn(move || { tcp_broadcast_thread(port, tcp_running); });

    if use_wgc {
        // ── WGC path: subprocess-based GPU capture ──
        // Emit method tag immediately so frontend shows "WGC" right away
        let _ = app.emit("stream-tick", serde_json::json!({"method": "WGC"}));

        let wgc_running = running.clone();
        let wgc_app = app.clone();
        thread::spawn(move || { run_wgc_stream(hwnd, wgc_app, wgc_running); });
        *STREAM.lock().unwrap() = Some(StreamState { running });
        return Ok("started (wgc)".into());
    }

    // ── GDI / explicit method stream loop ──
    let explicit_method: Option<String> = if method_str != "auto" && !method_str.is_empty() {
        Some(method_str.to_string())
    } else {
        None
    };

    thread::spawn(move || {
        let hwnd_ptr = HWND(std::ptr::with_exposed_provenance_mut::<std::ffi::c_void>(hwnd as usize));
        let mut stream_method: String;
        let mut w: i32;
        let mut h: i32;

        if let Some(ref m) = explicit_method {
            stream_method = normalize_method(m).to_string();
            let is_desk = hwnd == 0 || hwnd_ptr == unsafe { GetDesktopWindow() };
            if is_desk {
                unsafe { w = GetSystemMetrics(SM_CXSCREEN); h = GetSystemMetrics(SM_CYSCREEN); }
            } else {
                let mut wr = RECT::default();
                if unsafe { GetWindowRect(hwnd_ptr, &mut wr).is_err() } {
                    dlog!("stream: GetWindowRect failed, aborting"); return;
                }
                w = wr.right - wr.left; h = wr.bottom - wr.top;
            }
            if w <= 0 || h <= 0 { dlog!("stream: zero-size window, aborting"); return; }
            dlog!("stream: explicit method={} {}x{}", stream_method, w, h);
        } else {
            let detect = unsafe { capture_auto_detect_ffi(hwnd) };
            if let Some((pixels, pw, ph, method)) = detect {
                stream_method = normalize_method(&method).to_string();
                w = pw; h = ph;
                dlog!("stream: detected method={} {}x{}", stream_method, w, h);
                // Display first frame immediately
                let rgba = bgra_to_rgba(&pixels);
                if let Ok(mut state) = STREAM_FRAME.lock() {
                    *state = (rgba, w, h, stream_method.clone());
                }
                let _ = app.emit("stream-tick", serde_json::json!({"method": &stream_method}));
            } else {
                dlog!("stream: no working capture method, aborting"); return;
            }
        }

        let hwnd_ptr = HWND(std::ptr::with_exposed_provenance_mut::<std::ffi::c_void>(hwnd as usize));
        let target_ms = 16u64; // 60fps
        let mut frames: u64 = 0;
        let mut prev_pixels: Vec<u8> = Vec::new();
        let mut recheck_counter = 0u32;
        let fps_t0 = Instant::now();

        while running_clone.load(Ordering::Relaxed) {
            // Window gone → abort (skip for desktop)
            if hwnd != 0 && unsafe { !IsWindow(hwnd_ptr).as_bool() } {
                dlog!("stream: window closed, stopping");
                break;
            }

            let frame_t0 = Instant::now();
            let result = unsafe { capture_fast_ffi(hwnd, &stream_method) };
            let cap_us = frame_t0.elapsed().as_micros();

            if let Some((pixels, pw, ph)) = result {
                w = pw; h = ph;

                // Frame differ: skip unchanged frames in auto mode only.
                // Explicit method: always send frames — user chose this method
                // and expects continuous preview (e.g. DXGI desktop).
                let skip_differ = explicit_method.is_none()
                    && pixels.len() == prev_pixels.len() && pixels == prev_pixels;

                if skip_differ {
                    if let Ok(mut state) = STREAM_FRAME.lock() {
                        state.3 = stream_method.clone();
                    }
                } else {
                    // Pack raw BGRA for TCP broadcast (before scaling for preview)
                    let tcp_payload = payload::bgra::pack(&pixels, w as u32, h as u32, 4);
                    if let Ok(mut raw) = RAW_FRAME.lock() {
                        *raw = (tcp_payload, w, h);
                    }

                    let t_pack = Instant::now();
                    // Scale+swap BGRA→RGBA in one pass (no intermediate buffer)
                    let (preview_rgba, pw, ph) = scale_bgra_to_rgba(&pixels, w, h, 1280);
                    let scale_us = t_pack.elapsed().as_micros();

                    let t_store = Instant::now();
                    prev_pixels = pixels;
                    if let Ok(mut state) = STREAM_FRAME.lock() {
                        *state = (preview_rgba, pw, ph, stream_method.clone());
                    }
                    let store_us = t_store.elapsed().as_micros();

                    // Per-frame timing every 60 frames (avoid log flooding)
                    if frames % 60 == 0 {
                        let total_us = frame_t0.elapsed().as_micros();
                        dlog!("frame #{} cap={}us scale={}us store={}us total={}us {}x{}→{}x{}", frames, cap_us, scale_us, store_us, total_us, w, h, pw, ph);
                    }
                }
                let _ = app.emit("stream-tick", serde_json::json!({"method": &stream_method}));
                frames += 1;
                recheck_counter = 0;
            } else {
                // Auto mode: re-detect after 30 consecutive failures
                // Explicit method: just emit tick so frontend doesn't freeze
                if explicit_method.is_none() {
                    recheck_counter += 1;
                    if recheck_counter > 30 {
                        if let Some((_, _pw, _ph, method)) = unsafe { capture_auto_detect_ffi(hwnd) } {
                            stream_method = normalize_method(&method).to_string();
                            dlog!("stream: re-detected method={}", stream_method);
                        }
                        recheck_counter = 0;
                    }
                } else {
                    // Explicit method: emit tick so frontend shows we're still alive
                    let _ = app.emit("stream-tick", serde_json::json!({"method": &stream_method}));
                }
            }

            // FPS log every 120 frames
            if frames > 0 && frames % 120 == 0 {
                let elapsed = fps_t0.elapsed().as_secs_f64();
                dlog!("stream: {} frames in {:.1}s = {:.0}fps method={}",
                    frames, elapsed, frames as f64 / elapsed, stream_method);
            }

            // Frame pacing
            let elapsed = frame_t0.elapsed().as_millis() as u64;
            if elapsed < target_ms { std::thread::sleep(std::time::Duration::from_millis(target_ms - elapsed)); }
        }
        dlog!("stream: exited after {} frames", frames);
    });

    *STREAM.lock().unwrap() = Some(StreamState { running });
    Ok("started".into())
}

#[tauri::command]
fn stream_poll() -> String {
    if let Ok(state) = STREAM_FRAME.lock() {
        let (ref pixels, w, h, ref method) = *state;
        if !pixels.is_empty() {
            let b64 = base64_encode(pixels);
            return serde_json::json!({
                "p": b64,
                "w": w,
                "h": h,
                "m": method
            }).to_string();
        }
    }
    String::new()
}

#[tauri::command]
fn capture_stream_stop() -> Result<String, String> {
    let mut state = STREAM.lock().unwrap();
    if let Some(ref s) = *state {
        s.running.store(false, Ordering::Relaxed);
        dlog!("stream_stop: signaled stop");
    }
    *state = None;
    Ok("stopped".into())
}


#[tauri::command]
fn screen_info() -> serde_json::Value {
    unsafe {
        let w = GetSystemMetrics(SM_CXSCREEN);
        let h = GetSystemMetrics(SM_CYSCREEN);
        serde_json::json!({ "w": w, "h": h })
    }
}

#[derive(Clone, Serialize)]
struct LogFile { name: String, lines: Vec<String> }

#[tauri::command]
fn read_logs(max_files: usize) -> Vec<LogFile> {
    let log_dir = find_project_log_dir();
    let mut result = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&log_dir) {
        let mut log_files: Vec<_> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("agent_") && e.file_name().to_string_lossy().ends_with(".log"))
            .collect();
        // Sort by modification time, newest first
        log_files.sort_by_key(|e| {
            e.metadata()
                .and_then(|m| m.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
        });
        log_files.reverse(); // newest first
        log_files.truncate(max_files);

        for entry in log_files {
            let name = entry.file_name().to_string_lossy().to_string();
            if let Ok(content) = std::fs::read_to_string(entry.path()) {
                let lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();
                if !lines.is_empty() {
                    result.push(LogFile { name, lines });
                }
            }
        }
    }
    result
}

/// Benchmark capture methods: test single-frame latency for each method.
/// Returns JSON: [{"method":"wgc","single_ms":12,"ok":true}, ...]
#[tauri::command]
fn benchmark_methods(hwnd: u64) -> String {
    let methods = vec!["wgc", "GDI(GetWindowDC)", "PrintWindow", "ScreenBitBlt", "DesktopBlt"];
    let mut results: Vec<serde_json::Value> = Vec::new();
    for m in &methods {
        let t0 = std::time::Instant::now();
        let result = unsafe { capture_with_method_ffi(hwnd, m) };
        let ms = t0.elapsed().as_millis() as u64;
        let (ok, size_kb) = if let Some((ref pixels, _, _)) = result {
            let valid = !pixels.is_empty()
                && unsafe { capture_is_solid_color(pixels.as_ptr(), pixels.len() as i32) == 0 }
                && unsafe { capture_has_magenta(pixels.as_ptr(), pixels.len() as i32) == 0 };
            let kb = pixels.len() as f64 / 1024.0;
            (valid, kb)
        } else {
            (false, 0.0)
        };
        dlog!("bench: {} {}ms {}KB {}", normalize_method(m), ms, size_kb as u64, if ok {"OK"} else {"NO_CONTENT"});
        results.push(serde_json::json!({
            "method": normalize_method(m),
            "single_ms": ms,
            "ok": ok,
        }));
    }
    serde_json::to_string(&results).unwrap_or_else(|_| "[]".into())
}

/// Bridge: receive UI event logs from frontend and write to disk log.
#[tauri::command]
fn log_ui_event(msg: String) {
    dlog!("{}", msg);
}

/// Archive current log file and start a new session log.
#[tauri::command]
fn clear_log() {
    // Close current log file (old file stays on disk as archive)
    *LOG_FILE.lock().unwrap() = None;
    // Start new session with fresh timestamped file
    init_log(5);
    dlog!("New session started (previous log archived)");
}

/// Report window state via C++ capture lib.
#[tauri::command]
fn window_state(hwnd: u64) -> String {
    let ptr = unsafe { capture_query_window_state(hwnd as isize) };
    if ptr.is_null() { return "unknown".into(); }
    let s = unsafe { std::ffi::CStr::from_ptr(ptr).to_string_lossy().to_string() };
    s
}

fn main() {
    init_log(5);  // keep max 5 log files
    dlog!("Starting Tauri application...");

    // Start overlay position tracker
    start_overlay_tracker();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_windows, list_processes,
            capture_single, capture_window,
            capture_stream_start, capture_stream_stop, stream_poll,
            highlight_window, screen_info, read_logs, log_ui_event, clear_log, window_state, benchmark_methods
        ])
        .setup(|_app| {
            dlog!("Tauri setup complete, window created");
            // Start hidden → query OS scale factor → compute logical size → show
            use tauri::Manager;
            if let Some(win) = _app.get_webview_window("main") {
                let scale = _app.available_monitors()
                    .ok()
                    .and_then(|mons| mons.into_iter().next())
                    .map(|m| m.scale_factor())
                    .unwrap_or(1.0);
                let logical_w = (DEFAULT_WINDOW_W as f64 / scale).round() as u32;
                let logical_h = (DEFAULT_WINDOW_H as f64 / scale).round() as u32;
                dlog!("setup: scale={} logical={}x{}", scale, logical_w, logical_h);
                use tauri::LogicalSize;
                let _ = win.set_size(LogicalSize::new(logical_w, logical_h));
                let _ = win.show();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running game agent monitor");
}
