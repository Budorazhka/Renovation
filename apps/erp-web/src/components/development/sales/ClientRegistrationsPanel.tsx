import { useCallback, useEffect, useMemo, useState } from 'react'
import { User } from 'lucide-react'

import type { IProject } from '@/types/core'
import {
  clientRegistrationsApi,
  type IncomingClientRegistration,
} from '@/services/clientRegistrationsApi'
import { useI18n } from '@/i18n'

/**
 * Входящие фиксации клиентов: агентства заявляют своих покупателей по ЖК
 * застройщика, застройщик подтверждает или отклоняет. Подтверждение
 * закрепляет клиента за агентством на шесть месяцев (решение владельца
 * 16.09.2026).
 *
 * Раньше панель читала коллекцию `development-sales-clients` старой CRM
 * (CRM_API_BASE_URL) и заводила регистрации сама: на новой платформе этого
 * сервиса нет, а фиксация по своей природе двусторонняя — заводит её
 * агентство, а не застройщик.
 */
export type ClientReservationStatus = 'active' | 'expired'

// Скрываем последние 3 цифры
function maskPhone(phone: string): string {
  if (phone.length <= 3) return phone
  return phone.slice(0, -3) + '***'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

const inputCls =
  'h-9 w-full rounded-[4px] border border-[rgba(242,207,141,0.22)] bg-[rgba(0,0,0,0.28)] px-3 text-[15px] text-[#fcecc8] outline-none transition-colors focus:border-[rgba(242,207,141,0.5)] placeholder:text-[rgba(242,207,141,0.3)]'

export function ClientRegistrationsPanel({ project, readOnly }: { project: IProject; readOnly: boolean }) {
  const { t } = useI18n()
  const [rows, setRows] = useState<IncomingClientRegistration[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      setRows(await clientRegistrationsApi.listIncoming())
      setStatus('ready')
      setError(null)
    } catch {
      setRows([])
      setStatus('error')
      setError(t('salesManagement.registrations.errors.loadFailed', 'Не удалось загрузить регистрации'))
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  /** Заявки именно по открытому ЖК: панель живёт внутри экрана проекта. */
  const visible = useMemo(
    () => rows.filter((row) => row.developmentId === project._id),
    [project._id, rows],
  )

  const decide = useCallback(
    async (row: IncomingClientRegistration, action: () => Promise<IncomingClientRegistration | { id: string }>) => {
      setBusyId(row.id)
      setError(null)
      try {
        await action()
        await load()
        setRejectingId(null)
        setReason('')
      } catch (err) {
        const code = (err as { response?: { status?: number } }).response?.status
        setError(
          code === 409
            ? t('salesManagement.registrations.errors.conflict', 'Заявку изменили в другом месте, список обновлён')
            : code === 400
              ? t('salesManagement.registrations.errors.alreadyDecided', 'По заявке уже принято решение')
              : t('salesManagement.registrations.errors.saveFailed', 'Не удалось сохранить решение'),
        )
        await load()
      } finally {
        setBusyId(null)
      }
    },
    [load, t],
  )

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[15px] text-[rgba(242,207,141,0.6)]">
        {t(
          'salesManagement.registrations.incomingHint',
          'Заявки агентств по этому комплексу. Подтверждение закрепляет клиента за агентством на шесть месяцев.',
        )}
      </p>

      {error && <p className="text-[16px] text-[#ffb4ab]">{error}</p>}

      <div className="rounded-[8px] border border-[rgba(242,207,141,0.15)] bg-[rgba(0,0,0,0.2)]">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="text-[16px] font-normal uppercase tracking-wide text-[rgba(242,207,141,0.45)] bg-[rgba(255,255,255,0.02)]">
              <th className="px-4 py-3 font-normal">{t('salesManagement.registrations.columns.client', 'Клиент')}</th>
              <th className="px-4 py-3 font-normal">{t('salesManagement.registrations.columns.phone', 'Телефон')}</th>
              <th className="px-4 py-3 font-normal">{t('salesManagement.registrations.columns.date', 'Дата')}</th>
              <th className="px-4 py-3 font-normal">{t('salesManagement.registrations.columns.reservedUntil', 'Резерв до')}</th>
              <th className="px-4 py-3 font-normal">{t('salesManagement.registrations.columns.decision', 'Решение')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={row.id}
                className="border-b border-[rgba(242,207,141,0.07)] last:border-0 hover:bg-[rgba(255,255,255,0.015)] transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <User size={13} className="text-[rgba(242,207,141,0.4)] shrink-0" />
                    <span className="text-[15px] text-[#fcecc8]">{row.clientName}</span>
                  </div>
                  {row.unitLabel && (
                    <div className="mt-0.5 text-[13px] text-[rgba(242,207,141,0.5)]">{row.unitLabel}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-[15px] text-[rgba(242,207,141,0.72)] whitespace-nowrap">
                  {maskPhone(row.clientPhone)}
                </td>
                <td className="px-4 py-3 text-[15px] text-[rgba(242,207,141,0.72)] whitespace-nowrap">
                  {formatDate(row.createdAt)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {row.reservedUntil ? (
                    <>
                      <div className="text-[16px] text-[#fcecc8]">{formatDate(row.reservedUntil)}</div>
                      <div className={row.isExpired ? 'mt-0.5 text-[16px] text-[#ffb4ab]' : 'mt-0.5 text-[16px] text-[#d0e8df]'}>
                        {row.isExpired
                          ? t('salesManagement.registrations.reservationStatus.expired', 'Истёк')
                          : t('salesManagement.registrations.reservationStatus.active', 'Активен')}
                      </div>
                    </>
                  ) : (
                    <span className="text-[16px] text-[rgba(242,207,141,0.5)]">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {row.status === 'pending' ? (
                    readOnly ? (
                      <span className="text-[15px] text-[rgba(242,207,141,0.55)]">
                        {t('salesManagement.registrations.statuses.pending', 'Ждёт решения')}
                      </span>
                    ) : rejectingId === row.id ? (
                      <div className="flex flex-col gap-2">
                        <input
                          type="text"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder={t('salesManagement.registrations.rejectReason', 'Причина отказа')}
                          className={inputCls}
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busyId === row.id || reason.trim().length < 3}
                            onClick={() => void decide(row, () => clientRegistrationsApi.reject(row.id, row.version, reason.trim()))}
                            className="rounded-[4px] bg-[#c9a84c] px-3 py-1.5 text-[15px] font-medium text-[#0a1f12] disabled:opacity-60"
                          >
                            {t('salesManagement.registrations.reject', 'Отклонить')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectingId(null)
                              setReason('')
                            }}
                            className="px-2 py-1.5 text-[15px] text-[rgba(242,207,141,0.6)] hover:text-[#fcecc8]"
                          >
                            {t('common.cancel', 'Отмена')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => void decide(row, () => clientRegistrationsApi.accept(row.id, row.version))}
                          className="rounded-[4px] bg-[#c9a84c] px-3 py-1.5 text-[15px] font-medium text-[#0a1f12] disabled:opacity-60"
                        >
                          {t('salesManagement.registrations.accept', 'Подтвердить')}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => setRejectingId(row.id)}
                          className="px-2 py-1.5 text-[15px] text-[rgba(242,207,141,0.6)] hover:text-[#fcecc8]"
                        >
                          {t('salesManagement.registrations.reject', 'Отклонить')}
                        </button>
                      </div>
                    )
                  ) : (
                    <div>
                      <div className="text-[15px] text-[#fcecc8]">
                        {t(`salesManagement.registrations.statuses.${row.status}`, row.status)}
                      </div>
                      {row.decisionNote && (
                        <div className="mt-0.5 text-[13px] text-[rgba(242,207,141,0.5)]">{row.decisionNote}</div>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-[16px] text-[rgba(242,207,141,0.4)]">
                  {status === 'loading'
                    ? t('common.loading', 'Загрузка…')
                    : t('salesManagement.registrations.empty', 'Регистраций пока нет')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
