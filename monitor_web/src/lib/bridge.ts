// ═══ WebView2 WebMessage bridge (replaces Tauri invoke) ═══
import type { LogEntry, HistoryFile } from './types'

type PendingCall = {
  resolve: (value: any) => void
  reject: (reason: any) => void
  timer: ReturnType<typeof setTimeout>
}

let _callId = 0
const _pending = new Map<number, PendingCall>()

// Replacement for invoke()
export function hostCall(cmd: string, args?: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++_callId
    const timer = setTimeout(() => {
      _pending.delete(id)
      reject(new Error(`hostCall timeout: ${cmd}`))
    }, 30000)
    _pending.set(id, {
      resolve: (raw: any) => {
        resolve(raw && typeof raw === 'object' && 'result' in raw ? raw.result : raw)
      },
      reject,
      timer,
    })
    try {
      ;(window as any).chrome.webview.postMessage(JSON.stringify({ cmd, id, args: args || {} }))
    } catch (e) {
      clearTimeout(timer)
      _pending.delete(id)
      reject(e)
    }
  })
}

// ── Smooth theme switch ──
export function applyTheme(isDark: boolean) {
  document.documentElement.classList.add('theme-switching')
  document.documentElement.classList.toggle('dark', isDark)
  setTimeout(() => document.documentElement.classList.remove('theme-switching'), 220)
}

// ── Time formatter ──
function timeStr() {
  const d = new Date()
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`
}

// ═══ LogManager — single source of truth for all log views ═══
class LogManager {
  private entries: LogEntry[] = []
  private listeners = new Set<() => void>()
  private initialSyncDone = false

  add(msg: string) {
    this.entries.push({ ts: timeStr(), msg: `[ui] ${msg}` })
    this.listeners.forEach((f) => f())
    hostCall('log_ui_event', { event: msg, detail: '' }).catch(() => {})
  }

  addRemote(ts: string, tag: string, msg: string) {
    const dup = this.entries.find((e) => e.ts === ts && e.msg === `[${tag}] ${msg}`)
    if (dup) return
    this.entries.push({ ts, msg: `[${tag}] ${msg}` })
    if (this.entries.length > 500) this.entries = this.entries.slice(-500)
    this.listeners.forEach((f) => f())
  }

  getAll(): LogEntry[] {
    return this.entries
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  async initSync() {
    if (this.initialSyncDone) return
    this.initialSyncDone = true
    try {
      const res = await hostCall('read_live_log')
      const raw = typeof res === 'string' ? res : res?.lines || ''
      if (!raw) return
      const lines = raw.split('\n').filter((l: string) => l.trim())
      for (const line of lines) {
        const m = line.match(/^\[(\d{2}:\d{2}:\d{2}\.\d{3})\]\s\[(\w+)\]\s(.+)$/)
        if (m) {
          this.entries.push({ ts: m[1], msg: `[${m[2]}] ${m[3]}` })
        }
      }
      this.entries.sort((a, b) => a.ts.localeCompare(b.ts))
      if (this.entries.length > 500) this.entries = this.entries.slice(-500)
      this.listeners.forEach((f) => f())
    } catch (_) {}
  }

  clear() {
    this.entries = []
    this.listeners.forEach((f) => f())
    this.initialSyncDone = false
    hostCall('clear_log').catch(() => {})
    setTimeout(() => this.initSync(), 100)
  }

  async loadHistory(maxFiles: number): Promise<HistoryFile[]> {
    try {
      const data = await hostCall('read_logs', { max_files: maxFiles })
      const payload = data?.result || data
      const files = payload?.files || []
      return files.map((f: any) => ({ name: f.name, lines: [] as string[] }))
    } catch (e) {
      return []
    }
  }
}

export const logMgr = new LogManager()
export function addLog(msg: string) {
  logMgr.add(msg)
}

// Listen for responses from C++ host
if (typeof (window as any).chrome?.webview !== 'undefined') {
  ;(window as any).chrome.webview.addEventListener('message', (e: any) => {
    try {
      const msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
      if (msg.type === 'log') {
        logMgr.addRemote(msg.ts, msg.tag, msg.msg)
        return
      }
      const pending = _pending.get(msg.id)
      if (pending) {
        clearTimeout(pending.timer)
        _pending.delete(msg.id)
        pending.resolve(msg.result)
      }
    } catch {}
  })
}
