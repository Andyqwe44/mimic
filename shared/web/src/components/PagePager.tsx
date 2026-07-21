// Native overflow-x (6 slots: blank|4 content|blank) · nav/settle = scrollTo(smooth).
// Pill minimap: same axis x∈[0,5], pillTranslateX = x * pitch. No velocity continuity (N0).
//
// Android WebView: H-lock often fires pointercancel while native pan continues.
// Do NOT settle on cancel immediately — wait for scroll idle, then B1 settle.
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

/** Debug pager gestures + axis x into Log panel. Keep true while tuning. */
const PAGER_DEBUG = true
function pagerLog(msg: string) {
  if (PAGER_DEBUG) addLog(msg)
}

const BLANK_SLOTS = 2
const CONTENT_COUNT = PRIMARY_PAGES.length
const SLOT_COUNT = CONTENT_COUNT + BLANK_SLOTS
const X_MIN = 1
const X_MAX = CONTENT_COUNT
const SNAP_EPS = NAV.pagerSnapThreshold
/** Treat as "on a page slot" for origin / short-tap. */
const ON_SLOT_EPS = 0.05
/** After pointercancel / finger-up, wait for native scroll to go quiet. */
const SCROLL_IDLE_MS = 140

type PillLayout = { padL: number; slotW: number; pitch: number; n: number }
type PtrPhase = 'none' | 'pending' | 'dragging'

let pillEl: HTMLElement | null = null
let pillHost: HTMLElement | null = null
let pillLayout: PillLayout | null = null
let pillDragging = false

export function invalidateNavPillLayout() {
  pillLayout = null
}

function measurePillLayout(pill: HTMLElement): PillLayout {
  const track = pill.parentElement
  const nContent = CONTENT_COUNT
  if (!track || nContent <= 0) return { padL: 0, slotW: 0, pitch: 0, n: SLOT_COUNT }
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const gapPx = NAV.bottomGapRem * rem
  const cs = getComputedStyle(track)
  const padL = parseFloat(cs.paddingLeft) || 0
  const padR = parseFloat(cs.paddingRight) || 0
  const innerW = Math.max(0, track.clientWidth - padL - padR)
  const slotW = (innerW - (nContent - 1) * gapPx) / nContent
  const pitch = slotW + gapPx
  pill.style.left = `${padL - pitch}px`
  pill.style.width = `${slotW}px`
  return { padL, slotW, pitch, n: SLOT_COUNT }
}

export function writeNavProgress(
  host: HTMLElement | null,
  axisX: number,
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

  if (!pillLayout || pillLayout.n !== SLOT_COUNT) {
    pillLayout = measurePillLayout(pill)
  }
  pill.style.transform = `translate3d(${axisX * pillLayout.pitch}px,0,0)`
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function pageToAxis(page: AppPage): number {
  return pageIndex(page) + X_MIN
}

function axisToPage(slot: number): AppPage {
  const i = clamp(Math.round(slot) - X_MIN, 0, CONTENT_COUNT - 1)
  return PRIMARY_PAGES[i]
}

function fmtX(x: number): string {
  const lo = clamp(Math.floor(x + 1e-6), 0, SLOT_COUNT - 1)
  const hi = clamp(Math.ceil(x - 1e-6), 0, SLOT_COUNT - 1)
  const name = (s: number) => {
    if (s < X_MIN || s > X_MAX) return 'blank'
    return PRIMARY_PAGES[s - X_MIN] ?? '?'
  }
  if (lo === hi || Math.abs(x - lo) < 0.02) {
    return `x=${x.toFixed(2)}(${name(lo)})`
  }
  return `x=${x.toFixed(2)}(${name(lo)}→${name(hi)})`
}

function fmtTarget(axis: number): string {
  return `${axis}(${axisToPage(axis)})`
}

function isOnContentSlot(x: number): boolean {
  if (x < X_MIN - ON_SLOT_EPS || x > X_MAX + ON_SLOT_EPS) return false
  const r = Math.round(x)
  if (r < X_MIN || r > X_MAX) return false
  return Math.abs(x - r) <= ON_SLOT_EPS
}

/**
 * B1 hybrid settle target.
 * - Bounce blanks → nearest content edge.
 * - interrupted / null origin / not near origin slot → round(x).
 * - From integer content origin: dead-zone ±SNAP_EPS else step+round.
 */
function pickSettleTarget(
  x: number,
  originX: number | null,
  interruptedEase: boolean,
): number {
  if (x < X_MIN) return X_MIN
  if (x > X_MAX) return X_MAX

  if (interruptedEase || originX === null) {
    return clamp(Math.round(x), X_MIN, X_MAX)
  }

  const origin = clamp(Math.round(originX), X_MIN, X_MAX)
  if (Math.abs(originX - origin) > ON_SLOT_EPS) {
    return clamp(Math.round(x), X_MIN, X_MAX)
  }

  const delta = x - origin
  if (delta > SNAP_EPS) {
    return clamp(Math.max(origin + 1, Math.round(x)), X_MIN, X_MAX)
  }
  if (delta < -SNAP_EPS) {
    return clamp(Math.min(origin - 1, Math.round(x)), X_MIN, X_MAX)
  }
  return origin
}

/** Capture B1 origin from current x + hold (ignore stale hold after drift). */
function resolveDragOrigin(
  x: number,
  hold: number | null,
  interruptedEase: boolean,
): number | null {
  if (interruptedEase) return null
  if (hold !== null && Math.abs(x - hold) <= ON_SLOT_EPS) {
    return clamp(hold, X_MIN, X_MAX)
  }
  if (isOnContentSlot(x)) return clamp(Math.round(x), X_MIN, X_MAX)
  return null
}

function cancelScrollAtCurrent(vp: HTMLElement) {
  const left = vp.scrollLeft
  try {
    vp.scrollTo({ left, behavior: 'instant' as ScrollBehavior })
  } catch {
    vp.scrollLeft = left
  }
}

export function PagePager({
  page,
  navSeq = 0,
  onPageChange,
  progressHostRef,
  children,
}: {
  page: AppPage
  navSeq?: number
  onPageChange: (p: AppPage) => void
  progressHostRef?: RefObject<HTMLElement | null>
  children: ReactNode
}) {
  const panels = Children.toArray(children).slice(0, CONTENT_COUNT)
  const targetAxis = clamp(pageToAxis(page), X_MIN, X_MAX)

  const viewportRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef(0)
  const progressRef = useRef(targetAxis)
  const pageRef = useRef(page)
  pageRef.current = page
  const onPageChangeRef = useRef(onPageChange)
  onPageChangeRef.current = onPageChange

  const skipPropScroll = useRef(false)

  const actionSeq = useRef(0)
  const navActionSeq = useRef(-1)
  const navIntent = useRef<number | null>(null)
  const programmatic = useRef(false)
  const holdAxis = useRef<number | null>(targetAxis)

  const dragOriginX = useRef<number | null>(null)
  /** Origin snapped at pointerdown (before cancel/drift). */
  const ptrOriginX = useRef<number | null>(null)
  const interruptedEase = useRef(false)

  /**
   * Native pan still moving after pointercancel/up — settle when scroll goes idle.
   */
  const awaitingScrollIdle = useRef(false)

  const settleTimer = useRef(0)
  const watchdog = useRef(0)
  const navRaf = useRef(0)
  const lastProgLogTs = useRef(0)
  const lastProgLogX = useRef(Number.NaN)

  const ptrPhase = useRef<PtrPhase>('none')
  const ptrStartX = useRef(0)
  const ptrStartY = useRef(0)
  const ptrId = useRef<number | null>(null)
  const fingerDragging = useRef(false)

  const progressHost = () => progressHostRef?.current ?? null

  const readX = () => {
    const vp = viewportRef.current
    const w = widthRef.current
    if (!vp || w <= 0) return progressRef.current
    return vp.scrollLeft / w
  }

  const logProgress = (why: string, force = false) => {
    const x = readX()
    const now = performance.now()
    const dt = now - lastProgLogTs.current
    const dx = Number.isFinite(lastProgLogX.current) ? Math.abs(x - lastProgLogX.current) : 99
    const minDt = PAGER_DEBUG ? 48 : 32
    const minDx = PAGER_DEBUG ? 0.02 : 0.03
    if (!force && dt < minDt && dx < minDx) return
    lastProgLogTs.current = now
    lastProgLogX.current = x
    const intent = navIntent.current
    const intentStr = intent !== null ? ` intent→${fmtTarget(intent)}` : ''
    const mode = awaitingScrollIdle.current
      ? 'await-idle'
      : fingerDragging.current
        ? 'finger'
        : programmatic.current || intent !== null
          ? 'nav-smooth'
          : ptrPhase.current === 'pending'
            ? 'pending'
            : 'idle'
    pagerLog(`[pager] x=${x.toFixed(3)} ${fmtX(x)} | ${why} | mode=${mode}${intentStr}`)
  }

  const clearSettleTimer = () => {
    if (settleTimer.current) {
      window.clearTimeout(settleTimer.current)
      settleTimer.current = 0
    }
  }

  const clearWatchdog = () => {
    if (watchdog.current) {
      window.clearTimeout(watchdog.current)
      watchdog.current = 0
    }
  }

  const clearNavRaf = () => {
    if (navRaf.current) {
      cancelAnimationFrame(navRaf.current)
      navRaf.current = 0
    }
  }

  const syncPill = (scrollLeft: number, dragging: boolean) => {
    const w = widthRef.current
    if (w <= 0) return
    const x = scrollLeft / w
    progressRef.current = x
    writeNavProgress(progressHost(), x, dragging)
  }

  const commitAxis = (axis: number) => {
    const a = clamp(Math.round(axis), X_MIN, X_MAX)
    const next = axisToPage(a)
    if (next !== pageRef.current) {
      skipPropScroll.current = true
      pagerLog(`[pager] commit →${fmtTarget(a)} at ${fmtX(readX())}`)
      onPageChangeRef.current(next)
    }
  }

  const finishNavScroll = (reason: string, forSeq: number) => {
    if (forSeq !== actionSeq.current) {
      pagerLog(
        `[pager] finish-skip stale seq=${forSeq} now=${actionSeq.current} at ${fmtX(readX())}`,
      )
      return
    }
    const vp = viewportRef.current
    const w = widthRef.current
    const target = navIntent.current
    clearWatchdog()
    clearSettleTimer()
    clearNavRaf()
    programmatic.current = false
    awaitingScrollIdle.current = false
    if (target === null || !vp || w <= 0) {
      navIntent.current = null
      return
    }
    const exact = target * w
    const before = vp.scrollLeft / w
    try {
      vp.scrollTo({ left: exact, behavior: 'instant' as ScrollBehavior })
    } catch {
      vp.scrollLeft = exact
    }
    syncPill(exact, false)
    navIntent.current = null
    holdAxis.current = target
    interruptedEase.current = false
    dragOriginX.current = null
    ptrOriginX.current = null
    pagerLog(
      `[pager] intent-done →${fmtTarget(target)} (${reason}) from ${fmtX(before)}`,
    )
    logProgress('landed', true)
  }

  const finishNavScrollRef = useRef(finishNavScroll)
  finishNavScrollRef.current = finishNavScroll

  const nativeScrollTo = (targetAxisSlot: number) => {
    const vp = viewportRef.current
    const w = widthRef.current
    if (!vp || w <= 0) return

    const target = clamp(Math.round(targetAxisSlot), X_MIN, X_MAX)
    const targetLeft = target * w
    const from = vp.scrollLeft
    const x = from / w

    awaitingScrollIdle.current = false
    clearSettleTimer()

    if (Math.abs(from - targetLeft) < 1) {
      clearWatchdog()
      clearNavRaf()
      navIntent.current = null
      programmatic.current = false
      holdAxis.current = target
      interruptedEase.current = false
      syncPill(targetLeft, false)
      commitAxis(target)
      pagerLog(`[pager] noop-on-slot ${fmtX(x)} already ${fmtTarget(target)}`)
      return
    }

    if (navIntent.current === target && programmatic.current) {
      pagerLog(`[pager] adopt-nav ${fmtX(x)} keep→${fmtTarget(target)}`)
      commitAxis(target)
      return
    }

    clearWatchdog()
    clearNavRaf()

    actionSeq.current += 1
    const mySeq = actionSeq.current
    navActionSeq.current = mySeq
    holdAxis.current = null
    fingerDragging.current = false
    interruptedEase.current = false
    dragOriginX.current = null
    ptrOriginX.current = null

    navIntent.current = target
    commitAxis(target)

    programmatic.current = true
    pagerLog(
      `[pager] nav-smooth 从 x=${x.toFixed(3)} →${fmtTarget(target)} `
      + `Δ=${Math.abs(target - x).toFixed(2)} seq=${mySeq}`,
    )
    logProgress('nav-start', true)

    navRaf.current = requestAnimationFrame(() => {
      navRaf.current = 0
      if (navIntent.current !== target || navActionSeq.current !== mySeq) return
      const vp2 = viewportRef.current
      if (!vp2) return
      vp2.scrollTo({ left: targetLeft, behavior: 'smooth' })
    })

    watchdog.current = window.setTimeout(() => {
      watchdog.current = 0
      if (navIntent.current !== target || navActionSeq.current !== mySeq) return
      finishNavScrollRef.current(
        Math.abs(vp.scrollLeft - targetLeft) <= 3 ? 'watchdog-near' : 'watchdog-force',
        mySeq,
      )
    }, NAV.tapSmoothWatchdogMs)
  }

  const nativeScrollToRef = useRef(nativeScrollTo)
  nativeScrollToRef.current = nativeScrollTo

  const freezeEase = (why: string) => {
    const vp = viewportRef.current
    if (!vp) return
    const was = navIntent.current
    if (was === null && !programmatic.current) return
    clearWatchdog()
    clearNavRaf()
    clearSettleTimer()
    awaitingScrollIdle.current = false
    cancelScrollAtCurrent(vp)
    syncPill(vp.scrollLeft, false)
    programmatic.current = false
    navIntent.current = null
    interruptedEase.current = true
    dragOriginX.current = null
    holdAxis.current = null
    pagerLog(
      `[pager] freeze(${why}) x=${readX().toFixed(3)}`
      + (was !== null ? ` was→${fmtTarget(was)}` : ''),
    )
  }

  const settleToPicked = (x: number, why: string) => {
    awaitingScrollIdle.current = false
    clearSettleTimer()
    const origin = dragOriginX.current
    const interrupted = interruptedEase.current
    const target = pickSettleTarget(x, origin, interrupted)
    const rule = interrupted || origin === null
      ? 'round'
      : Math.abs(x - origin) <= SNAP_EPS
        ? `stay(±${SNAP_EPS})`
        : `step+round(±${SNAP_EPS})`
    interruptedEase.current = false
    dragOriginX.current = null
    ptrOriginX.current = null
    pagerLog(
      `[pager] 吸附(${why}) x=${x.toFixed(3)} origin=${origin ?? 'null'} `
      + `interrupted=${interrupted ? 1 : 0} rule=${rule} →${fmtTarget(target)}`,
    )
    nativeScrollToRef.current(target)
  }

  const settleToPickedRef = useRef(settleToPicked)
  settleToPickedRef.current = settleToPicked

  /** Debounce: native pan / momentum finished → B1. */
  const armScrollIdleSettle = (why: string) => {
    awaitingScrollIdle.current = true
    clearSettleTimer()
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = 0
      if (!awaitingScrollIdle.current) return
      if (programmatic.current || navIntent.current !== null) {
        awaitingScrollIdle.current = false
        return
      }
      const x = readX()
      pagerLog(`[pager] 滚动停稳(${why}) x=${x.toFixed(3)} →吸附`)
      settleToPickedRef.current(x, `idle:${why}`)
    }, SCROLL_IDLE_MS)
  }

  useLayoutEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const measure = () => {
      const w = vp.clientWidth
      if (w <= 0) return
      const prevW = widthRef.current
      widthRef.current = w
      invalidateNavPillLayout()
      if (prevW <= 0) {
        const i = holdAxis.current ?? navIntent.current ?? pageToAxis(pageRef.current)
        vp.scrollLeft = i * w
        holdAxis.current = i
      } else if (Math.abs(prevW - w) > 0.5) {
        const i = holdAxis.current ?? navIntent.current ?? pageToAxis(pageRef.current)
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
    const targetLeft = targetAxis * w
    if (
      Math.abs(vp.scrollLeft - targetLeft) < 1
      && navIntent.current === null
      && !programmatic.current
      && holdAxis.current === targetAxis
    ) {
      syncPill(targetLeft, false)
      return
    }
    pagerLog(`[pager] prop→scroll →${fmtTarget(targetAxis)} 当前x=${(vp.scrollLeft / w).toFixed(3)} navSeq=${navSeq}`)
    nativeScrollToRef.current(targetAxis)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetAxis, navSeq])

  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return

    const beginDrag = () => {
      if (ptrPhase.current === 'dragging') return
      ptrPhase.current = 'dragging'
      fingerDragging.current = true
      awaitingScrollIdle.current = false
      clearSettleTimer()

      actionSeq.current += 1

      const x = widthRef.current > 0 ? vp.scrollLeft / widthRef.current : progressRef.current
      const wasNav = navIntent.current !== null || programmatic.current
      if (wasNav) {
        freezeEase('drag-takeover')
      }

      // Prefer origin captured at pointerdown; re-resolve if stale vs current x.
      const fromPtr = ptrOriginX.current
      const origin = resolveDragOrigin(
        x,
        fromPtr ?? holdAxis.current,
        interruptedEase.current,
      )
      dragOriginX.current = origin
      holdAxis.current = null
      pagerLog(
        `[pager] 横滑开始 x=${x.toFixed(3)} seq=${actionSeq.current}`
        + ` origin=${origin ?? 'round'} interrupted=${interruptedEase.current ? 1 : 0}`,
      )
      logProgress('drag-start', true)
    }

    const onScroll = () => {
      const w = widthRef.current
      const moving = fingerDragging.current
        || awaitingScrollIdle.current
        || programmatic.current
        || navIntent.current !== null
      syncPill(vp.scrollLeft, moving)
      if (moving) logProgress('tick')

      // Native pan after cancel: keep resetting idle timer until quiet.
      if (awaitingScrollIdle.current && !programmatic.current && navIntent.current === null) {
        armScrollIdleSettle('scroll')
        return
      }

      // Idle drift (no gesture): force snap if off-slot / blank.
      if (
        !fingerDragging.current
        && ptrPhase.current === 'none'
        && !awaitingScrollIdle.current
        && !programmatic.current
        && navIntent.current === null
        && w > 0
      ) {
        const x = vp.scrollLeft / w
        const hold = holdAxis.current
        const drifted = hold === null
          || Math.abs(x - hold) > ON_SLOT_EPS
          || x < X_MIN - ON_SLOT_EPS
          || x > X_MAX + ON_SLOT_EPS
        if (drifted) {
          dragOriginX.current = null
          interruptedEase.current = true
          pagerLog(`[pager] 检测到漂移 x=${x.toFixed(3)} hold=${hold ?? 'null'} →等停稳`)
          armScrollIdleSettle('drift')
        }
        return
      }

      if (fingerDragging.current || ptrPhase.current === 'pending') return

      if (navIntent.current !== null || programmatic.current) {
        const target = navIntent.current
        const mySeq = navActionSeq.current
        if (w > 0 && target !== null && Math.abs(vp.scrollLeft - target * w) <= 2) {
          finishNavScrollRef.current('near', mySeq)
        }
      }
    }

    const onScrollEnd = () => {
      logProgress('scrollend', true)
      if (awaitingScrollIdle.current && !programmatic.current && navIntent.current === null) {
        armScrollIdleSettle('scrollend')
        return
      }
      if (fingerDragging.current || ptrPhase.current === 'pending') return
      if (navIntent.current !== null || programmatic.current) {
        finishNavScrollRef.current('scrollend', navActionSeq.current)
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      if (ptrPhase.current !== 'none') return
      // New touch cancels pending idle-settle from prior cancel (will re-evaluate).
      if (awaitingScrollIdle.current) {
        clearSettleTimer()
        awaitingScrollIdle.current = false
        pagerLog(`[pager] 按下取消待吸附 x=${readX().toFixed(3)}`)
      }

      ptrPhase.current = 'pending'
      ptrStartX.current = e.clientX
      ptrStartY.current = e.clientY
      ptrId.current = e.pointerId
      fingerDragging.current = false

      const x0 = readX()
      const easing = navIntent.current !== null || programmatic.current
      ptrOriginX.current = resolveDragOrigin(x0, holdAxis.current, false)

      pagerLog(
        `[pager] 按下 content `
        + `cx=${e.clientX.toFixed(0)} cy=${e.clientY.toFixed(0)} `
        + `x=${x0.toFixed(3)} easing=${easing ? 1 : 0} `
        + `origin=${ptrOriginX.current ?? 'round'}`
        + (navIntent.current !== null ? ` intent→${fmtTarget(navIntent.current)}` : ''),
      )

      if (easing) {
        freezeEase('pointerdown')
        ptrOriginX.current = null
      }

      logProgress('pointer-down', true)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (ptrPhase.current !== 'pending') return
      if (ptrId.current !== null && e.pointerId !== ptrId.current) return
      const dx = e.clientX - ptrStartX.current
      const dy = e.clientY - ptrStartY.current
      const axis = resolvePagerAxis(Math.abs(dx), Math.abs(dy))
      if (axis === 'none') return
      if (axis === 'v') {
        ptrPhase.current = 'none'
        ptrId.current = null
        pagerLog(
          `[pager] 轴锁定=竖滑(放弃横滑) Δx=${dx.toFixed(0)} Δy=${dy.toFixed(0)} `
          + `x=${readX().toFixed(3)} interrupted=${interruptedEase.current ? 1 : 0}`,
        )
        // Mid-page or freeze: snap; else leave vertical scroll alone if on-slot.
        const x = readX()
        if (interruptedEase.current || !isOnContentSlot(x)) {
          dragOriginX.current = null
          settleToPickedRef.current(x, 'axis-v')
        }
        return
      }
      pagerLog(
        `[pager] 轴锁定=横滑 Δx=${dx.toFixed(0)} Δy=${dy.toFixed(0)} x=${readX().toFixed(3)}`,
      )
      beginDrag()
    }

    const endPointer = (e: PointerEvent, reason: 'up' | 'cancel') => {
      if (ptrId.current !== null && e.pointerId !== ptrId.current) return
      const phase = ptrPhase.current
      ptrPhase.current = 'none'
      ptrId.current = null
      const x = widthRef.current > 0 ? vp.scrollLeft / widthRef.current : progressRef.current
      // cancel often zeros client coords — don't trust Δ for cancel
      const dx = reason === 'cancel' ? NaN : e.clientX - ptrStartX.current

      if (phase === 'pending') {
        fingerDragging.current = false
        pagerLog(
          `[pager] 短触抬起(${reason}) phase=pending `
          + `x=${x.toFixed(3)} interrupted=${interruptedEase.current ? 1 : 0} `
          + `onSlot=${isOnContentSlot(x) ? 1 : 0}`,
        )
        // B2-A freeze, or stranded mid-page / blank → always settle.
        if (interruptedEase.current || !isOnContentSlot(x)) {
          dragOriginX.current = interruptedEase.current ? null : ptrOriginX.current
          if (!isOnContentSlot(x)) {
            dragOriginX.current = null
            interruptedEase.current = true
          }
          settleToPickedRef.current(x, reason === 'cancel' ? 'short-cancel' : 'short-tap')
        } else {
          pagerLog(`[pager] 短触忽略(已在槽上) x=${x.toFixed(3)}`)
        }
        logProgress('tap-end', true)
        return
      }

      if (phase !== 'dragging') return

      fingerDragging.current = false
      if (dragOriginX.current === null && ptrOriginX.current !== null) {
        dragOriginX.current = ptrOriginX.current
      }
      pagerLog(
        `[pager] 手指结束(${reason}) phase=dragging x=${x.toFixed(3)} `
        + `Δx=${Number.isFinite(dx) ? dx.toFixed(0) : 'n/a'} `
        + `→等待原生滚动停稳`,
      )
      logProgress('finger-end', true)
      // Critical: cancel ≠ settle now — native overflow often continues.
      armScrollIdleSettle(reason)
    }

    const onPointerUp = (e: PointerEvent) => endPointer(e, 'up')
    const onPointerCancel = (e: PointerEvent) => endPointer(e, 'cancel')

    vp.addEventListener('scroll', onScroll, { passive: true })
    vp.addEventListener('scrollend', onScrollEnd as EventListener)
    vp.addEventListener('pointerdown', onPointerDown, { passive: true })
    vp.addEventListener('pointermove', onPointerMove, { passive: true })
    vp.addEventListener('pointerup', onPointerUp, { passive: true })
    vp.addEventListener('pointercancel', onPointerCancel, { passive: true })
    pagerLog(
      `[pager] ready 轴0..${SLOT_COUNT - 1} 内容${X_MIN}..${X_MAX} `
      + `当前x=${pageToAxis(pageRef.current)} (${pageRef.current}) `
      + `idleMs=${SCROLL_IDLE_MS}`,
    )

    if (widthRef.current > 0) {
      const ax = pageToAxis(pageRef.current)
      vp.scrollLeft = ax * widthRef.current
      syncPill(vp.scrollLeft, false)
      holdAxis.current = ax
    }

    return () => {
      vp.removeEventListener('scroll', onScroll)
      vp.removeEventListener('scrollend', onScrollEnd as EventListener)
      vp.removeEventListener('pointerdown', onPointerDown)
      vp.removeEventListener('pointermove', onPointerMove)
      vp.removeEventListener('pointerup', onPointerUp)
      vp.removeEventListener('pointercancel', onPointerCancel)
      clearSettleTimer()
      clearWatchdog()
      clearNavRaf()
      programmatic.current = false
      navIntent.current = null
      awaitingScrollIdle.current = false
    }
  }, [progressHostRef])

  return (
    <div
      ref={viewportRef}
      className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden"
      data-page-pager
      style={{
        scrollSnapType: 'none',
        WebkitOverflowScrolling: 'touch',
        overscrollBehaviorX: 'contain',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        touchAction: 'pan-x pan-y',
      }}
    >
      <div className="flex h-full w-full">
        <div
          key="blank-l"
          className="h-full shrink-0"
          style={{ flex: '0 0 100%', width: '100%' }}
          aria-hidden
        />
        {panels.map((panel, i) => (
          <div
            key={PRIMARY_PAGES[i] ?? i}
            className="h-full shrink-0 flex flex-col min-h-0 overflow-hidden"
            style={{
              flex: '0 0 100%',
              width: '100%',
            }}
            aria-hidden={pageToAxis(page) !== i + X_MIN}
          >
            {panel}
          </div>
        ))}
        <div
          key="blank-r"
          className="h-full shrink-0"
          style={{ flex: '0 0 100%', width: '100%' }}
          aria-hidden
        />
      </div>
    </div>
  )
}
