import { useEffect, useState } from 'react'
import { BP } from '../lib/design'
import { isAndroidHost } from '../lib/platform'

/** Layout chrome: side rail (≥ tablet) or bottom tabs (< tablet). Label density is user-toggled. */
export type ShellMode = 'side' | 'bottom'

export function useViewport() {
  const [width, setWidth] = useState(
    () => (typeof window !== 'undefined' ? window.innerWidth : BP.desktop),
  )
  const [height, setHeight] = useState(
    () => (typeof window !== 'undefined' ? window.innerHeight : 800),
  )

  useEffect(() => {
    const onResize = () => {
      setWidth(window.innerWidth)
      setHeight(window.innerHeight)
    }
    window.addEventListener('resize', onResize)
    onResize()
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Android: always bottom pager — Clash-Royale-style swipe; wide phones ≥600 would
  // otherwise switch to side rail and lose PagePager entirely.
  const shellMode: ShellMode =
    isAndroidHost() || width < BP.tablet ? 'bottom' : 'side'
  const isNarrow = width < BP.narrow
  const isShort = height < BP.short

  return { width, height, shellMode, isNarrow, isShort }
}
