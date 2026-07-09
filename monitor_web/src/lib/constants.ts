// ═══ Shared constants ═══

// Collapsible card header (used in 6 places)
export const COLLAPSIBLE_HEADER =
  'w-full flex items-center justify-between px-3 py-2 hover:bg-bg-hover cursor-pointer transition-colors outline-none'

// Selectable option button (capture method + transport)
export const SELECTABLE_BTN =
  'flex items-center w-full px-3 py-2 rounded-lg border transition'

// Methods that cannot capture minimized windows
export const METHOD_SHORT: Record<string, string> = {
  wgc: 'WGC', gdi: 'GDI', dxgi: 'DXGI', printwindow: 'PW',
  screenbitblt: 'SBlt', GDI: 'GDI', 'GDI(GetWindowDC)': 'GDI',
  PrintWindow: 'PW', 'PrintWindow(minimized)': 'PW',
  ScreenBitBlt: 'SBlt', DesktopBlt: 'DXGI', WGC: 'WGC',
}

export const METHODS_NO_MINIMIZED = ['wgc', 'gdi', 'printwindow', 'screenbitblt']

export const cantCaptureMinimized = (method: string, ws: string) =>
  ws === 'minimized' && METHODS_NO_MINIMIZED.includes(method)

export const STATE_LABEL: Record<string, string> = {
  desktop: '桌面', foreground: '前台', background: '后台',
  minimized: '最小化', hidden: '隐藏', closed: '已关闭', unknown: '未知',
}

export const STATE_COLOR: Record<string, string> = {
  desktop: 'text-text-muted', foreground: 'text-success',
  background: 'text-accent', minimized: 'text-error',
  hidden: 'text-error', closed: 'text-error', unknown: 'text-text-muted',
}

export const CAPTURE_METHODS = [
  { v: 'wgc',  name: 'WGC', eng: 'GPU FramePool', rec: '前台/后台/桌面', desc: 'GPU 加速，支持后台/遮挡窗口，前台后台及桌面首选' },
  { v: 'dxgi', name: 'DXGI', eng: 'DesktopBlt',   rec: '桌面/最小化', desc: '全桌面 GDI 位图，最小化窗口时唯一可行方案' },
]

export const RENDER_METHODS = [
  { v: 'shared', name: 'SharedBuffer', eng: 'Zero-copy COM', rec: '当前', desc: 'C++ COM SharedBuffer → JS ArrayBuffer → Canvas putImageData，零拷贝无编解码' },
  { v: 'h264',   name: 'H.264',        eng: 'GPU MFT + MSE', rec: '未实现', desc: 'GPU MFT 硬件编码 → fMP4 分片 → MSE → <video> 标签，低延迟高压缩' },
  { v: 'h265',   name: 'H.265',        eng: 'GPU MFT + MSE', rec: '未实现', desc: 'HEVC 硬件编码，压缩率更高但兼容性有限，需 Windows 11 + HEVC 扩展' },
]

export const CAPTURE_MODES = [
  { v: 'foreground', label: '前台 (Foreground)', desc: '窗口可见且在最前 → 推荐 WGC GPU 加速', method: 'wgc' },
  { v: 'background', label: '后台 (Background)', desc: '窗口被遮挡但未最小化 → 推荐 WGC (唯一支持后台)', method: 'wgc' },
  { v: 'minimized',  label: '最小化 (Minimized)',  desc: '窗口已最小化 → 只能用 DesktopGDI 截桌面', method: 'dxgi' },
]

export const INPUT_METHODS = [
  { v: 'sendinput',  name: 'SendInput',  eng: 'Win32 API', rec: '推荐', desc: '应用层合成输入，SendInput API。兼容性最好，大多数窗口都能接受。' },
  { v: 'postmessage', name: 'PostMessage', eng: 'Window Msg', rec: '备选', desc: '窗口消息层，直接向目标窗口队列投递 WM_LBUTTONDOWN/UP。可能绕过某些输入保护。' },
  { v: 'driver',      name: 'Driver',     eng: 'Kernel',    rec: '未实现', desc: '驱动层输入，内核级拦截/注入。需要安装驱动，兼容性取决于驱动实现。' },
]
