/**
 * test_target.cpp — Standalone input-test window for GAM.
 *
 * Layout:
 *   - 5×5 color grid. Click registers ONLY inside each cell's inner target
 *     zone (shrunk by HIT_MARGIN); clicks in the border gutter = MISS.
 *   - A real multiline EDIT box below the grid: type text, it is saved,
 *     caret / selection / clipboard / system IME (Chinese) all work natively.
 *   - Every mouse/keyboard event is printed to a console with a timestamp.
 *
 * Build (from VS Developer Command Prompt):
 *   cl.exe /EHsc /O2 test_target.cpp user32.lib gdi32.lib /Fe:test_target.exe
 *
 * Usage:
 *   1. Run test_target.exe — a window titled "GAM Test Target" appears
 *   2. In GAM, select "GAM Test Target" as capture target
 *   3. Preview → enable mapping → interact
 *   4. Console shows received events; window shows visual feedback
 *   5. Click the input box and type (English or Chinese via IME) to test text input
 */

#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <windowsx.h>
#include <cstdio>
#include <cstring>
#include <string>
#include <ctime>
#include <thread>
#include <mutex>
#pragma comment(lib, "ws2_32.lib")

// ── Grid config ──
static constexpr int GRID = 5;          // 5×5 cells
static constexpr int CELL = 60;         // px per cell
static constexpr int PAD = 10;          // padding around grid
static constexpr int HIT_MARGIN = 16;   // inner-target inset: only this zone counts as a hit
static constexpr int GRID_W = GRID * CELL;
static constexpr int GRID_H = GRID * CELL;

// ── Layout below the grid ──
static constexpr int LABEL_H = 22;      // "input box" caption line
static constexpr int EDIT_H = 92;       // text input box height
static constexpr int STATUS_H = 20;     // status bar
static constexpr int WIN_W = GRID_W + PAD * 2;
static constexpr int EDIT_Y = PAD + GRID_H + PAD + LABEL_H;
static constexpr int WIN_H = EDIT_Y + EDIT_H + PAD + STATUS_H + PAD;

static constexpr int ID_EDIT = 1001;

// ── State ──
static int   g_lastGridX = -1, g_lastGridY = -1;
static DWORD g_lastClickTime = 0;
static int   g_lastButton = 0;          // 0=left 1=middle 2=right
static int   g_clickCount = 0;          // total hits registered
static int   g_missCount = 0;           // clicks that landed outside a target zone
static POINT g_lastMove = { -1, -1 };
static UINT  g_lastVk = 0;

// ── Child controls ──
static HWND   g_hwnd = nullptr;         // main window (server thread → GetClientRect)
static HWND   g_edit = nullptr;
static HFONT  g_editFont = nullptr;
static HBRUSH g_editBrush = nullptr;

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

// ── TCP report server (127.0.0.1:9998, JSON-lines) ──
// GAM connects as client. On connect we greet with window geometry ("hello"),
// then push one "click" report per received mouse-button-down (hit or miss).
static constexpr int REPORT_PORT = 9998;
static SOCKET      g_srv = INVALID_SOCKET;
static SOCKET      g_cli = INVALID_SOCKET;
static std::thread g_srvThread;
static std::mutex  g_cliMtx;
static volatile bool g_srvRun = false;
static unsigned    g_seq = 0;           // monotonic report sequence (drop detection)

static void report_send_line(const std::string& line) {
    std::lock_guard<std::mutex> lk(g_cliMtx);
    if (g_cli == INVALID_SOCKET) return;
    std::string s = line; s.push_back('\n');
    if (send(g_cli, s.c_str(), (int)s.size(), 0) == SOCKET_ERROR) {
        closesocket(g_cli); g_cli = INVALID_SOCKET;
    }
}

static std::string hello_json() {
    RECT cr{}; if (g_hwnd) GetClientRect(g_hwnd, &cr);
    char buf[256];
    snprintf(buf, sizeof(buf),
        "{\"type\":\"hello\",\"client_w\":%ld,\"client_h\":%ld,"
        "\"grid\":%d,\"cell\":%d,\"pad\":%d,\"hit_margin\":%d}",
        cr.right - cr.left, cr.bottom - cr.top, GRID, CELL, PAD, HIT_MARGIN);
    return buf;
}

static void server_loop() {
    while (g_srvRun) {
        SOCKET c = accept(g_srv, nullptr, nullptr);
        if (c == INVALID_SOCKET) { if (!g_srvRun) break; Sleep(100); continue; }
        {
            std::lock_guard<std::mutex> lk(g_cliMtx);
            if (g_cli != INVALID_SOCKET) closesocket(g_cli);
            g_cli = c;
        }
        report_send_line(hello_json());   // greet new client with geometry
        log_event("TCP client connected");
    }
}

static void server_start() {
    WSADATA wsa; WSAStartup(MAKEWORD(2, 2), &wsa);
    g_srv = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (g_srv == INVALID_SOCKET) { log_event("TCP: socket() failed"); return; }
    int reuse = 1;
    setsockopt(g_srv, SOL_SOCKET, SO_REUSEADDR, (const char*)&reuse, sizeof(reuse));
    sockaddr_in a{};
    a.sin_family = AF_INET;
    a.sin_port = htons(REPORT_PORT);
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);   // loopback only
    if (bind(g_srv, (sockaddr*)&a, sizeof(a)) != 0) {
        log_event("TCP: bind(%d) failed", REPORT_PORT);
        closesocket(g_srv); g_srv = INVALID_SOCKET; return;
    }
    listen(g_srv, 1);
    g_srvRun = true;
    g_srvThread = std::thread(server_loop);
    log_event("TCP report server on 127.0.0.1:%d", REPORT_PORT);
}

static void server_stop() {
    g_srvRun = false;
    if (g_srv != INVALID_SOCKET) { closesocket(g_srv); g_srv = INVALID_SOCKET; }
    { std::lock_guard<std::mutex> lk(g_cliMtx);
      if (g_cli != INVALID_SOCKET) { closesocket(g_cli); g_cli = INVALID_SOCKET; } }
    if (g_srvThread.joinable()) g_srvThread.join();
    WSACleanup();
}

// ── Color helpers ──
// Inner target color: neutral, or a green flash right after a registered hit.
static COLORREF target_color(int x, int y, int button) {
    COLORREF base = RGB(70, 80, 96);
    if (x == g_lastGridX && y == g_lastGridY) {
        DWORD elapsed = GetTickCount() - g_lastClickTime;
        if (elapsed < 600) {
            BYTE r = (BYTE)(GetRValue(base) + (144 - GetRValue(base)) * (600 - elapsed) / 600);
            BYTE g_ = (BYTE)(GetGValue(base) + (238 - GetGValue(base)) * (600 - elapsed) / 600);
            BYTE b = (BYTE)(GetBValue(base) + (144 - GetBValue(base)) * (600 - elapsed) / 600);
            // right button = red-ish flash, others green-ish
            return button == 2 ? RGB(238, r, b) : RGB(r, g_, b);
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
        printf("Window: %dx%d, Grid: %dx%d cells (%dpx each), hit zone: %dpx inner\n",
               WIN_W, WIN_H, GRID, GRID, CELL, CELL - 2 * HIT_MARGIN);
        printf("Click inside a cell's inner target to register a hit.\n");
        printf("Click the text box and type (English or IME Chinese) to test input.\n");
        printf("Waiting for input...\n\n");
        SetConsoleTitleW(L"GAM Test Target — Console");

        HINSTANCE hInst = (HINSTANCE)GetWindowLongPtrW(hwnd, GWLP_HINSTANCE);

        // Real multiline edit box — native text save, caret, selection, clipboard, system IME.
        g_edit = CreateWindowExW(
            WS_EX_CLIENTEDGE, L"EDIT", L"",
            WS_CHILD | WS_VISIBLE | WS_VSCROLL |
            ES_MULTILINE | ES_AUTOVSCROLL | ES_WANTRETURN,
            PAD, EDIT_Y, GRID_W, EDIT_H,
            hwnd, (HMENU)(INT_PTR)ID_EDIT, hInst, nullptr);

        g_editFont = CreateFontW(20, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE,
                                 DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                                 CLEARTYPE_QUALITY, DEFAULT_PITCH,
                                 L"Microsoft YaHei");   // 中文字形，IME 友好
        if (g_edit && g_editFont)
            SendMessageW(g_edit, WM_SETFONT, (WPARAM)g_editFont, TRUE);

        g_editBrush = CreateSolidBrush(RGB(30, 34, 42));
        if (g_edit) SetFocus(g_edit);   // ready to type immediately

        g_hwnd = hwnd;
        server_start();                 // TCP report server for GAM self-test
        return 0;
    }
    case WM_DESTROY:
        server_stop();
        if (g_editFont)  DeleteObject(g_editFont);
        if (g_editBrush) DeleteObject(g_editBrush);
        FreeConsole();
        PostQuitMessage(0);
        return 0;

    // Dark theme for the edit box
    case WM_CTLCOLOREDIT: {
        HDC dc = (HDC)wp;
        SetTextColor(dc, RGB(222, 232, 246));
        SetBkColor(dc, RGB(30, 34, 42));
        return (LRESULT)g_editBrush;
    }

    // ── Mouse clicks ──
    case WM_LBUTTONDOWN: case WM_LBUTTONUP:
    case WM_RBUTTONDOWN: case WM_RBUTTONUP:
    case WM_MBUTTONDOWN: case WM_MBUTTONUP: {
        int btn = (msg == WM_LBUTTONDOWN || msg == WM_LBUTTONUP) ? 0 :
                  (msg == WM_RBUTTONDOWN || msg == WM_RBUTTONUP) ? 2 : 1;
        bool down = (msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN || msg == WM_MBUTTONDOWN);
        int mx = GET_X_LPARAM(lp), my = GET_Y_LPARAM(lp);

        // Position relative to grid origin
        int rx = mx - PAD, ry = my - PAD;
        int gx = (rx >= 0) ? rx / CELL : -1;
        int gy = (ry >= 0) ? ry / CELL : -1;
        bool inGrid = gx >= 0 && gx < GRID && gy >= 0 && gy < GRID;

        // Local position inside the cell, then the inner-target test
        int lx = inGrid ? rx - gx * CELL : -1;
        int ly = inGrid ? ry - gy * CELL : -1;
        bool inHit = inGrid &&
                     lx >= HIT_MARGIN && lx < CELL - HIT_MARGIN &&
                     ly >= HIT_MARGIN && ly < CELL - HIT_MARGIN;

        const char* labels[] = { "Left","Middle","Right" };

        if (down && inHit) {
            g_lastGridX = gx; g_lastGridY = gy;
            g_lastButton = btn;
            g_lastClickTime = GetTickCount();
            g_clickCount++;
            InvalidateRect(hwnd, nullptr, TRUE);
            log_event("%s DOWN  HIT  grid[%d,%d] local(%d,%d) client(%d,%d) hits=%d",
                      labels[btn], gx, gy, lx, ly, mx, my, g_clickCount);
        } else if (down) {
            g_missCount++;
            InvalidateRect(hwnd, nullptr, TRUE);
            if (inGrid)
                log_event("%s DOWN  MISS grid[%d,%d] local(%d,%d) — outside %dpx target, miss=%d",
                          labels[btn], gx, gy, lx, ly, CELL - 2 * HIT_MARGIN, g_missCount);
            else
                log_event("%s DOWN  MISS client(%d,%d) — outside grid, miss=%d",
                          labels[btn], mx, my, g_missCount);
        } else {
            log_event("%s UP    client(%d,%d)", labels[btn], mx, my);
        }

        // Push a TCP report to GAM for every button-down (hit or miss).
        if (down) {
            char rep[256];
            snprintf(rep, sizeof(rep),
                "{\"type\":\"click\",\"seq\":%u,\"btn\":%d,\"x\":%d,\"y\":%d,"
                "\"gx\":%d,\"gy\":%d,\"hit\":%s}",
                ++g_seq, btn, mx, my,
                inGrid ? gx : -1, inGrid ? gy : -1, inHit ? "true" : "false");
            report_send_line(rep);
        }
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

    // ── Keyboard (detection; text entry is handled natively by the edit box) ──
    case WM_KEYDOWN: case WM_SYSKEYDOWN: {
        wchar_t name[32];
        UINT vk = (UINT)wp;
        g_lastVk = vk;
        LONG sc = (lp >> 16) & 0xFF;
        if (!GetKeyNameTextW((LONG)(sc << 16), name, 32))
            swprintf(name, 32, L"VK_%u", vk);
        InvalidateRect(hwnd, nullptr, FALSE);
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

        SetBkMode(hdc, TRANSPARENT);

        // ── Grid ──
        for (int y = 0; y < GRID; y++) {
            for (int x = 0; x < GRID; x++) {
                int cx = PAD + x * CELL, cy = PAD + y * CELL;

                // Cell background: checkerboard gutter (the non-hit border area)
                RECT r = { cx + 1, cy + 1, cx + CELL - 1, cy + CELL - 1 };
                COLORREF gut = ((x + y) & 1) ? RGB(52, 58, 70) : RGB(46, 52, 62);
                HBRUSH br = CreateSolidBrush(gut);
                FillRect(hdc, &r, br);
                DeleteObject(br);

                // Cell border
                HPEN pen = CreatePen(PS_SOLID, 1, RGB(80, 88, 100));
                HGDIOBJ oldPen = SelectObject(hdc, pen);
                HGDIOBJ oldBr = SelectObject(hdc, GetStockObject(NULL_BRUSH));
                Rectangle(hdc, cx, cy, cx + CELL, cy + CELL);

                // Inner target zone — the only region that registers a hit
                RECT hz = { cx + HIT_MARGIN, cy + HIT_MARGIN,
                            cx + CELL - HIT_MARGIN, cy + CELL - HIT_MARGIN };
                HBRUSH tbr = CreateSolidBrush(target_color(x, y, g_lastButton));
                FillRect(hdc, &hz, tbr);
                DeleteObject(tbr);
                HPEN tpen = CreatePen(PS_SOLID, 1, RGB(120, 180, 130));
                SelectObject(hdc, tpen);
                Rectangle(hdc, hz.left, hz.top, hz.right, hz.bottom);
                DeleteObject(tpen);

                SelectObject(hdc, oldPen);
                SelectObject(hdc, oldBr);
                DeleteObject(pen);

                // Cell label
                wchar_t label[8];
                swprintf(label, 8, L"%d,%d", x, y);
                SetTextColor(hdc, RGB(150, 165, 190));
                DrawTextW(hdc, label, -1, &hz, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
            }
        }

        // ── Input-box caption ──
        RECT lblr = { PAD, PAD + GRID_H + PAD, WIN_W - PAD, EDIT_Y };
        SetTextColor(hdc, RGB(150, 165, 190));
        DrawTextW(hdc, L"输入框 (English / 中文输入法):", -1, &lblr,
                  DT_LEFT | DT_VCENTER | DT_SINGLELINE);

        // ── Status bar ──
        RECT sr = { PAD, EDIT_Y + EDIT_H + PAD, WIN_W - PAD, WIN_H - PAD };
        SetTextColor(hdc, RGB(150, 158, 170));
        wchar_t status[160];
        swprintf(status, 160,
                 L"Hits: %d  Miss: %d  |  Last: btn%d grid[%d,%d]  |  vk=%u  |  Move(%d,%d)",
                 g_clickCount, g_missCount, g_lastButton, g_lastGridX, g_lastGridY,
                 g_lastVk, g_lastMove.x, g_lastMove.y);
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

    // Register with CS_DBLCLKS so we receive WM_LBUTTONDBLCLK too
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

    // Note: no IsDialogMessage — GAM forwards keys via PostMessage to the main
    // window, and IsDialogMessage would consume them before WM_KEYDOWN detection.
    // The edit control still handles its own WM_CHAR / IME when it holds focus.
    MSG m;
    while (GetMessage(&m, nullptr, 0, 0)) {
        TranslateMessage(&m);
        DispatchMessage(&m);
    }
    return (int)m.wParam;
}
