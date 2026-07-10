/**
 * test_target.cpp — Standalone input-test window for GAM.
 *
 * Opens a 400×400 window with a 5×5 color grid plus keyboard display.
 * Prints every received mouse/keyboard event to stdout with timestamp.
 *
 * Build (from VS Developer Command Prompt):
 *   cl.exe /EHsc /O2 test_target.cpp user32.lib gdi32.lib /Fe:test_target.exe
 *
 * Usage:
 *   1. Run test_target.exe — a window titled "GAM Test Target" appears
 *   2. In GAM, select "GAM Test Target" as capture target
 *   3. Preview → enable mapping → interact
 *   4. Console shows received events; window shows visual feedback
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <windowsx.h>
#include <cstdio>
#include <cstring>
#include <string>
#include <ctime>

// ── Grid config ──
static constexpr int GRID = 5;          // 5×5 cells
static constexpr int CELL = 60;         // px per cell
static constexpr int PAD = 10;          // padding around grid
static constexpr int GRID_W = GRID * CELL;
static constexpr int GRID_H = GRID * CELL;
static constexpr int KEY_H = 80;        // keyboard display area
static constexpr int WIN_W = GRID_W + PAD * 2;
static constexpr int WIN_H = GRID_H + PAD * 2 + KEY_H;

// ── State ──
static int g_lastGridX = -1, g_lastGridY = -1;
static DWORD g_lastClickTime = 0;
static int g_lastButton = 0;            // 0=left 1=middle 2=right
static int g_clickCount = 0;            // total clicks received
static wchar_t g_lastKey[32] = L"";
static DWORD g_lastKeyTime = 0;
static POINT g_lastMove = { -1, -1 };

// ── Console helpers ──
static void ts_now(char* buf, size_t sz) {
    SYSTEMTIME st; GetLocalTime(&st);
    snprintf(buf, sz, "%02d:%02d:%02d.%03d",
             st.wHour, st.wMinute, st.wSecond, st.wMilliseconds);
}

static void log_event(const char* fmt, ...) {
    char ts[32]; ts_now(ts, sizeof(ts));
    printf("[%s] ", ts);
    va_list ap; va_start(ap, fmt);
    vprintf(fmt, ap);
    va_end(ap);
    printf("\n");
    fflush(stdout);
}

// ── Color helpers ──
static COLORREF grid_color(int x, int y, int button) {
    // Base: checkerboard of soft colors
    COLORREF base = ((x + y) & 1) ? RGB(230, 240, 255) : RGB(210, 225, 250);
    // Highlight last click position
    if (x == g_lastGridX && y == g_lastGridY) {
        DWORD elapsed = GetTickCount() - g_lastClickTime;
        if (elapsed < 600) {
            // Flash: fade from bright green back to base
            BYTE r = (BYTE)(GetRValue(base) + (144 - GetRValue(base)) * (600 - elapsed) / 600);
            BYTE g_ = (BYTE)(GetGValue(base) + (238 - GetGValue(base)) * (600 - elapsed) / 600);
            BYTE b = (BYTE)(GetBValue(base) + (144 - GetBValue(base)) * (600 - elapsed) / 600);
            return button == 1 ? RGB(r, g_, b) : button == 2 ? RGB(255, r, b) : RGB(r, g_, b);
        }
    }
    return base;
}

// ── Window proc ──
LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
    case WM_CREATE: {
        AllocConsole();
        FILE* f; freopen_s(&f, "CONOUT$", "w", stdout);
        freopen_s(&f, "CONOUT$", "w", stderr);
        printf("=== GAM Test Target ===\n");
        printf("Window: %dx%d, Grid: %dx%d cells (%dpx each)\n",
               WIN_W, WIN_H, GRID, GRID, CELL);
        printf("Waiting for input...\n\n");
        SetConsoleTitleW(L"GAM Test Target — Console");
        return 0;
    }
    case WM_DESTROY:
        FreeConsole();
        PostQuitMessage(0);
        return 0;

    // ── Mouse clicks ──
    case WM_LBUTTONDOWN: case WM_LBUTTONUP:
    case WM_RBUTTONDOWN: case WM_RBUTTONUP:
    case WM_MBUTTONDOWN: case WM_MBUTTONUP: {
        int btn = (msg == WM_LBUTTONDOWN || msg == WM_LBUTTONUP) ? 0 :
                  (msg == WM_RBUTTONDOWN || msg == WM_RBUTTONUP) ? 2 : 1;
        bool down = (msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN || msg == WM_MBUTTONDOWN);
        int mx = GET_X_LPARAM(lp), my = GET_Y_LPARAM(lp);
        int gx = (mx - PAD) / CELL, gy = (my - PAD) / CELL;
        const char* btnName = btn == 0 ? "Left" : btn == 2 ? "Right" : "Middle";
        const char* labels[] = { "Left","Middle","Right" };

        if (down && gx >= 0 && gx < GRID && gy >= 0 && gy < GRID) {
            g_lastGridX = gx; g_lastGridY = gy;
            g_lastButton = btn;
            g_lastClickTime = GetTickCount();
            g_clickCount++;
            InvalidateRect(hwnd, nullptr, TRUE);
        }

        log_event("%s %s at (%d,%d) grid[%d,%d] client(%d,%d) total=%d",
                  labels[btn], down ? "DOWN" : "UP",
                  mx, my, gx, gy, mx - PAD - gx*CELL, my - PAD - gy*CELL,
                  g_clickCount);
        return 0;
    }

    // ── Mouse move ──
    case WM_MOUSEMOVE: {
        g_lastMove.x = GET_X_LPARAM(lp);
        g_lastMove.y = GET_Y_LPARAM(lp);
        return 0;
    }

    // ── Mouse wheel ──
    case WM_MOUSEWHEEL: {
        short delta = GET_WHEEL_DELTA_WPARAM(wp);
        int mx = GET_X_LPARAM(lp), my = GET_Y_LPARAM(lp);
        log_event("WHEEL delta=%d at client(%d,%d)", delta, mx, my);
        return 0;
    }

    // ── Keyboard ──
    case WM_KEYDOWN: case WM_SYSKEYDOWN: {
        wchar_t name[32];
        UINT vk = (UINT)wp;
        // Get key name
        LONG sc = (lp >> 16) & 0xFF;
        if (!GetKeyNameTextW(sc << 16, name, 32))
            swprintf(name, 32, L"VK_%u", vk);
        wcscpy(g_lastKey, name);
        g_lastKeyTime = GetTickCount();
        InvalidateRect(hwnd, nullptr, TRUE);
        log_event("KEYDOWN  vk=%u sc=%lu name=%ls", vk, (unsigned long)sc, name);
        return 0;
    }
    case WM_KEYUP: case WM_SYSKEYUP: {
        UINT vk = (UINT)wp;
        log_event("KEYUP    vk=%u", vk);
        return 0;
    }

    // ── Double-click ──
    case WM_LBUTTONDBLCLK:
        log_event("DBLCLICK Left");
        return 0;

    // ── Paint ──
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);
        RECT cr; GetClientRect(hwnd, &cr);

        // Background
        HBRUSH bg = CreateSolidBrush(RGB(40, 44, 52));
        FillRect(hdc, &cr, bg);
        DeleteObject(bg);

        // ── Grid ──
        for (int y = 0; y < GRID; y++) {
            for (int x = 0; x < GRID; x++) {
                int cx = PAD + x * CELL, cy = PAD + y * CELL;
                RECT r = { cx + 1, cy + 1, cx + CELL - 1, cy + CELL - 1 };
                HBRUSH br = CreateSolidBrush(grid_color(x, y, g_lastButton));
                FillRect(hdc, &r, br);
                DeleteObject(br);
                // Grid lines
                HPEN pen = CreatePen(PS_SOLID, 1, RGB(80, 88, 100));
                SelectObject(hdc, pen);
                SelectObject(hdc, GetStockObject(NULL_BRUSH));
                Rectangle(hdc, cx, cy, cx + CELL, cy + CELL);
                DeleteObject(pen);
                // Cell label
                wchar_t label[8];
                swprintf(label, 8, L"%d,%d", x, y);
                SetBkMode(hdc, TRANSPARENT);
                SetTextColor(hdc, RGB(100, 110, 130));
                DrawTextW(hdc, label, -1, &r, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
            }
        }

        // ── Keyboard display ──
        int ky = GRID_H + PAD * 2;
        RECT kr = { PAD, ky, WIN_W - PAD, ky + KEY_H - PAD };
        HBRUSH kbg = CreateSolidBrush(RGB(30, 34, 42));
        FillRect(hdc, &kr, kbg);
        DeleteObject(kbg);

        HPEN kpen = CreatePen(PS_SOLID, 1, RGB(80, 88, 100));
        SelectObject(hdc, kpen);
        SelectObject(hdc, GetStockObject(NULL_BRUSH));
        Rectangle(hdc, kr.left, kr.top, kr.right, kr.bottom);
        DeleteObject(kpen);

        // Key display
        SetBkMode(hdc, TRANSPARENT);
        if (g_lastKey[0]) {
            DWORD elapsed = GetTickCount() - g_lastKeyTime;
            BYTE alpha = (BYTE)(elapsed < 1000 ? 255 : 255 - (elapsed - 1000) * 255 / 500);
            if (alpha < 30) g_lastKey[0] = 0;
            SetTextColor(hdc, RGB(59, 130, 246));
            RECT lr = kr; lr.top += 8; lr.bottom -= 8;
            HFONT hf = CreateFontW(28, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE,
                                    DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                                    DEFAULT_QUALITY, DEFAULT_PITCH, L"Consolas");
            SelectObject(hdc, hf);
            DrawTextW(hdc, g_lastKey, -1, &lr, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
            DeleteObject(hf);
        } else {
            SetTextColor(hdc, RGB(80, 88, 100));
            DrawTextW(hdc, L"Press any key...", -1, &kr, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
        }

        // ── Status bar ──
        RECT sr = { PAD, WIN_H - 22, WIN_W - PAD, WIN_H - 6 };
        SetTextColor(hdc, RGB(150, 158, 170));
        wchar_t status[128];
        swprintf(status, 128, L"Clicks: %d  |  Last: btn%d grid[%d,%d]  |  Move: (%d,%d)",
                 g_clickCount, g_lastButton, g_lastGridX, g_lastGridY,
                 g_lastMove.x, g_lastMove.y);
        DrawTextW(hdc, status, -1, &sr, DT_LEFT | DT_VCENTER | DT_SINGLELINE);

        EndPaint(hwnd, &ps);
        return 0;
    }

    default:
        return DefWindowProcW(hwnd, msg, wp, lp);
    }
}

// ── WinMain ──
int WINAPI WinMain(_In_ HINSTANCE hInst, _In_opt_ HINSTANCE, _In_ LPSTR, _In_ int nCmdShow) {
    WNDCLASSEXW wc = {};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInst;
    wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszClassName = L"GAMTestTarget";

    // Prevent double-click from being treated as separate messages
    // Register the class with CS_DBLCLKS so we receive WM_LBUTTONDBLCLK too
    wc.style = CS_DBLCLKS;

    RegisterClassExW(&wc);

    // Adjust window size to get desired client area
    RECT wr = { 0, 0, WIN_W, WIN_H };
    AdjustWindowRect(&wr, WS_OVERLAPPEDWINDOW, FALSE);

    HWND hwnd = CreateWindowExW(
        0, L"GAMTestTarget", L"GAM Test Target",
        WS_OVERLAPPEDWINDOW & ~WS_THICKFRAME & ~WS_MAXIMIZEBOX,
        CW_USEDEFAULT, CW_USEDEFAULT,
        wr.right - wr.left, wr.bottom - wr.top,
        nullptr, nullptr, hInst, nullptr);

    if (!hwnd) return 1;

    ShowWindow(hwnd, nCmdShow);
    UpdateWindow(hwnd);

    MSG m;
    while (GetMessage(&m, nullptr, 0, 0)) {
        TranslateMessage(&m);
        DispatchMessage(&m);
    }
    return (int)m.wParam;
}
