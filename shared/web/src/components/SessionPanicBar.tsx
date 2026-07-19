// Controlled-side session emergency: refuse control (view-only) + hangup.
import { Lock, Unlock, PhoneOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, ActionBtn } from './Toolkit'
import { RADIUS, RING, TEXT } from '../lib/design'

export function SessionPanicBar({
  controlOn,
  onToggleControl,
  onHangup,
}: {
  controlOn: boolean
  onToggleControl: () => void
  onHangup: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className={`${RADIUS.xl} bg-bg-secondary ${RING} p-3 space-y-2 shrink-0`}>
      <div className={`${TEXT.smallMono} font-medium text-text-secondary`}>
        {t('session.panic_title')}
      </div>
      <p className={`${TEXT.xs} text-text-muted leading-relaxed`}>
        {t('session.panic_hint')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Tooltip text={controlOn ? t('session.refuse_control_tip') : t('session.allow_control_tip')}>
          <button
            type="button"
            onClick={onToggleControl}
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium transition-colors ${
              controlOn
                ? 'bg-success-soft text-success ring-1 ring-success-ring'
                : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover'
            }`}
          >
            {controlOn ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            {controlOn ? t('session.refuse_control') : t('session.allow_control')}
          </button>
        </Tooltip>
        <ActionBtn
          icon={<PhoneOff className="w-3.5 h-3.5" />}
          label={t('peer.hangup')}
          title={t('peer.hangup_tip')}
          variant="danger"
          onClick={onHangup}
        />
      </div>
    </div>
  )
}
