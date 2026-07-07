//! Zero-copy frame pipeline: WebView2 SharedBuffer → Canvas.
//!
//! WGC GPU frame → CPU readback(BGRA) → SharedBuffer(shared mem) → JS Canvas
//! No base64, no JSON, no HTTP, no JPEG encode — raw BGRA straight to ImageData.
//!
//! Uses ICoreWebView2Environment12::CreateSharedBuffer (available from
//! WebView2 Runtime ≥122.0.2365.0).
//!
//! PostSharedBufferToScript is callable from any thread — capture thread
//! pushes frames directly without UI-thread marshaling.

use std::sync::Mutex;
use webview2_com_sys::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2SharedBuffer, ICoreWebView2_17, ICoreWebView2Environment12,
    COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY, ICoreWebView2_17_Vtbl,
};
use windows_core::Interface;

// webview2_com (safe) and webview2_com_sys are both #[repr(transparent)]
// over windows_core::Interface (which is { ptr: *mut c_void }).
// Cross-crate transmute is safe (same repr, same COM interface).
use webview2_com as wv2;

/// Initialized once in setup() — holds the WebView2 interfaces needed
/// for shared buffer creation and posting.
pub struct SharedTexturePipeline {
    /// ICoreWebView2Environment12 for CreateSharedBuffer
    env12: ICoreWebView2Environment12,
    /// ICoreWebView2_17 for PostSharedBufferToScript
    webview17: ICoreWebView2_17,
}

unsafe impl Send for SharedTexturePipeline {}
unsafe impl Sync for SharedTexturePipeline {}

static PIPELINE: Mutex<Option<SharedTexturePipeline>> = Mutex::new(None);

/// Safe size limit: 4K RGBA = 3840*2160*4 ≈ 33MB. SharedBuffer has no
/// hard limit but keep under 64MB for performance.
const MAX_BUFFER_SIZE: u64 = 64 * 1024 * 1024;

/// Initialize the pipeline. Must be called from the main thread during setup,
/// after the webview is created.
///
/// Accepts webview2_com types directly (what Tauri's PlatformWebview returns).
/// Internally transmutes to webview2_com_sys types for the newer interfaces.
pub fn init_pipeline(
    controller: wv2::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
    environment: wv2::Microsoft::Web::WebView2::Win32::ICoreWebView2Environment,
) {
    // Transmute from webview2_com to webview2_com_sys types.
    // Both are #[repr(transparent)] over windows_core::Interface.
    let controller_sys: webview2_com_sys::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller =
        unsafe { std::mem::transmute(controller) };

    let env_sys: webview2_com_sys::Microsoft::Web::WebView2::Win32::ICoreWebView2Environment =
        unsafe { std::mem::transmute(environment) };

    // Get ICoreWebView2 → cast to ICoreWebView2_17 (for PostSharedBufferToScript)
    let core_webview = match unsafe { controller_sys.CoreWebView2() } {
        Ok(wv) => wv,
        Err(e) => {
            dlog!("[shared_texture] CoreWebView2() failed: {:?}", e);
            return;
        }
    };
    let webview17: ICoreWebView2_17 = match core_webview.cast() {
        Ok(wv) => wv,
        Err(e) => {
            dlog!("[shared_texture] cast→ICoreWebView2_17 failed: {:?} (Runtime too old? need >=122)", e);
            return;
        }
    };

    // Environment → ICoreWebView2Environment12 (for CreateSharedBuffer)
    let env12: ICoreWebView2Environment12 = match env_sys.cast() {
        Ok(env) => env,
        Err(e) => {
            dlog!("[shared_texture] cast→ICoreWebView2Environment12 failed: {:?}", e);
            return;
        }
    };

    let pipeline = SharedTexturePipeline { env12, webview17 };
    *PIPELINE.lock().unwrap() = Some(pipeline);
    dlog!("[shared_texture] pipeline initialized — ICoreWebView2_17 + ICoreWebView2Environment12 OK");
}

// ── Raw vtable call for PostSharedBufferToScript ──
// We bypass the type-safe wrapper because cargo has two windows_core versions
// (0.58 and 0.61) that create trait conflicts for PCWSTR.
// PCWSTR is #[repr(transparent)] struct(*const u16) — same ABI as *const u16.

type RawPostSharedBufferFn = unsafe extern "system" fn(
    this: *mut std::ffi::c_void,
    sharedbuffer: *mut std::ffi::c_void,
    access: i32,
    additionaldataasjson: *const u16,
) -> i32; // HRESULT

/// Push a BGRA frame to the frontend via SharedBuffer.
/// Callable from any thread (capture thread).
/// Returns false if pipeline not initialized or buffer creation failed.
pub fn push_shared_frame(bgra: &[u8], w: u32, h: u32) -> bool {
    let (env12, webview17) = {
        let guard = match PIPELINE.lock() {
            Ok(g) => g,
            Err(_) => return false,
        };
        match guard.as_ref() {
            Some(p) => (p.env12.clone(), p.webview17.clone()),
            None => return false,
        }
    };

    let size = (w as u64) * (h as u64) * 4;
    if size == 0 || size > MAX_BUFFER_SIZE {
        return false;
    }

    // Create shared buffer — allocates shared memory accessible by both
    // the native process and the WebView2 script environment.
    let shared_buf: ICoreWebView2SharedBuffer = match unsafe { env12.CreateSharedBuffer(size) } {
        Ok(buf) => buf,
        Err(e) => {
            dlog!("[shared_texture] CreateSharedBuffer({}) failed: {:?}", size, e);
            return false;
        }
    };

    // Get raw pointer to buffer data
    let mut buf_ptr: *mut u8 = std::ptr::null_mut();
    if let Err(e) = unsafe { shared_buf.Buffer(&mut buf_ptr) } {
        dlog!("[shared_texture] Buffer() failed: {:?}", e);
        let _ = unsafe { shared_buf.Close() };
        return false;
    }
    if buf_ptr.is_null() {
        dlog!("[shared_texture] Buffer() returned null pointer");
        let _ = unsafe { shared_buf.Close() };
        return false;
    }

    // Copy frame data into shared buffer (the only memcpy in the pipeline)
    unsafe {
        std::ptr::copy_nonoverlapping(bgra.as_ptr(), buf_ptr, bgra.len().min(size as usize));
    }

    // Build metadata JSON: width, height, timestamp
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let meta = format!(r#"{{"w":{},"h":{},"ts":{}}}"#, w, h, ts);
    let meta_wide: Vec<u16> = meta.encode_utf16().chain(std::iter::once(0)).collect();

    // Raw vtable call to PostSharedBufferToScript.
    // We transmute the function signature to use *const u16 instead of PCWSTR
    // to avoid windows_core version conflicts between 0.58 and 0.61.
    let vtbl: &ICoreWebView2_17_Vtbl = windows_core::Interface::vtable(&webview17);
    let raw_fn: RawPostSharedBufferFn = unsafe {
        std::mem::transmute(vtbl.PostSharedBufferToScript)
    };
    let hr = unsafe {
        raw_fn(
            windows_core::Interface::as_raw(&webview17) as *mut _,
            windows_core::Interface::as_raw(&shared_buf) as *mut _,
            COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY.0,
            meta_wide.as_ptr(),
        )
    };

    // Close our native handle — script side retains a reference until released
    let _ = unsafe { shared_buf.Close() };

    if hr >= 0 {
        true
    } else {
        dlog!("[shared_texture] PostSharedBufferToScript returned HRESULT 0x{:08X}", hr);
        false
    }
}

/// Check if the SharedTexture pipeline is ready.
pub fn is_pipeline_ready() -> bool {
    PIPELINE.lock().map(|g| g.is_some()).unwrap_or(false)
}
