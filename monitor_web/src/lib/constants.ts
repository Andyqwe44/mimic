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

export const MOUSE_MODES = [
  { v: 'background' as const, name: 'Background', eng: 'PostMessage', rec: '推荐',
    desc: '全后台，完全不抢鼠标。虚拟指示器 + PostMessage 转发点击，窗口可能乱飞但不影响使用，建议目标窗口最小化' },
  { v: 'semi' as const, name: 'Semi', eng: 'SendMsg-Cursor', rec: '进阶',
    desc: '半后台，点击时短暂抢鼠标。虚拟指示器常驻，鼠标移动不抢占，点击瞬间通过 SendInput 定位+点击' },
  { v: 'seize' as const, name: 'Seize', eng: 'SendInput', rec: '前台',
    desc: '前台模式，完全抢占鼠标。虚拟指示器 + 实时光标同步，SendInput 合成系统输入，与真实硬件走相同路径' },
]

export const KEYBOARD_MODES = [
  { v: 'postmsg' as const, name: 'PostMsg', eng: 'PostMessage', rec: '推荐',
    desc: '异步非阻塞，高效稳定。直接向目标窗口队列投递 WM_KEYDOWN/WM_KEYUP 消息' },
  { v: 'sendmsg' as const, name: 'SendMsg', eng: 'WinAPI', rec: '稳定',
    desc: 'AttachThreadInput + SendMessage 同步投递。正确更新目标线程输入状态，兼容性好' },
  { v: 'seize' as const, name: 'Seize', eng: 'SendInput', rec: '前台',
    desc: 'SendInput API 合成系统键盘输入。需要目标窗口在前台，受 UIPI 限制' },
]

export const MOUSE_METHOD: Record<string, string> = {
  seize: 'sendinput', semi: 'sendinput', background: 'postmessage',
}

export const KEY_METHOD: Record<string, string> = {
  seize: 'sendinput', postmsg: 'postmessage', sendmsg: 'winapi',
}

// ── Key code → display name (shared: SettingsView recording + MonitorView matching) ──
export function codeToName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)          // KeyA → A
  if (code.startsWith('Digit')) return code.slice(5)         // Digit1 → 1
  if (code === 'Space') return 'Space'
  if (code.startsWith('F') && /^F\d+$/.test(code)) return code
  const m: Record<string, string> = {
    'ControlLeft': 'Ctrl', 'ControlRight': 'Ctrl',
    'AltLeft': 'Alt', 'AltRight': 'Alt',
    'ShiftLeft': 'Shift', 'ShiftRight': 'Shift',
    'MetaLeft': 'Win', 'MetaRight': 'Win',
    'Escape': 'Esc', 'Backspace': 'Backspace', 'Delete': 'Del',
    'Insert': 'Ins', 'Home': 'Home', 'End': 'End',
    'PageUp': 'PgUp', 'PageDown': 'PgDn',
    'Tab': 'Tab', 'CapsLock': 'CapsLock', 'Enter': 'Enter',
    'ArrowUp': '↑', 'ArrowDown': '↓', 'ArrowLeft': '←', 'ArrowRight': '→',
    'PrintScreen': 'PrtSc', 'ScrollLock': 'ScrlLk', 'Pause': 'Pause',
    'NumLock': 'NumLk', 'ContextMenu': 'Menu',
    'Minus': '-', 'Equal': '=', 'BracketLeft': '[', 'BracketRight': ']',
    'Backslash': '\\', 'Semicolon': ';', 'Quote': "'",
    'Comma': ',', 'Period': '.', 'Slash': '/', 'Backquote': '`',
  }
  return m[code] || code
}
