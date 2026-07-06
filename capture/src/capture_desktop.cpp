/**
 * capture_desktop.cpp — FFI: DesktopBlt (full-screen GDI BitBlt).
 */
#include "capture_methods.h"
#include "capture_internal.h"
#include <cstring>
#include <vector>

int capture_desktop_bitblt(uint8_t* buf, int buf_size, int* w, int* h) {
    *w = GetSystemMetrics(SM_CXSCREEN);
    *h = GetSystemMetrics(SM_CYSCREEN);
    if (*w <= 0 || *h <= 0) return 0;

    HDC dc = GetDC(nullptr);
    if (!dc) return 0;
    std::vector<uint8_t> pixels;
    bool ok = bitblt_bgra_full(dc, dc, *w, *h, pixels);
    ReleaseDC(nullptr, dc);
    if (!ok) return 0;

    int needed = (int)pixels.size();
    if (needed > buf_size) return 0;
    memcpy(buf, pixels.data(), needed);
    return needed;
}
