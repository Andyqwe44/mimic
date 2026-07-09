// ═══ Monitor View — main workspace with large preview ═══
import { useState, useCallback } from 'react'
import { Camera, Play, Square, MousePointer2 } from 'lucide-react'
import { Tooltip } from './Toolkit'
import { METHOD_SHORT, STATE_LABEL, STATE_COLOR } from '../lib/constants'
import { addLog, hostCall } from '../lib/bridge'
import type { WindowInfo } from '../lib/types'

export function MonitorView({
  selWin,
  winState,
  capMethod,
  snapMethod,
  streamMethod,
  previewing,
  snapshotLatency,
  onTakeSnapshot,
  onTogglePreview,
  children,
  inputMethod,
}: {
  selWin: WindowInfo
  winState: string
  capMethod: string
  snapMethod: string
  streamMethod: string
  previewing: boolean
  snapshotLatency: number | null
  onTakeSnapshot: () => void
  onTogglePreview: () => void
  children: React.ReactNode
  inputMethod: string
}) {
  const isDesktop = selWin.hwnd === 0
  const stateLabel = STATE_LABEL[winState] || winState
  const stateColor = STATE_COLOR[winState] || 'text-text-muted'
  const [mouseOn, setMouseOn] = useState(false)
  const [lastClick, setLastClick] = useState<{ x: number; y: number } | null>(null)

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isDesktop || !previewing) return // only forward clicks when streaming
      const rect = e.currentTarget.getBoundingClientRect()
      const rx = (e.clientX - rect.left) / rect.width
      const ry = (e.clientY - rect.top) / rect.height
      setLastClick({ x: Math.round(rx * 100), y: Math.round(ry * 100) })
      // Forward input to target window via C++ backend
      hostCall('send_input', {
        hwnd: selWin.hwnd,
        type: 'click',
        x_norm: rx,
        y_norm: ry,
        button: 'left',
        method: inputMethod,
      })
        .then(() => {
          addLog(
            `[Mouse] click mapped → hwnd=0x${selWin.hwnd.toString(16)} (${Math.round(rx * 100)}%,${Math.round(ry * 100)}%) [${inputMethod}]`,
          )
        })
        .catch((err: any) => {
          addLog(`[Mouse] send_input failed: ${err?.message || err}`)
        })
    },
    [isDesktop, previewing, selWin.hwnd, inputMethod],
  )

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center h-11 px-4 bg-bg-secondary border-b border-border shrink-0 gap-4">
        {/* Target */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-text-primary truncate max-w-[240px]">
            {selWin.title}
          </span>
          <span className={`text-[11px] font-medium shrink-0 ${stateColor}`}>
            {stateLabel}
          </span>
        </div>
        <span className="text-border/40 select-none">│</span>
        {/* Methods */}
        <div className="flex items-center gap-2 text-[11px] shrink-0">
          <span className="inline-flex items-center gap-1 text-text-muted">
            <Camera className="w-3 h-3" /> Snapshot
          </span>
          <span className="font-medium text-accent bg-accent/10 px-1.5 py-0.5 rounded">
            {METHOD_SHORT[snapMethod] || snapMethod.toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] shrink-0">
          <span className="inline-flex items-center gap-1 text-text-muted">
            <Play className="w-3 h-3" /> Stream
          </span>
          <span className="font-medium text-accent bg-accent/10 px-1.5 py-0.5 rounded">
            {METHOD_SHORT[streamMethod] || streamMethod.toUpperCase()}
          </span>
        </div>
        {capMethod && (
          <span className="text-[11px] text-text-muted shrink-0">
            Last: {METHOD_SHORT[capMethod] || capMethod}
            {snapshotLatency !== null ? ` (${snapshotLatency}ms)` : ''}
          </span>
        )}
        <span className="flex-1" />
        {/* Actions */}
        <Tooltip text="单帧截图">
          <button
            onClick={onTakeSnapshot}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 h-7 text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            <Camera className="w-3.5 h-3.5" />
            Snapshot
          </button>
        </Tooltip>
        {previewing ? (
          <Tooltip text="停止实时预览">
            <button
              onClick={onTogglePreview}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 h-7 text-xs font-medium bg-error/20 text-error hover:bg-error/30 transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
              Stop
            </button>
          </Tooltip>
        ) : (
          <Tooltip text="开始实时预览">
            <button
              onClick={onTogglePreview}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 h-7 text-xs font-medium border border-border text-text-secondary hover:bg-bg-hover transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
              Preview
            </button>
          </Tooltip>
        )}
      </div>

      {/* Preview canvas area */}
      <div className="flex-1 overflow-hidden p-4">
        <div
          className={`w-full h-full rounded-xl bg-bg-secondary ring-1 ring-inset ring-border overflow-hidden flex items-center justify-center relative ${
            !isDesktop && previewing ? 'cursor-crosshair' : ''
          }`}
          onClick={handleCanvasClick}
          onMouseEnter={() => setMouseOn(true)}
          onMouseLeave={() => setMouseOn(false)}
        >
          {children}

          {/* Mouse forwarding hint */}
          {mouseOn && !isDesktop && previewing && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-bg-tertiary/90 text-xs text-text-secondary flex items-center gap-1.5 shadow-lg backdrop-blur-sm pointer-events-none">
              <MousePointer2 className="w-3.5 h-3.5 text-accent" />
              点击映射鼠标 → {inputMethod}
              {lastClick && (
                <span className="text-text-muted ml-2">
                  [{lastClick.x}%, {lastClick.y}%]
                </span>
              )}
            </div>
          )}

          {/* Empty state */}
          {!previewing && lastClick === null && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center space-y-1">
                <div className="text-sm text-text-muted">No preview active</div>
                <div className="text-xs text-text-tertiary">
                  点击右上角 Preview 开始实时预览
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
