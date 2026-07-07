//! Unified logging — Rust bindings to C++ logger.cpp via FFI.
//!
//! ONE write function: capture_log_write_msg(tag, msg) — C++ and Rust both call it.
//!
//! Usage from any module in the crate:
//!   dlog!("wgc: {} frames", n);     // formats → capture_log_write_msg("rs", msg)
//!
//! Usage from main.rs:
//!   logger::init("agent", "0.2.0", "log/", 5, 5000);
//!   logger::read_logs(5) → Vec<LogFile>
//!   logger::shutdown();

use std::ffi::CString;

// ── FFI: the one true logging function ───────────────────
extern "C" {
    pub fn capture_log_init(
        app_name: *const std::ffi::c_char,
        app_version: *const std::ffi::c_char,
        log_dir: *const std::ffi::c_char,
        max_files: i32,
        ring_size: i32,
    );
    pub fn capture_log_shutdown();
    pub fn capture_log_write_msg(tag: *const std::ffi::c_char, msg: *const std::ffi::c_char);
    pub fn capture_log_read_memory() -> *mut std::ffi::c_char;
    pub fn capture_log_list_files(max_files: i32) -> *mut std::ffi::c_char;
    pub fn capture_log_free(s: *mut std::ffi::c_char);
    pub fn capture_log_flush();
}

// ── Convenience wrappers for Tauri commands ───────────────

pub fn init(app_name: &str, version: &str, log_dir: &str, max_files: usize, ring_size: usize) {
    let name_c = CString::new(app_name).unwrap();
    let ver_c = CString::new(version).unwrap();
    let dir_c = CString::new(log_dir).unwrap();
    unsafe {
        capture_log_init(
            name_c.as_ptr(),
            ver_c.as_ptr(),
            dir_c.as_ptr(),
            max_files as i32,
            ring_size as i32,
        );
    }
}

pub fn shutdown() {
    unsafe { capture_log_shutdown(); }
}

pub fn write(tag: &str, msg: &str) {
    let tag_c = CString::new(tag).unwrap();
    let msg_c = CString::new(msg).unwrap();
    unsafe { capture_log_write_msg(tag_c.as_ptr(), msg_c.as_ptr()); }
}

pub fn flush() {
    unsafe { capture_log_flush(); }
}

pub fn read_memory() -> String {
    unsafe {
        let ptr = capture_log_read_memory();
        if ptr.is_null() {
            return String::new();
        }
        let s = std::ffi::CStr::from_ptr(ptr).to_string_lossy().to_string();
        capture_log_free(ptr);
        s
    }
}

pub fn list_files(max_files: usize) -> Vec<serde_json::Value> {
    unsafe {
        let ptr = capture_log_list_files(max_files as i32);
        if ptr.is_null() {
            return vec![];
        }
        let json = std::ffi::CStr::from_ptr(ptr).to_string_lossy().to_string();
        capture_log_free(ptr);
        serde_json::from_str(&json).unwrap_or_default()
    }
}
