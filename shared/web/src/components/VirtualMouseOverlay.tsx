// UU-style virtual mouse — relative stage drag + floating L/Wheel/R panel.
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MousePointer2, GripHorizontal } from 'lucide-react'
import { Tooltip } from './Toolkit'
import { TEXT, VMOUSE, RADIUS } from '../lib/design'

/** How many remote-screen widths one full stage-width finger drag covers. */
const SENSITIVITY = 1.15

export function VirtualMouseOverlay({
  enabled,
  videoAspect,
  rotated = false,
  showPanel = true,
  onAction,
}: {
  enabled: boolean
  /** Remote frame aspect (w/h). Fallback 16/9. */
  videoAspect?: number
  /**
   * True when parent CSS uses rotate(90deg) CW fake-landscape.
   * Screen deltas must be inverse-mapped into the element's local axes.
   */
  rotated?: boolean
  /** Floating mouse panel (left / wheel / right). Off in compact preview. */
  showPanel?: boolean
  onAction: (action: Record<string, unknown>) => void
}) {
  const { t } = useTranslation()
  const stageRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const lastPtrRef = useRef({ x: 0, y: 0 })
  const posRef = useRef({ x: 0.5, y: 0.5 })
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 })

  // Floating panel position (viewport % of overlay).
  const panelDragRef = useRef(false)
  const panelLastRef = useRef({ x: 0, y: 0 })
  const [panelPos, setPanelPos] = useState({ x: 72, y: 68 })

  const clampNorm = (x: number, y: number) => ({
    x_norm: Math.min(1, Math.max(0, x)),
    y_norm: Math.min(1, Math.max(0, y)),
  })

  const applyDelta = (clientX: number, clientY: number, held: boolean) => {
    const el = stageRef.current
    if (!el) return
    const W = el.offsetWidth
    const H = el.offsetHeight
    if (W <= 0 || H <= 0) return
    const dSx = clientX - lastPtrRef.current.x
    const dSy = clientY - lastPtrRef.current.y
    lastPtrRef.current = { x: clientX, y: clientY }
    // CSS rotate(90deg) CW: local ← (dSy, -dSx)
    let dx: number
    let dy: number
    if (rotated) {
      dx = (dSy / W) * SENSITIVITY
      dy = (-dSx / H) * SENSITIVITY
    } else {
      dx = (dSx / W) * SENSITIVITY
      dy = (dSy / H) * SENSITIVITY
    }
    const next = clampNorm(posRef.current.x + dx, posRef.current.y + dy)
    posRef.current = { x: next.x_norm, y: next.y_norm }
    setPos({ x: next.x_norm, y: next.y_norm })
    onAction({ type: 'move', held, button: 'left', x_norm: next.x_norm, y_norm: next.y_norm })
  }

  const clickButton = (button: 'left' | 'right') => {
    const { x, y } = posRef.current
    onAction({ type: 'mousedown', button, x_norm: x, y_norm: y })
    onAction({ type: 'mouseup', button, x_norm: x, y_norm: y })
  }

  const wheel = (delta: number) => {
    const { x, y } = posRef.current
    onAction({ type: 'wheel', delta, x_norm: x, y_norm: y })
  }

  if (!enabled) return null

  const aspect = videoAspect && videoAspect > 0 ? videoAspect : 16 / 9

  return (
    <div className="absolute inset-0 z-10 flex flex-col pointer-events-none" data-no-page-swipe>
      <div className="flex-1 min-h-0 flex items-center justify-center p-1 relative">
        <div
          ref={stageRef}
          className="relative max-w-full max-h-full pointer-events-auto touch-none"
          style={{ aspectRatio: `${aspect}`, width: '100%', height: 'auto' }}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            draggingRef.current = true
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

        {showPanel && (
          <div
            className={`absolute pointer-events-auto touch-none ${VMOUSE.panel} ${RADIUS.xl} bg-bg-secondary/95 ring-1 ring-inset ring-border shadow-lg select-none`}
            style={{
              left: `${panelPos.x}%`,
              top: `${panelPos.y}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div
              className={`${VMOUSE.handleH} flex items-center justify-center gap-1 text-text-muted cursor-grab active:cursor-grabbing border-b border-border`}
              onPointerDown={(e) => {
                e.stopPropagation()
                ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                panelDragRef.current = true
                panelLastRef.current = { x: e.clientX, y: e.clientY }
              }}
              onPointerMove={(e) => {
                if (!panelDragRef.current) return
                const parent = (e.currentTarget as HTMLElement).offsetParent as HTMLElement | null
                const pw = parent?.clientWidth || window.innerWidth
                const ph = parent?.clientHeight || window.innerHeight
                const dSx = e.clientX - panelLastRef.current.x
                const dSy = e.clientY - panelLastRef.current.y
                panelLastRef.current = { x: e.clientX, y: e.clientY }
                setPanelPos((p) => ({
                  x: Math.min(92, Math.max(8, p.x + (dSx / pw) * 100)),
                  y: Math.min(92, Math.max(8, p.y + (dSy / ph) * 100)),
                }))
              }}
              onPointerUp={() => { panelDragRef.current = false }}
              onPointerCancel={() => { panelDragRef.current = false }}
            >
              <GripHorizontal className="w-3.5 h-3.5" />
              <span className={TEXT.tiny}>{t('peer.vmouse_panel')}</span>
            </div>
            <div className="flex items-stretch p-1.5 gap-1">
              <Tooltip text={t('peer.vmouse_left')}>
                <button
                  type="button"
                  className={`flex-1 ${VMOUSE.btnH} ${RADIUS.lg} ${TEXT.xs} font-semibold bg-bg-tertiary text-text-primary active:bg-accent-soft-mid`}
                  onClick={() => clickButton('left')}
                >
                  {t('peer.vmouse_left_short')}
                </button>
              </Tooltip>
              <div className={`${VMOUSE.wheelW} flex flex-col gap-0.5`}>
                <Tooltip text={t('peer.vmouse_wheel_up')}>
                  <button
                    type="button"
                    className={`flex-1 ${RADIUS.md} ${TEXT.tiny} font-medium bg-bg-tertiary text-text-primary active:bg-accent-soft-mid`}
                    onClick={() => wheel(120)}
                  >
                    ↑
                  </button>
                </Tooltip>
                <Tooltip text={t('peer.vmouse_wheel_down')}>
                  <button
                    type="button"
                    className={`flex-1 ${RADIUS.md} ${TEXT.tiny} font-medium bg-bg-tertiary text-text-primary active:bg-accent-soft-mid`}
                    onClick={() => wheel(-120)}
                  >
                    ↓
                  </button>
                </Tooltip>
              </div>
              <Tooltip text={t('peer.vmouse_right')}>
                <button
                  type="button"
                  className={`flex-1 ${VMOUSE.btnH} ${RADIUS.lg} ${TEXT.xs} font-semibold bg-bg-tertiary text-text-primary active:bg-accent-soft-mid`}
                  onClick={() => clickButton('right')}
                >
                  {t('peer.vmouse_right_short')}
                </button>
              </Tooltip>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
