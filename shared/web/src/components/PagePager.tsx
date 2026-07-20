// Horizontal page track — four primary pages side-by-side with drag/swipe animation.
// Android WebView: prefer TouchEvent (PointerEvent cancel is unreliable with overflow-y-auto).
import {
  Children,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { NAV } from '../lib/design'
import { PRIMARY_PAGES, fractionalPageIndex, pageIndex, type AppPage } from '../lib/pages'

const MIN_DX = 28
/** Horizontal wins unless clearly vertical (Clash-Royale-style tab swipe). */
const MAX_SLOPE = 1.0
/** Edge strips always allow swipe even over canvas / data-no-page-swipe. */
const EDGE_PX = 48

function blockedTarget(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false
  // Do NOT block on bare canvas — Monitor chrome must stay swipeable.
  // Only hard-block form fields and explicit opt-outs (remote control overlays).
  return !!t.closest(
    'input, textarea, select, [contenteditable="true"], [data-no-page-swipe]',
  )
}

function nearHorizontalEdge(clientX: number, width: number): boolean {
  return clientX <= EDGE_PX || clientX >= width - EDGE_PX
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Write CSS vars on a host so bottom-nav pill can follow without React re-renders. */
export function writeNavProgress(
  host: HTMLElement | null,
  fractional: number,
  dragging: boolean,
) {
  if (!host) return
  host.style.setProperty('--nav-fraction', String(fractional))
  host.classList.toggle('nav-dragging', dragging)
}

type Gesture = {
  x: number
  y: number
  id: number
  blocked: boolean
  axis: 'undecided' | 'h' | 'v'
}

export function PagePager({
  page,
  onPageChange,
  progressHostRef,
  children,
}: {
  page: AppPage
  onPageChange: (p: AppPage) => void
  /** Element that receives --nav-fraction / --nav-dragging (AppShell root). */
  progressHostRef?: RefObject<HTMLElement | null>
  children: ReactNode
}) {
  const panels = Children.toArray(children)
  const index = pageIndex(page)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [dragPx, setDragPx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const start = useRef<Gesture | null>(null)
  const indexRef = useRef(index)
  indexRef.current = index
  const widthRef = useRef(width)
  widthRef.current = width
  const onPageChangeRef = useRef(onPageChange)
  onPageChangeRef.current = onPageChange
  const reduceMotion = useRef(prefersReducedMotion())
  const dragPxRef = useRef(0)

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => { reduceMotion.current = mq.matches }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!dragging) setDragPx(0)
  }, [index, dragging])

  useLayoutEffect(() => {
    const frac = fractionalPageIndex(index, dragPx, width)
    writeNavProgress(progressHostRef?.current ?? null, frac, dragging)
  }, [index, dragPx, width, dragging, progressHostRef])

  const settleTo = useCallback((nextIdx: number) => {
    const cur = indexRef.current
    const clamped = Math.max(0, Math.min(PRIMARY_PAGES.length - 1, nextIdx))
    setDragging(false)
    setDragPx(0)
    dragPxRef.current = 0
    if (clamped !== cur) {
      onPageChangeRef.current(PRIMARY_PAGES[clamped])
    }
  }, [])

  useEffect(() => {
    const el = viewportRef.current
    if (!el || width <= 0) return

    const begin = (clientX: number, clientY: number, id: number, target: EventTarget | null) => {
      const w = widthRef.current
      const edge = nearHorizontalEdge(clientX, w)
      start.current = {
        x: clientX,
        y: clientY,
        id,
        blocked: edge ? false : blockedTarget(target),
        axis: 'undecided',
      }
    }

    const move = (clientX: number, clientY: number, id: number, ev: Event) => {
      const s = start.current
      if (!s || s.blocked || s.id !== id) return
      const dx = clientX - s.x
      const dy = clientY - s.y

      if (s.axis === 'undecided') {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
        // Prefer horizontal when comparable — Clash Royale tab feel.
        s.axis = Math.abs(dx) >= Math.abs(dy) * (1 / MAX_SLOPE) ? 'h' : 'v'
        if (s.axis === 'v') return
        setDragging(true)
        el.style.touchAction = 'none'
      }
      if (s.axis !== 'h') return

      ev.preventDefault()
      const i = indexRef.current
      let next = dx
      if ((i === 0 && dx > 0) || (i === PRIMARY_PAGES.length - 1 && dx < 0)) {
        next = dx * 0.35
      }
      dragPxRef.current = next
      setDragPx(next)
    }

    const end = (clientX: number, id: number) => {
      const s = start.current
      start.current = null
      el.style.touchAction = ''
      if (!s || s.blocked || s.id !== id) {
        setDragging(false)
        setDragPx(0)
        dragPxRef.current = 0
        return
      }
      if (s.axis !== 'h') {
        setDragging(false)
        setDragPx(0)
        dragPxRef.current = 0
        return
      }
      const dx = clientX - s.x
      const i = indexRef.current
      const w = widthRef.current
      const threshold = Math.max(MIN_DX, w * 0.18)
      if (dx <= -threshold && i < PRIMARY_PAGES.length - 1) {
        settleTo(i + 1)
      } else if (dx >= threshold && i > 0) {
        settleTo(i - 1)
      } else {
        setDragging(false)
        setDragPx(0)
        dragPxRef.current = 0
      }
    }

    const cancel = () => {
      start.current = null
      el.style.touchAction = ''
      setDragging(false)
      setDragPx(0)
      dragPxRef.current = 0
    }

    // Touch first — reliable on Android WebView over scrollable children.
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      begin(t.clientX, t.clientY, t.identifier, e.target)
    }
    const onTouchMove = (e: TouchEvent) => {
      const s = start.current
      if (!s) return
      let t: Touch | null = null
      for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === s.id) {
          t = e.touches[i]
          break
        }
      }
      if (!t) return
      move(t.clientX, t.clientY, s.id, e)
    }
    const onTouchEnd = (e: TouchEvent) => {
      const s = start.current
      if (!s) return
      let clientX = s.x
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === s.id) {
          clientX = e.changedTouches[i].clientX
          break
        }
      }
      end(clientX, s.id)
    }

    // Mouse / pen fallback (desktop emulator, stylus).
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return // handled by TouchEvent
      if (e.pointerType === 'mouse' && e.button !== 0) return
      begin(e.clientX, e.clientY, e.pointerId, e.target)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      move(e.clientX, e.clientY, e.pointerId, e)
    }
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      end(e.clientX, e.pointerId)
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true, capture: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })
    el.addEventListener('touchend', onTouchEnd, { capture: true })
    el.addEventListener('touchcancel', cancel, { capture: true })
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove, { passive: false })
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', cancel)
    return () => {
      el.removeEventListener('touchstart', onTouchStart, true)
      el.removeEventListener('touchmove', onTouchMove, true)
      el.removeEventListener('touchend', onTouchEnd, true)
      el.removeEventListener('touchcancel', cancel, true)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', cancel)
      el.style.touchAction = ''
    }
  }, [width, settleTo])

  const tx = width > 0 ? -index * width + dragPx : 0
  const settleMs = reduceMotion.current ? 0 : NAV.settleMs

  return (
    <div
      ref={viewportRef}
      className="flex-1 min-h-0 overflow-hidden relative"
      style={{ touchAction: 'pan-y' }}
      data-page-pager
    >
      <div
        className="pager-track flex h-full will-change-transform"
        style={{
          transform: `translate3d(${tx}px, 0, 0)`,
          transition: dragging ? 'none' : `transform ${settleMs}ms ${NAV.settleEase}`,
        }}
      >
        {panels.map((panel, i) => (
          <div
            key={PRIMARY_PAGES[i] ?? i}
            className={`h-full shrink-0 flex flex-col min-h-0 overflow-hidden ${
              i === index ? '' : 'pointer-events-none'
            }`}
            style={{ width: width > 0 ? width : '100%' }}
            aria-hidden={i !== index}
          >
            {panel}
          </div>
        ))}
      </div>
    </div>
  )
}
