// ═══ Tooltip, ActionBtn, ThemeBtn — reusable UI kit ═══
import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Moon, Sun } from 'lucide-react'
import type { ReactNode } from 'react'

// ── Tooltip: 300ms delay, portal to body, smart positioning ──
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
  const [pos, setPos] = useState({ x: 0, y: 0, placement: 'top' as 'top' | 'bottom' })
  const timer = useRef<number>(0)
  const ref = useRef<HTMLDivElement>(null)

  const updatePos = () => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    const tipW = Math.min(text.length * 8 + 20, 300)
    const tipH = 28
    const above = r.top > tipH + 8
    let x = r.left + r.width / 2
    const vw = window.innerWidth
    x = Math.max(tipW / 2 + 4, Math.min(vw - tipW / 2 - 4, x))
    setPos({ x, y: above ? r.top : r.bottom, placement: above ? 'top' : 'bottom' })
  }

  return (
    <div
      ref={ref}
      className={`relative inline-flex ${className || ''}`}
      onMouseEnter={() => {
        updatePos()
        timer.current = window.setTimeout(() => {
          updatePos()
          setShow(true)
        }, 300)
      }}
      onMouseLeave={() => {
        clearTimeout(timer.current)
        setShow(false)
      }}
      onMouseMove={() => {
        if (!show) {
          clearTimeout(timer.current)
          timer.current = window.setTimeout(() => {
            updatePos()
            setShow(true)
          }, 300)
        }
      }}
    >
      {children}
      {show &&
        createPortal(
          <div
            className="fixed px-2 py-1 bg-bg-tertiary text-text-primary text-xs rounded shadow-lg whitespace-nowrap pointer-events-none z-[9999]"
            style={{
              left: pos.x,
              top: pos.placement === 'top' ? pos.y - 6 : pos.y + 6,
              transform:
                pos.placement === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
            }}
          >
            {text}
          </div>,
          document.body,
        )}
    </div>
  )
}

// ── ActionBtn: golden-ratio modular scale (×√φ ≈ 1.272) ──
//   xs: w-16 (64px) — ≤3 chars
//   sm: w-20 (80px) — 4–6 chars (default auto)
//   md: w-[104px]    — 7–9 chars
//   lg: w-[132px]    — 10–14 chars
//   xl: w-[168px]    — 15+ chars
//   Height fixed at h-7 (28px). size auto-detected from label.length when omitted.
const SIZE_CLASS: Record<string, string> = {
  xs: 'w-16',
  sm: 'w-20',
  md: 'w-[104px]',
  lg: 'w-[132px]',
  xl: 'w-[168px]',
}
function autoSize(label: string): string {
  const n = label.length
  if (n <= 3) return 'xs'
  if (n <= 6) return 'sm'
  if (n <= 9) return 'md'
  if (n <= 14) return 'lg'
  return 'xl'
}

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
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  onClick?: () => void
  className?: string
}) {
  const w = SIZE_CLASS[size ?? autoSize(label)]
  return (
    <Tooltip text={title}>
      <button
        onClick={onClick}
        className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 h-7 text-xs font-medium transition-all duration-150 ${w} ${className ?? ''} ${
          variant === 'primary'
            ? 'bg-accent text-white hover:bg-accent-hover'
            : variant === 'danger'
              ? 'bg-error/20 text-error hover:bg-error/30'
              : variant === 'outline-accent'
                ? 'border border-accent text-accent hover:bg-accent/10'
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
  return (
    <Tooltip text={dark ? '切换亮色主题' : '切换暗色主题'}>
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
