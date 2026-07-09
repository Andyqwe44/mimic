// ═══ Shared types ═══
export interface WindowInfo {
  title: string
  category: string
  hwnd: number
  desktop?: number
}

export interface HistoryFile {
  name: string
  lines: string[]
}

export type LogEntry = { ts: string; msg: string }
