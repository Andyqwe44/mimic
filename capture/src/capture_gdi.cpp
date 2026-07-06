/**
 * capture_gdi.cpp — FFI: GetWindowDC capture method.
 */
#include "capture_methods.h"
#include "capture_internal.h"
#include <cstring>
#include <vector>

int capture_gdi_getwindowdc(HWND hwnd, uint8_t* buf, int buf_size, int* w, int* h) {
    RECT wr;
    if (!GetWindowRect(hwnd, &wr)) return 0;
    *w = wr.right - wr.left;
    *h = wr.bottom - wr.top;
    if (*w <= 0 || *h <= 0) return 0;

    HDC dc = GetWindowDC(hwnd);
    if (!dc) return 0;
    std::vector<uint8_t> pixels;
    bool ok = bitblt_bgra_full(dc, dc, *w, *h, pixels);
    ReleaseDC(hwnd, dc);
    if (!ok) return 0;
    if (capture_is_solid_color(pixels.data(), (int)pixels.size())) return 0;

    int needed = (int)pixels.size();
    if (needed > buf_size) return 0;
    memcpy(buf, pixels.data(), needed);
    return needed;
}
