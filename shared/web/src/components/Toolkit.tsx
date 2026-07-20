// ═══ Tooltip, ActionBtn, ThemeBtn — reusable UI kit ═══
import { useState, useRef, useLayoutEffect, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Moon, Sun } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BTN_SIZE_CLASS, btnAutoSize, H, NAV, RADIUS, TEXT } from '../lib/design'
import { isAndroidHost } from '../lib/platform'

const TIP_GAP = 6
const TIP_MARGIN = 4
const PAD_TIP = 'px-2 py-1'

type TipPlacement = 'top' | 'bottom'

/**
 * Tooltip positioning (铁律 4):
 * 1. Prefer above the anchor.
 * 2. If anchor is near the window top (not enough room above) → below.
 * 3. Prefer horizontally centered on the anchor; clamp so the tip stays fully
 *    inside the viewport (right/left edges), without drifting away needlessly.
 * Uses real measured tip size — never estimate from string length (EN tips are
 * longer than ZH and the old estimate pulled them far left).
 *
 * Trigger:
 * - PC / hover: mouseenter delay → show; mouseleave → hide
 * - Android: long-press → show; tip stays while finger is down (even if moved
 *   aside to uncover text). Only real finger-up (touchend) dismisses.
 *   Ignore pointercancel after show — WebView cancels pointer on move/scroll.
 */
export function Tooltip({
  text,
  children,
  className,
}: {
  text: string
  children: React.ReactElement
  className?: string
}) {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0, placement: 'top' as TipPlacement })
  const [ready, setReady] = useState(false)
  const timer = useRef<number>(0)
  const anchorRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const longPress = useRef(false)
  const holding = useRef(false)
  const android = isAndroidHost()

  const hide = () => {
    clearTimeout(timer.current)
    timer.current = 0
    longPress.current = false
    holding.current = false
    setShow(false)
    setReady(false)
  }

  const placeTip = () => {
    const anchorEl = anchorRef.current
    const tipEl = tipRef.current
    if (!anchorEl || !tipEl) return

    const a = anchorEl.getBoundingClientRect()
    const tipW = tipEl.offsetWidth
    const tipH = tipEl.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight

    // ── Vertical: prefer above; flip below when top-clamped ──
    let placement: TipPlacement = 'top'
    let top = a.top - TIP_GAP - tipH
    if (a.top < tipH + TIP_GAP + TIP_MARGIN) {
      placement = 'bottom'
      top = a.bottom + TIP_GAP
    }
    // Keep fully inside viewport vertically
    if (top + tipH > vh - TIP_MARGIN) top = Math.max(TIP_MARGIN, vh - tipH - TIP_MARGIN)
    if (top < TIP_MARGIN) {
      if (a.bottom + TIP_GAP + tipH <= vh - TIP_MARGIN) {
        placement = 'bottom'
        top = a.bottom + TIP_GAP
      } else {
        top = TIP_MARGIN
      }
    }

    // ── Horizontal: center on anchor, clamp into viewport ──
    let left = a.left + a.width / 2 - tipW / 2
    if (left + tipW > vw - TIP_MARGIN) left = vw - tipW - TIP_MARGIN
    if (left < TIP_MARGIN) left = TIP_MARGIN

    setPos({ left, top, placement })
    setReady(true)
  }

  useLayoutEffect(() => {
    if (!show) {
      setReady(false)
      return
    }
    placeTip()
    const onResize = () => placeTip()
    window.addEventListener('resize', onResize)
    // Tip is fixed to first place — do NOT re-place on scroll (would feel like chase).
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [show, text])

  useEffect(() => () => clearTimeout(timer.current), [])

  const hoverHandlers = android
    ? {}
    : {
        onMouseEnter: () => {
          timer.current = window.setTimeout(() => setShow(true), NAV.tooltipHoverMs)
        },
        onMouseLeave: () => hide(),
        onMouseMove: () => {
          if (!show) {
            clearTimeout(timer.current)
            timer.current = window.setTimeout(() => setShow(true), NAV.tooltipHoverMs)
          }
        },
      }

  const touchHandlers = android
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          if (e.pointerType === 'mouse') return
          clearTimeout(timer.current)
          longPress.current = false
          holding.current = true
          const id = e.pointerId
          const x0 = e.clientX
          const y0 = e.clientY
          timer.current = window.setTimeout(() => {
            if (!holding.current) return
            longPress.current = true
            setShow(true)
          }, NAV.tooltipLongPressMs)

          const onMove = (ev: PointerEvent) => {
            if (ev.pointerId !== id) return
            // Tip already up — finger may slide aside to uncover text; keep tip.
            if (longPress.current) return
            // Before tip: cancel long-press if this is a scroll/drag.
            if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) {
              clearTimeout(timer.current)
              timer.current = 0
            }
          }

          /** Only real finger-up dismisses. pointercancel is ignored after tip shows. */
          const onPointerUp = (ev: PointerEvent) => {
            if (ev.pointerId !== id) return
            cleanup()
            hide()
          }
          const onPointerCancel = (ev: PointerEvent) => {
            if (ev.pointerId !== id) return
            if (longPress.current) {
              // WebView cancelled the pointer (move/scroll) — tip stays until touchend.
              return
            }
            cleanup()
            hide()
          }
          const onTouchEnd = (ev: TouchEvent) => {
            if (!holding.current) return
            // touchcancel while tip is up: finger may still be down (WebView steal) — keep tip.
            if (ev.type === 'touchcancel' && longPress.current) return
            if (ev.touches.length > 0) return
            cleanup()
            hide()
          }
          const onTouchMove = (ev: TouchEvent) => {
            // Once tip is showing, block scroll/pager from stealing the gesture.
            if (longPress.current) {
              ev.preventDefault()
            }
          }

          const cleanup = () => {
            holding.current = false
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onPointerUp)
            window.removeEventListener('pointercancel', onPointerCancel)
            window.removeEventListener('touchend', onTouchEnd)
            window.removeEventListener('touchcancel', onTouchEnd)
            window.removeEventListener('touchmove', onTouchMove, true)
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onPointerUp)
          window.addEventListener('pointercancel', onPointerCancel)
          window.addEventListener('touchend', onTouchEnd)
          window.addEventListener('touchcancel', onTouchEnd)
          window.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
        },
        onContextMenu: (e: React.MouseEvent) => {
          e.preventDefault()
        },
      }
    : {}

  return (
    <div
      ref={anchorRef}
      className={`relative ${className?.includes('w-full') ? 'flex' : 'inline-flex'} ${className || ''}`}
      {...hoverHandlers}
      {...touchHandlers}
    >
      {children}
      {show &&
        createPortal(
          <div
            ref={tipRef}
            className={`fixed ${PAD_TIP} bg-bg-tertiary text-text-primary ${TEXT.xs} ${RADIUS.md} shadow-lg whitespace-nowrap pointer-events-none z-[9999]`}
            style={{
              left: pos.left,
              top: pos.top,
              opacity: ready ? 1 : 0,
            }}
            data-placement={pos.placement}
          >
            {text}
          </div>,
          document.body,
        )}
    </div>
  )
}

// ── ActionBtn: golden-ratio modular scale (×√φ ≈ 1.272), tokens from design.ts ──
export function ActionBtn({
  icon,
  label,
  title,
  variant,
  size,
  onClick,
  className,
}: {
  icon: ReactNode
  label: string
  title: string
  variant: 'primary' | 'danger' | 'outline' | 'outline-accent'
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'fill'
  onClick?: () => void
  className?: string
}) {
  const w = BTN_SIZE_CLASS[size ?? btnAutoSize(label)]
  return (
    <Tooltip text={title}>
      <button
        onClick={onClick}
        className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 ${H.control} text-xs font-medium whitespace-nowrap transition-all duration-150 ${w} ${className ?? ''} ${
          variant === 'primary'
            ? 'bg-accent text-white hover:bg-accent-hover'
            : variant === 'danger'
              ? 'bg-error-soft-mid text-error hover:bg-error-soft-mid'
              : variant === 'outline-accent'
                ? 'border border-accent text-accent hover:bg-accent-soft'
                : 'border border-border text-text-secondary hover:bg-bg-hover'
        }`}
      >
        {icon}
        <span>{label}</span>
      </button>
    </Tooltip>
  )
}

// ── ThemeBtn ──
export function ThemeBtn({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  return (
    <Tooltip text={dark ? t('theme.switch_light') : t('theme.switch_dark')}>
      <button
        onClick={onToggle}
        className="p-2 rounded-md hover:bg-bg-hover transition-colors"
      >
        {dark ? (
          <Sun className="w-4 h-4 text-text-secondary" />
        ) : (
          <Moon className="w-4 h-4 text-text-secondary" />
        )}
      </button>
    </Tooltip>
  )
}
