import clsx from 'clsx'

interface StatusIndicatorProps {
  status: 'active' | 'warning' | 'error' | 'inactive'
  label?: string
  pulse?: boolean
  className?: string
}

const statusColors = {
  active: 'bg-hud-success',
  warning: 'bg-hud-warning',
  error: 'bg-hud-error',
  inactive: 'bg-hud-dim',
}

const statusGlow = {
  active: 'shadow-[0_0_6px_rgba(114,241,184,0.6),0_0_12px_rgba(114,241,184,0.25)]',
  warning: 'shadow-[0_0_6px_rgba(254,222,93,0.6),0_0_12px_rgba(254,222,93,0.25)]',
  error: 'shadow-[0_0_6px_rgba(254,68,80,0.6),0_0_12px_rgba(254,68,80,0.25)]',
  inactive: '',
}

export function StatusIndicator({
  status,
  label,
  pulse = false,
  className,
}: StatusIndicatorProps) {
  return (
    <div className={clsx('flex items-center gap-2', className)}>
      <div className="relative">
        <div
          className={clsx(
            'w-2 h-2 rounded-full',
            statusColors[status],
            statusGlow[status]
          )}
        />
        {pulse && status === 'active' && (
          <div
            className={clsx(
              'absolute inset-0 w-2 h-2 rounded-full animate-ping',
              statusColors[status],
              'opacity-75'
            )}
          />
        )}
      </div>
      {label && <span className="hud-label">{label}</span>}
    </div>
  )
}

interface StatusBarProps {
  items: Array<{
    label: string
    value: string | number
    status?: 'active' | 'warning' | 'error' | 'inactive'
  }>
  className?: string
}

export function StatusBar({
  items,
  className,
}: StatusBarProps) {
  return (
    <div className={clsx('flex items-center gap-6', className)}>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          {item.status && (
            <div
              className={clsx('w-1.5 h-1.5 rounded-full', statusColors[item.status])}
            />
          )}
          <span className="hud-label">{item.label}</span>
          <span className="hud-value-sm">{item.value}</span>
        </div>
      ))}
    </div>
  )
}
