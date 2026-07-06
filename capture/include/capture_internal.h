/**
 * capture_internal.h — Shared GDI helpers used by all capture method files.
 * Not part of the public FFI; only included by capture_*.cpp.
 */
#pragma once
#include <windows.h>
#include <cstdint>
#include <vector>

#ifndef PW_RENDERFULLCONTENT
#define PW_RENDERFULLCONTENT 0x00000002
#endif
#ifndef PW_CLIENTONLY
#define PW_CLIENTONLY 0x00000001
#endif

extern "C" {
    int WINAPI PrintWindow(HWND hwnd, HDC hdc, UINT flags);
}

// ── GDI BitBlt + GetDIBits → BGRA pixels ──────────────
inline bool bitblt_bgra(HDC dc, HDC src_dc, int src_x, int src_y,
                         int w, int h, std::vector<uint8_t>& out) {
    HDC mem_dc = CreateCompatibleDC(dc);
    if (!mem_dc) return false;
    HBITMAP bitmap = CreateCompatibleBitmap(dc, w, h);
    if (!bitmap) { DeleteDC(mem_dc); return false; }
    HGDIOBJ old_bmp = SelectObject(mem_dc, bitmap);

    if (!BitBlt(mem_dc, 0, 0, w, h, src_dc, src_x, src_y, SRCCOPY)) {
        SelectObject(mem_dc, old_bmp); DeleteObject(bitmap); DeleteDC(mem_dc);
        return false;
    }

    BITMAPINFOHEADER bi = {};
    bi.biSize = sizeof(BITMAPINFOHEADER);
    bi.biWidth = w; bi.biHeight = -h; bi.biPlanes = 1;
    bi.biBitCount = 32; bi.biCompression = BI_RGB;

    out.resize(w * h * 4);
    int copied = GetDIBits(mem_dc, bitmap, 0, h, out.data(),
                           (BITMAPINFO*)&bi, DIB_RGB_COLORS);
    SelectObject(mem_dc, old_bmp); DeleteObject(bitmap); DeleteDC(mem_dc);
    return copied != 0;
}

inline bool bitblt_bgra_full(HDC dc, HDC src_dc, int w, int h,
                              std::vector<uint8_t>& out) {
    return bitblt_bgra(dc, src_dc, 0, 0, w, h, out);
}

// ── Content validation ─────────────────────────────────
inline int pixel_step(int len) {
    int step = ((len / 4) / 400) * 4;
    return step > 0 ? step : 4;
}

inline bool is_window_valid(HWND hwnd) {
    return IsWindow(hwnd) != 0;
}
