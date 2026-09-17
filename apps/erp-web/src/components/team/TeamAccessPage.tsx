import { useCallback, useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { DashboardShell } from '@/components/layout/DashboardShell'
import type { UserRole } from '@/types/auth'
import { ROLE_LABEL } from '@/lib/permissions'
import { useAuth } from '@/context/AuthContext'
import { teamApi } from '@/services/teamApi'
import { positionGrantsApi, type PositionGrant, type PermissionScope } from '@/services/positionGrantsApi'
import { useI18n } from "@/i18n";

const C = {
  gold: 'var(--gold)',
  white: '#ffffff',
  whiteMid: 'rgba(255,255,255,0.7)',
  whiteLow: 'rgba(255,255,255,0.4)',
  border: 'var(--green-border)',
  card: 'var(--green-card)',
}

type AccessPerson = {
  id: string
  name: string
  role: UserRole
  position: string
}

const ROLE_ACCENT: Record<UserRole, string> = {
  owner:            'var(--gold-light)',
  director:         '#7ec8e3',
  rop:              '#fb923c',
  manager:          '#4ade80',
  marketer:         '#f472b6',
  lawyer:           '#22d3ee',
  procurement_head: '#a78bfa',
  administrator:    '#818cf8',
  trainee:          '#a1a1aa',
  finance:          '#bef264',
  developer:        '#facc15',
  hr:               '#fb7185',
  partner:          '#94a3b8',
}

/**
 * Роли, которым backend в default-role-grants.ts реально выдаёт
 * personal_access.grant/read/revoke.position (owner/director/developer,
 * НЕ rop/manager/administrator/marketer). Грубее реального 403 сервера, но
 * убирает лишние клики — 403 всё равно остаётся конечным источником истины.
 */
const EDITABLE_ROLES: UserRole[] = ['owner', 'director', 'developer']

/** Человекочитаемые подписи действий — общие для большинства resource. */
const ACTION_LABELS: Record<string, string> = {
  read: 'Просмотр',
  create: 'Создать',
  update: 'Изменить',
  edit: 'Изменить',
  delete: 'Удалить',
  assign: 'Назначить',
  reassign: 'Переназначить',
  complete: 'Завершить',
  confirm: 'Подтвердить',
  cancel: 'Отменить',
  extend: 'Продлить',
  decide: 'Решение',
  run: 'Запуск',
  respond: 'Ответ',
  'price.update': 'Цена',
  'status.update': 'Статус',
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

/**
 * Дефолтный scope для НОВОГО grant'а этого resource+action. 'organization' —
 * общий дефолт (владелец продукта, брифинг). Исключения — booking.create и
 * booking.confirm: в default-role-grants.ts они ВСЕГДА 'own' у каждой роли
 * без исключения (Booking.manager — Position, которая создала/владеет
 * бронью), 'organization' там не встречается ни разу.
 */
const DEFAULT_SCOPE_OVERRIDES: Record<string, PermissionScope> = {
  'booking.create': 'own',
  'booking.confirm': 'own',
}

function defaultScopeFor(resource: string, action: string): PermissionScope {
  return DEFAULT_SCOPE_OVERRIDES[`${resource}.${action}`] ?? 'organization'
}

type ResourceRow = {
  resource: string
  label: string
  description?: string
  actions: string[]
}

type DisabledRow = {
  label: string
  reason: string
}

type AccessGroup = {
  group: string
  rows: ResourceRow[]
  /** Строки без реального resource.action в этой группе — показываем задизейбленными, не убираем. */
  disabled?: DisabledRow[]
}

const ACCESS_GROUPS: AccessGroup[] = [
  {
    group: 'CRM',
    rows: [
      { resource: 'lead', label: 'Лиды', description: 'Очередь, распределение, контроль', actions: ['read', 'create', 'update', 'delete', 'assign', 'reassign'] },
      { resource: 'deal', label: 'Сделки', description: 'Создание и ведение сделок', actions: ['read', 'create', 'edit'] },
      { resource: 'contact', label: 'Контакты', description: 'Контактные лица клиентов', actions: ['read', 'create', 'update'] },
      { resource: 'task', label: 'Задачи', description: 'Постановка и контроль задач', actions: ['read', 'create', 'edit', 'complete', 'reassign'] },
    ],
  },
  {
    group: 'Брони и регистрации',
    rows: [
      { resource: 'booking', label: 'Брони', description: 'Бронирование юнитов', actions: ['read', 'create', 'confirm', 'cancel', 'extend'] },
      { resource: 'client_registration', label: 'Регистрации клиентов', description: 'Закрепление клиента за агентом у застройщика', actions: ['read', 'create', 'update', 'decide'] },
    ],
  },
  {
    group: 'Объекты',
    rows: [
      { resource: 'listing', label: 'Листинги', description: 'Карточки объявлений', actions: ['read', 'create', 'edit'] },
      { resource: 'property_asset', label: 'Объекты недвижимости', description: 'Карточки объектов', actions: ['read', 'create', 'edit'] },
      { resource: 'development', label: 'ЖК / проекты', description: 'Карточка застройки', actions: ['read', 'edit'] },
      { resource: 'unit', label: 'Юниты', description: 'Цена и статус юнита', actions: ['price.update', 'status.update'] },
    ],
  },
  {
    group: 'Подборки и рассрочки',
    rows: [
      { resource: 'dev_selection', label: 'Подборки', description: 'Подборки лотов для клиента', actions: ['read', 'create', 'update', 'delete'] },
      { resource: 'installment_plan', label: 'Рассрочки', description: 'Планы рассрочки платежей', actions: ['read', 'create', 'update', 'delete'] },
      { resource: 'commission_rule', label: 'Правила комиссии', description: 'Комиссии партнёров по ЖК', actions: ['read', 'create', 'update', 'delete'] },
    ],
  },
  {
    group: 'Финансы и отчёты',
    rows: [
      { resource: 'finance', label: 'Финансы', description: 'Финансовые показатели', actions: ['read'] },
      { resource: 'manual_ledger', label: 'Ручная бухгалтерия', description: 'Ручные проводки', actions: ['read'] },
      { resource: 'crm_report', label: 'Отчёты CRM', description: 'Аналитика по организации', actions: ['read'] },
      { resource: 'export', label: 'Экспорт', description: 'Выгрузка данных', actions: ['run'] },
      { resource: 'import', label: 'Импорт', description: 'Массовая загрузка данных', actions: ['run'] },
    ],
  },
  {
    group: 'Партнёры / MLM',
    rows: [
      { resource: 'referral_network', label: 'Реферальная сеть', description: 'Просмотр структуры рефералов', actions: ['read'] },
    ],
    disabled: [
      { label: 'Посредники / собственники', reason: 'Модуль не реализован' },
    ],
  },
  {
    group: 'Админ / Система',
    rows: [],
    disabled: [
      { label: 'Рассылки, блокировки, подмены', reason: 'Нет grant-пространства позиции для этих действий' },
    ],
  },
]

function extractErrorMessage(err: unknown, fallback: string): string {
  const message =
    (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message ||
    (err as { message?: string })?.message
  return message || fallback
}

function errorStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status
}

export function TeamAccessPage() {
  const { t } = useI18n();
  const { currentUser } = useAuth()
  const canEdit = Boolean(currentUser && EDITABLE_ROLES.includes(currentUser.role))
  const organizationId = currentUser?.companyId ?? ''

  const [people, setPeople] = useState<AccessPerson[]>([])
  const [peopleLoading, setPeopleLoading] = useState(true)
  const [peopleError, setPeopleError] = useState<string | null>(null)
  const [selectedPersonId, setSelectedPersonId] = useState<string>('')

  const [grants, setGrants] = useState<PositionGrant[]>([])
  const [grantsLoading, setGrantsLoading] = useState(false)
  const [grantsError, setGrantsError] = useState<string | null>(null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setPeopleLoading(true)
    setPeopleError(null)
    teamApi
      .list()
      .then((users) => {
        if (cancelled) return
        setPeople(
          users.map((u) => ({
            id: u.positionId ?? u.id,
            name: u.name,
            role: u.role,
            position: u.position || ROLE_LABEL[u.role] || u.role,
          })),
        )
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setPeopleError(extractErrorMessage(err, 'Не удалось загрузить список сотрудников'))
      })
      .finally(() => {
        if (!cancelled) setPeopleLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedPersonId && people.length > 0) setSelectedPersonId(people[0].id)
  }, [people, selectedPersonId])

  const loadGrants = useCallback(
    async (positionId: string) => {
      if (!organizationId || !positionId) return
      setGrantsLoading(true)
      setGrantsError(null)
      try {
        const items = await positionGrantsApi.list(organizationId, positionId)
        setGrants(items)
      } catch (err) {
        setGrantsError(extractErrorMessage(err, 'Не удалось загрузить права позиции'))
        setGrants([])
      } finally {
        setGrantsLoading(false)
      }
    },
    [organizationId],
  )

  useEffect(() => {
    if (selectedPersonId) void loadGrants(selectedPersonId)
  }, [selectedPersonId, loadGrants])

  const selectedPerson = people.find((p) => p.id === selectedPersonId)

  const findActiveGrant = (resource: string, action: string): PositionGrant | undefined =>
    grants.find((g) => g.resource === resource && g.action === action && !g.revokedAt)

  const toggleAction = async (resource: string, action: string) => {
    if (!canEdit || !selectedPerson || pendingKey) return
    const key = `${resource}.${action}`
    const active = findActiveGrant(resource, action)

    if (active) {
      const reason = window.prompt('Причина отзыва права (обязательно):')?.trim()
      if (!reason) return
      setPendingKey(key)
      try {
        await positionGrantsApi.revoke(organizationId, selectedPerson.id, active.id, {
          expectedVersion: active.version,
          reason,
        })
        await loadGrants(selectedPerson.id)
      } catch (err) {
        const status = errorStatus(err)
        if (status === 403) {
          setGrantsError('Недостаточно прав для изменения доступов этой позиции')
        } else if (status === 404 || status === 409) {
          setGrantsError('Список прав устарел — обновляем список')
          await loadGrants(selectedPerson.id)
        } else {
          setGrantsError(extractErrorMessage(err, 'Не удалось отозвать право'))
        }
      } finally {
        setPendingKey(null)
      }
      return
    }

    setPendingKey(key)
    try {
      await positionGrantsApi.grant(organizationId, selectedPerson.id, {
        resource,
        action,
        scope: defaultScopeFor(resource, action),
      })
      await loadGrants(selectedPerson.id)
    } catch (err) {
      const status = errorStatus(err)
      if (status === 403) {
        setGrantsError('Недостаточно прав для изменения доступов этой позиции')
      } else if (status === 404 || status === 409) {
        setGrantsError('Список прав устарел — обновляем список')
        await loadGrants(selectedPerson.id)
      } else {
        setGrantsError(extractErrorMessage(err, 'Не удалось выдать право'))
      }
    } finally {
      setPendingKey(null)
    }
  }

  const activeGrantsCount = grants.filter((g) => !g.revokedAt).length

  return (
    <DashboardShell>
      <div style={{ padding: '24px 28px 40px' }}>
        <div style={{ marginBottom: 20, fontSize: 20, fontWeight: 400, color: C.white }}>{t('team.teamAccessPage.матрица_доступов_сот')}</div>

        <div style={{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gap: 14 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 400, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.whiteLow }}>
              {t('team.teamAccessPage.сотрудники')}</div>
            <div style={{ maxHeight: '66vh', overflowY: 'auto' }}>
              {peopleLoading && (
                <div style={{ padding: '14px', fontSize: 11, color: C.whiteLow }}>Загрузка…</div>
              )}
              {peopleError && !peopleLoading && (
                <div style={{ padding: '14px', fontSize: 11, color: '#f87171' }}>{peopleError}</div>
              )}
              {!peopleLoading && !peopleError && people.length === 0 && (
                <div style={{ padding: '14px', fontSize: 11, color: C.whiteLow }}>Сотрудников не найдено</div>
              )}
              {people.map((person) => {
                const active = selectedPersonId === person.id
                return (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => setSelectedPersonId(person.id)}
                    style={{
                      width: '100%',
                      border: 'none',
                      borderBottom: `1px solid ${C.border}`,
                      background: active ? 'rgba(201,168,76,0.08)' : 'transparent',
                      padding: '10px 12px',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontSize: 12, color: C.white, fontWeight: 400 }}>{person.name}</div>
                    <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 400,
                          letterSpacing: '0.07em',
                          textTransform: 'uppercase',
                          padding: '3px 8px',
                          borderRadius: 20,
                          background: `${ROLE_ACCENT[person.role]}18`,
                          border: `1px solid ${ROLE_ACCENT[person.role]}44`,
                          color: ROLE_ACCENT[person.role],
                          display: 'inline-block',
                        }}
                      >
                        {person.position}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'auto' }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ fontSize: 13, color: C.white, fontWeight: 400 }}>
                  {selectedPerson ? selectedPerson.name : 'Выберите сотрудника'}
                </div>
                <div style={{ marginTop: 2, fontSize: 11, color: C.whiteLow }}>
                  {selectedPerson ? ROLE_LABEL[selectedPerson.role] : '—'}
                  {selectedPerson && !grantsLoading && ` · активных прав: ${activeGrantsCount}`}
                  {grantsLoading && ' · загрузка прав…'}
                </div>
              </div>
              {!canEdit && (
                <div style={{ fontSize: 10, color: C.whiteLow }}>
                  {t('team.teamAccessPage.только_просмотр')}</div>
              )}
            </div>

            {grantsError && (
              <div style={{ padding: '10px 16px', fontSize: 11, color: '#f87171', borderBottom: `1px solid ${C.border}`, background: 'rgba(248,113,113,0.06)' }}>
                {grantsError}
              </div>
            )}

            {ACCESS_GROUPS.map((group) => (
              <div key={group.group}>
                <div
                  style={{
                    padding: '10px 18px 6px',
                    fontSize: 10,
                    fontWeight: 400,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: C.gold,
                    background: 'rgba(201,168,76,0.04)',
                    borderTop: `1px solid ${C.border}`,
                  }}
                >
                  {group.group}
                </div>

                {group.rows.map((row) => (
                  <div
                    key={row.resource}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 16,
                      padding: '12px 18px',
                      borderBottom: `1px solid rgba(255,255,255,0.04)`,
                    }}
                  >
                    <div style={{ minWidth: 200, maxWidth: 260, flexShrink: 0 }}>
                      <div style={{ fontSize: 12, color: C.whiteMid, fontWeight: 400 }}>{row.label}</div>
                      {row.description && (
                        <div style={{ marginTop: 3, fontSize: 10, color: C.whiteLow }}>{row.description}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, flex: 1, justifyContent: 'flex-end' }}>
                      {row.actions.map((action) => {
                        const active = Boolean(selectedPerson && findActiveGrant(row.resource, action))
                        const key = `${row.resource}.${action}`
                        const busy = pendingKey === key
                        const clickable = canEdit && Boolean(selectedPerson) && !busy && !grantsLoading

                        return (
                          <button
                            key={key}
                            type="button"
                            disabled={!clickable}
                            onClick={() => void toggleAction(row.resource, action)}
                            title={
                              !selectedPerson
                                ? 'Выберите сотрудника'
                                : active
                                  ? 'Отозвать право'
                                  : 'Выдать право'
                            }
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '5px 10px',
                              borderRadius: 20,
                              border: `1px solid ${active ? 'rgba(74,222,128,0.35)' : C.border}`,
                              background: active ? 'rgba(74,222,128,0.10)' : 'rgba(255,255,255,0.03)',
                              color: active ? '#4ade80' : C.whiteLow,
                              fontSize: 11,
                              cursor: clickable ? 'pointer' : 'default',
                              opacity: busy ? 0.5 : 1,
                            }}
                          >
                            {active ? <Check size={11} /> : <X size={11} />}
                            {actionLabel(action)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}

                {group.disabled?.map((d) => (
                  <div
                    key={d.label}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 16,
                      padding: '12px 18px',
                      borderBottom: `1px solid rgba(255,255,255,0.04)`,
                      opacity: 0.45,
                    }}
                  >
                    <div style={{ fontSize: 12, color: C.whiteMid, fontWeight: 400 }}>{d.label}</div>
                    <div
                      style={{ fontSize: 10, color: C.whiteLow, textTransform: 'uppercase', letterSpacing: '0.08em' }}
                      title={d.reason}
                    >
                      {d.reason}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 20, marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.whiteLow }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(74,222,128,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Check size={10} color="#4ade80" />
            </div>
            {t('team.teamAccessPage.разрешено')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.whiteLow }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={10} color="rgba(255,255,255,0.18)" />
            </div>
            {t('team.teamAccessPage.нет_доступа')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.whiteLow, opacity: 0.6 }}>
            Затемнённые строки — модуль не реализован
          </div>
        </div>
      </div>
    </DashboardShell>
  )
}
