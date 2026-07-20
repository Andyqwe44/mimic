// Paged horizontal track — native overflow-x + CSS scroll-snap (same compositor path as vertical).
// Finger drag is browser scrolling (60/120fps). JS only syncs the nav pill + commits page index.
import {
  Children,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
import { NAV, navTapDurationMs } from '../lib/design'
import { PRIMARY_PAGES, pageIndex, type AppPage } from '../lib/pages'
import { addLog } from '../lib/bridge'

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
  const widthRef = useRef(0)
  const progressRef = useRef(index)
  const indexRef = useRef(index)
  indexRef.current = index
  const onPageChangeRef = useRef(onPageChange)
  onPageChangeRef.current = onPageChange

  const animRaf = useRef(0)
  const reduceMotion = useRef(prefersReducedMotion())
  /** Ignore next page-prop scroll (we already scrolled / committed). */
  const skipPropScroll = useRef(false)
  /** True while finger is down on the pager. */
  const fingerDown = useRef(false)
  /** True while snap inertia may still be running after lift. */
  const userScrolling = useRef(false)
  const settleTimer = useRef(0)

  const progressHost = () => progressHostRef?.current ?? null

  const cancelAnim = () => {
    if (animRaf.current) {
      cancelAnimationFrame(animRaf.current)
      animRaf.current = 0
    }
  }

  const syncPill = (scrollLeft: number, dragging: boolean) => {
    const w = widthRef.current
    if (w <= 0) return
    const p = scrollLeft / w
    progressRef.current = p
    writeNavProgress(progressHost(), p, dragging)
  }

  const commitIndex = (next: number) => {
    const i = clampIndex(next, pageCount)
    if (i !== indexRef.current) {
      skipPropScroll.current = true
      addLog(`[pager] commit ${PRIMARY_PAGES[indexRef.current]}→${PRIMARY_PAGES[i]}`)
      onPageChangeRef.current(PRIMARY_PAGES[i])
    }
  }

  /** Programmatic jump (bottom-nav tap) — rAF on scrollLeft only; finger uses native scroll. */
  const animateScrollTo = (targetIdx: number, durationMs: number) => {
    const vp = viewportRef.current
    const w = widthRef.current
    if (!vp || w <= 0) return
    cancelAnim()
    const targetLeft = targetIdx * w
    const from = vp.scrollLeft
    if (reduceMotion.current || Math.abs(from - targetLeft) < 1) {
      vp.scrollLeft = targetLeft
      syncPill(targetLeft, false)
      return
    }
    const [x1, y1, x2, y2] = NAV.tapEase
    const t0 = performance.now()
    const tick = (now: number) => {
      if (userScrolling.current) {
        animRaf.current = 0
        return
      }
      const t = Math.min(1, (now - t0) / durationMs)
      const e = bezierEase(t, x1, y1, x2, y2)
      const left = from + (targetLeft - from) * e
      vp.scrollLeft = left
      syncPill(left, true)
      if (t < 1) {
        animRaf.current = requestAnimationFrame(tick)
        return
      }
      animRaf.current = 0
      vp.scrollLeft = targetLeft
      syncPill(targetLeft, false)
    }
    animRaf.current = requestAnimationFrame(tick)
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
      const prevW = widthRef.current
      widthRef.current = w
      invalidateNavPillLayout()
      // Keep current page after resize (don't animate).
      if (prevW > 0 && Math.abs(prevW - w) > 0.5) {
        vp.scrollLeft = indexRef.current * w
      }
      syncPill(vp.scrollLeft, false)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(vp)
    return () => ro.disconnect()
  }, [progressHostRef])

  // Bottom-nav / external page change → scroll to slot.
  useLayoutEffect(() => {
    if (skipPropScroll.current) {
      skipPropScroll.current = false
      return
    }
    const vp = viewportRef.current
    const w = widthRef.current
    if (!vp || w <= 0) return
    const targetLeft = index * w
    if (Math.abs(vp.scrollLeft - targetLeft) < 1) {
      syncPill(targetLeft, false)
      return
    }
    const delta = Math.abs(index - progressRef.current)
    addLog(`[pager] prop→scroll idx=${index} from=${progressRef.current.toFixed(2)}`)
    animateScrollTo(index, navTapDurationMs(delta))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return

    const settleFromScroll = () => {
      const w = widthRef.current
      if (w <= 0) return
      const nearest = clampIndex(Math.round(vp.scrollLeft / w), pageCount)
      // Snap may still be settling — force exact slot if slightly off.
      const exact = nearest * w
      if (Math.abs(vp.scrollLeft - exact) > 1) {
        vp.scrollTo({ left: exact, behavior: 'smooth' })
      }
      syncPill(vp.scrollLeft, false)
      commitIndex(nearest)
      userScrolling.current = false
    }

    const onScroll = () => {
      syncPill(vp.scrollLeft, fingerDown.current || userScrolling.current)
      if (fingerDown.current) return
      if (settleTimer.current) window.clearTimeout(settleTimer.current)
      // Fallback when scrollend is missing / delayed (older WebViews).
      settleTimer.current = window.setTimeout(settleFromScroll, 100)
    }

    const onScrollEnd = () => {
      if (fingerDown.current) return
      if (settleTimer.current) {
        window.clearTimeout(settleTimer.current)
        settleTimer.current = 0
      }
      settleFromScroll()
    }

    const onPointerDown = () => {
      fingerDown.current = true
      userScrolling.current = true
      cancelAnim()
      if (settleTimer.current) {
        window.clearTimeout(settleTimer.current)
        settleTimer.current = 0
      }
    }
    const onPointerUp = () => {
      fingerDown.current = false
      userScrolling.current = true
      // Snap may run after lift — settle via scrollend / debounce.
      if (settleTimer.current) window.clearTimeout(settleTimer.current)
      settleTimer.current = window.setTimeout(settleFromScroll, 120)
    }

    vp.addEventListener('scroll', onScroll, { passive: true })
    vp.addEventListener('scrollend', onScrollEnd as EventListener)
    vp.addEventListener('pointerdown', onPointerDown, { passive: true })
    vp.addEventListener('pointerup', onPointerUp, { passive: true })
    vp.addEventListener('pointercancel', onPointerUp, { passive: true })
    addLog(`[pager] native-scroll ready pages=${pageCount} idx=${indexRef.current}`)
    // Seed position without smooth (first paint).
    if (widthRef.current > 0) {
      vp.scrollLeft = indexRef.current * widthRef.current
      syncPill(vp.scrollLeft, false)
    }

    return () => {
      vp.removeEventListener('scroll', onScroll)
      vp.removeEventListener('scrollend', onScrollEnd as EventListener)
      vp.removeEventListener('pointerdown', onPointerDown)
      vp.removeEventListener('pointerup', onPointerUp)
      vp.removeEventListener('pointercancel', onPointerUp)
      if (settleTimer.current) window.clearTimeout(settleTimer.current)
      cancelAnim()
    }
  }, [pageCount, progressHostRef])

  return (
    <div
      ref={viewportRef}
      className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden"
      data-page-pager
      style={{
        scrollSnapType: 'x mandatory',
        WebkitOverflowScrolling: 'touch',
        overscrollBehaviorX: 'contain',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      }}
    >
      <div className="flex h-full w-full">
        {panels.map((panel, i) => (
          <div
            key={PRIMARY_PAGES[i] ?? i}
            className="h-full shrink-0 flex flex-col min-h-0 overflow-hidden"
            style={{
              flex: '0 0 100%',
              width: '100%',
              scrollSnapAlign: 'start',
              scrollSnapStop: 'always',
            }}
            aria-hidden={i !== index}
          >
            {panel}
          </div>
        ))}
      </div>
    </div>
  )
}
