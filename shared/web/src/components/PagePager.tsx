// Paged horizontal track — Clash Royale–style snap slots.
// Finger down: 1:1 free drag. Release: distance (~20%) OR fling; 折返 cancels to start.
// Page count = PRIMARY_PAGES.length. Debug: addLog('[pager] …') — keep until swipe bug closed.
import {
  Children,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
import { NAV, navTapDurationMs, resolvePagerAxis, rubberBandPage } from '../lib/design'
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

/** Describe event target for Android log dumps (DOM intercept diagnosis). */
function describeTarget(t: EventTarget | null): string {
  if (!(t instanceof Element)) return String(t)
  const tag = t.tagName.toLowerCase()
  const id = t.id ? `#${t.id}` : ''
  const cls = typeof t.className === 'string' && t.className
    ? `.${t.className.trim().split(/\s+/).slice(0, 4).join('.')}`
    : ''
  const noSwipe = t.closest('[data-no-page-swipe]')
  const scroll = t.closest('.overflow-y-auto, .overflow-y-scroll, .overflow-auto, [data-page-scroll]')
  const parts = [`${tag}${id}${cls.slice(0, 80)}`]
  if (noSwipe) {
    const ns = noSwipe as Element
    parts.push(`noSwipe=<${ns.tagName.toLowerCase()}${ns.className && typeof ns.className === 'string' ? '.' + ns.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}>`)
  }
  if (scroll) {
    const s = scroll as Element
    parts.push(`scroll=<${s.tagName.toLowerCase()}>`)
  }
  return parts.join(' ')
}

/**
 * Clash Royale–like settle:
 * - ~15% distance commits
 * - fling only if already moved a real distance + lasting gesture
 * - 折返 cancels to start
 */
function snapTarget(
  progress: number,
  velocity: number,
  pageCount: number,
  startPage: number,
  peakProgress: number,
  moveAgeMs: number,
  gestureMs: number,
): { target: number; reason: string } {
  if (pageCount <= 0) return { target: 0, reason: 'empty' }
  if (progress < 0) return { target: 0, reason: 'edgeL' }
  if (progress > pageCount - 1) return { target: pageCount - 1, reason: 'edgeR' }

  const start = clampIndex(startPage, pageCount)
  const delta = progress - start
  const peakDelta = peakProgress - start
  const thr = NAV.pagerSnapThreshold
  const retreated = Math.abs(peakDelta) - Math.abs(delta)

  if (retreated >= NAV.pagerReverseCancel && Math.abs(delta) < thr) {
    return {
      target: start,
      reason: `reverse peakΔ=${peakDelta.toFixed(2)} nowΔ=${delta.toFixed(2)} ret=${retreated.toFixed(2)}`,
    }
  }

  const flingOk = moveAgeMs <= NAV.pagerFlingStaleMs
    && gestureMs >= NAV.pagerFlingMinMs
    && Math.abs(delta) >= NAV.pagerFlingMinDelta
  const fling = NAV.pagerFlingPagesPerMs
  if (flingOk && velocity >= fling && delta > 0) {
    return { target: clampIndex(start + 1, pageCount), reason: `fling+ v=${velocity.toFixed(5)} Δ=${delta.toFixed(2)}` }
  }
  if (flingOk && velocity <= -fling && delta < 0) {
    return { target: clampIndex(start - 1, pageCount), reason: `fling- v=${velocity.toFixed(5)} Δ=${delta.toFixed(2)}` }
  }

  if (delta >= thr) {
    return { target: clampIndex(start + 1, pageCount), reason: `dist+ Δ=${delta.toFixed(2)}≥${thr}` }
  }
  if (delta <= -thr) {
    return { target: clampIndex(start - 1, pageCount), reason: `dist- Δ=${delta.toFixed(2)}≤-${thr}` }
  }
  return { target: start, reason: `stay Δ=${delta.toFixed(2)}<${thr}` }
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

  const pointerId = useRef<number | null>(null)
  const dragging = useRef(false)
  const axisLocked = useRef<'none' | 'h' | 'v'>('none')
  const startX = useRef(0)
  const startY = useRef(0)
  const startProgress = useRef(0)
  const startPage = useRef(0)
  const peakProgress = useRef(0)
  const lastX = useRef(0)
  const lastY = useRef(0)
  const lastT = useRef(0)
  const gestureStartT = useRef(0)
  const velocity = useRef(0)
  const windowListening = useRef(false)
  const lastMoveLogT = useRef(0)
  const hitNoSwipe = useRef(false)

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
      addLog(`[pager] commit ${PRIMARY_PAGES[indexRef.current]}→${PRIMARY_PAGES[i]}`)
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
      if (w <= 0) {
        addLog(`[pager] measure w=0 (page=${PRIMARY_PAGES[indexRef.current]})`)
        return
      }
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
    addLog(`[pager] prop→anim idx=${index} from=${progressRef.current.toFixed(2)}`)
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
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
    }

    const settleHorizontal = () => {
      const now = performance.now()
      const moveAge = now - lastT.current
      const gestureMs = now - gestureStartT.current
      const { target, reason } = snapTarget(
        progressRef.current,
        velocity.current,
        pageCount,
        startPage.current,
        peakProgress.current,
        moveAge,
        gestureMs,
      )
      addLog(
        `[pager] up axis=h page=${PRIMARY_PAGES[startPage.current]} `
        + `p=${progressRef.current.toFixed(3)} peak=${peakProgress.current.toFixed(3)} `
        + `v=${velocity.current.toFixed(5)} age=${moveAge.toFixed(0)} gest=${gestureMs.toFixed(0)} `
        + `→${PRIMARY_PAGES[target] ?? target} (${reason}) `
        + `noSwipe=${hitNoSwipe.current}`,
      )
      const delta = Math.abs(target - progressRef.current)
      const dur = delta < 0.15
        ? NAV.pagerSnapMs
        : navTapDurationMs(Math.max(delta, 0.5))
      commitIndex(target)
      animateTo(target, dur, NAV.pagerSnapEase)
    }

    /** Paint + velocity from a client point (pointer or touch). */
    const applyHDrag = (clientX: number, clientY: number, timeStamp: number) => {
      const w = widthRef.current
      if (w <= 0) return
      const dx = clientX - startX.current
      const dt = timeStamp - lastT.current
      if (dt > 0) {
        velocity.current = (-(clientX - lastX.current) / w) / dt
      }
      lastX.current = clientX
      lastY.current = clientY
      lastT.current = timeStamp

      const raw = startProgress.current - dx / w
      const p = rubberBandPage(raw, pageCount)
      if (Math.abs(p - startPage.current) >= Math.abs(peakProgress.current - startPage.current)) {
        peakProgress.current = p
      }
      paint(p, true)

      const now = performance.now()
      if (now - lastMoveLogT.current > 120) {
        lastMoveLogT.current = now
        addLog(
          `[pager] drag p=${p.toFixed(3)} peak=${peakProgress.current.toFixed(3)} `
          + `dx=${dx.toFixed(0)}`,
        )
      }
    }

    /**
     * Lock axis with ViewPager2 cone (ties / mild diagonal → H).
     * Returns true if gesture was abandoned (V).
     */
    const lockAxis = (adx: number, ady: number, via: string, tgt?: EventTarget | null): boolean => {
      if (axisLocked.current !== 'none') return false
      const axis = resolvePagerAxis(adx, ady)
      if (axis === 'none') return false
      if (axis === 'v') {
        axisLocked.current = 'v'
        addLog(
          `[pager] axis=V via=${via} adx=${adx.toFixed(0)} ady=${ady.toFixed(0)} `
          + `tgt=${describeTarget(tgt ?? null)} → abandon`,
        )
        dragging.current = false
        pointerId.current = null
        detachWindow()
        writeNavProgress(progressHost(), progressRef.current, false)
        return true
      }
      axisLocked.current = 'h'
      addLog(
        `[pager] axis=H via=${via} adx=${adx.toFixed(0)} ady=${ady.toFixed(0)} `
        + `noSwipe=${hitNoSwipe.current} tgt=${describeTarget(tgt ?? null)}`,
      )
      return false
    }

    const endPointer = (id: number, why: string) => {
      if (pointerId.current !== id) {
        addLog(`[pager] end ignore id=${id} active=${pointerId.current} why=${why}`)
        return
      }
      let wasH = axisLocked.current === 'h'
      // pointercancel often fires before lock on scrollable pages — recover H intent.
      const moved = Math.abs(progressRef.current - startProgress.current)
      const adx = Math.abs(lastX.current - startX.current)
      const ady = Math.abs(lastY.current - startY.current)
      if (!wasH && axisLocked.current === 'none') {
        if (moved >= 0.02 || resolvePagerAxis(adx, ady) === 'h') {
          wasH = true
          addLog(
            `[pager] ${why}: promote none→H moved=${moved.toFixed(3)} `
            + `adx=${adx.toFixed(0)} ady=${ady.toFixed(0)}`,
          )
        }
      }
      const wasAxis = axisLocked.current
      pointerId.current = null
      dragging.current = false
      axisLocked.current = 'none'
      detachWindow()
      if (wasH) settleHorizontal()
      else {
        addLog(`[pager] up axis=${wasAxis} why=${why} (no snap)`)
        writeNavProgress(progressHost(), progressRef.current, false)
      }
    }

    function onWindowMove(e: PointerEvent) {
      if (pointerId.current !== e.pointerId || !dragging.current) return
      if (widthRef.current <= 0) {
        addLog('[pager] move skip w=0')
        return
      }

      const dx = e.clientX - startX.current
      const dy = e.clientY - startY.current
      const adx = Math.abs(dx)
      const ady = Math.abs(dy)

      if (axisLocked.current === 'none') {
        if (lockAxis(adx, ady, 'pointer', e.target)) return
      }
      if (axisLocked.current !== 'h') return

      e.preventDefault()
      applyHDrag(e.clientX, e.clientY, e.timeStamp)
    }

    function onWindowUp(e: PointerEvent) {
      endPointer(e.pointerId, e.type)
    }

    /**
     * Touch is primary on Android WebView: pointercancel often kills PointerEvents
     * while TouchEvents still flow. Drive lock + paint from touchmove; preventDefault
     * once H so nested vertical scroll cannot steal the gesture.
     */
    const onTouchMove = (e: TouchEvent) => {
      if (!dragging.current || pointerId.current === null) return
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      // Always track last point so pointercancel promote has real adx/ady.
      lastX.current = t.clientX
      lastY.current = t.clientY
      const adx = Math.abs(t.clientX - startX.current)
      const ady = Math.abs(t.clientY - startY.current)

      if (axisLocked.current === 'none') {
        if (lockAxis(adx, ady, 'touch', e.target)) return
      }
      if (axisLocked.current !== 'h') return

      e.preventDefault()
      applyHDrag(t.clientX, t.clientY, e.timeStamp || performance.now())
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (pointerId.current === null || !dragging.current) return
      // Finger left — settle even if pointercancel already ate pointerup.
      if (e.type === 'touchcancel' || e.touches.length === 0) {
        endPointer(pointerId.current, e.type)
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (pointerId.current !== null) {
        addLog(`[pager] down ignore (busy id=${pointerId.current})`)
        return
      }

      const noSwipeEl = e.target instanceof Element
        ? e.target.closest('[data-no-page-swipe]')
        : null
      hitNoSwipe.current = !!noSwipeEl
      if (noSwipeEl) {
        addLog(`[pager] down on no-swipe zone tgt=${describeTarget(e.target)}`)
      }

      cancelAnim()
      pointerId.current = e.pointerId
      dragging.current = true
      axisLocked.current = 'none'
      startX.current = e.clientX
      startY.current = e.clientY
      startProgress.current = progressRef.current
      startPage.current = clampIndex(Math.round(progressRef.current), pageCount)
      peakProgress.current = progressRef.current
      lastX.current = e.clientX
      lastY.current = e.clientY
      lastT.current = e.timeStamp
      gestureStartT.current = performance.now()
      velocity.current = 0
      lastMoveLogT.current = 0

      addLog(
        `[pager] down id=${e.pointerId} type=${e.pointerType} `
        + `page=${PRIMARY_PAGES[startPage.current]} p=${progressRef.current.toFixed(3)} `
        + `w=${widthRef.current} tgt=${describeTarget(e.target)}`,
      )

      if (!windowListening.current) {
        windowListening.current = true
        window.addEventListener('pointermove', onWindowMove, { passive: false })
        window.addEventListener('pointerup', onWindowUp)
        window.addEventListener('pointercancel', onWindowUp)
        window.addEventListener('touchend', onTouchEnd)
        window.addEventListener('touchcancel', onTouchEnd)
      }
    }

    vp.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
    vp.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
    addLog(`[pager] listeners ready pages=${pageCount} idx=${indexRef.current}`)
    paint(indexRef.current, false)

    return () => {
      vp.removeEventListener('pointerdown', onPointerDown, true)
      vp.removeEventListener('touchmove', onTouchMove, true)
      detachWindow()
      cancelAnim()
    }
  }, [pageCount, progressHostRef])

  return (
    <div
      ref={viewportRef}
      className="flex-1 min-h-0 overflow-hidden"
      data-page-pager
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
