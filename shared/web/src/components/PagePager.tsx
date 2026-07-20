// Paged horizontal track — Clash Royale–style snap slots.
// Finger down: 1:1 free drag (regret OK). Release: snap by which page covers more (>50%).
// Page count = PRIMARY_PAGES.length (extensible).
import {
  Children,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
import { NAV, navTapDurationMs, rubberBandPage } from '../lib/design'
import { PRIMARY_PAGES, pageIndex, type AppPage } from '../lib/pages'

type PillLayout = { padL: number; slotW: number; pitch: number; n: number }

let pillEl: HTMLElement | null = null
let pillHost: HTMLElement | null = null
let pillLayout: PillLayout | null = null
let pillDragging = false

/** Call after nav resize / PRIMARY_PAGES length change. */
export function invalidateNavPillLayout() {
  pillLayout = null
}

function measurePillLayout(pill: HTMLElement): PillLayout {
  const track = pill.parentElement
  const n = PRIMARY_PAGES.length
  if (!track || n <= 0) return { padL: 0, slotW: 0, pitch: 0, n }
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const gapPx = NAV.bottomGapRem * rem
  const cs = getComputedStyle(track)
  const padL = parseFloat(cs.paddingLeft) || 0
  const padR = parseFloat(cs.paddingRight) || 0
  const innerW = Math.max(0, track.clientWidth - padL - padR)
  const slotW = (innerW - (n - 1) * gapPx) / n
  const pitch = slotW + gapPx
  pill.style.left = `${padL}px`
  pill.style.width = `${slotW}px`
  return { padL, slotW, pitch, n }
}

/**
 * Drive bottom-nav pill via compositor-friendly translate3d only.
 * Layout cached; hot path is transform only.
 */
export function writeNavProgress(
  host: HTMLElement | null,
  fractional: number,
  dragging: boolean,
) {
  if (!host) return
  if (pillHost !== host) {
    pillHost = host
    pillEl = host.querySelector('[data-nav-pill]') as HTMLElement | null
    pillLayout = null
    pillDragging = false
  }
  const pill = pillEl
  if (!pill) return

  if (pillDragging !== dragging) {
    pillDragging = dragging
    host.classList.toggle('nav-dragging', dragging)
  }

  if (!pillLayout || pillLayout.n !== PRIMARY_PAGES.length) {
    pillLayout = measurePillLayout(pill)
  }
  pill.style.transform = `translate3d(${fractional * pillLayout.pitch}px,0,0)`
}

/** CSS cubic-bezier unit ease (x1,y1,x2,y2) → y at t∈[0,1]. */
function bezierEase(t: number, x1: number, y1: number, x2: number, y2: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  let x = t
  for (let i = 0; i < 6; i++) {
    const cx = 3 * x1
    const bx = 3 * (x2 - x1) - cx
    const ax = 1 - cx - bx
    const dx = ((ax * x + bx) * x + cx) * x - t
    const d = (3 * ax * x + 2 * bx) * x + cx
    if (Math.abs(d) < 1e-6) break
    x -= dx / d
  }
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  return ((ay * x + by) * x + cy) * x
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function clampIndex(i: number, pageCount: number): number {
  if (pageCount <= 0) return 0
  return Math.max(0, Math.min(pageCount - 1, i))
}

/**
 * Snap ONLY on release: whichever page covers more of the viewport (>50%).
 * Equivalent to round(progress), clamped — startPage unused for the ratio rule,
 * but edges still spring to 0 / last.
 */
function snapTarget(progress: number, pageCount: number): number {
  if (pageCount <= 0) return 0
  if (progress < 0) return 0
  if (progress > pageCount - 1) return pageCount - 1
  return clampIndex(Math.round(progress), pageCount)
}

export function PagePager({
  page,
  onPageChange,
  progressHostRef,
  children,
}: {
  page: AppPage
  onPageChange: (p: AppPage) => void
  progressHostRef?: RefObject<HTMLElement | null>
  children: ReactNode
}) {
  const pageCount = PRIMARY_PAGES.length
  const panels = Children.toArray(children).slice(0, pageCount)
  const index = clampIndex(pageIndex(page), pageCount)

  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef(0)
  const progressRef = useRef(index)
  const indexRef = useRef(index)
  indexRef.current = index
  const onPageChangeRef = useRef(onPageChange)
  onPageChangeRef.current = onPageChange

  const animRaf = useRef(0)
  const reduceMotion = useRef(prefersReducedMotion())
  const skipPropAnim = useRef(false)

  // Gesture (refs only — no re-render on move).
  const pointerId = useRef<number | null>(null)
  const dragging = useRef(false)
  const axisLocked = useRef<'none' | 'h' | 'v'>('none')
  const startX = useRef(0)
  const startY = useRef(0)
  const startProgress = useRef(0)
  const windowListening = useRef(false)

  const progressHost = () => progressHostRef?.current ?? null

  const cancelAnim = () => {
    if (animRaf.current) {
      cancelAnimationFrame(animRaf.current)
      animRaf.current = 0
    }
  }

  const paint = (p: number, isDragging: boolean) => {
    progressRef.current = p
    const track = trackRef.current
    const w = widthRef.current
    if (track && w > 0) {
      track.style.transform = `translate3d(${-p * w}px,0,0)`
    }
    writeNavProgress(progressHost(), p, isDragging)
  }

  const animateTo = (
    target: number,
    durationMs: number,
    ease: readonly [number, number, number, number],
  ) => {
    cancelAnim()
    const from = progressRef.current
    if (reduceMotion.current || Math.abs(from - target) < 0.001) {
      paint(target, false)
      return
    }
    const [x1, y1, x2, y2] = ease
    const t0 = performance.now()
    const tick = (now: number) => {
      if (dragging.current && axisLocked.current === 'h') {
        animRaf.current = 0
        return
      }
      const t = Math.min(1, (now - t0) / durationMs)
      const e = bezierEase(t, x1, y1, x2, y2)
      paint(from + (target - from) * e, true)
      if (t < 1) {
        animRaf.current = requestAnimationFrame(tick)
        return
      }
      animRaf.current = 0
      paint(target, false)
    }
    animRaf.current = requestAnimationFrame(tick)
  }

  const commitIndex = (next: number) => {
    const i = clampIndex(next, pageCount)
    if (i !== indexRef.current) {
      skipPropAnim.current = true
      onPageChangeRef.current(PRIMARY_PAGES[i])
    }
  }

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => { reduceMotion.current = mq.matches }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useLayoutEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const measure = () => {
      const w = vp.clientWidth
      if (w <= 0) return
      widthRef.current = w
      invalidateNavPillLayout()
      if (dragging.current && axisLocked.current === 'h') {
        paint(progressRef.current, true)
        return
      }
      if (dragging.current) return
      cancelAnim()
      paint(indexRef.current, false)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(vp)
    return () => ro.disconnect()
  }, [progressHostRef])

  useLayoutEffect(() => {
    if (skipPropAnim.current) {
      skipPropAnim.current = false
      return
    }
    if (dragging.current && axisLocked.current === 'h') return
    if (Math.abs(progressRef.current - index) < 0.001) {
      paint(index, false)
      return
    }
    const delta = Math.abs(index - progressRef.current)
    animateTo(index, navTapDurationMs(delta), NAV.tapEase)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return

    const detachWindow = () => {
      if (!windowListening.current) return
      windowListening.current = false
      window.removeEventListener('pointermove', onWindowMove)
      window.removeEventListener('pointerup', onWindowUp)
      window.removeEventListener('pointercancel', onWindowUp)
    }

    const settleHorizontal = () => {
      const target = snapTarget(progressRef.current, pageCount)
      const delta = Math.abs(target - progressRef.current)
      const dur = delta < 0.15
        ? NAV.pagerSnapMs
        : navTapDurationMs(Math.max(delta, 0.5))
      commitIndex(target)
      animateTo(target, dur, NAV.pagerSnapEase)
    }

    const endPointer = (id: number) => {
      if (pointerId.current !== id) return
      const wasH = axisLocked.current === 'h'
      pointerId.current = null
      dragging.current = false
      axisLocked.current = 'none'
      detachWindow()
      if (wasH) settleHorizontal()
      else writeNavProgress(progressHost(), progressRef.current, false)
    }

    function onWindowMove(e: PointerEvent) {
      if (pointerId.current !== e.pointerId || !dragging.current) return
      const w = widthRef.current
      if (w <= 0) return

      const dx = e.clientX - startX.current
      const dy = e.clientY - startY.current

      if (axisLocked.current === 'none') {
        const adx = Math.abs(dx)
        const ady = Math.abs(dy)
        if (adx < NAV.pagerAxisLockPx && ady < NAV.pagerAxisLockPx) return
        if (ady > adx) {
          // Vertical scroll wins — drop pager gesture; let overflow-y children work.
          axisLocked.current = 'v'
          dragging.current = false
          pointerId.current = null
          detachWindow()
          writeNavProgress(progressHost(), progressRef.current, false)
          return
        }
        axisLocked.current = 'h'
      }

      if (axisLocked.current !== 'h') return

      e.preventDefault()
      // 1:1 free drag — snap only on release.
      paint(rubberBandPage(startProgress.current - dx / w, pageCount), true)
    }

    function onWindowUp(e: PointerEvent) {
      endPointer(e.pointerId)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      // Ignore secondary pointers / re-entry.
      if (pointerId.current !== null) return
      // Don't steal gestures from explicit no-swipe regions (remote overlays etc.).
      const t = e.target
      if (t instanceof Element && t.closest('[data-no-page-swipe]')) return

      cancelAnim()
      pointerId.current = e.pointerId
      dragging.current = true
      axisLocked.current = 'none'
      startX.current = e.clientX
      startY.current = e.clientY
      startProgress.current = progressRef.current

      if (!windowListening.current) {
        windowListening.current = true
        // Non-passive move so we can preventDefault after horizontal lock.
        window.addEventListener('pointermove', onWindowMove, { passive: false })
        window.addEventListener('pointerup', onWindowUp)
        window.addEventListener('pointercancel', onWindowUp)
      }
    }

    vp.addEventListener('pointerdown', onPointerDown, { passive: true })
    paint(indexRef.current, false)

    return () => {
      vp.removeEventListener('pointerdown', onPointerDown)
      detachWindow()
      cancelAnim()
    }
  }, [pageCount, progressHostRef])

  return (
    <div
      ref={viewportRef}
      className="flex-1 min-h-0 overflow-hidden"
      data-page-pager
      // pan-y: vertical lists inside pages still scroll; horizontal handled by us.
      style={{ touchAction: 'pan-y' }}
    >
      <div
        ref={trackRef}
        className="flex h-full w-full will-change-transform"
      >
        {panels.map((panel, i) => (
          <div
            key={PRIMARY_PAGES[i] ?? i}
            className="h-full shrink-0 flex flex-col min-h-0 overflow-hidden"
            style={{ flex: '0 0 100%', width: '100%' }}
            aria-hidden={i !== index}
          >
            {panel}
          </div>
        ))}
      </div>
    </div>
  )
}
