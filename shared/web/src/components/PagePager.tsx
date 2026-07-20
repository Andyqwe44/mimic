// Unified animateTo(target) wraps native scrollTo({ behavior:'smooth' }).
// Finger drag = native overflow-x follow; release / nav tap = animateTo only.
// Last animateTo wins — no scroll-snap settle race.
import {
  Children,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react'
import { NAV, resolvePagerAxis } from '../lib/design'
import { PRIMARY_PAGES, pageIndex, type AppPage } from '../lib/pages'
import { addLog } from '../lib/bridge'

type PillLayout = { padL: number; slotW: number; pitch: number; n: number }
type PtrPhase = 'none' | 'pending' | 'dragging'

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

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function clampIndex(i: number, pageCount: number): number {
  if (pageCount <= 0) return 0
  return Math.max(0, Math.min(pageCount - 1, i))
}

/** 1-based axis: 1=Monitor 2=Peers 3=Log 4=Settings. */
function axisX(frac0: number): number {
  return frac0 + 1
}

function fmtX(frac0: number): string {
  const x = axisX(frac0)
  const n = PRIMARY_PAGES.length
  if (n <= 0) return `x=${x.toFixed(2)}`
  const lo = Math.max(0, Math.min(n - 1, Math.floor(frac0 + 1e-6)))
  const hi = Math.max(0, Math.min(n - 1, Math.ceil(frac0 - 1e-6)))
  if (lo === hi || Math.abs(frac0 - lo) < 0.02) {
    return `x=${x.toFixed(2)}(${PRIMARY_PAGES[lo]})`
  }
  return `x=${x.toFixed(2)}(${PRIMARY_PAGES[lo]}→${PRIMARY_PAGES[hi]})`
}

function fmtTarget(idx0: number): string {
  const name = PRIMARY_PAGES[idx0] ?? `?${idx0}`
  return `${axisX(idx0).toFixed(0)}(${name})`
}

function axisLegend(): string {
  return PRIMARY_PAGES.map((p, i) => `${i + 1}=${p}`).join(' ')
}

/** Kill in-flight native smooth / fling at current offset. Snap always stays off. */
function freezeAtCurrent(vp: HTMLElement) {
  const x = vp.scrollLeft
  vp.style.scrollSnapType = 'none'
  try {
    vp.scrollTo({ left: x, behavior: 'instant' as ScrollBehavior })
  } catch {
    vp.scrollLeft = x
  }
}

/**
 * Release target from fractional position + recent velocity (pages / ms).
 * Fling bias uses design.ts thresholds; otherwise nearest / distance threshold.
 */
function resolveReleaseTarget(
  frac: number,
  vel: number,
  pageCount: number,
  startFrac: number,
): number {
  const nearest = clampIndex(Math.round(frac), pageCount)
  const moved = frac - startFrac
  const absVel = Math.abs(vel)
  const flingOk = absVel >= NAV.pagerFlingPagesPerMs
    && Math.abs(moved) >= NAV.pagerFlingMinDelta

  if (flingOk) {
    const dir = vel > 0 ? 1 : -1
    // Fling toward next page in velocity direction from current floor/ceil.
    const base = dir > 0 ? Math.floor(frac + 1e-6) : Math.ceil(frac - 1e-6)
    return clampIndex(base + dir, pageCount)
  }

  if (Math.abs(moved) >= NAV.pagerSnapThreshold) {
    return clampIndex(moved > 0 ? Math.ceil(frac - 1e-6) : Math.floor(frac + 1e-6), pageCount)
  }

  return nearest
}

export function PagePager({
  page,
  navSeq = 0,
  onPageChange,
  progressHostRef,
  children,
}: {
  page: AppPage
  /** Bumped on every bottom/side nav tap (even same page) so retap re-animates. */
  navSeq?: number
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

  const reduceMotion = useRef(prefersReducedMotion())
  const skipPropScroll = useRef(false)

  /** Sole animation owner: target page index while native smooth runs. */
  const animTarget = useRef<number | null>(null)
  const animSeq = useRef(0)
  const holdIdx = useRef<number | null>(null)
  const holdCorrected = useRef(false)

  const watchdog = useRef(0)
  const animRaf = useRef(0)
  const lastProgLogTs = useRef(0)
  const lastProgLogX = useRef(Number.NaN)

  const ptrPhase = useRef<PtrPhase>('none')
  const ptrStartX = useRef(0)
  const ptrStartY = useRef(0)
  const ptrId = useRef<number | null>(null)
  const dragStartFrac = useRef(0)
  /** Velocity samples: { t, frac } during drag for fling resolve. */
  const velSamples = useRef<{ t: number; frac: number }[]>([])

  const progressHost = () => progressHostRef?.current ?? null

  const readFrac = () => {
    const vp = viewportRef.current
    const w = widthRef.current
    if (!vp || w <= 0) return progressRef.current
    return vp.scrollLeft / w
  }

  const logProgress = (why: string, force = false) => {
    const frac = readFrac()
    const x = axisX(frac)
    const now = performance.now()
    const dt = now - lastProgLogTs.current
    const dx = Number.isFinite(lastProgLogX.current) ? Math.abs(x - lastProgLogX.current) : 99
    if (!force && dt < 32 && dx < 0.03) return
    lastProgLogTs.current = now
    lastProgLogX.current = x
    const target = animTarget.current
    const intentStr = target !== null ? ` →${fmtTarget(target)}` : ''
    const mode = ptrPhase.current === 'dragging'
      ? 'finger'
      : animTarget.current !== null
        ? 'anim'
        : holdIdx.current !== null
          ? 'hold'
          : ptrPhase.current === 'pending'
            ? 'pending'
            : 'idle'
    addLog(`[pager] ${fmtX(frac)} ${why} mode=${mode}${intentStr}`)
  }

  const clearWatchdog = () => {
    if (watchdog.current) {
      window.clearTimeout(watchdog.current)
      watchdog.current = 0
    }
  }

  const clearAnimRaf = () => {
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
      const from = indexRef.current
      addLog(
        `[pager] commit ${fmtTarget(from)}→${fmtTarget(i)} at ${fmtX(readFrac())}`,
      )
      onPageChangeRef.current(PRIMARY_PAGES[i])
    }
  }

  /**
   * End animateTo: pin exact slot, commit once. Snap stays off.
   */
  const finishAnim = (reason: string, forSeq: number) => {
    if (forSeq !== animSeq.current) {
      addLog(
        `[pager] finish-skip stale seq=${forSeq} now=${animSeq.current} at ${fmtX(readFrac())}`,
      )
      return
    }
    const vp = viewportRef.current
    const w = widthRef.current
    const target = animTarget.current
    clearWatchdog()
    clearAnimRaf()
    if (target === null || !vp || w <= 0) {
      animTarget.current = null
      return
    }
    const exact = target * w
    const before = vp.scrollLeft / w
    const dist = Math.abs(vp.scrollLeft - exact)
    freezeAtCurrent(vp)
    try {
      vp.scrollTo({ left: exact, behavior: 'instant' as ScrollBehavior })
    } catch {
      vp.scrollLeft = exact
    }
    syncPill(exact, false)
    animTarget.current = null
    holdIdx.current = target
    holdCorrected.current = false
    addLog(
      `[pager] anim-done →${fmtTarget(target)} (${reason}) `
      + `from ${fmtX(before)} distPx=${dist.toFixed(1)}`,
    )
    logProgress('landed', true)
    commitIndex(target)
  }

  const finishAnimRef = useRef(finishAnim)
  finishAnimRef.current = finishAnim

  /**
   * Single entry: retarget native smooth from current fractional x.
   * Last call wins (new seq invalidates previous watchdog / finish).
   */
  const animateTo = (targetIdx: number, why: string) => {
    const vp = viewportRef.current
    const w = widthRef.current
    if (!vp || w <= 0) return

    const target = clampIndex(targetIdx, pageCount)
    const targetLeft = target * w
    const from = vp.scrollLeft
    const frac = from / w

    // Already animating to same slot — keep native smooth running.
    if (animTarget.current === target && Math.abs(from - targetLeft) > 1) {
      addLog(`[pager] adopt-anim ${fmtX(frac)} keep→${fmtTarget(target)} why=${why}`)
      return
    }

    // Already parked on slot.
    if (Math.abs(from - targetLeft) < 1 && animTarget.current === null) {
      holdIdx.current = target
      holdCorrected.current = false
      syncPill(targetLeft, false)
      commitIndex(target)
      addLog(`[pager] noop-on-slot ${fmtX(frac)} already ${fmtTarget(target)} why=${why}`)
      return
    }

    clearWatchdog()
    clearAnimRaf()
    holdIdx.current = null
    holdCorrected.current = false

    // Freeze kills previous native smooth / residual fling at current x.
    freezeAtCurrent(vp)
    const frac2 = vp.scrollLeft / w

    animSeq.current += 1
    const mySeq = animSeq.current
    animTarget.current = target

    if (reduceMotion.current || Math.abs(vp.scrollLeft - targetLeft) < 1) {
      try {
        vp.scrollTo({ left: targetLeft, behavior: 'instant' as ScrollBehavior })
      } catch {
        vp.scrollLeft = targetLeft
      }
      syncPill(targetLeft, false)
      finishAnimRef.current('instant', mySeq)
      return
    }

    addLog(
      `[pager] animateTo ${fmtX(frac2)}→${fmtTarget(target)} `
      + `Δ=${Math.abs(axisX(target) - axisX(frac2)).toFixed(2)} `
      + `seq=${mySeq} why=${why}`,
    )
    logProgress('anim-start', true)

    // One frame after freeze so compositor registers cancel before smooth.
    animRaf.current = requestAnimationFrame(() => {
      animRaf.current = 0
      if (animTarget.current !== target || animSeq.current !== mySeq) return
      const vp2 = viewportRef.current
      if (!vp2) return
      freezeAtCurrent(vp2)
      vp2.scrollTo({ left: targetLeft, behavior: 'smooth' })
    })

    watchdog.current = window.setTimeout(() => {
      watchdog.current = 0
      if (animTarget.current !== target || animSeq.current !== mySeq) return
      const dist = Math.abs(vp.scrollLeft - targetLeft)
      finishAnimRef.current(dist <= 3 ? 'watchdog-near' : 'watchdog-force', mySeq)
    }, NAV.tapSmoothWatchdogMs)
  }

  const animateToRef = useRef(animateTo)
  animateToRef.current = animateTo

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
      if (prevW > 0 && Math.abs(prevW - w) > 0.5) {
        const i = holdIdx.current ?? animTarget.current ?? indexRef.current
        vp.scrollLeft = i * w
      }
      syncPill(vp.scrollLeft, false)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(vp)
    return () => ro.disconnect()
  }, [progressHostRef])

  useLayoutEffect(() => {
    if (skipPropScroll.current) {
      skipPropScroll.current = false
      return
    }
    const vp = viewportRef.current
    const w = widthRef.current
    if (!vp || w <= 0) return
    const targetLeft = index * w
    if (
      Math.abs(vp.scrollLeft - targetLeft) < 1
      && animTarget.current === null
      && holdIdx.current === index
    ) {
      syncPill(targetLeft, false)
      return
    }
    if (Math.abs(vp.scrollLeft - targetLeft) < 1 && animTarget.current === null) {
      syncPill(targetLeft, false)
      holdIdx.current = index
      holdCorrected.current = false
      return
    }
    addLog(`[pager] prop→anim →${fmtTarget(index)} at ${fmtX(vp.scrollLeft / w)} seq=${navSeq}`)
    animateToRef.current(index, `prop/navSeq=${navSeq}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, navSeq])

  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return

    const sampleVel = () => {
      const w = widthRef.current
      if (w <= 0) return
      const frac = vp.scrollLeft / w
      const t = performance.now()
      const s = velSamples.current
      s.push({ t, frac })
      if (s.length > 6) s.shift()
    }

    const readVel = (): number => {
      const s = velSamples.current
      if (s.length < 2) return 0
      const a = s[0]
      const b = s[s.length - 1]
      const dt = b.t - a.t
      if (dt < 8 || dt > NAV.pagerFlingStaleMs * 3) return 0
      return (b.frac - a.frac) / dt
    }

    const onScroll = () => {
      const w = widthRef.current
      const dragging = ptrPhase.current === 'dragging'
      const moving = dragging || animTarget.current !== null
      syncPill(vp.scrollLeft, moving)

      if (dragging) sampleVel()
      if (moving) logProgress('tick')

      // One-shot hold pin if compositor drifts.
      if (
        !dragging
        && ptrPhase.current === 'none'
        && holdIdx.current !== null
        && !holdCorrected.current
        && animTarget.current === null
        && w > 0
      ) {
        const exact = holdIdx.current * w
        if (Math.abs(vp.scrollLeft - exact) > 2) {
          const held = holdIdx.current
          holdCorrected.current = true
          freezeAtCurrent(vp)
          try {
            vp.scrollTo({ left: exact, behavior: 'instant' as ScrollBehavior })
          } catch {
            vp.scrollLeft = exact
          }
          syncPill(exact, false)
          addLog(`[pager] hold-correct →${fmtTarget(held)} at ${fmtX(exact / w)}`)
          return
        }
      }

      if (dragging || ptrPhase.current === 'pending') return

      // animateTo near-complete → finish.
      const target = animTarget.current
      if (target !== null && w > 0) {
        if (Math.abs(vp.scrollLeft - target * w) <= 2) {
          finishAnimRef.current('near', animSeq.current)
        }
      }
    }

    const onScrollEnd = () => {
      logProgress('scrollend', true)
      if (ptrPhase.current === 'dragging' || ptrPhase.current === 'pending') return
      if (animTarget.current !== null) {
        finishAnimRef.current('scrollend', animSeq.current)
      }
    }

    const beginDrag = () => {
      if (ptrPhase.current === 'dragging') return
      ptrPhase.current = 'dragging'
      holdIdx.current = null
      holdCorrected.current = false
      velSamples.current = []

      const frac = readFrac()
      dragStartFrac.current = frac

      // Grab: cancel animateTo at current fractional x, then native follow.
      if (animTarget.current !== null) {
        clearWatchdog()
        clearAnimRaf()
        const was = animTarget.current
        animTarget.current = null
        freezeAtCurrent(vp)
        addLog(`[pager] drag-grab ${fmtX(frac)} was→${fmtTarget(was)}`)
      } else {
        freezeAtCurrent(vp)
        addLog(`[pager] drag-start ${fmtX(frac)}`)
      }
      logProgress('finger', true)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (ptrPhase.current !== 'none') return
      ptrPhase.current = 'pending'
      ptrStartX.current = e.clientX
      ptrStartY.current = e.clientY
      ptrId.current = e.pointerId
      // Do not cancel anim yet — short tap must not interrupt (U2/tap-ignore).
      addLog(
        `[pager] pointer↓ pending ${fmtX(readFrac())}`
        + (animTarget.current !== null ? ` anim→${fmtTarget(animTarget.current)}` : ''),
      )
      logProgress('pointer-down', true)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (ptrPhase.current !== 'pending') return
      if (ptrId.current !== null && e.pointerId !== ptrId.current) return
      const adx = Math.abs(e.clientX - ptrStartX.current)
      const ady = Math.abs(e.clientY - ptrStartY.current)
      const axis = resolvePagerAxis(adx, ady)
      if (axis === 'none') return
      if (axis === 'v') {
        ptrPhase.current = 'none'
        ptrId.current = null
        addLog(`[pager] tap-ignore axis=v ${fmtX(readFrac())}`)
        return
      }
      beginDrag()
    }

    const endPointer = (e: PointerEvent, reason: 'up' | 'cancel') => {
      if (ptrId.current !== null && e.pointerId !== ptrId.current) return
      const phase = ptrPhase.current
      ptrPhase.current = 'none'
      ptrId.current = null
      const frac = readFrac()

      if (phase === 'pending') {
        addLog(`[pager] tap-ignore ${fmtX(frac)} reason=${reason}`)
        logProgress('tap-ignore', true)
        return
      }

      if (phase !== 'dragging') return

      // Kill native coast, then sole owner animateTo(target).
      const vel = readVel()
      freezeAtCurrent(vp)
      const frac2 = readFrac()
      const target = resolveReleaseTarget(frac2, vel, pageCount, dragStartFrac.current)
      addLog(
        `[pager] finger↑ ${fmtX(frac2)} vel=${vel.toFixed(4)} →${fmtTarget(target)}`,
      )
      logProgress('finger-up', true)
      animateToRef.current(target, 'finger↑')
    }

    const onPointerUp = (e: PointerEvent) => endPointer(e, 'up')
    const onPointerCancel = (e: PointerEvent) => endPointer(e, 'cancel')

    vp.addEventListener('scroll', onScroll, { passive: true })
    vp.addEventListener('scrollend', onScrollEnd as EventListener)
    vp.addEventListener('pointerdown', onPointerDown, { passive: true })
    vp.addEventListener('pointermove', onPointerMove, { passive: true })
    vp.addEventListener('pointerup', onPointerUp, { passive: true })
    vp.addEventListener('pointercancel', onPointerCancel, { passive: true })
    addLog(`[pager] ready axis ${axisLegend()} animateTo=native-smooth`)
    addLog(`[pager] ready at ${fmtX(indexRef.current)} pages=${pageCount}`)
    if (widthRef.current > 0) {
      vp.style.scrollSnapType = 'none'
      vp.scrollLeft = indexRef.current * widthRef.current
      syncPill(vp.scrollLeft, false)
      holdIdx.current = indexRef.current
      holdCorrected.current = false
    }

    return () => {
      vp.removeEventListener('scroll', onScroll)
      vp.removeEventListener('scrollend', onScrollEnd as EventListener)
      vp.removeEventListener('pointerdown', onPointerDown)
      vp.removeEventListener('pointermove', onPointerMove)
      vp.removeEventListener('pointerup', onPointerUp)
      vp.removeEventListener('pointercancel', onPointerCancel)
      clearWatchdog()
      clearAnimRaf()
      animTarget.current = null
    }
  }, [pageCount, progressHostRef])

  return (
    <div
      ref={viewportRef}
      className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden"
      data-page-pager
      style={{
        // Snap never owns settle — animateTo(native smooth) is the only settler.
        scrollSnapType: 'none',
        WebkitOverflowScrolling: 'touch',
        overscrollBehaviorX: 'contain',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        touchAction: 'pan-x pan-y',
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
              // Keep align hints for a11y; snap-type stays none so they never settle.
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
