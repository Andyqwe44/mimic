/**
 * capture_wgc_ffi.cpp — FFI implementation for WgcCapture.
 * Manages background thread, frame buffer with mutex, and C-compatible access.
 */
#include "capture_wgc.hpp"
#include "capture_wgc_ffi.h"
#include <thread>
#include <atomic>
#include <mutex>
#include <vector>
#include <cstring>

struct WgcStreamHandle {
    wgc::WgcCapture cap;
    std::thread worker;
    std::atomic<bool> running{false};
    std::atomic<bool> has_frame{false};

    // Mutex-protected latest frame
    std::mutex mtx;
    std::vector<uint8_t> frame_buf;
    int frame_w = 0, frame_h = 0, frame_ch = 4;

    bool start(HWND hwnd) {
        if (!cap.init(hwnd)) return false;
        running = true;
        worker = std::thread([this]() {
            wgc::WgcFrame frame;
            while (running) {
                if (cap.capture(frame)) {
                    std::lock_guard<std::mutex> lk(mtx);
                    frame_buf = std::move(frame.pixels);
                    frame_w = frame.width;
                    frame_h = frame.height;
                    frame_ch = frame.channels;
                    has_frame = true;
                } else {
                    // No new frame; sleep briefly to avoid busy-wait
                    std::this_thread::sleep_for(std::chrono::milliseconds(1));
                }
            }
        });
        return true;
    }

    void stop() {
        running = false;
        if (worker.joinable()) worker.join();
        cap.shutdown();
    }
};

extern "C" {

WgcStreamHandle* wgc_stream_start(HWND hwnd, int /*max_dim*/) {
    auto* h = new WgcStreamHandle();
    if (!h->start(hwnd)) {
        delete h;
        return nullptr;
    }
    return h;
}

int wgc_stream_read(WgcStreamHandle* h, uint8_t* buf, int buf_size,
                    int* out_w, int* out_h, int* out_ch) {
    if (!h || !h->has_frame.load()) return 0;
    std::lock_guard<std::mutex> lk(h->mtx);
    if (h->frame_buf.empty()) return 0;
    int needed = (int)h->frame_buf.size();
    if (buf_size < needed) return 0; // buffer too small
    memcpy(buf, h->frame_buf.data(), needed);
    *out_w = h->frame_w;
    *out_h = h->frame_h;
    *out_ch = h->frame_ch;
    h->has_frame = false;
    return needed;
}

int wgc_stream_is_ok(WgcStreamHandle* h) {
    if (!h) return 0;
    return h->running.load() && h->cap.is_ok() ? 1 : 0;
}

void wgc_stream_stop(WgcStreamHandle* h) {
    if (!h) return;
    h->stop();
    delete h;
}

int wgc_capture_single(HWND hwnd, uint8_t* buf, int buf_size,
                       int* out_w, int* out_h, int* out_ch) {
    wgc::WgcCapture cap;
    if (!cap.init(hwnd)) return 0;
    wgc::WgcFrame frame;
    // Wait up to ~500ms for first frame
    for (int i = 0; i < 500; i++) {
        if (cap.capture(frame)) {
            int needed = (int)frame.pixels.size();
            if (buf_size < needed) { cap.shutdown(); return 0; }
            memcpy(buf, frame.pixels.data(), needed);
            *out_w = frame.width;
            *out_h = frame.height;
            *out_ch = frame.channels;
            cap.shutdown();
            return needed;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    cap.shutdown();
    return 0;
}

} // extern "C"
