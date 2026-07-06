/**
 * capture_screen.cpp — FFI: ScreenBitBlt capture method.
 */
#include "capture_methods.h"
#include "capture_internal.h"
#include <cstring>
#include <vector>

int capture_screen_bitblt(HWND hwnd, uint8_t* buf, int buf_size, int* w, int* h) {
    RECT wr;
    if (!GetWindowRect(hwnd, &wr)) return 0;
    *w = wr.right - wr.left;
    *h = wr.bottom - wr.top;
    if (*w <= 0 || *h <= 0) return 0;

    int src_x = wr.left > 0 ? wr.left : 0;
    int src_y = wr.top > 0 ? wr.top : 0;
    HDC sc = GetDC(nullptr);
    if (!sc) return 0;
    std::vector<uint8_t> pixels;
    bool ok = bitblt_bgra(sc, sc, src_x, src_y, *w, *h, pixels);
    ReleaseDC(nullptr, sc);
    if (!ok) return 0;
    if (capture_is_solid_color(pixels.data(), (int)pixels.size())) return 0;

    int needed = (int)pixels.size();
    if (needed > buf_size) return 0;
    memcpy(buf, pixels.data(), needed);
    return needed;
}
