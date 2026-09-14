import type { LucideIcon } from 'lucide-react'
import { LayoutGrid, LayoutList, PanelsLeftRight } from 'lucide-react'
import type { CrmView } from '@/hooks/useCrmView'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

const OPTIONS: Array<{ value: CrmView; labelKey: string; Icon: LucideIcon }> = [
  { value: 'poker', labelKey: 'crmPoker.table', Icon: LayoutGrid },
  { value: 'list', labelKey: 'crmPoker.list', Icon: LayoutList },
  { value: 'classic', labelKey: 'tabs.classic', Icon: PanelsLeftRight },
]

export function CrmViewSwitcher({ value, onChange }: { value: CrmView; onChange: (next: CrmView) => void }) {
  const { t } = useI18n()
  return (
    <div
      role="radiogroup"
      aria-label={t('shell.crmView')}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-[rgba(3,29,22,0.5)] p-0.5"
    >
      {OPTIONS.map(({ value: option, labelKey, Icon }) => {
        const active = option === value
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option)}
            className={cn(
              'inline-flex min-h-8 items-center gap-1.5 rounded-sm px-3 text-[16px] font-normal transition-colors',
              active
                ? 'bg-[color-mix(in_srgb,var(--gold)_20%,transparent)] text-[color:var(--app-text)]'
                : 'text-[color:var(--app-text-muted)] hover:text-[color:var(--app-text)]',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {t(labelKey)}
          </button>
        )
      })}
    </div>
  )
}
