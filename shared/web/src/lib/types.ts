// ═══ Shared types — used across all components ═══

/** Platform-agnostic capture/control target (peer protocol v2). */
export type TargetPlatform = 'windows' | 'android'
export type TargetKind = 'desktop' | 'window' | 'display' | 'app' | 'process'

export interface TargetCapabilities {
  capture?: boolean
  control?: boolean
  launch?: boolean
  virtualDisplay?: boolean
}

export interface TargetDescriptor {
  id: string
  platform: TargetPlatform
  kind: TargetKind
  title: string
  /** Windows HWND when platform=windows (legacy wire alias). */
  hwnd?: number
  packageName?: string
  activity?: string
  displayId?: number
  desktop?: number
  capabilities?: TargetCapabilities
}

// Window/desktop entry from C++ list_windows command
// Windows host still returns this shape; UI maps to TargetDescriptor when needed.
export interface WindowInfo {
  title: string
  category: string       // 'desktop' | 'window' | 'process'
  hwnd: number           // window handle, or 0 for desktop, or pid for process
  desktop?: number       // virtual desktop index (D1/D2/...), from registry
  /** Optional cross-platform fields (Android / peer v2). */
  id?: string
  platform?: TargetPlatform
  kind?: TargetKind
  packageName?: string
  activity?: string
  displayId?: number
  capabilities?: TargetCapabilities
}

// Log history file metadata (content loaded on demand)
export interface HistoryFile {
  name: string
  lines: string[]        // empty until user expands the tile
}

// Rectangle in screen coordinates
export interface Rect { x: number; y: number; w: number; h: number }

// Single log entry — timestamp (HH:MM:SS.ms) + message.
// When count > 1, this entry represents collapsed consecutive duplicates:
// firstTs = timestamp of first occurrence, ts = timestamp of last occurrence.
export type LogEntry = {
  ts: string
  msg: string
  count?: number    // >1 when collapsed — how many consecutive identical entries
  firstTs?: string  // timestamp of the first entry in the collapsed range
}
