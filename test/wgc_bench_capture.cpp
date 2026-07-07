/**
 * wgc_bench_capture.cpp — Pure WGC capture FPS benchmark.
 *
 * Isolates WGC capture from all rendering/encoding/transport overhead.
 * Writes raw BGRA frames + per-frame timing to binary file.
 *
 * Usage:
 *   wgc_bench_capture.exe <hwnd|0> [--monitor] [--duration 5] [--output frames.bin] [--poll]
 *     hwnd=0 + --monitor = desktop capture via HMONITOR
 *     hwnd>0             = window capture
 *     --poll             = non-blocking TryGetNextFrame polling (no CV wait)
 *     --duration N       = capture duration in seconds (default: 10)
 *     --output file      = binary output file (default: wgc_bench_frames.bin)
 *
 * Output format (binary, LE):
 *   Repeated frames:
 *     [timestamp_us:8][width:4][height:4][size_bytes:4][pixels: size_bytes]
 *
 * Stderr: per-second FPS + per-stage timing breakdown (μs)
 */

#include "capture_wgc.hpp"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <thread>
#include <atomic>
#include <vector>
#include <chrono>
#include <fcntl.h>
#include <io.h>

// ── Simple integer-ratio downscale ──
static void scale_bgra(const uint8_t* src, int sw, int sh,
                       std::vector<uint8_t>& dst, int& dw, int& dh,
                       int max_dim) {
    float s = (float)max_dim / (float)(sw > sh ? sw : sh);
    if (s >= 1.0f) {
        dw = sw; dh = sh;
        dst.assign(src, src + sw * sh * 4);
        return;
    }
    dw = (int)(sw * s); dh = (int)(sh * s);
    if (dw < 1) dw = 1; if (dh < 1) dh = 1;
    dst.resize(dw * dh * 4);
    for (int y = 0; y < dh; y++) {
        int sy = (int)(y / s);
        for (int x = 0; x < dw; x++) {
            int sx = (int)(x / s);
            memcpy(dst.data() + (y * dw + x) * 4,
                   src + (sy * sw + sx) * 4, 4);
        }
    }
}

static void write_u32(std::vector<uint8_t>& buf, uint32_t v) {
    buf.push_back((uint8_t)(v));
    buf.push_back((uint8_t)(v >> 8));
    buf.push_back((uint8_t)(v >> 16));
    buf.push_back((uint8_t)(v >> 24));
}
static void write_u64(std::vector<uint8_t>& buf, uint64_t v) {
    write_u32(buf, (uint32_t)(v));
    write_u32(buf, (uint32_t)(v >> 32));
}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        fprintf(stderr, "Usage: wgc_bench_capture.exe <hwnd> [--monitor] [--duration 5] [--output file] [--poll]\n");
        return 1;
    }

    winrt::init_apartment(winrt::apartment_type::multi_threaded);
    setvbuf(stderr, NULL, _IONBF, 0);

    HWND hwnd = (HWND)(ULONG_PTR)_strtoui64(argv[1], nullptr, 10);
    bool use_monitor = false;
    bool use_poll = false;
    int duration_sec = 10;
    const char* out_file = "wgc_bench_frames.bin";
    int max_dim = 0;
    int frame_pool_size = 2;  // default

    for (int i = 2; i < argc; i++) {
        if (strcmp(argv[i], "--monitor") == 0) use_monitor = true;
        else if (strcmp(argv[i], "--poll") == 0) use_poll = true;
        else if (strcmp(argv[i], "--duration") == 0 && i + 1 < argc)
            duration_sec = atoi(argv[++i]);
        else if (strcmp(argv[i], "--output") == 0 && i + 1 < argc)
            out_file = argv[++i];
        else if (strcmp(argv[i], "--scale") == 0 && i + 1 < argc)
            max_dim = atoi(argv[++i]);
        else if (strcmp(argv[i], "--pool") == 0 && i + 1 < argc)
            frame_pool_size = atoi(argv[++i]);
    }

    fprintf(stderr, "=== WGC Capture Benchmark ===\n");
    fprintf(stderr, "Target: %s (hwnd=%p)\n", use_monitor ? "desktop(monitor)" : "window", (void*)hwnd);
    fprintf(stderr, "Mode: %s\n", use_poll ? "POLL (non-blocking TryGetNextFrame)" : "CV WAIT (condition variable)");
    fprintf(stderr, "Duration: %d sec | FramePool: %d | Scale: %d\n",
            duration_sec, frame_pool_size, max_dim);
    fprintf(stderr, "Output: %s\n", out_file);

    // Create DispatcherQueue (required for FrameArrived)
    auto dq_ctrl = wgc::create_dispatcher_queue();

    wgc::WgcCapture cap;
    bool ok;
    if (use_monitor) {
        HMONITOR hmon = MonitorFromWindow(nullptr, MONITOR_DEFAULTTOPRIMARY);
        ok = cap.init_monitor(hmon);
    } else {
        ok = cap.init(hwnd);
    }

    if (!ok) {
        fprintf(stderr, "ERROR: init failed: %s\n", cap.last_error());
        return 1;
    }
    fprintf(stderr, "Capture size: %dx%d\n", cap.width(), cap.height());

    // Open output file
    FILE* fout = fopen(out_file, "wb");
    if (!fout) {
        fprintf(stderr, "ERROR: cannot open output file %s\n", out_file);
        return 1;
    }

    // Warm up: get first frame
    fprintf(stderr, "Warming up...\n");
    wgc::WgcFrame warm;
    int warm_attempts = 0;
    while (warm_attempts < 200) {
        if ((use_poll && cap.capture(warm, nullptr)) ||
            (!use_poll && cap.wait_frame(warm, 100))) {
            fprintf(stderr, "Warm-up OK: %dx%d after %d attempts\n",
                    warm.width, warm.height, warm_attempts + 1);
            break;
        }
        warm_attempts++;
    }
    if (warm_attempts >= 200) {
        fprintf(stderr, "ERROR: no frame after 20s\n");
        fclose(fout);
        return 1;
    }

    // Write header: total frame count placeholder (will overwrite at end)
    uint32_t frame_count_placeholder = 0xFFFFFFFF;
    fwrite(&frame_count_placeholder, 4, 1, fout);
    // Write capture params
    uint32_t cap_w = (uint32_t)warm.width;
    uint32_t cap_h = (uint32_t)warm.height;
    fwrite(&cap_w, 4, 1, fout);
    fwrite(&cap_h, 4, 1, fout);

    // Benchmark loop
    std::atomic<bool> running{true};
    auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(duration_sec);

    int total_frames = 0;
    uint64_t total_cap_us = 0, total_copy_us = 0, total_readback_us = 0;
    auto last_report = std::chrono::steady_clock::now();
    int frames_since_report = 0;

    std::vector<uint8_t> frame_buf; // reusable buffer

    while (running) {
        if (std::chrono::steady_clock::now() >= deadline) {
            running = false;
            break;
        }

        wgc::WgcFrame frame;
        wgc::WgcTiming timing;
        bool got;

        if (use_poll) {
            got = cap.capture(frame, &timing);
            if (!got) {
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
                continue;
            }
        } else {
            got = cap.wait_frame(frame, 100, &timing);
            if (!got) continue;
        }

        total_frames++;
        total_cap_us += timing.cap_us;
        total_copy_us += timing.copy_us;
        total_readback_us += timing.readback_us;

        // Scale if needed
        const uint8_t* pixel_data = frame.pixels.data();
        int fw = frame.width, fh = frame.height;
        std::vector<uint8_t> scaled;
        if (max_dim > 0 && (fw > max_dim || fh > max_dim)) {
            scale_bgra(pixel_data, fw, fh, scaled, fw, fh, max_dim);
            pixel_data = scaled.data();
        }

        // Serialize frame: [ts:8][w:4][h:4][size:4][pixels:size]
        uint32_t size = (uint32_t)(fw * fh * 4);
        fwrite(&frame.timestamp_us, 8, 1, fout);
        uint32_t w32 = (uint32_t)fw, h32 = (uint32_t)fh;
        fwrite(&w32, 4, 1, fout);
        fwrite(&h32, 4, 1, fout);
        fwrite(&size, 4, 1, fout);
        fwrite(pixel_data, 1, size, fout);

        frames_since_report++;

        // Per-second report
        auto now = std::chrono::steady_clock::now();
        double elapsed = std::chrono::duration<double>(now - last_report).count();
        if (elapsed >= 1.0) {
            double fps = frames_since_report / elapsed;
            double avg_total = total_frames > 0
                ? (double)(total_cap_us + total_copy_us + total_readback_us) / total_frames
                : 0;
            fprintf(stderr, "[bench] %d frames in %.2fs = %.1f FPS | "
                    "avg total=%.0fus (cap=%.0f copy=%.0f readback=%.0f)\n",
                    frames_since_report, elapsed, fps, avg_total,
                    total_frames > 0 ? (double)total_cap_us / total_frames : 0,
                    total_frames > 0 ? (double)total_copy_us / total_frames : 0,
                    total_frames > 0 ? (double)total_readback_us / total_frames : 0);
            frames_since_report = 0;
            last_report = now;
            total_cap_us = 0;
            total_copy_us = 0;
            total_readback_us = 0;
            total_frames = 0;
        }
    }

    // Update header with actual frame count
    fseek(fout, 0, SEEK_SET);
    fwrite(&total_frames, 4, 1, fout);
    fclose(fout);

    cap.shutdown();
    // Fire-and-forget DispatcherQueue shutdown — .get() can hang
    // if there are pending FrameArrived callbacks (same issue as FFI).
    if (dq_ctrl) {
        dq_ctrl.ShutdownQueueAsync();  // no .get() — let OS clean up
        dq_ctrl = nullptr;
    }

    fprintf(stderr, "\nDone. Total frames captured: %d (output: %s)\n", total_frames, out_file);
    fprintf(stderr, "To replay: cargo run --bin frame_replay -- %s\n", out_file);
    return 0;
}
