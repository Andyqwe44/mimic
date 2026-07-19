// PC absolute pointer — click/drag on the video maps 1:1 to remote (x_norm, y_norm).
// No virtual-mouse triangle panel (Android-only).
import { useRef, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'

function clientToNorm(
  el: HTMLElement,
  clientX: number,
  clientY: number,
  rotated: boolean,
): { x_norm: number; y_norm: number } {
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return { x_norm: 0.5, y_norm: 0.5 }
  const lx = (clientX - r.left) / r.width
  const ly = (clientY - r.top) / r.height
  // Parent CSS rotate(90deg) CW: map viewport → element-local axes.
  if (rotated) {
    return {
      x_norm: Math.min(1, Math.max(0, ly)),
      y_norm: Math.min(1, Math.max(0, 1 - lx)),
    }
  }
  return {
    x_norm: Math.min(1, Math.max(0, lx)),
    y_norm: Math.min(1, Math.max(0, ly)),
  }
}

type MouseButton = 'left' | 'right'

export function AbsolutePointerOverlay({
  enabled,
  rotated = false,
  fitWidth,
  fitHeight,
  onAction,
}: {
  enabled: boolean
  rotated?: boolean
  fitWidth?: number
  fitHeight?: number
  onAction: (action: Record<string, unknown>) => void
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const leftDownRef = useRef(false)
  const rightDownRef = useRef(false)
  const posRef = useRef({ x: 0.5, y: 0.5 })

  if (!enabled) return null

  const useFit = (fitWidth ?? 0) > 0 && (fitHeight ?? 0) > 0

  const buttonOf = (e: ReactPointerEvent): MouseButton =>
    e.button === 2 ? 'right' : 'left'

  const syncPos = (clientX: number, clientY: number) => {
    const el = stageRef.current
    if (!el) return posRef.current
    const n = clientToNorm(el, clientX, clientY, rotated)
    posRef.current = { x: n.x_norm, y: n.y_norm }
    return posRef.current
  }

  const anyHeld = () => leftDownRef.current || rightDownRef.current

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none" data-no-page-swipe>
      <div
        ref={stageRef}
        className="relative pointer-events-auto touch-none cursor-none"
        style={
          useFit
            ? { width: fitWidth, height: fitHeight }
            : { width: '100%', height: '100%' }
        }
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          const btn = buttonOf(e)
          const down = btn === 'left' ? leftDownRef : rightDownRef
          if (down.current) return
          down.current = true
          const { x, y } = syncPos(e.clientX, e.clientY)
          onAction({ type: 'mousedown', button: btn, x_norm: x, y_norm: y })
        }}
        onPointerMove={(e: ReactPointerEvent<HTMLDivElement>) => {
          const { x, y } = syncPos(e.clientX, e.clientY)
          const btn: MouseButton = leftDownRef.current
            ? 'left'
            : rightDownRef.current
              ? 'right'
              : 'left'
          onAction({
            type: 'move',
            held: anyHeld(),
            button: btn,
            x_norm: x,
            y_norm: y,
          })
        }}
        onPointerUp={(e: ReactPointerEvent<HTMLDivElement>) => {
          e.preventDefault()
          const btn = buttonOf(e)
          const down = btn === 'left' ? leftDownRef : rightDownRef
          if (!down.current) return
          down.current = false
          const { x, y } = syncPos(e.clientX, e.clientY)
          onAction({ type: 'mouseup', button: btn, x_norm: x, y_norm: y })
        }}
        onPointerCancel={(e: ReactPointerEvent<HTMLDivElement>) => {
          const btn = buttonOf(e)
          const down = btn === 'left' ? leftDownRef : rightDownRef
          if (!down.current) return
          down.current = false
          const { x, y } = posRef.current
          onAction({ type: 'mouseup', button: btn, x_norm: x, y_norm: y })
        }}
        onWheel={(e: ReactWheelEvent<HTMLDivElement>) => {
          e.preventDefault()
          const { x, y } = syncPos(e.clientX, e.clientY)
          const delta = e.deltaY < 0 ? 120 : e.deltaY > 0 ? -120 : 0
          if (delta === 0) return
          onAction({ type: 'wheel', delta, x_norm: x, y_norm: y })
        }}
      />
    </div>
  )
}
