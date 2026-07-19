// UU-style virtual mouse — joystick-style relative drag (finger delta moves cursor; tap does not jump).
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MousePointer2 } from 'lucide-react'
import { Tooltip } from './Toolkit'
import { TEXT } from '../lib/design'

/** How many remote-screen widths one full stage-width finger drag covers. */
const SENSITIVITY = 1.15

export function VirtualMouseOverlay({
  enabled,
  videoAspect,
  onAction,
}: {
  enabled: boolean
  /** Remote frame aspect (w/h). Fallback 16/9. */
  videoAspect?: number
  onAction: (action: Record<string, unknown>) => void
}) {
  const { t } = useTranslation()
  const stageRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const lastPtrRef = useRef({ x: 0, y: 0 })
  const posRef = useRef({ x: 0.5, y: 0.5 })
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 })

  const clampNorm = (x: number, y: number) => ({
    x_norm: Math.min(1, Math.max(0, x)),
    y_norm: Math.min(1, Math.max(0, y)),
  })

  const applyDelta = (clientX: number, clientY: number, held: boolean) => {
    const el = stageRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    const dx = ((clientX - lastPtrRef.current.x) / r.width) * SENSITIVITY
    const dy = ((clientY - lastPtrRef.current.y) / r.height) * SENSITIVITY
    lastPtrRef.current = { x: clientX, y: clientY }
    const next = clampNorm(posRef.current.x + dx, posRef.current.y + dy)
    posRef.current = { x: next.x_norm, y: next.y_norm }
    setPos({ x: next.x_norm, y: next.y_norm })
    onAction({ type: 'move', held, button: 'left', x_norm: next.x_norm, y_norm: next.y_norm })
  }

  if (!enabled) return null

  const aspect = videoAspect && videoAspect > 0 ? videoAspect : 16 / 9

  return (
    <div className="absolute inset-0 z-10 flex flex-col pointer-events-none" data-no-page-swipe>
      <div className="flex-1 min-h-0 flex items-center justify-center p-1">
        <div
          ref={stageRef}
          className="relative max-w-full max-h-full pointer-events-auto touch-none"
          style={{ aspectRatio: `${aspect}`, width: '100%', height: 'auto' }}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            draggingRef.current = true
            // Joystick: remember finger start only — do NOT snap cursor under finger.
            lastPtrRef.current = { x: e.clientX, y: e.clientY }
          }}
          onPointerMove={(e) => {
            if (!draggingRef.current) return
            applyDelta(e.clientX, e.clientY, true)
          }}
          onPointerUp={() => { draggingRef.current = false }}
          onPointerCancel={() => { draggingRef.current = false }}
        >
          <div
            className="absolute w-5 h-5 -ml-2.5 -mt-2.5 pointer-events-none drop-shadow"
            style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}
          >
            <MousePointer2 className="w-5 h-5 text-accent" strokeWidth={2.5} />
          </div>
        </div>
      </div>

      <div className="shrink-0 flex items-center justify-center gap-2 pb-1 px-2 pointer-events-auto">
        <Tooltip text={t('peer.vmouse_left')}>
          <button
            type="button"
            className={`h-9 min-w-14 px-3 rounded-lg ${TEXT.xs} font-medium bg-bg-tertiary text-text-primary active:bg-accent-soft-mid`}
            onClick={() => {
              onAction({ type: 'mousedown', button: 'left', x_norm: pos.x, y_norm: pos.y })
              onAction({ type: 'mouseup', button: 'left', x_norm: pos.x, y_norm: pos.y })
            }}
          >
            {t('peer.vmouse_left_short')}
          </button>
        </Tooltip>
        <Tooltip text={t('peer.vmouse_right')}>
          <button
            type="button"
            className={`h-9 min-w-14 px-3 rounded-lg ${TEXT.xs} font-medium bg-bg-tertiary text-text-primary active:bg-accent-soft-mid`}
            onClick={() => {
              onAction({ type: 'mousedown', button: 'right', x_norm: pos.x, y_norm: pos.y })
              onAction({ type: 'mouseup', button: 'right', x_norm: pos.x, y_norm: pos.y })
            }}
          >
            {t('peer.vmouse_right_short')}
          </button>
        </Tooltip>
        <Tooltip text={t('peer.vmouse_wheel_up')}>
          <button
            type="button"
            className={`h-9 min-w-10 px-2 rounded-lg ${TEXT.xs} font-medium bg-bg-tertiary text-text-primary active:bg-accent-soft-mid`}
            onClick={() => onAction({ type: 'wheel', delta: 120, x_norm: pos.x, y_norm: pos.y })}
          >
            ↑
          </button>
        </Tooltip>
        <Tooltip text={t('peer.vmouse_wheel_down')}>
          <button
            type="button"
            className={`h-9 min-w-10 px-2 rounded-lg ${TEXT.xs} font-medium bg-bg-tertiary text-text-primary active:bg-accent-soft-mid`}
            onClick={() => onAction({ type: 'wheel', delta: -120, x_norm: pos.x, y_norm: pos.y })}
          >
            ↓
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
