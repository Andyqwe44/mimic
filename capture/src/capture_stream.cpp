/**
 * capture_stream.exe — persistent capture, frame-differenced stream
 *
 * Usage:   capture_stream.exe <hwnd>
 *
 * Window capture: WGC FramePool via capture_wgc library (GPU, 2ms)
 * Desktop capture: DXGI → GDI fallback
 *
 * Frame protocol (LE binary to stdout):
 *   [w:4][h:4][ch:4][size:4][BGRA pixels: size bytes]
 *   size=0 → unchanged frame.  First line: method name.
 *
 * Stdin: "q\n" → quit. Stderr: debug info.
 */
#ifndef WIN32_LEAN_AND_MEAN
  #define WIN32_LEAN_AND_MEAN
#endif
#define NOMINMAX
#define _SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS
#include <windows.h>
#include <dwmapi.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <wrl/client.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <winrt/Windows.Foundation.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <cstdio>
#include <cstdlib>
#include <vector>
#include <thread>
#include <atomic>
#include <io.h>
#include <fcntl.h>

#include "../include/capture_wgc.hpp"
#include "../../common/include/capture_helpers.hpp"

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "windowsapp.lib")

using Microsoft::WRL::ComPtr;
namespace wgc_rt = winrt::Windows::Graphics::Capture;
namespace wf = winrt::Windows::Foundation;
namespace ch = capture_helpers;
static std::atomic<bool> g_running{true};

// ── DXGI desktop capture (try all outputs, skip black/virtual) ──
static bool dxgi_cap(std::vector<uint8_t>& p, int& w, int& h) {
    ComPtr<ID3D11Device> dev; ComPtr<ID3D11DeviceContext> ctx;
    if (FAILED(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0,
        nullptr, 0, D3D11_SDK_VERSION, &dev, nullptr, &ctx))) return false;
    ComPtr<IDXGIDevice> d; dev.As(&d);
    ComPtr<IDXGIAdapter> a; d->GetAdapter(&a);

    for (UINT oi = 0; ; oi++) {
        ComPtr<IDXGIOutput> o;
        if (FAILED(a->EnumOutputs(oi, &o))) break;
        DXGI_OUTPUT_DESC odesc;
        o->GetDesc(&odesc);
        // Skip outputs that look virtual (tiny resolution or no monitor)
        if (odesc.AttachedToDesktop && odesc.DesktopCoordinates.right - odesc.DesktopCoordinates.left < 320)
            continue;
        ComPtr<IDXGIOutput1> o1;
        if (FAILED(o.As(&o1))) continue;
        IDXGIOutputDuplication* dup = nullptr;
        if (FAILED(o1->DuplicateOutput(dev.Get(), &dup))) continue;
        IDXGIResource* res = nullptr; DXGI_OUTDUPL_FRAME_INFO fi = {};
        HRESULT acq = dup->AcquireNextFrame(16, &fi, &res);
        if (FAILED(acq)) { dup->Release(); continue; }
        ComPtr<ID3D11Texture2D> src;
        res->QueryInterface(__uuidof(ID3D11Texture2D), (void**)src.GetAddressOf()); res->Release();
        D3D11_TEXTURE2D_DESC desc; src->GetDesc(&desc);
        D3D11_TEXTURE2D_DESC sd = {};
        sd.Width=desc.Width; sd.Height=desc.Height; sd.MipLevels=1; sd.ArraySize=1;
        sd.Format=desc.Format; sd.SampleDesc.Count=1;
        sd.Usage=D3D11_USAGE_STAGING; sd.CPUAccessFlags=D3D11_CPU_ACCESS_READ;
        ComPtr<ID3D11Texture2D> st;
        if (FAILED(dev->CreateTexture2D(&sd, nullptr, &st))) { dup->ReleaseFrame(); dup->Release(); continue; }
        ctx->CopyResource(st.Get(), src.Get()); src.Reset();
        dup->ReleaseFrame(); dup->Release();
        D3D11_MAPPED_SUBRESOURCE m={};
        if (FAILED(ctx->Map(st.Get(), 0, D3D11_MAP_READ, 0, &m))) continue;
        int fw=(int)desc.Width, fh=(int)desc.Height, pitch=(int)m.RowPitch;
        p.resize(fw*fh*4); uint8_t* dst=p.data(); uint8_t* s=(uint8_t*)m.pData;
        for (int y=0; y<fh; y++) memcpy(dst+y*fw*4, s+y*pitch, fw*4);
        ctx->Unmap(st.Get(),0);
        // Skip if solid black (virtual display) — use shared helper
        if (ch::is_solid_color(p.data(), p.size())) continue;
        w=fw; h=fh; return true;
    }
    return false;
}

// ── GDI desktop fallback ────────────────────────────────
static bool gdi_desk(std::vector<uint8_t>& p, int& w, int& h) {
    HDC dc=GetDC(nullptr); if(!dc) return false;
    w=GetSystemMetrics(SM_CXSCREEN); h=GetSystemMetrics(SM_CYSCREEN);
    HDC mem=CreateCompatibleDC(dc); HBITMAP bmp=CreateCompatibleBitmap(dc,w,h);
    SelectObject(mem,bmp); BitBlt(mem,0,0,w,h,dc,0,0,SRCCOPY);
    BITMAPINFOHEADER bi={}; bi.biSize=sizeof(bi); bi.biWidth=w; bi.biHeight=-h;
    bi.biPlanes=1; bi.biBitCount=32; bi.biCompression=BI_RGB;
    p.resize(w*h*4); GetDIBits(mem,bmp,0,h,p.data(),(BITMAPINFO*)&bi,DIB_RGB_COLORS);
    DeleteObject(bmp); DeleteDC(mem); ReleaseDC(nullptr,dc); return true;
}

static void stdin_thread() {
    char c; while(g_running&&fread(&c,1,1,stdin)>0&&c!='q'){}
    g_running=false;
}

// ── Frame output helpers ────────────────────────────────
static void emit_unchanged(int pw, int ph) {
    uint8_t buf[16];
    ch::w32_le(buf,     (uint32_t)pw);
    ch::w32_le(buf + 4, (uint32_t)ph);
    ch::w32_le(buf + 8, 4);
    ch::w32_le(buf + 12, 0);
    fwrite(buf, 1, 16, stdout);
}

static void emit_frame(const uint8_t* data, int w, int h) {
    uint8_t buf[16];
    uint32_t sz = (uint32_t)(w * h * 4);
    ch::w32_le(buf,     (uint32_t)w);
    ch::w32_le(buf + 4, (uint32_t)h);
    ch::w32_le(buf + 8, 4);
    ch::w32_le(buf + 12, sz);
    fwrite(buf, 1, 16, stdout);
    fwrite(data, 1, sz, stdout);
}

// ── main ────────────────────────────────────────────────
int main(int argc, char* argv[]) {
    winrt::init_apartment(winrt::apartment_type::multi_threaded);
    _setmode(_fileno(stdout),_O_BINARY); _setmode(_fileno(stdin),_O_BINARY);

    HWND hwnd=(HWND)0;
    if(argc>1) hwnd=(HWND)(ULONG_PTR)_strtoui64(argv[1],nullptr,10);
    bool desk=(hwnd==0||hwnd==GetDesktopWindow());
    fprintf(stderr,"[stream] hwnd=%p desktop=%d\n",hwnd,(int)desk);

    // Use shared WgcCapture library (not inline FramePool copy)
    wgc::WgcCapture wgc_cap;
    const char* method = desk ? "GDI" : "WGC";
    bool use_wgc = false;
    RECT wr={};

    if (!desk) {
        use_wgc = wgc_cap.init(hwnd);
        if (!use_wgc) {
            fprintf(stderr,"[stream] WGC failed, PrintWindow fallback\n");
            method = "PrintWindow";
            DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &wr, sizeof(wr));
            if (wr.right - wr.left <= 0) GetWindowRect(hwnd, &wr);
        }
    } else {
        // Desktop: test DXGI, fallback GDI
        std::vector<uint8_t> t; int tw=0,th=0;
        if(dxgi_cap(t,tw,th) && !ch::is_solid_color(t.data(), t.size()))
            method="DXGI";
    }

    // Handshake
    fprintf(stdout, "%s\n", method); fflush(stdout);
    fprintf(stderr,"[stream] method=%s\n",method);

    std::thread(stdin_thread).detach();

    std::vector<uint8_t> prev, cur;
    int pw=0, ph=0, frames=0, skipped=0;
    LARGE_INTEGER freq, t0, t1;
    QueryPerformanceFrequency(&freq);
    QueryPerformanceCounter(&t0);

    while(g_running) {
        int w=0,h=0; cur.clear(); bool ok=false;

        if (use_wgc) {
            wgc::WgcFrame wf;
            ok = wgc_cap.capture(wf);
            if (ok) {
                cur = std::move(wf.pixels);
                w = wf.width; h = wf.height;
            } else {
                // No new frame → emit unchanged
                if (pw > 0 && ph > 0) {
                    emit_unchanged(pw, ph);
                    fflush(stdout); skipped++;
                }
                Sleep(1); continue;
            }
        } else if (desk) {
            if (method && strcmp(method, "DXGI") == 0) {
                ok = dxgi_cap(cur, w, h);
            }
            if (!ok) ok = gdi_desk(cur, w, h);
        } else {
            // PrintWindow fallback for window capture
            int ww=wr.right-wr.left, wh=wr.bottom-wr.top;
            if(ww>0&&wh>0){
                HDC screen=GetDC(nullptr); if(screen){
                HDC mem=CreateCompatibleDC(screen);
                HBITMAP bmp=CreateCompatibleBitmap(screen,ww,wh);
                SelectObject(mem,bmp);
                RECT fill={0,0,ww,wh}; HBRUSH mBrush=CreateSolidBrush(RGB(255,0,255));
                FillRect(mem,&fill,mBrush); DeleteObject(mBrush);
                PrintWindow(hwnd,mem,PW_RENDERFULLCONTENT|PW_CLIENTONLY);
                BITMAPINFOHEADER bi={}; bi.biSize=sizeof(bi); bi.biWidth=ww; bi.biHeight=-wh;
                bi.biPlanes=1; bi.biBitCount=32; bi.biCompression=BI_RGB;
                cur.resize(ww*wh*4);
                GetDIBits(mem,bmp,0,wh,cur.data(),(BITMAPINFO*)&bi,DIB_RGB_COLORS);
                SelectObject(mem,(HBITMAP)GetStockObject(NULL_BRUSH)); DeleteObject(bmp);
                DeleteDC(mem); ReleaseDC(nullptr,screen);
                // Check magenta sentinel and solid color using shared helpers
                ok = !ch::is_solid_color(cur.data(), cur.size())
                  && !ch::has_magenta_sentinel(cur.data(), cur.size());
                }}
            }
            if(!ok){ // DXGI crop fallback
                std::vector<uint8_t> full; int fw=0,fh=0;
                if(dxgi_cap(full,fw,fh)){
                    int cx=wr.left>0?wr.left:0, cy=wr.top>0?wr.top:0;
                    int cw=ww<(fw-cx)?ww:(fw-cx), ch_=wh<(fh-cy)?wh:(fh-cy);
                    if(cw>0&&ch_>0){cur.resize(cw*ch_*4);
                        for(int y=0;y<ch_;y++){int si=((cy+y)*fw+cx)*4; memcpy(cur.data()+y*cw*4,full.data()+si,cw*4);}
                        w=cw; h=ch_; ok=true;}}
            } else { w=ww; h=wh; }
        }

        if(!ok||w<=0||h<=0){Sleep(1); continue;}

        // Scale BGRA using shared helper
        auto [scaled_px, dims] = ch::scale_bgra(cur.data(), w, h, 640);
        int sw = dims.first, sh = dims.second;

        // Frame differ using shared helper
        if(sw==pw && sh==ph && ch::frames_equal(prev.data(), scaled_px.data(), scaled_px.size())) {
            emit_unchanged(sw, sh);
            fflush(stdout); skipped++;
        } else {
            emit_frame(scaled_px.data(), sw, sh);
            fflush(stdout);
            prev.swap(scaled_px); pw=sw; ph=sh; frames++;
        }
        // Timing log every 60 frames
        if (frames > 0 && frames % 60 == 0) {
            QueryPerformanceCounter(&t1);
            double elapsed = (double)(t1.QuadPart - t0.QuadPart) / freq.QuadPart;
            fprintf(stderr, "[stream] %d frames in %.2fs = %.1f fps (method=%s)\n",
                frames, elapsed, frames/elapsed, method);
        }
        Sleep(1);
    }

    wgc_cap.shutdown();
    fprintf(stderr,"[stream] exit: %d frames, %d skipped\n",frames,skipped);
    return 0;
}
