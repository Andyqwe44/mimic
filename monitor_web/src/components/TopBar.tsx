// ═══ TopBar (MXU-style tab bar) ───
import { FileText, Monitor, Settings } from 'lucide-react'
import { ActionBtn, ThemeBtn } from './Toolkit'
import { addLog } from '../lib/bridge'
import { Play, Square } from 'lucide-react'

export function TopBar({
  tab,
  setTab,
  running,
  onStart,
  onStop,
  dark,
  onToggleTheme,
}: {
  tab: string
  setTab: (t: 'Monitor' | 'Log' | 'Settings') => void
  running: boolean
  onStart: () => void
  onStop: () => void
  dark: boolean
  onToggleTheme: () => void
}) {
  const tabs = [
    { id: 'Monitor' as const, icon: <Monitor className="w-3.5 h-3.5" />, label: 'Monitor' },
    { id: 'Log' as const, icon: <FileText className="w-3.5 h-3.5" />, label: 'Log' },
    {
      id: 'Settings' as const,
      icon: <Settings className="w-3.5 h-3.5" />,
      label: 'Settings',
    },
  ]
  return (
    <div className="flex items-center h-10 bg-bg-secondary border-b border-border select-none shrink-0">
      <div className="flex-1 flex items-center h-full overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id)
              addLog(`[Tab] ${t.label}`)
            }}
            className={`group flex items-center gap-1.5 h-full px-3 cursor-pointer border-r border-border border-b-[3px] min-w-[100px] transition-colors
              ${t.id === tab ? 'bg-bg-primary text-accent border-b-accent' : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover border-b-transparent'}`}
          >
            {t.icon}
            <span className="text-sm font-medium">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 px-2">
        {running ? (
          <ActionBtn
            icon={<Square className="w-3.5 h-3.5" />}
            label="Stop"
            title="停止所有运行中的任务"
            variant="danger"
            onClick={() => {
              onStop()
              addLog('[Action] Stop')
            }}
          />
        ) : (
          <ActionBtn
            icon={<Play className="w-3.5 h-3.5" />}
            label="Start"
            title="启动agent任务"
            variant="primary"
            onClick={() => {
              onStart()
              addLog('[Action] Start')
            }}
          />
        )}
        <div className="mx-1 h-4 w-px bg-border" />
        <ThemeBtn dark={dark} onToggle={onToggleTheme} />
      </div>
    </div>
  )
}
