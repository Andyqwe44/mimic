/**
 * 示例: C++ 捕获桌面 → 构建 BGRA payload → pipe 发送 → Rust 接收
 *
 * 发送端: 知道 payload 格式 (BGRA 像素 + 维度信息)
 * 传输层: 不知道内容, 只管打 [magic][size] 包头
 */
#include <windows.h>
#include <cstdio>
#include <vector>
#include "cpp_sender.hpp"

std::vector<uint8_t> capture_desktop(int& w, int& h) {
    HDC dc = GetDC(nullptr);
    w = GetSystemMetrics(SM_CXSCREEN); h = GetSystemMetrics(SM_CYSCREEN);
    HDC mem = CreateCompatibleDC(dc);
    HBITMAP bmp = CreateCompatibleBitmap(dc, w, h);
    HBITMAP old = (HBITMAP)SelectObject(mem, bmp);
    BitBlt(mem, 0, 0, w, h, dc, 0, 0, SRCCOPY);
    BITMAPINFOHEADER bi = {}; bi.biSize = sizeof(bi);
    bi.biWidth = w; bi.biHeight = -h; bi.biPlanes = 1; bi.biBitCount = 32; bi.biCompression = BI_RGB;
    std::vector<uint8_t> pixels(w * h * 4);
    GetDIBits(mem, bmp, 0, h, pixels.data(), (BITMAPINFO*)&bi, DIB_RGB_COLORS);
    SelectObject(mem, old); DeleteObject(bmp); DeleteDC(mem); ReleaseDC(nullptr, dc);
    return pixels;
}

int main() {
    PipeFrameSender pipe;  // 纯传输, 不管内容

    printf("[cpp_pipe] capturing desktop at 5fps... (Ctrl+C to stop)\n");

    for (int fi = 0; fi < 100; fi++) {
        int w, h;
        auto full = capture_desktop(w, h);

        // 缩放
        float s = 640.0f / w;
        int sw = w, sh = h;
        std::vector<uint8_t> scaled;
        if (s >= 1.0f) { scaled = full; sw = w; sh = h; }
        else {
            sw = (int)(w * s); sh = (int)(h * s);
            scaled.resize(sw * sh * 4);
            for (int y = 0; y < sh; y++) {
                int sy = (int)(y / s);
                for (int x = 0; x < sw; x++) {
                    int sx = (int)(x / s);
                    memcpy(scaled.data() + (y*sw+x)*4, full.data() + (sy*w+sx)*4, 4);
                }
            }
        }

        // ── 应用层: 构建 BGRA payload ──
        // 格式: [w:4][h:4][ch:4][reserved:4][pixels...]
        // 这是应用层自己的格式, 传输层不管
        uint8_t bgra_hdr[stream_protocol::BGRA_HEADER_SIZE];
        stream_protocol::build_bgra_payload_header(bgra_hdr, sw, sh, 4);
        std::vector<uint8_t> payload;
        payload.insert(payload.end(), bgra_hdr, bgra_hdr + sizeof(bgra_hdr));
        payload.insert(payload.end(), scaled.begin(), scaled.end());

        // ── 传输层: 发送 (只负责打 [FRAM][size] 包头) ──
        pipe.send(payload);

        fprintf(stderr, "[cpp] frame %d: %dx%d payload=%zuB\n", fi+1, sw, sh, payload.size());
        Sleep(200);
    }

    printf("[cpp_pipe] done\n");
    return 0;
}
