/**
 * 示例: C++ 捕获桌面 → 构建 BGRA payload → TCP :9999 广播 → Python 接收
 *
 * 使用 canonical protocol/ 格式 (12字节头 + type_tag).
 * 应用层 payload 由 common/payload/bgra.hpp 构建.
 */
#include <windows.h>
#include <cstdio>
#include <vector>
#include <cstring>
#include "cpp_sender.hpp"
#include "../common/payload/bgra.hpp"

std::vector<uint8_t> capture_desktop(int& w, int& h) {
    HDC dc = GetDC(nullptr);
    w = GetSystemMetrics(SM_CXSCREEN); h = GetSystemMetrics(SM_CYSCREEN);
    HDC mem = CreateCompatibleDC(dc);
    HBITMAP bmp = CreateCompatibleBitmap(dc, w, h);
    SelectObject(mem, bmp);
    BitBlt(mem, 0, 0, w, h, dc, 0, 0, SRCCOPY);
    BITMAPINFOHEADER bi = {}; bi.biSize = sizeof(bi);
    bi.biWidth = w; bi.biHeight = -h; bi.biPlanes = 1; bi.biBitCount = 32; bi.biCompression = BI_RGB;
    std::vector<uint8_t> pixels(w * h * 4);
    GetDIBits(mem, bmp, 0, h, pixels.data(), (BITMAPINFO*)&bi, DIB_RGB_COLORS);
    DeleteObject(bmp); DeleteDC(mem); ReleaseDC(nullptr, dc);
    return pixels;
}

int main() {
    TcpFrameSender tcp;
    tcp.listen();

    printf("[cpp_tcp] broadcasting at 5fps on :%d...\n", PROTOCOL_DEFAULT_TCP_PORT);
    printf("           run: python examples/python_tcp_recv.py\n");

    for (int fi = 0; ; fi++) {
        tcp.accept_clients();

        int w, h;
        auto full = capture_desktop(w, h);

        float s = 640.0f / w;
        int sw = w, sh = h;
        std::vector<uint8_t> scaled = full;
        if (s < 1.0f) {
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

        // 应用层: 用 canonical payload/bgra.hpp 构建 BGRA payload
        auto payload = payload::bgra_pack(scaled, sw, sh, 4);

        // 传输层: 广播 (12字节头 + type_tag)
        tcp.broadcast(PAYLOAD_TYPE_BGRA_FRAME, payload);

        fprintf(stderr, "[cpp] frame %d: %dx%d payload=%zuB\n", fi+1, sw, sh, payload.size());
        Sleep(200);
    }
    return 0;
}
