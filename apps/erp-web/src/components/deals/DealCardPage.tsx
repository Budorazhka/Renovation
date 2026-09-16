import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CheckSquare, Square, AlertTriangle, User, Building2, Bookmark, Contact, ArrowRight } from 'lucide-react'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { LeadHistoryTimeline } from '@/components/leads/LeadHistoryTimeline'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/context/AuthContext'
import { useLeads } from '@/context/LeadsContext'
import { useDeals } from '@/context/DealsContext'
import { useRolePermissions } from '@/hooks/useRolePermissions'
import { FMT_USD, formatUsdMillions, formatUsdThousands } from '@/lib/format-currency'
import { CLIENTS_MOCK } from '@/data/clients-mock'
import { STAGE_LABELS, STAGE_ORDER, type DealStage, type PaymentStatus } from '@/types/deals'
import { useI18n } from "@/i18n";
import { referralNetworkApi, type Accrual } from '@/services/referralNetworkApi'

const STAGE_COLORS: Record<DealStage, string> = {
  showing:     '#60a5fa',
  deposit:     '#f87171',
  deal:        '#c9a84c',
  golden:      '#d3bd75',
  check_in:    '#fbbf24',
  referral:    '#f59e0b',
  closed_lost: '#64748b',
}

const C = {
  gold: 'var(--gold)',
  white: '#ffffff',
  whiteMid: 'rgba(255,255,255,0.7)',
  whiteLow: 'rgba(255,255,255,0.4)',
  border: 'var(--green-border)',
  card: 'var(--green-card)',
  green: '#4ade80',
}

const PAYMENT_STATUS_COLOR: Record<PaymentStatus, string> = {
  paid: '#4ade80',
  pending: 'var(--gold)',
  overdue: '#f87171',
}

const SETTLEMENT_ROLE_LABEL: Record<string, string> = {
  referral_partner: 'Реферальный партнёр',
  broker: 'Посредник',
  co_agent: 'Соагент',
}

type Tab = 'checklist' | 'participants' | 'finances' | 'history'

export function DealCardPage() {
    const { t } = useI18n();
  const { dealId } = useParams<{ dealId: string }>()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const { isManager } = useRolePermissions()
  const { getLeadWithHistory, state: leadsState, dispatch, leadManagers } = useLeads()
  const { deals, updateChecklist } = useDeals()
  const [tab, setTab] = useState<Tab>('checklist')
  const [transferConfirm, setTransferConfirm] = useState<{
    newManagerId: string | null
    newManagerName: string
  } | null>(null)

  const deal = deals.find(d => d.id === dealId)

  /**
   * Начисление куратору по этой сделке. Сервер отдаёт человеку только его
   * собственное место в сети, поэтому строку видит агент из команды на своей
   * сделке; остальным её просто неоткуда взять — и не нужно.
   */
  const [curatorAccrual, setCuratorAccrual] = useState<Accrual | null>(null)
  useEffect(() => {
    if (tab !== 'finances' || !deal?.commissionReceived) return
    let cancelled = false
    referralNetworkApi
      .getMine()
      .then((network) => {
        if (cancelled) return
        const found = network.membership?.accruals.find((a) => a.dealId === deal.id && a.status !== 'reversed')
        setCuratorAccrual(found ?? null)
      })
      .catch(() => {
        if (!cancelled) setCuratorAccrual(null)
      })
    return () => {
      cancelled = true
    }
  }, [tab, deal?.id, deal?.commissionReceived])

  /** Связанный лид в CRM: sourceLeadId, clientId lead-* или клиент с convertedFromLeadId, если лид есть в пуле */
  const linkedLeadId = useMemo(() => {
    const d = deals.find(x => x.id === dealId)
    if (!d) return null
    if (d.sourceLeadId) return d.sourceLeadId
    if (d.clientId?.startsWith('lead-')) return d.clientId
    const client = CLIENTS_MOCK.find(c => c.id === d.clientId)
    const conv = client?.convertedFromLeadId
    if (conv && leadsState.leadPool.some(l => l.id === conv)) return conv
    return null
  }, [deals, dealId, leadsState.leadPool])

  const leadCrmPath = linkedLeadId
    ? `/dashboard/leads/poker?lead=${encodeURIComponent(linkedLeadId)}`
    : null

  if (!deal) {
    return (
      <DashboardShell>
        <div style={{ padding: 40, color: C.whiteLow }}>{t('deals.dealCardPage.сделка_не_найдена')}</div>
      </DashboardShell>
    )
  }

  const stageColor = STAGE_COLORS[deal.stage] || C.gold
  const stageIdx = STAGE_ORDER.indexOf(deal.stage)

  /** CAS через DealsContext.updateChecklist — сервер сам проставляет completedAt/completedByPositionId по флагу done (см. CrmService.updateDealChecklist). */
  function toggleChecklistItem(itemId: string) {
    if (!deal) return
    const items = deal.checklist.map(c => ({
      id: c.id,
      label: c.label,
      done: c.id === itemId ? !c.done : c.done,
    }))
    void updateChecklist(deal.id, items)
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'checklist', label: 'Чеклист' },
    { key: 'participants', label: 'Участники' },
    { key: 'finances', label: 'Финансы' },
    { key: 'history', label: 'История' },
  ]

  const linkedLead = linkedLeadId ? getLeadWithHistory(linkedLeadId) : null

  return (
    <DashboardShell>
      <div
        style={{
          padding: '24px 28px 40px',
          maxWidth: tab === 'history' && linkedLeadId ? 1024 : 900,
          width: '100%',
          margin: '0 auto',
        }}
      >
        {/* Header */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 400, color: C.white }}>{deal.clientName}</div>
              <div style={{ fontSize: 13, color: C.whiteLow, marginTop: 3 }}>{deal.propertyAddress} · {deal.propertyType}</div>
              <div style={{ marginTop: 8 }}>
                <span style={{
                  fontSize: 11,
                  fontWeight: 400,
                  padding: '4px 10px',
                  borderRadius: 20,
                  background: `${stageColor}18`,
                  border: `1px solid ${stageColor}44`,
                  color: stageColor,
                  letterSpacing: '0.06em',
                }}>
                  {STAGE_LABELS[deal.stage]}
                </span>
                {deal.lawyerTaskCreated && (
                  <span style={{
                    marginLeft: 8,
                    fontSize: 10,
                    padding: '4px 8px',
                    borderRadius: 20,
                    background: 'rgba(251,146,60,0.1)',
                    border: '1px solid rgba(251,146,60,0.3)',
                    color: '#fb923c',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}>
                    <AlertTriangle size={10} /> {t('deals.dealCardPage.задача_юристу_создан')}</span>
                )}
              </div>
            </div>
            <div style={{ textAlign: 'right' as const }}>
              <div style={{ fontSize: 24, fontWeight: 400, color: C.white }}>{formatUsdMillions(deal.price, 1)}</div>
              <div style={{ fontSize: 12, color: C.gold }}>{t('deals.dealCardPage.комиссия')}{formatUsdThousands(deal.commission)}</div>
              <div style={{ fontSize: 11, color: C.whiteLow, marginTop: 4 }}>{t('deals.dealCardPage.агент')}{deal.agentName}</div>
            </div>
          </div>

          {/* Cross-module actions → CRM */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' as const, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => navigate(`/dashboard/clients/list?search=${encodeURIComponent(deal.clientName)}`)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, fontSize: 11, fontWeight: 400, cursor: 'pointer', background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.18)', color: '#93c5fd' }}
            >
              <User size={11} /> {t('deals.dealCardPage.найти_в_клиентах')}</button>
            {leadCrmPath && (
              <button
                type="button"
                onClick={() => navigate(leadCrmPath)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, fontSize: 11, fontWeight: 400, cursor: 'pointer', background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.28)', color: '#34d399' }}
              >
                <Contact size={11} /> {t('deals.dealCardPage.открыть_полную_карто')}</button>
            )}
            <button
              type="button"
              onClick={() => navigate('/dashboard/objects/list')}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, fontSize: 11, fontWeight: 400, cursor: 'pointer', background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.22)', color: C.gold }}
            >
              <Building2 size={11} /> {t('deals.dealCardPage.объект_в_каталоге')}</button>
            <button
              type="button"
              onClick={() => navigate('/dashboard/bookings/client')}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, fontSize: 11, fontWeight: 400, cursor: 'pointer', background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.22)', color: '#a78bfa' }}
            >
              <Bookmark size={11} /> {t('deals.dealCardPage.создать_бронь')}</button>
          </div>

          {/* Stage progress */}
          <div style={{ display: 'flex', gap: 4 }}>
            {STAGE_ORDER.map((s, i) => (
              <div key={s} style={{ flex: 1 }}>
                <div style={{
                  height: 4,
                  borderRadius: 2,
                  background: i <= stageIdx ? STAGE_COLORS[s] || C.gold : 'rgba(255,255,255,0.1)',
                  transition: 'background 0.3s',
                }} />
                <div style={{ fontSize: 16, color: i === stageIdx ? stageColor : C.whiteLow, marginTop: 4, textAlign: 'center' as const, letterSpacing: '0.04em' }}>
                  {STAGE_LABELS[s].split(' ')[0]}
                </div>
              </div>
            ))}
          </div>

          {deal.nextAction && (
            <div style={{
              marginTop: 16,
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'rgba(201,168,76,0.06)',
              borderRadius: 6,
              boxShadow: 'inset 0 0 0 1px rgba(201,168,76,0.18)',
            }}>
              <ArrowRight size={14} color={C.gold} style={{ flexShrink: 0 }} />
              <div>
                <span style={{ fontSize: 16, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: C.gold }}>
                  {t('deals.dealCardPage.ближайшее_действие')}
                </span>
                <span style={{ fontSize: 16, color: C.whiteMid, marginLeft: 8 }}>{deal.nextAction}</span>
                {deal.nextActionDate && (
                  <span style={{ fontSize: 16, color: C.whiteLow, marginLeft: 8 }}>· {deal.nextActionDate}</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 16 }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              background: tab === t.key ? 'rgba(201,168,76,0.1)' : 'transparent',
              color: tab === t.key ? C.gold : C.whiteLow,
              fontSize: 16,
              fontWeight: tab === t.key ? 500 : 400,
              cursor: 'pointer',
              borderBottom: tab === t.key ? '2px solid var(--gold)' : '2px solid transparent',
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'checklist' && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 24px' }}>
            <div style={{ fontSize: 11, fontWeight: 400, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: C.whiteLow, marginBottom: 14 }}>
              {t('deals.dealCardPage.чеклист_для_перехода')}</div>
            {deal.checklist.map(item => (
              <div
                key={item.id}
                onClick={() => toggleChecklistItem(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  cursor: 'pointer',
                }}
              >
                {item.done
                  ? <CheckSquare size={16} color={C.green} />
                  : <Square size={16} color={C.whiteLow} />
                }
                <span style={{ fontSize: 13, color: item.done ? C.whiteLow : C.white, textDecoration: item.done ? 'line-through' : 'none' }}>
                  {item.label}
                </span>
                {item.required && !item.done && (
                  <span style={{ fontSize: 10, color: '#f87171', marginLeft: 'auto' }}>{t('deals.dealCardPage.обязательно')}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'participants' && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 24px' }}>
            {deal.participants.map((p, i) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 0',
                borderBottom: i < deal.participants.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
              }}>
                <div style={{ fontSize: 13, color: C.white }}>{p.name}</div>
                <span style={{
                  fontSize: 10,
                  fontWeight: 400,
                  padding: '3px 8px',
                  borderRadius: 20,
                  background: 'rgba(201,168,76,0.1)',
                  border: '1px solid rgba(201,168,76,0.2)',
                  color: C.gold,
                }}>
                  {p.role === 'agent' ? 'Агент' : p.role === 'lawyer' ? 'Юрист' : p.role === 'buyer' ? 'Покупатель' : p.role === 'seller' ? 'Продавец' : 'РОП'}
                </span>
              </div>
            ))}
          </div>
        )}

        {tab === 'finances' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 24px' }}>
              {[
                { label: 'Стоимость объекта', value: deal.price > 0 ? formatUsdMillions(deal.price, 2) : '—', color: C.white },
                { label: 'Комиссия агентства', value: FMT_USD.format(deal.commission), color: C.gold },
                { label: 'Ставка комиссии', value: deal.price > 0 ? `${((deal.commission / deal.price) * 100).toFixed(1)}%` : '—', color: C.gold },
                // Деньги отмечает менеджер BAZA в админке — здесь только чтение.
                {
                  label: t('mlm.dealCommissionReceived'),
                  value: deal.commissionReceived
                    ? `${new Intl.NumberFormat('ru-RU', { style: 'currency', currency: deal.commissionReceived.currency }).format(deal.commissionReceived.amount)} · ${new Date(deal.commissionReceived.receivedAt).toLocaleDateString('ru-RU')}`
                    : t('mlm.dealCommissionNotYet'),
                  color: deal.commissionReceived ? C.gold : C.whiteLow,
                },
                ...(curatorAccrual
                  ? [
                      {
                        label: t('mlm.dealCuratorAccrual', { rate: curatorAccrual.ratePercent }),
                        value: new Intl.NumberFormat('ru-RU', { style: 'currency', currency: curatorAccrual.amount.currency }).format(
                          curatorAccrual.amount.amountMinorUnits / 100,
                        ),
                        color: C.gold,
                      },
                    ]
                  : []),
              ].map((row, i, rows) => (
                <div key={i} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '12px 0',
                  borderBottom: i < rows.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                }}>
                  <span style={{ fontSize: 16, color: C.whiteLow }}>{row.label}</span>
                  <span style={{ fontSize: 16, fontWeight: 400, color: row.color }}>{row.value}</span>
                </div>
              ))}
            </div>

            {deal.payments && deal.payments.length > 0 && (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 24px' }}>
                <div style={{ fontSize: 16, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: C.whiteLow, marginBottom: 14 }}>
                  {t('deals.dealCardPage.график_платежей')}
                </div>
                {deal.payments.map((p, i) => (
                  <div key={p.id} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 0',
                    borderBottom: i < deal.payments!.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                  }}>
                    <div>
                      <div style={{ fontSize: 16, color: C.white }}>{p.label}</div>
                      <div style={{ fontSize: 16, color: C.whiteLow, marginTop: 2 }}>{p.dueDate}</div>
                    </div>
                    <div style={{ textAlign: 'right' as const }}>
                      <div style={{ fontSize: 16, fontWeight: 400, color: C.white }}>{FMT_USD.format(p.amount)}</div>
                      <div style={{
                        fontSize: 16, marginTop: 2, color: PAYMENT_STATUS_COLOR[p.status],
                      }}>
                        {t(`deals.dealCardPage.paymentStatus.${p.status}`)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {deal.settlements && deal.settlements.length > 0 && (
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '20px 24px' }}>
                <div style={{ fontSize: 16, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: C.whiteLow, marginBottom: 14 }}>
                  {t('deals.dealCardPage.взаиморасчёты_с_парт')}
                </div>
                {deal.settlements.map((s, i) => (
                  <div key={s.id} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 0',
                    borderBottom: i < deal.settlements!.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                  }}>
                    <div>
                      <div style={{ fontSize: 16, color: C.white }}>{s.partnerName}</div>
                      <div style={{ fontSize: 16, color: C.whiteLow, marginTop: 2 }}>{SETTLEMENT_ROLE_LABEL[s.role]}</div>
                    </div>
                    <div style={{ textAlign: 'right' as const }}>
                      <div style={{ fontSize: 16, fontWeight: 400, color: C.gold }}>{FMT_USD.format(s.amount)}</div>
                      <div style={{
                        fontSize: 16, marginTop: 2, color: PAYMENT_STATUS_COLOR[s.status],
                      }}>
                        {t(`deals.dealCardPage.paymentStatus.${s.status}`)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'history' && (
          linkedLeadId ? (
            <>
              {/* Тот же каркас, что диалог «История» в LeadsCardTableView */}
              <div className="flex h-[90vh] max-h-[900px] w-full max-w-5xl flex-col overflow-hidden rounded-xl border-none bg-slate-50 p-0 shadow-2xl">
                <div className="flex shrink-0 flex-row items-center justify-between border-b border-slate-200 bg-white px-6 py-5">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-xl font-normal tracking-tight text-slate-900">{t('deals.dealCardPage.карточка_лида')}</h3>
                    <p className="text-sm font-medium text-slate-500">
                      {linkedLead?.name ? linkedLead.name : 'Выберите лида'}
                    </p>
                  </div>

                  {linkedLead && !isManager && (
                    <div className="mr-8 flex items-center gap-3">
                      <span className="text-xs font-normal uppercase tracking-wide text-slate-500">
                        {t('deals.dealCardPage.передать')}</span>
                      <Select
                        value={linkedLead.managerId || 'unassigned'}
                        onValueChange={(val) => {
                          const newManagerId = val === 'unassigned' ? null : val
                          const newManagerName = newManagerId
                            ? (leadManagers.find(m => m.id === newManagerId)?.name ?? 'Неизвестный менеджер')
                            : ''
                          setTransferConfirm({ newManagerId, newManagerName })
                        }}
                      >
                        <SelectTrigger className="h-9 w-[220px] border-slate-200 bg-white text-sm">
                          <SelectValue placeholder={t('deals.dealCardPage.выберите_менеджера')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned" className="italic text-slate-500">
                            {t('deals.dealCardPage.выберите_менеджера')}</SelectItem>
                          {leadManagers.map(mgr => (
                            <SelectItem key={mgr.id} value={mgr.id}>
                              {mgr.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                <div className="min-h-0 flex-1 bg-slate-50/50">
                  <LeadHistoryTimeline leadId={linkedLeadId} initialInputType="comment" />
                </div>
              </div>

              <Dialog open={!!transferConfirm} onOpenChange={open => { if (!open) setTransferConfirm(null) }}>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>{t('deals.dealCardPage.передать_лида')}</DialogTitle>
                    <DialogDescription>
                      {transferConfirm && linkedLead && (
                        transferConfirm.newManagerId
                          ? (
                              <>
                                {t('deals.dealCardPage.вы_уверены_что_хотит')}{' '}
                                <strong>{linkedLead.name ?? linkedLead.id}</strong> {t('deals.dealCardPage.менеджеру')}{' '}
                                <strong>{transferConfirm.newManagerName}</strong>?
                              </>
                            )
                          : (
                              <>
                                {t('deals.dealCardPage.вы_уверены_что_хотит')}{' '}
                                <strong>{linkedLead.name ?? linkedLead.id}</strong>?
                              </>
                            )
                      )}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => setTransferConfirm(null)}>
                      {t('deals.dealCardPage.отмена')}</Button>
                    <Button
                      onClick={() => {
                        if (!linkedLead || !transferConfirm) return
                        const authorId = currentUser?.id ?? 'lm-1'
                        const authorName = currentUser?.name ?? 'Текущий пользователь'
                        if (transferConfirm.newManagerId) {
                          dispatch({
                            type: 'ASSIGN_LEAD',
                            leadId: linkedLead.id,
                            managerId: transferConfirm.newManagerId,
                          })
                          dispatch({
                            type: 'ADD_LEAD_EVENT',
                            leadId: linkedLead.id,
                            event: {
                              id: `evt-${Date.now()}`,
                              type: 'assign',
                              timestamp: new Date().toISOString(),
                              authorId,
                              authorName,
                              payload: {
                                managerId: transferConfirm.newManagerId,
                                managerName: transferConfirm.newManagerName,
                              },
                            },
                          })
                        } else {
                          dispatch({ type: 'UNASSIGN_LEAD', leadId: linkedLead.id })
                        }
                        setTransferConfirm(null)
                      }}
                    >
                      {t('deals.dealCardPage.подтвердить')}</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </>
          ) : (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '24px 28px' }}>
              <p style={{ fontSize: 14, color: C.whiteMid, marginBottom: 16, lineHeight: 1.5 }}>
                {t('deals.dealCardPage.лента_истории_подтяг')}</p>
              <button
                type="button"
                onClick={() => navigate('/dashboard/leads/poker')}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: `1px solid ${C.gold}`,
                  background: 'rgba(201,168,76,0.12)',
                  color: C.gold,
                  fontSize: 12,
                  fontWeight: 400,
                  cursor: 'pointer',
                  marginBottom: 24,
                }}
              >
                {t('deals.dealCardPage.открыть_полную_карто')}</button>
              <div style={{ fontSize: 11, fontWeight: 400, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: C.whiteLow, marginBottom: 10 }}>
                {t('deals.dealCardPage.события_по_сделке_ло')}</div>
              {[
                { date: deal.updatedAt, event: `Сделка на этапе: ${STAGE_LABELS[deal.stage]}` },
                { date: deal.createdAt, event: 'Сделка создана' },
              ].map((h, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: i < 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                  <div style={{ fontSize: 11, color: C.whiteLow, width: 90, flexShrink: 0 }}>{h.date}</div>
                  <div style={{ fontSize: 13, color: C.whiteMid }}>{h.event}</div>
                </div>
              ))}
            </div>
          )
        )}

        {deal.notes && (
          <div style={{ marginTop: 12, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 20px' }}>
            <div style={{ fontSize: 10, fontWeight: 400, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: C.whiteLow, marginBottom: 6 }}>{t('deals.dealCardPage.заметки')}</div>
            <div style={{ fontSize: 13, color: C.whiteMid }}>{deal.notes}</div>
          </div>
        )}
      </div>
    </DashboardShell>
  )
}
