// AppShell — unified responsive chrome: side or bottom PrimaryNav + page column.
import { useRef, type ReactNode, type RefObject } from 'react'
import { PrimaryNav } from './PrimaryNav'
import { PageHeader } from './PageHeader'
import { pageIndex, type AppPage } from '../lib/pages'
import type { ShellMode } from '../hooks/useViewport'

export function AppShell({
  page,
  setPage,
  shellMode,
  navExpanded,
  onToggleNavExpand,
  pageTitle,
  device,
  connected,
  streaming,
  controlling,
  sessionError,
  compactCapsule,
  short,
  onCapsule,
  appVersion,
  headerTrailing,
  statusBar,
  shellRef: shellRefOut,
  children,
}: {
  page: AppPage
  setPage: (p: AppPage) => void
  shellMode: ShellMode
  navExpanded?: boolean
  onToggleNavExpand?: () => void
  pageTitle: string
  device: string
  connected: boolean
  streaming: boolean
  controlling: boolean
  sessionError?: boolean
  compactCapsule?: boolean
  short?: boolean
  onCapsule: () => void
  appVersion?: string
  headerTrailing?: ReactNode
  statusBar?: ReactNode
  /** Optional external ref for CSS nav-progress vars (PagePager writes here). */
  shellRef?: RefObject<HTMLDivElement | null>
  children: ReactNode
}) {
  const bottom = shellMode === 'bottom'
  const localRef = useRef<HTMLDivElement>(null)
  const progressHostRef = shellRefOut ?? localRef

  return (
    <div
      ref={progressHostRef}
      className={`h-full flex bg-bg-primary ${bottom ? 'flex-col' : 'flex-row'}
        ${bottom
          ? 'pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)]'
          : ''}`}
      style={bottom ? {
        // Initial pill position before PagePager mounts
        ['--nav-fraction' as string]: String(pageIndex(page)),
      } : undefined}
    >
      {!bottom && (
        <PrimaryNav
          page={page}
          setPage={setPage}
          mode="side"
          expanded={navExpanded}
          onToggleExpand={onToggleNavExpand}
          appVersion={appVersion}
        />
      )}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <PageHeader
          page={page}
          title={pageTitle}
          device={device}
          connected={connected}
          streaming={streaming}
          controlling={controlling}
          error={sessionError}
          compact={compactCapsule}
          short={short}
          onCapsule={onCapsule}
          trailing={headerTrailing}
        />
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden">{children}</main>
        {statusBar}
        {bottom && (
          <PrimaryNav
            page={page}
            setPage={setPage}
            mode="bottom"
            appVersion={appVersion}
            progressHostRef={progressHostRef}
          />
        )}
      </div>
    </div>
  )
}
