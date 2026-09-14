import { useState, type FormEvent } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { leadsApiV2, OLD_BASE_TAG, type LeadImportResultV2 } from '@/services/leadsApiV2'
import { useI18n } from '@/i18n'

const MAX_SHOWN_ERRORS = 10

/** Загрузка старой базы контактов: каждая строка таблицы становится лидом с меткой OLD_BASE_TAG. */
export function LeadsImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => void
}) {
  const { t } = useI18n()
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<LeadImportResultV2 | null>(null)
  const [error, setError] = useState<string | null>(null)

  function close(next: boolean) {
    if (submitting) return
    if (!next) {
      setFile(null)
      setResult(null)
      setError(null)
    }
    onOpenChange(next)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || submitting) return
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const imported = await leadsApiV2.importLeads(file, { tag: OLD_BASE_TAG })
      setResult(imported)
      if (imported.created > 0) onImported()
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } }
      setError(e.response?.data?.message || t('crmPoker.importFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-[520px] rounded-md border-0 bg-[var(--green-card)] p-6 text-[color:var(--app-text)] shadow-[inset_0_0_0_1px_rgba(201,168,76,0.14)]">
        <DialogHeader>
          <DialogTitle className="text-[20px] font-medium text-[color:var(--app-text)]">{t('crmPoker.importTitle')}</DialogTitle>
          <DialogDescription className="text-[16px] font-normal text-[color:var(--app-text-muted)]">
            {t('crmPoker.importHint')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-2 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[16px] font-medium text-[color:var(--app-text-muted)]">{t('crmPoker.importChooseFile')}</span>
            <input
              type="file"
              accept=".xlsx,.csv"
              disabled={submitting}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setResult(null)
                setError(null)
              }}
              className="text-[16px] text-[color:var(--app-text)] file:mr-3 file:rounded-sm file:border-0 file:bg-[color-mix(in_srgb,var(--gold)_20%,transparent)] file:px-3 file:py-1.5 file:text-[16px] file:font-normal file:text-[color:var(--app-text)]"
            />
          </label>

          {result ? (
            <div className="flex flex-col gap-1 rounded-sm bg-[rgba(3,29,22,0.5)] px-3 py-2.5 text-[16px]">
              <p className="text-[color:var(--app-text)]">
                {t('crmPoker.importResult', { created: result.created, failed: result.failed })}
              </p>
              {result.errors.slice(0, MAX_SHOWN_ERRORS).map((rowError) => (
                <p key={rowError.row} className="text-[color:var(--app-text-muted)]">
                  {t('crmPoker.importRowError', { row: rowError.row, message: rowError.message })}
                </p>
              ))}
            </div>
          ) : null}

          {error ? <p className="text-[16px] text-[color:var(--error,#ffb4ab)]">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => close(false)}
              disabled={submitting}
              className="inline-flex min-h-10 items-center rounded-sm px-4 text-[16px] font-normal text-[color:var(--app-text-muted)] hover:text-[color:var(--app-text)] disabled:opacity-50"
            >
              {t('crmPoker.importClose')}
            </button>
            <button
              type="submit"
              disabled={!file || submitting}
              className="inline-flex min-h-10 items-center rounded-sm bg-[var(--gold)] px-4 text-[16px] font-medium text-[color:var(--gold-btn-text)] hover:bg-[color:var(--gold-light)] disabled:opacity-50"
            >
              {submitting ? t('crmPoker.importing') : t('crmPoker.importSubmit')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
