/**
 * Game Agent Monitor — MAA-inspired unified entry
 */
#define SLINT_FEATURE_FREESTANDING
#define WIN32_LEAN_AND_MEAN
#include "appwindow.h"
#include <windows.h>
#include <cstdio>
#include <string>
#include <thread>
#include <mutex>
#include <chrono>
#include <vector>
#include <atomic>

#include "../../capture/include/capture.hpp"
#include "../../input/include/input.hpp"

// ── Log ──
static std::mutex g_log_mutex;
static std::string g_log_buf;

static void log(const char* lv, const char* fmt, ...) {
    char buf[512]; va_list a; va_start(a, fmt); vsnprintf(buf, sizeof(buf), fmt, a); va_end(a);
    auto t = std::chrono::system_clock::now();
    auto tt = std::chrono::system_clock::to_time_t(t);
    auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(t.time_since_epoch()) % 1000;
    char tb[32]; std::tm lc; localtime_s(&lc, &tt);
    snprintf(tb, sizeof(tb), "%02d:%02d:%02d.%03lld", lc.tm_hour, lc.tm_min, lc.tm_sec, ms.count());
    std::lock_guard<std::mutex> lk(g_log_mutex);
    g_log_buf += std::string(tb) + " [" + lv + "] " + buf + "\n";
}

// ── Process ──
struct Proc { PROCESS_INFORMATION pi; std::string name; };
static std::vector<Proc> g_procs;

static void launch(const char* cmd, const char* name) {
    STARTUPINFOA si = { sizeof(si) }; PROCESS_INFORMATION pi = {};
    char c[512]; strncpy_s(c, cmd, 511);
    if (!CreateProcessA(nullptr, c, nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
        log("ERR", "Launch failed: %s", name); return;
    }
    log("OK", "Started %s (PID %d)", name, pi.dwProcessId);
    g_procs.push_back({pi, name});
}

static void kill_all() {
    for (auto& p : g_procs) {
        TerminateProcess(p.pi.hProcess, 0); CloseHandle(p.pi.hProcess); CloseHandle(p.pi.hThread);
        log("--", "Stopped %s", p.name.c_str());
    }
    g_procs.clear();
}

// ── Main ──
int main() {
    auto app = AppWindow::create();
    app->set_version("v0.1.0");
    app->set_status("Idle");
    app->set_running(false);
    app->set_fps(0);
    app->set_latency(0);
    app->set_resolution(slint::SharedString("---"));
    app->set_log_text(slint::SharedString(""));

    auto capture = create_capture_backend();
    log("INFO", "Capture: %s", capture->name());
    auto input = create_input_backend();
    log("INFO", "Input: %s", input->name());
    app->set_log_text(slint::SharedString(g_log_buf));

    std::atomic<bool> running{false};

    // ── Start ──
    app->on_start([&]() {
        log("INFO", "=== Task started ===");
        launch("game\\main.exe --server 127.0.0.1 9999 --auto", "Game Engine");
        launch("python ai\\ai_server.py --port 9999", "AI Server");
        running = true;
        app->set_running(true);
        app->set_status("Running");
        app->set_log_text(slint::SharedString(g_log_buf));
    });

    // ── Stop ──
    app->on_stop([&]() {
        running = false;
        kill_all();
        app->set_running(false);
        app->set_status("Idle");
        app->set_fps(0);
        app->set_latency(0);
        log("INFO", "=== Task stopped ===");
        app->set_log_text(slint::SharedString(g_log_buf));
    });

    // ── Screenshot test ──
    app->on_screenshot([&]() {
        FrameBuffer buf;
        if (capture->capture(buf)) {
            log("INFO", "Screenshot: %dx%d (%.1fms)", buf.width, buf.height, 0.0);
        } else {
            log("WARN", "Screenshot failed");
        }
        app->set_log_text(slint::SharedString(g_log_buf));
    });

    // ── Click test ──
    app->on_click([&]() {
        int sw = GetSystemMetrics(SM_CXSCREEN), sh = GetSystemMetrics(SM_CYSCREEN);
        int cx = sw / 2, cy = sh / 2;
        log("ACT", "Test click at (%d, %d)", cx, cy);
        input->move_mouse(cx, cy); Sleep(50);
        input->click(MouseButton::Left);
        app->set_log_text(slint::SharedString(g_log_buf));
    });

    // ── FPS timer ──
    std::thread([&]() {
        float fps = 0, lat = 0;
        while (true) {
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
            if (running) {
                auto t0 = std::chrono::steady_clock::now();
                FrameBuffer buf;
                capture->capture(buf);
                auto t1 = std::chrono::steady_clock::now();
                float dt = std::chrono::duration_cast<std::chrono::microseconds>(t1 - t0).count() / 1000.0f;
                fps = dt > 0 ? 1000.0f / dt : 0;
                lat = dt;
                slint::invoke_from_event_loop([&]() {
                    app->set_fps(fps);
                    app->set_latency(lat);
                    char r[32];
                    snprintf(r, sizeof(r), "%dx%d", buf.width, buf.height);
                    app->set_resolution(slint::SharedString(r));
                });
            }
        }
    }).detach();

    app->run();
    running = false; kill_all();
    capture->shutdown(); input->shutdown();
    return 0;
}
