/**
 * capture_stream.exe — persistent capture, frame-differenced stream
 *
 * Usage:   capture_stream.exe <hwnd>
 *
 * Frame protocol (LE binary to stdout):
 *   [w:4][h:4][ch:4][size:4][BGRA pixels: size bytes]
 *   size=0 → unchanged frame (use previous), size>0 → new frame
 *
 * Stdin: "q\n" → quit. Stderr: debug info.
 */
#ifndef WIN32_LEAN_AND_MEAN
  #define WIN32_LEAN_AND_MEAN
#endif
#define NOMINMAX
#include <windows.h>
#include <dwmapi.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <wrl/client.h>
#include <cstdio>
#include <cstdlib>
#include <vector>
#include <thread>
#include <atomic>
#include <io.h>
#include <fcntl.h>

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")

using Microsoft::WRL::ComPtr;
static std::atomic<bool> g_running{true};
static void w32(uint32_t v) { fwrite(&v, 4, 1, stdout); }

// ── DXGI ────────────────────────────────────────────────
static bool dxgi_cap(std::vector<uint8_t>& p, int& w, int& h) {
    ComPtr<ID3D11Device> dev; ComPtr<ID3D11DeviceContext> ctx;
    if (FAILED(D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, 0,
        nullptr, 0, D3D11_SDK_VERSION, &dev, nullptr, &ctx))) return false;
    ComPtr<IDXGIDevice> d; dev.As(&d);
    ComPtr<IDXGIAdapter> a; d->GetAdapter(&a);
    ComPtr<IDXGIOutput> o; a->EnumOutputs(0, &o);
    ComPtr<IDXGIOutput1> o1; o.As(&o1);
    IDXGIOutputDuplication* dup = nullptr;
    if (FAILED(o1->DuplicateOutput(dev.Get(), &dup))) return false;
    IDXGIResource* res = nullptr; DXGI_OUTDUPL_FRAME_INFO fi = {};
    if (FAILED(dup->AcquireNextFrame(16, &fi, &res))) { dup->Release(); return false; }
    ComPtr<ID3D11Texture2D> src;
    res->QueryInterface(__uuidof(ID3D11Texture2D), (void**)src.GetAddressOf()); res->Release();
    D3D11_TEXTURE2D_DESC desc; src->GetDesc(&desc);
    D3D11_TEXTURE2D_DESC sd = {};
    sd.Width=desc.Width; sd.Height=desc.Height; sd.MipLevels=1; sd.ArraySize=1;
    sd.Format=desc.Format; sd.SampleDesc.Count=1;
    sd.Usage=D3D11_USAGE_STAGING; sd.CPUAccessFlags=D3D11_CPU_ACCESS_READ;
    ComPtr<ID3D11Texture2D> st;
    if (FAILED(dev->CreateTexture2D(&sd, nullptr, &st))) { dup->ReleaseFrame(); dup->Release(); return false; }
    ctx->CopyResource(st.Get(), src.Get()); src.Reset();
    dup->ReleaseFrame(); dup->Release();
    D3D11_MAPPED_SUBRESOURCE m={};
    if (FAILED(ctx->Map(st.Get(), 0, D3D11_MAP_READ, 0, &m))) return false;
    int fw=(int)desc.Width, fh=(int)desc.Height, pitch=(int)m.RowPitch;
    p.resize(fw*fh*4); uint8_t* dst=p.data(); uint8_t* s=(uint8_t*)m.pData;
    for (int y=0; y<fh; y++) memcpy(dst+y*fw*4, s+y*pitch, fw*4);
    ctx->Unmap(st.Get(),0); w=fw; h=fh; return true;
}

// ── PrintWindow ─────────────────────────────────────────
static bool print_cap(HWND hwnd, std::vector<uint8_t>& p, int w, int h) {
    HDC screen=GetDC(nullptr); if(!screen) return false;
    HDC mem=CreateCompatibleDC(screen);
    HBITMAP bmp=CreateCompatibleBitmap(screen,w,h);
    SelectObject(mem,bmp);
    RECT fill={0,0,w,h}; HBRUSH mBrush=CreateSolidBrush(RGB(255,0,255));
    FillRect(mem,&fill,mBrush); DeleteObject(mBrush);
    PrintWindow(hwnd,mem,PW_RENDERFULLCONTENT|PW_CLIENTONLY);
    BITMAPINFOHEADER bi={}; bi.biSize=sizeof(bi); bi.biWidth=w; bi.biHeight=-h;
    bi.biPlanes=1; bi.biBitCount=32; bi.biCompression=BI_RGB;
    p.resize(w*h*4);
    GetDIBits(mem,bmp,0,h,p.data(),(BITMAPINFO*)&bi,DIB_RGB_COLORS);
    SelectObject(mem,(HBITMAP)GetStockObject(NULL_BRUSH)); DeleteObject(bmp);
    DeleteDC(mem); ReleaseDC(nullptr,screen);
    if(p.size()<16) return false;
    uint8_t r0=p[2],g0=p[1],b0=p[0]; int same=0,n=0,step=(int)p.size()/400; if(step<4)step=4;
    for(size_t i=0;i<p.size();i+=(size_t)step*4){n++;if(p[i+2]==r0&&p[i+1]==g0&&p[i]==b0)same++;}
    return !(n>0&&same==n);
}

// ── GDI desktop ─────────────────────────────────────────
static bool gdi_desk(std::vector<uint8_t>& p, int& w, int& h) {
    HDC dc=GetDC(nullptr); if(!dc) return false;
    w=GetSystemMetrics(SM_CXSCREEN); h=GetSystemMetrics(SM_CYSCREEN);
    HDC mem=CreateCompatibleDC(dc); HBITMAP bmp=CreateCompatibleBitmap(dc,w,h);
    SelectObject(mem,bmp); BitBlt(mem,0,0,w,h,dc,0,0,SRCCOPY);
    BITMAPINFOHEADER bi={}; bi.biSize=sizeof(bi); bi.biWidth=w; bi.biHeight=-h;
    bi.biPlanes=1; bi.biBitCount=32; bi.biCompression=BI_RGB;
    p.resize(w*h*4);
    GetDIBits(mem,bmp,0,h,p.data(),(BITMAPINFO*)&bi,DIB_RGB_COLORS);
    DeleteObject(bmp); DeleteDC(mem); ReleaseDC(nullptr,dc); return true;
}

// ── Scale BGRA to max 640px wide ────────────────────────
static void scale_frame(const uint8_t* src, int sw, int sh, std::vector<uint8_t>& dst, int& dw, int& dh) {
    float s = (640.0f / sw);
    if (s >= 1.0f) { dw = sw; dh = sh; dst.assign(src, src + sw * sh * 4); return; }
    dw = (int)(sw * s); dh = (int)(sh * s);
    dst.resize(dw * dh * 4);
    for (int y = 0; y < dh; y++) {
        int sy = (int)(y / s);
        for (int x = 0; x < dw; x++) {
            int sx = (int)(x / s);
            int di = (y * dw + x) * 4;
            int si = (sy * sw + sx) * 4;
            memcpy(dst.data() + di, src + si, 4);
        }
    }
}

// ── Frame differ ────────────────────────────────────────
static bool frames_equal(const std::vector<uint8_t>& a, const std::vector<uint8_t>& b) {
    if (a.size() != b.size()) return false;
    return memcmp(a.data(), b.data(), a.size()) == 0;
}

static void stdin_thread() {
    char c; while(g_running&&fread(&c,1,1,stdin)>0&&c!='q'){}
    g_running=false;
}

// ── main ────────────────────────────────────────────────
int main(int argc, char* argv[]) {
    _setmode(_fileno(stdout),_O_BINARY); _setmode(_fileno(stdin),_O_BINARY);

    HWND hwnd=(HWND)0;
    if(argc>1) hwnd=(HWND)(ULONG_PTR)_strtoui64(argv[1],nullptr,10);
    bool desk=(hwnd==0||hwnd==GetDesktopWindow());
    fprintf(stderr,"[stream] hwnd=%p desktop=%d\n",hwnd,(int)desk);

    RECT wr={};
    if(!desk){DwmGetWindowAttribute(hwnd,DWMWA_EXTENDED_FRAME_BOUNDS,&wr,sizeof(wr));
        if(wr.right-wr.left<=0) GetWindowRect(hwnd,&wr);}

    std::thread(stdin_thread).detach();

    // ── Handshake: output capture method on first line ──
    const char* method = desk ? "GDI" : "PrintWindow";  // updated below if DXGI works

    // Fast pre-check: can DXGI work? (non-solid test)
    if (desk) {
        std::vector<uint8_t> test; int tw=0, th=0;
        if (dxgi_cap(test, tw, th) && test.size()>=16) {
            int step=(int)test.size()/400; if(step<4)step=4;
            uint8_t r0=test[2],g0=test[1],b0=test[0]; int same=0,n=0;
            for(size_t i=0;i<test.size();i+=(size_t)step*4){n++;if(test[i+2]==r0&&test[i+1]==g0&&test[i]==b0)same++;}
            if(!(n>0&&same==n)) method = "DXGI";
        }
    }
    fprintf(stdout, "%s\n", method);
    fflush(stdout);
    fprintf(stderr, "[stream] method=%s\n", method);

    std::vector<uint8_t> prev, cur;
    int pw=0, ph=0, frames=0, skipped=0;

    while(g_running) {
        int w=0,h=0; cur.clear(); bool ok=false;

        if(desk) {
            ok=dxgi_cap(cur,w,h);
            if(ok) { // check solid (WebView2 GPU conflict)
                int step=(int)cur.size()/400; if(step<4)step=4;
                uint8_t r0=cur[2],g0=cur[1],b0=cur[0]; int same=0,n=0;
                for(size_t i=0;i<cur.size();i+=(size_t)step*4){n++;if(cur[i+2]==r0&&cur[i+1]==g0&&cur[i]==b0)same++;}
                if(n>0&&same==n) ok=gdi_desk(cur,w,h); // DXGI solid → GDI
            } else ok=gdi_desk(cur,w,h);
        } else {
            int ww=wr.right-wr.left, wh=wr.bottom-wr.top;
            if(ww>0&&wh>0){ok=print_cap(hwnd,cur,ww,wh); w=ww; h=wh;}
            if(!ok){ // DXGI crop fallback
                std::vector<uint8_t> full; int fw=0,fh=0;
                if(dxgi_cap(full,fw,fh)){
                    int cx=wr.left>0?wr.left:0, cy=wr.top>0?wr.top:0;
                    int cw=ww<(fw-cx)?ww:(fw-cx), ch=wh<(fh-cy)?wh:(fh-cy);
                    if(cw>0&&ch>0){cur.resize(cw*ch*4);
                        for(int y=0;y<ch;y++){int si=((cy+y)*fw+cx)*4; memcpy(cur.data()+y*cw*4,full.data()+si,cw*4);}
                        w=cw; h=ch; ok=true;}}}
        }

        if(!ok||w<=0||h<=0){Sleep(1); continue;}

        // Scale to max 640px wide (9x less data for 1080p, ~3x less for 720p)
        std::vector<uint8_t> scaled;
        int sw=0, sh=0;
        scale_frame(cur.data(), w, h, scaled, sw, sh);

        // Frame differencing: skip unchanged frames
        if(sw==pw && sh==ph && frames_equal(prev, scaled)) {
            w32((uint32_t)sw); w32((uint32_t)sh); w32(4); w32(0);
            fflush(stdout);
            skipped++;
        } else {
            uint32_t sz=(uint32_t)(sw*sh*4);
            w32((uint32_t)sw); w32((uint32_t)sh); w32(4); w32(sz);
            fwrite(scaled.data(),1,sz,stdout); fflush(stdout);
            prev.swap(scaled); pw=sw; ph=sh;
            frames++;
        }

        // Limit to ~60fps max to avoid CPU spin
        Sleep(1);
    }

    fprintf(stderr,"[stream] exit: %d frames sent, %d skipped\n",frames,skipped);
    return 0;
}
