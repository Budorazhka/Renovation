import { useRef, useState } from 'react'
import { Lock, X } from 'lucide-react'

import { platformAuthApi } from '@/services/platformAuthApi'
import { Button } from '@/components/ui/button'
import { useI18n } from "@/i18n";

interface Props {
  onConfirm: () => void
  onCancel: () => void
}

export function PasswordConfirmModal({ onConfirm, onCancel }: Props) {
    const { t } = useI18n();
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [checking, setChecking] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setChecking(true)
    let valid = false
    try {
      valid = await platformAuthApi.verifyPassword(password)
    } catch {
      valid = false
    }
    setChecking(false)
    if (valid) {
      onConfirm()
    } else {
      setError(true)
      setPassword('')
      inputRef.current?.focus()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="w-80 rounded-2xl border border-[rgba(242,207,141,0.2)] bg-[#0e1a12] p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[rgba(201,168,76,0.15)]">
              <Lock size={16} className="text-[#c9a84c]" />
            </div>
            <div>
              <p className="text-sm font-normal text-[#fcecc8]">{t('common.passwordConfirmModal.подтверждение')}</p>
              <p className="text-[11px] text-[rgba(242,207,141,0.5)]">{t('common.passwordConfirmModal.введите_ваш_пароль')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-[rgba(242,207,141,0.4)] transition-colors hover:text-[#fcecc8]"
          >
            <X size={14} />
          </button>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e) }} className="flex flex-col gap-3">
          <input
            ref={inputRef}
            autoFocus
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(false) }}
            placeholder={t('common.passwordConfirmModal.пароль')}
            className={`h-9 rounded-md border px-3 text-sm text-[#fcecc8] placeholder:text-[rgba(242,207,141,0.35)] bg-[rgba(0,0,0,0.3)] outline-none transition-colors focus:border-[rgba(242,207,141,0.5)] ${
              error ? 'border-rose-400/70' : 'border-[rgba(242,207,141,0.2)]'
            }`}
          />
          {error && (
            <p className="text-[11px] text-rose-300">{t('common.passwordConfirmModal.неверный_пароль')}</p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onCancel}
              className="flex-1 border-[rgba(242,207,141,0.3)] bg-transparent text-[#e8dcc4] hover:bg-[rgba(242,207,141,0.1)]"
            >
              {t('common.passwordConfirmModal.отмена')}</Button>
            <Button
              type="submit"
              size="sm"
              disabled={!password || checking}
              className="flex-1 bg-[#c9a84c] text-[#0a1f12] hover:bg-[#e2c97e]"
            >
              {checking ? 'Проверка…' : t('common.passwordConfirmModal.подтвердить')}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
