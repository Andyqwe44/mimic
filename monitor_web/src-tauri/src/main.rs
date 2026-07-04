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
struct WindowInfo { title: String, category: String, hwnd: u64 }

#[tauri::command]
fn list_processes() -> Vec<WindowInfo> {
    let t0 = Instant::now();
    let exe = std::env::current_exe()
        .map(|p| p.parent().unwrap_or(&p).join("..").join("..").join("..").join("..").join("capture").join("build").join("process_list.exe"))
        .unwrap_or_else(|_| "capture/build/process_list.exe".into());
    let exe = std::fs::canonicalize(&exe).unwrap_or(exe);

    dlog!("list_processes: calling {}", exe.display());
    match Command::new(&exe).output() {
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            if !stderr.is_empty() { dlog!("  stderr: {}", stderr.trim()); }
            let result: Vec<_> = String::from_utf8_lossy(&out.stdout).lines().filter_map(|line| {
                let line = line.trim(); if line.is_empty() { return None; }
                let title = extract_json_str(line, "title").unwrap_or("Unknown");
                let hwnd = extract_json_str(line, "hwnd").and_then(|s| s.parse().ok()).unwrap_or(0);
                Some(WindowInfo { title: title.to_string(), category: "process".into(), hwnd })
            }).collect();
            dlog!("list_processes: {} entries in {:.0}ms", result.len(), t0.elapsed().as_millis());
            result
        }
        Err(e) => {
            dlog!("list_processes: ERROR {}", e);
            vec![]
        }
    }
}

#[tauri::command]
fn list_windows() -> Vec<WindowInfo> {
    let t0 = Instant::now();
    // Navigate from exe dir: target/release -> target -> src-tauri -> monitor_web -> root -> capture/build
    let exe = std::env::current_exe()
        .map(|p| p.parent().unwrap_or(&p).join("..").join("..").join("..").join("..").join("capture").join("build").join("window_list.exe"))
        .unwrap_or_else(|_| "capture/build/window_list.exe".into());
    let exe = std::fs::canonicalize(&exe).unwrap_or(exe);

    dlog!("list_windows: calling {}", exe.display());
    match Command::new(&exe).output() {
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            if !stderr.is_empty() { dlog!("  stderr: {}", stderr.trim()); }
            let result: Vec<_> = String::from_utf8_lossy(&out.stdout).lines().filter_map(|line| {
                let line = line.trim(); if line.is_empty() { return None; }
                let cat = extract_json_str(line, "category").unwrap_or("window");
                let title = extract_json_str(line, "title").unwrap_or("Unknown");
                let hwnd = extract_json_str(line, "hwnd").and_then(|s| s.parse().ok()).unwrap_or(0);
                Some(WindowInfo { title: title.to_string(), category: cat.to_string(), hwnd })
            }).collect();
            dlog!("list_windows: {} entries in {:.0}ms", result.len(), t0.elapsed().as_millis());
            result
        }
        Err(e) => {
            dlog!("list_windows: ERROR {}", e);
            vec![WindowInfo { title: " Entire Desktop".into(), category: "desktop".into(), hwnd: 0 }]
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

// ── Screenshot via C++ capture_single.exe → raw BGRA → PNG(base64) ──

/// Run capture_single.exe, read raw BGRA pixels from stdout binary
fn run_capture(hwnd: u64) -> Option<(Vec<u8>, i32, i32)> {
    let t0 = Instant::now();
    let exe = std::env::current_exe()
        .map(|p| p.parent().unwrap_or(&p).join("..").join("..").join("..").join("..").join("capture").join("build").join("capture_single.exe"))
        .unwrap_or_else(|_| "capture/build/capture_single.exe".into());
    let exe = std::fs::canonicalize(&exe).unwrap_or(exe);

    dlog!("run_capture: {} {}", exe.display(), hwnd);
    let out = match Command::new(&exe).arg(hwnd.to_string()).output() {
        Ok(o) => o,
        Err(e) => { dlog!("run_capture: spawn failed: {}", e); return None; }
    };

    // Log C++ stderr (debug info)
    let stderr = String::from_utf8_lossy(&out.stderr);
    for line in stderr.lines() {
        if !line.is_empty() { dlog!("  C++ {}", line); }
    }

    if !out.status.success() {
        dlog!("run_capture: C++ exit {}", out.status.code().unwrap_or(-1));
        return None;
    }

    let data = out.stdout;
    if data.len() < 12 {
        dlog!("run_capture: stdout too short ({} bytes)", data.len());
        return None;
    }

    let w = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as i32;
    let h = u32::from_le_bytes([data[4], data[5], data[6], data[7]]) as i32;
    let ch = u32::from_le_bytes([data[8], data[9], data[10], data[11]]);

    let expected = w as usize * h as usize * ch as usize;
    let pixels = data[12..].to_vec();
    if pixels.len() != expected {
        dlog!("run_capture: pixel mismatch: got {} expected {}", pixels.len(), expected);
        return None;
    }
    dlog!("run_capture: {}x{} ch={} {}px in {:.0}ms", w, h, ch, pixels.len(), t0.elapsed().as_millis());
    Some((pixels, w, h))
}

/// Scale BGRA pixels → max 640px wide, BGRA→RGBA, PNG encode, base64
fn pixels_to_base64(pixels: &[u8], w: i32, h: i32) -> String {
    let scale = (640.0 / w as f32).min(1.0);
    let sw = (w as f32 * scale) as i32;
    let sh = (h as f32 * scale) as i32;

    // Nearest-neighbor scale + BGRA→RGBA
    let mut rgba = vec![0u8; (sw * sh * 4) as usize];
    for y in 0..sh {
        let sy = (y as f32 / scale) as usize;
        for x in 0..sw {
            let sx = (x as f32 / scale) as usize;
            let di = (y * sw + x) as usize * 4;
            let si = (sy * w as usize + sx) * 4;
            rgba[di]     = pixels[si + 2]; // B→R
            rgba[di + 1] = pixels[si + 1]; // G
            rgba[di + 2] = pixels[si];     // R→B
            rgba[di + 3] = 255;            // A
        }
    }

    // PNG encode
    let mut out = Vec::new();
    out.extend_from_slice(&[137, 80, 78, 71, 13, 10, 26, 10]);
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&(sw as u32).to_be_bytes());
    ihdr.extend_from_slice(&(sh as u32).to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    write_png_chunk(&mut out, b"IHDR", &ihdr);

    let mut raw = Vec::new();
    for y in 0..sh {
        raw.push(0);
        raw.extend_from_slice(&rgba[(y * sw) as usize * 4..(y * sw + sw) as usize * 4]);
    }
    let compressed = miniz_oxide::deflate::compress_to_vec_zlib(&raw, 6);
    write_png_chunk(&mut out, b"IDAT", &compressed);
    write_png_chunk(&mut out, b"IEND", &[]);
    base64_encode(&out)
}

#[tauri::command]
fn capture_single() -> String {
    let t0 = Instant::now();
    dlog!("capture_single: C++ desktop...");
    if let Some((pixels, w, h)) = run_capture(0) {
        let t1 = Instant::now();
        let b64 = pixels_to_base64(&pixels, w, h);
        let t2 = t1.elapsed().as_millis();
        dlog!("capture_single: {}x{} → {}b base64, C++={:.0}ms PNG+encode={}ms total={:.0}ms",
            w, h, b64.len(), t1.duration_since(t0).as_millis(), t2, t0.elapsed().as_millis());
        b64
    } else {
        dlog!("capture_single: FAILED");
        String::new()
    }
}

#[tauri::command]
fn capture_window(hwnd: u64) -> String {
    let t0 = Instant::now();
    dlog!("capture_window: hwnd={} C++...", hwnd);
    if let Some((pixels, w, h)) = run_capture(hwnd) {
        let t1 = Instant::now();
        let b64 = pixels_to_base64(&pixels, w, h);
        let t2 = t1.elapsed().as_millis();
        dlog!("capture_window: {}x{} → {}b base64, C++={:.0}ms PNG+encode={}ms total={:.0}ms",
            w, h, b64.len(), t1.duration_since(t0).as_millis(), t2, t0.elapsed().as_millis());
        b64
    } else {
        dlog!("capture_window: FAILED");
        String::new()
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

fn main() {
    init_log(5);  // keep max 5 log files
    dlog!("Starting Tauri application...");

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![list_windows, list_processes, capture_single, capture_window])
        .setup(|_app| {
            dlog!("Tauri setup complete, window created");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running game agent monitor");
}
