#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;
use serde::Serialize;
use std::time::Instant;

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

fn init_log(max_logs: usize) {
    let log_dir = std::env::current_exe()
        .map(|p| p.parent().unwrap_or(&p).to_path_buf())
        .unwrap_or_else(|_| std::path::PathBuf::from("."));

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
struct WindowInfo { title: String, category: String }

#[tauri::command]
fn list_windows() -> Vec<WindowInfo> {
    let t0 = Instant::now();
    let exe = std::env::current_dir()
        .map(|d| d.join("..").join("capture").join("build").join("window_list.exe"))
        .unwrap_or_else(|_| "../capture/build/window_list.exe".into());

    dlog!("list_windows: calling {}", exe.display());
    match Command::new(&exe).output() {
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            if !stderr.is_empty() { dlog!("  stderr: {}", stderr.trim()); }
            let result: Vec<_> = String::from_utf8_lossy(&out.stdout).lines().filter_map(|line| {
                let line = line.trim(); if line.is_empty() { return None; }
                let cat = extract_json_str(line, "category").unwrap_or("window");
                let title = extract_json_str(line, "title").unwrap_or("Unknown");
                Some(WindowInfo { title: title.to_string(), category: cat.to_string() })
            }).collect();
            dlog!("list_windows: {} entries in {:.0}ms", result.len(), t0.elapsed().as_millis());
            result
        }
        Err(e) => {
            dlog!("list_windows: ERROR {}", e);
            vec![WindowInfo { title: " Entire Desktop".into(), category: "desktop".into() }]
        }
    }
}

fn extract_json_str<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let search = format!("\"{}\":\"", key);
    let start = line.find(&search)? + search.len();
    // Find the closing unescaped quote using char indices
    let rest = &line[start..];
    let mut prev_backslash = false;
    for (i, c) in rest.char_indices() {
        if c == '\\' { prev_backslash = true; continue; }
        if c == '"' && !prev_backslash { return Some(&rest[..i]); }
        prev_backslash = false;
    }
    Some(rest)
}

// ── Single-frame screenshot via GDI → base64 PNG ──
#[tauri::command]
fn capture_single() -> String {
    let t0 = Instant::now();
    dlog!("capture_single: starting...");
    let result = unsafe { capture_screen_to_base64() }.unwrap_or_default();
    dlog!("capture_single: {} bytes in {:.0}ms", result.len(), t0.elapsed().as_millis());
    result
}

#[cfg(target_os = "windows")]
unsafe fn capture_screen_to_base64() -> Option<String> {
    extern "system" {
        fn GetDC(hwnd: isize) -> isize;
        fn ReleaseDC(hwnd: isize, hdc: isize) -> i32;
        fn GetSystemMetrics(idx: i32) -> i32;
        fn CreateCompatibleDC(hdc: isize) -> isize;
        fn CreateCompatibleBitmap(hdc: isize, w: i32, h: i32) -> isize;
        fn SelectObject(hdc: isize, obj: isize) -> isize;
        fn DeleteDC(hdc: isize) -> i32;
        fn DeleteObject(obj: isize) -> i32;
        fn BitBlt(hdc: isize, x: i32, y: i32, w: i32, h: i32, src: isize, sx: i32, sy: i32, op: u32) -> i32;
        fn GetDIBits(hdc: isize, bmp: isize, start: u32, lines: u32, bits: *mut u8, bmi: *const u8, usage: u32) -> i32;
        fn StretchBlt(dst: isize, dx: i32, dy: i32, dw: i32, dh: i32, src: isize, sx: i32, sy: i32, sw: i32, sh: i32, op: u32) -> i32;
    }
    const SRCCOPY: u32 = 0x00CC0020;
    const SM_CXSCREEN: i32 = 0; const SM_CYSCREEN: i32 = 1;

    dlog!("capture: GetDC...");
    let hdc_screen = GetDC(0);
    if hdc_screen == 0 { dlog!("capture: GetDC FAILED"); return None; }
    let w = GetSystemMetrics(SM_CXSCREEN);
    let h = GetSystemMetrics(SM_CYSCREEN);
    dlog!("capture: screen {}x{}", w, h);

    // Scale to max 640px wide
    let scale = (640.0 / w as f32).min(1.0);
    let sw = (w as f32 * scale) as i32;
    let sh = (h as f32 * scale) as i32;
    dlog!("capture: scaled to {}x{}", sw, sh);

    dlog!("capture: CreateCompatibleDC+Bitmap...");
    let hdc_mem = CreateCompatibleDC(hdc_screen);
    let hbmp_small = CreateCompatibleBitmap(hdc_screen, sw, sh);
    if hbmp_small == 0 { dlog!("capture: CreateCompatibleBitmap FAILED"); ReleaseDC(0, hdc_screen); DeleteDC(hdc_mem); return None; }
    let old = SelectObject(hdc_mem, hbmp_small);

    // StretchBlt: scales down in one step
    dlog!("capture: StretchBlt...");
    StretchBlt(hdc_mem, 0, 0, sw, sh, hdc_screen, 0, 0, w, h, SRCCOPY);

    // GetDIBits from the small bitmap (sw×sh)
    let mut bmi = [0u8; 44];
    bmi[0..4].copy_from_slice(&44u32.to_le_bytes());
    bmi[4..8].copy_from_slice(&(sw as u32).to_le_bytes());
    bmi[8..12].copy_from_slice(&(-sh as i32).to_le_bytes());
    bmi[12..14].copy_from_slice(&1u16.to_le_bytes());
    bmi[14..16].copy_from_slice(&32u16.to_le_bytes());
    let buf_size = (sw * sh * 4) as usize;
    let mut pixels: Vec<u8> = vec![0u8; buf_size];

    dlog!("capture: GetDIBits {} bytes...", buf_size);
    let ret = GetDIBits(hdc_mem, hbmp_small, 0, sh as u32, pixels.as_mut_ptr(), bmi.as_ptr(), 0);
    if ret == 0 { dlog!("capture: GetDIBits FAILED"); }

    // Cleanup GDI
    SelectObject(hdc_mem, old); DeleteObject(hbmp_small); DeleteDC(hdc_mem); ReleaseDC(0, hdc_screen);
    dlog!("capture: GDI cleanup done");

    // BGRA → RGBA
    let mut rgba = vec![0u8; buf_size];
    for i in (0..buf_size).step_by(4) {
        rgba[i] = pixels[i + 2]; rgba[i + 1] = pixels[i + 1]; rgba[i + 2] = pixels[i]; rgba[i + 3] = 255;
    }
    dlog!("capture: BGRA->RGBA done, encoding PNG...");

    let mut out = Vec::new();
    out.extend_from_slice(&[137, 80, 78, 71, 13, 10, 26, 10]);
    let mut ihdr_data = Vec::new();
    ihdr_data.extend_from_slice(&(sw as u32).to_be_bytes());
    ihdr_data.extend_from_slice(&(sh as u32).to_be_bytes());
    ihdr_data.extend_from_slice(&[8, 6, 0, 0, 0]);
    write_png_chunk(&mut out, b"IHDR", &ihdr_data);

    let mut raw = Vec::with_capacity(buf_size + sh as usize);
    for y in 0..sh {
        raw.push(0);
        let row_start = (y * sw) as usize * 4;
        raw.extend_from_slice(&rgba[row_start..row_start + sw as usize * 4]);
    }
    let compressed = miniz_oxide::deflate::compress_to_vec_zlib(&raw, 6);
    write_png_chunk(&mut out, b"IDAT", &compressed);
    write_png_chunk(&mut out, b"IEND", &[]);
    let b64 = base64_encode(&out);
    dlog!("capture: done, {} bytes base64", b64.len());
    Some(b64)
}

#[cfg(not(target_os = "windows"))]
unsafe fn capture_screen_to_base64() -> Option<String> { None }

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

fn main() {
    init_log(5);  // keep max 5 log files
    dlog!("Starting Tauri application...");

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![list_windows, capture_single])
        .setup(|_app| {
            dlog!("Tauri setup complete, window created");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running game agent monitor");
}
