// Peer remote view — WebCodecs H.264 decode + UU virtual mouse + soft keyboard.
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Expand, Keyboard, Minimize2 } from 'lucide-react'
import { hostCall, addLog } from '../lib/bridge'
import { Tooltip } from './Toolkit'
import { VirtualMouseOverlay } from './VirtualMouseOverlay'
import { SoftKeyboardOverlay } from './SoftKeyboardOverlay'
import { TEXT } from '../lib/design'

function annexbHasIdr(u8: Uint8Array) {
  for (let i = 0; i + 4 < u8.length; i++) {
    if (u8[i] === 0 && u8[i + 1] === 0 && u8[i + 2] === 0 && u8[i + 3] === 1) {
      if ((u8[i + 4] & 0x1f) === 5) return true
      i += 3
    } else if (u8[i] === 0 && u8[i + 1] === 0 && u8[i + 2] === 1) {
      if ((u8[i + 3] & 0x1f) === 5) return true
      i += 2
    }
  }
  return false
}

type PeerH264Detail = {
  w?: number
  h?: number
  flags?: number
  bytes: Uint8Array
}

export function PeerRemoteView({
  active,
  humanControl,
  fill = false,
  encodeHint,
  compact = false,
}: {
  active: boolean
  humanControl: boolean
  /** Fill parent height (Monitor workspace). */
  fill?: boolean
  /** Optional encoder path hint from controlled side (e.g. SOFTWARE). */
  encodeHint?: string
  /** Smaller 16:9 preview — leave room for target list below. */
  compact?: boolean
}) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const decoderRef = useRef<VideoDecoder | null>(null)
  const needKeyRef = useRef(true)
  const videoSizeRef = useRef({ w: 0, h: 0 })
  const framesRef = useRef(0)
  const lastFpsTsRef = useRef(performance.now())
  const dropCountRef = useRef(0)
  const lastKeyReqRef = useRef(0)
  const recvCountRef = useRef(0)
  const lastDiagTsRef = useRef(0)
  const [fps, setFps] = useState(0)
  const [dims, setDims] = useState('')
  const [status, setStatus] = useState(t('peer.waiting_frames'))
  const [videoAspect, setVideoAspect] = useState(16 / 9)
  const [expanded, setExpanded] = useState(false)
  const [kbOpen, setKbOpen] = useState(false)
  const [portrait, setPortrait] = useState(
    typeof window !== 'undefined' ? window.innerHeight >= window.innerWidth : true,
  )
  const keyRecvRef = useRef(0)
  const deltaDropRef = useRef(0)

  const requestKeyframe = (reason: string) => {
    const now = performance.now()
    if (now - lastKeyReqRef.current < 150) return
    lastKeyReqRef.current = now
    needKeyRef.current = true
    hostCall('peer_request_keyframe').catch(() => {})
    setStatus(t('peer.waiting_keyframe', { reason }))
    addLog(`[Decode] need_key reason=${reason}`)
  }

  const closeDecoder = () => {
    try { decoderRef.current?.close() } catch { /* */ }
    decoderRef.current = null
  }

  const ensureDecoder = (w: number, h: number) => {
    const canvas = canvasRef.current
    if (!canvas || w <= 0 || h <= 0) return
    if (decoderRef.current && videoSizeRef.current.w === w && videoSizeRef.current.h === h) return
    closeDecoder()
    videoSizeRef.current = { w, h }
    canvas.width = w
    canvas.height = h
    setDims(`${w}×${h}`)
    setVideoAspect(w / h)
    needKeyRef.current = true
    addLog(`[Decode] configure ${w}x${h} codec=avc1.42E028`)
    if (typeof VideoDecoder === 'undefined') {
      setStatus(t('peer.webcodecs_unavailable'))
      return
    }
    const ctx = canvas.getContext('2d')
    decoderRef.current = new VideoDecoder({
      output: (frame) => {
        ctx?.drawImage(frame, 0, 0, canvas.width, canvas.height)
        frame.close()
        framesRef.current++
        const now = performance.now()
        if (now - lastFpsTsRef.current >= 1000) {
          setFps(framesRef.current)
          framesRef.current = 0
          lastFpsTsRef.current = now
        }
      },
      error: (e) => {
        requestKeyframe('error')
        setStatus(t('peer.decoder_error', { msg: e.message }))
        addLog(`[Decode] VideoDecoder error: ${e.message}`)
      },
    })
    decoderRef.current.configure({
      codec: 'avc1.42E028',
      optimizeForLatency: true,
      hardwareAcceleration: 'prefer-hardware',
    })
  }

  useEffect(() => {
    if (!active) {
      closeDecoder()
      setStatus(t('peer.idle'))
      setFps(0)
      dropCountRef.current = 0
      recvCountRef.current = 0
      setExpanded(false)
      setKbOpen(false)
      return
    }
    const onFrame = (ev: Event) => {
      const d = (ev as CustomEvent<PeerH264Detail>).detail
      if (!d?.bytes || d.bytes.byteLength < 16) return
      const view = new DataView(d.bytes.buffer, d.bytes.byteOffset, d.bytes.byteLength)
      const w = d.w || view.getUint32(0, true)
      const h = d.h || view.getUint32(4, true)
      const flags = d.flags ?? view.getUint32(8, true)
      const annexb = d.bytes.subarray(16)
      ensureDecoder(w, h)
      const decoder = decoderRef.current
      if (!decoder || decoder.state === 'closed') return
      const key = ((flags & 1) !== 0) || annexbHasIdr(annexb)
      recvCountRef.current++
      if (needKeyRef.current && !key) {
        requestKeyframe('sync')
        deltaDropRef.current++
        return
      }
      // After sync, a lost IDR still leaves deltas undecodable — pull key early.
      if (!key && decoder.decodeQueueSize > 0) {
        dropCountRef.current++
        deltaDropRef.current++
        if (dropCountRef.current >= 2) {
          dropCountRef.current = 0
          requestKeyframe('drop')
        }
        return
      }
      try {
        decoder.decode(new EncodedVideoChunk({
          type: key ? 'key' : 'delta',
          timestamp: performance.now() * 1000,
          data: annexb,
        }))
        if (key) {
          needKeyRef.current = false
          dropCountRef.current = 0
          keyRecvRef.current++
          setStatus(t('peer.live'))
          if (keyRecvRef.current <= 3 || keyRecvRef.current % 30 === 0) {
            addLog(`[Decode] IDR #${keyRecvRef.current} ${w}x${h} bytes=${annexb.byteLength}`)
          }
        }
      } catch (e: unknown) {
        requestKeyframe('decode')
        const msg = e instanceof Error ? e.message : String(e)
        setStatus(t('peer.decode_error', { msg }))
        addLog(`[Decode] decode() throw: ${msg}`)
      }
      const nowDiag = performance.now()
      if (nowDiag - lastDiagTsRef.current >= 1500) {
        lastDiagTsRef.current = nowDiag
        addLog(
          `[Decode] recv=${recvCountRef.current} idr=${keyRecvRef.current} dropDelta=${deltaDropRef.current} fps≈${framesRef.current} needKey=${needKeyRef.current} q=${decoder.decodeQueueSize}`,
        )
        deltaDropRef.current = 0
      }
    }
    window.addEventListener('peer-h264', onFrame)
    return () => {
      window.removeEventListener('peer-h264', onFrame)
      closeDecoder()
    }
  }, [active, t])

  useEffect(() => {
    const onResize = () => setPortrait(window.innerHeight >= window.innerWidth)
    onResize()
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  useEffect(() => {
    if (!expanded) {
      try {
        const o = screen.orientation as ScreenOrientation & { unlock?: () => void }
        o?.unlock?.()
      } catch { /* */ }
      return
    }
    try {
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
      o?.lock?.('landscape')?.catch?.(() => {})
    } catch { /* */ }
    return () => {
      try {
        const o = screen.orientation as ScreenOrientation & { unlock?: () => void }
        o?.unlock?.()
      } catch { /* */ }
    }
  }, [expanded])

  const send = (action: Record<string, unknown>) => {
    if (!humanControl) return
    hostCall('peer_send_control', action).catch(() => {})
  }

  const sendKey = (type: 'keydown' | 'keyup', key: string, code: string) => {
    if (!humanControl) return
    hostCall('peer_send_control', { type, key, code }).catch(() => {})
  }

  if (!active) return null

  const stageInner = (
    <div
      className={`relative bg-black flex items-center justify-center overflow-hidden ${
        expanded
          ? 'flex-1 min-h-0 w-full'
          : compact
            ? 'w-full aspect-video max-h-[28vh] shrink-0'
            : fill
              ? 'flex-1 min-h-0'
              : 'min-h-[160px] max-h-[280px]'
      }`}
      data-no-page-swipe
    >
      <canvas
        ref={canvasRef}
        width={640}
        height={360}
        className="max-w-full max-h-full object-contain pointer-events-none"
        style={{
          aspectRatio: `${videoAspect}`,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
        }}
      />
      {humanControl && (
        <VirtualMouseOverlay
          enabled
          videoAspect={videoAspect}
          onAction={send}
        />
      )}
      {humanControl && (
        <SoftKeyboardOverlay
          open={kbOpen}
          onClose={() => setKbOpen(false)}
          onKey={sendKey}
        />
      )}
    </div>
  )

  const toolbar = (
    <div className="h-7 px-2 flex items-center gap-2 text-[11px] text-text-tertiary border-b border-border shrink-0">
      <span className="font-medium text-text-secondary">{t('peer.remote_view')}</span>
      <span className="tabular-nums">{dims}</span>
      <span className="tabular-nums">{fps} fps</span>
      {encodeHint && (
        <span className="text-amber-500 truncate">{encodeHint}</span>
      )}
      <span className="ml-auto truncate min-w-0">
        {status}{!humanControl ? ` · ${t('peer.ai_mode_short')}` : ''}
      </span>
      {humanControl && (
        <Tooltip text={kbOpen ? t('peer.soft_kb_close') : t('peer.soft_kb_open')}>
          <button
            type="button"
            className={`h-6 w-6 rounded flex items-center justify-center shrink-0 ${
              kbOpen ? 'bg-accent-soft-mid text-accent' : 'hover:bg-bg-hover text-text-secondary'
            }`}
            onClick={() => setKbOpen((v) => !v)}
          >
            <Keyboard className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      )}
      <Tooltip text={expanded ? t('peer.collapse_view') : t('peer.expand_view')}>
        <button
          type="button"
          className="h-6 w-6 rounded flex items-center justify-center shrink-0 hover:bg-bg-hover text-text-secondary"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Expand className="w-3.5 h-3.5" />}
        </button>
      </Tooltip>
    </div>
  )

  if (expanded) {
    // Portrait WebView: CSS-rotate a landscape plane so user can hold phone sideways.
    // Already landscape (after lock/turn): no rotate — fill screen with contain.
    const landscapePlane = portrait
    return (
      <div className="fixed inset-0 z-[80] bg-black overflow-hidden">
        <div
          className="flex flex-col bg-black"
          style={
            landscapePlane
              ? {
                  position: 'absolute',
                  width: '100dvh',
                  height: '100dvw',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%) rotate(90deg)',
                  transformOrigin: 'center center',
                }
              : {
                  position: 'absolute',
                  inset: 0,
                }
          }
        >
          {toolbar}
          {stageInner}
          <div className={`${TEXT.tiny} text-center text-text-muted py-1 shrink-0`}>
            {t('peer.expand_hint')}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`${fill && !compact ? 'flex-1 flex flex-col min-h-0' : 'shrink-0'} rounded-xl bg-bg-secondary ring-1 ring-inset ring-border overflow-hidden`}>
      {toolbar}
      {stageInner}
    </div>
  )
}
