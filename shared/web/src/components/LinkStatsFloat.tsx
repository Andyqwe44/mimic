// Floating link/decode stats — sits beside the preview, never covers video pixels.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, GripHorizontal } from 'lucide-react'
import { TEXT, RADIUS, RING } from '../lib/design'

type Stats = {
  active?: boolean
  dims?: string
  fps?: number
  status?: string
  latHint?: string
  encodeHint?: string
  rtt?: number | null
  transport?: string
}

function parseLatHint(hint: string) {
  // tx=lan gap≈48ms jitter≈38ms q=0 rtt=31
  const gap = /gap≈(\d+)ms/.exec(hint)?.[1]
  const jitter = /jitter≈(\d+)ms/.exec(hint)?.[1]
  const q = /q=(\d+)/.exec(hint)?.[1]
  const drop = /dropDelta=(\d+)/.exec(hint)?.[1]
  return { gap, jitter, q, drop }
}

export function LinkStatsFloat({ visible }: { visible: boolean }) {
  const { t } = useTranslation()
  const [st, setSt] = useState<Stats | null>(null)
  const [pos, setPos] = useState({ x: 12, y: 72 })
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null)

  useEffect(() => {
    const onStats = (ev: Event) => {
      const d = (ev as CustomEvent<Stats>).detail
      if (!d) return
      if (d.active === false) {
        setSt(null)
        return
      }
      setSt(d)
    }
    window.addEventListener('peer-decode-stats', onStats)
    return () => window.removeEventListener('peer-decode-stats', onStats)
  }, [])

  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => {
      setPos({
        x: Math.max(4, Math.min(window.innerWidth - 160, e.clientX - drag.dx)),
        y: Math.max(4, Math.min(window.innerHeight - 80, e.clientY - drag.dy)),
      })
    }
    const onUp = () => setDrag(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag])

  if (!visible || !st) return null

  const parsed = parseLatHint(st.latHint || '')
  const rtt = st.rtt != null ? `${Math.round(st.rtt)}` : '—'
  const tx = st.transport && st.transport !== 'none' ? st.transport : '—'

  return (
    <div
      className={`fixed z-[60] ${RADIUS.lg} bg-bg-secondary ${RING} shadow-lg w-[148px] select-none`}
      style={{ left: pos.x, top: pos.y }}
      data-no-page-swipe
    >
      <div
        className="flex items-center gap-1 px-2 h-7 border-b border-border cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => {
          e.preventDefault()
          setDrag({ dx: e.clientX - pos.x, dy: e.clientY - pos.y })
        }}
      >
        <Activity className="w-3.5 h-3.5 text-accent shrink-0" />
        <span className={`${TEXT.tiny} font-medium text-text-secondary truncate`}>
          {t('peer.link_stats_title')}
        </span>
        <GripHorizontal className="w-3.5 h-3.5 text-text-muted ml-auto shrink-0" />
      </div>
      <div className={`px-2 py-1.5 space-y-0.5 ${TEXT.tiny} tabular-nums text-text-secondary`}>
        <div className="flex justify-between gap-2">
          <span className="text-text-muted">{t('peer.link_rtt')}</span>
          <span>{rtt} ms</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-text-muted">{t('peer.link_gap')}</span>
          <span>{parsed.gap != null ? `${parsed.gap} ms` : '—'}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-text-muted">{t('peer.link_jitter')}</span>
          <span>{parsed.jitter != null ? `${parsed.jitter} ms` : '—'}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-text-muted">FPS</span>
          <span>{st.fps ?? 0}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-text-muted">{t('peer.link_tx')}</span>
          <span className="truncate">{tx}</span>
        </div>
        {st.encodeHint ? (
          <div className="text-amber-500 truncate pt-0.5">{st.encodeHint}</div>
        ) : null}
      </div>
    </div>
  )
}
