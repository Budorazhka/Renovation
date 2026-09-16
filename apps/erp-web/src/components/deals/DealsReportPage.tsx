import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { useDeals } from '@/context/DealsContext'
import { formatUsdMillions, formatUsdThousands } from '@/lib/format-currency'
import { STAGE_LABELS, STAGE_ORDER, SUCCESS_DEAL_STAGE_SET, type DealStage, type DealType } from '@/types/deals'
import { useI18n } from "@/i18n";

const C = {
  gold: 'var(--gold)',
  white: '#ffffff',
  whiteMid: 'rgba(255,255,255,0.7)',
  whiteLow: 'rgba(255,255,255,0.4)',
  border: 'var(--green-border)',
  card: 'var(--green-card)',
  green: '#4ade80',
}

function daysSinceUpdate(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

const TYPE_LABEL: Record<DealType, string> = {
  primary: 'Первичка',
  secondary: 'Вторичка',
  rental: 'Аренда',
  assignment: 'Переуступка',
}

export function DealsReportPage() {
    const { t } = useI18n();
  const navigate = useNavigate()
  const { deals } = useDeals()
  const [stage, setStage] = useState<'all' | DealStage>('all')
  const [type, setType] = useState<'all' | DealType>('all')
  const [agent, setAgent] = useState<string>('all')
  const filterSelectStyle: React.CSSProperties = {
    padding: '10px 12px',
    borderRadius: 8,
    border: `1px solid ${C.border}`,
    background: 'rgba(0,0,0,0.2)',
    color: C.white,
    fontSize: 12,
    colorScheme: 'dark',
  }

  const agentOptions = useMemo(() => Array.from(new Set(deals.map((d) => d.agentName))).sort(), [deals])

  const filtered = useMemo(() => {
    let rows = [...deals]
    if (stage !== 'all') rows = rows.filter((d) => d.stage === stage)
    if (type !== 'all') rows = rows.filter((d) => d.type === type)
    if (agent !== 'all') rows = rows.filter((d) => d.agentName === agent)
    return rows
  }, [agent, deals, stage, type])

  const totalCommission = filtered.reduce((s, d) => s + d.commission, 0)
  const successDeals = filtered.filter((d) => SUCCESS_DEAL_STAGE_SET.has(d.stage))
  const activeDeals = filtered.filter((d) => !SUCCESS_DEAL_STAGE_SET.has(d.stage))

  const stuck = useMemo(
    () => deals.filter((d) => !SUCCESS_DEAL_STAGE_SET.has(d.stage) && daysSinceUpdate(d.updatedAt) >= 10),
    [deals],
  )

  return (
    <DashboardShell>
      <div style={{ padding: '24px 28px 40px', width: '100%', maxWidth: 'none', minHeight: 'calc(100vh - 84px)' }}>
        <div style={{ fontSize: 26, fontWeight: 400, color: C.white, marginBottom: 4 }}>{t('deals.dealsReportPage.отч_т_по_сделкам')}</div>
        <div style={{ fontSize: 13, color: C.whiteLow, marginBottom: 20 }}>{t('deals.dealsReportPage.сводка_фильтры_и_ком')}</div>

        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: '14px 18px',
            marginBottom: 20,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12,
          }}
        >
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as 'all' | DealStage)}
            style={filterSelectStyle}
          >
            <option value="all">{t('deals.dealsReportPage.этап_все')}</option>
            {STAGE_ORDER.map((stageId) => (
              <option key={stageId} value={stageId}>
                {STAGE_LABELS[stageId]}
              </option>
            ))}
          </select>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as 'all' | DealType)}
            style={filterSelectStyle}
          >
            <option value="all">{t('deals.dealsReportPage.тип_все')}</option>
            <option value="primary">{TYPE_LABEL.primary}</option>
            <option value="secondary">{TYPE_LABEL.secondary}</option>
            <option value="rental">{TYPE_LABEL.rental}</option>
            <option value="assignment">{TYPE_LABEL.assignment}</option>
          </select>
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            style={filterSelectStyle}
          >
            <option value="all">{t('deals.dealsReportPage.агент_все')}</option>
            {agentOptions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        {/* KPI */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 24 }}>
          {[
            { label: 'В выборке', value: filtered.length.toString() },
            { label: 'Активных', value: activeDeals.length.toString(), color: '#60a5fa' },
            { label: 'Успешных', value: successDeals.length.toString(), color: C.green },
            { label: 'Комиссия (выборка)', value: formatUsdMillions(totalCommission, 2), color: C.gold },
          ].map((kpi) => (
            <div key={kpi.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '18px 20px' }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 400,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase' as const,
                  color: C.whiteLow,
                  marginBottom: 6,
                }}
              >
                {kpi.label}
              </div>
              <div style={{ fontSize: 28, fontWeight: 400, color: kpi.color || C.white }}>{kpi.value}</div>
            </div>
          ))}
        </div>

        {/* Deals table */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', minHeight: 'calc(100vh - 360px)' }}>
          <div
            style={{
              padding: '12px 20px',
              borderBottom: `1px solid ${C.border}`,
              display: 'grid',
              gridTemplateColumns: 'minmax(260px,2.2fr) minmax(120px,1fr) minmax(110px,1fr) minmax(120px,1fr) minmax(120px,1fr)',
              gap: 8,
            }}
          >
            {['Клиент / Объект', 'Этап', 'Тип', 'Цена', 'Комиссия'].map((h) => (
              <div
                key={h}
                style={{
                  fontSize: 10,
                  fontWeight: 400,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase' as const,
                  color: C.whiteLow,
                }}
              >
                {h}
              </div>
            ))}
          </div>
          <div style={{ maxHeight: 'calc(100vh - 430px)', overflowY: 'auto' }}>
          {filtered.map((deal, i) => (
            <div
              key={deal.id}
              onClick={() => navigate(`/dashboard/deals/${deal.id}`)}
              style={{
                padding: '14px 20px',
                borderBottom: i < filtered.length - 1 ? `1px solid ${C.border}` : 'none',
                display: 'grid',
                gridTemplateColumns: 'minmax(260px,2.2fr) minmax(120px,1fr) minmax(110px,1fr) minmax(120px,1fr) minmax(120px,1fr)',
                gap: 8,
                cursor: 'pointer',
                alignItems: 'center',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div>
                <div style={{ fontSize: 13, color: C.white, fontWeight: 500 }}>{deal.clientName}</div>
                <div style={{ fontSize: 11, color: C.whiteLow }}>{deal.propertyAddress}</div>
              </div>
              <div style={{ fontSize: 12, color: C.whiteMid }}>{STAGE_LABELS[deal.stage]}</div>
              <div style={{ fontSize: 12, color: C.whiteMid }}>{TYPE_LABEL[deal.type]}</div>
              <div style={{ fontSize: 13, fontWeight: 400, color: C.white }}>{formatUsdMillions(deal.price, 1)}</div>
              <div style={{ fontSize: 13, fontWeight: 400, color: C.gold }}>{formatUsdThousands(deal.commission)}</div>
            </div>
          ))}
          </div>
        </div>

        {filtered.length === 0 && (
          <p style={{ marginTop: 16, fontSize: 13, color: C.whiteLow }}>{t('deals.dealsReportPage.нет_сделок_по_выбран')}</p>
        )}

        {stuck.length > 0 && (
          <div style={{ marginTop: 24, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 20px' }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 400,
                letterSpacing: '0.1em',
                textTransform: 'uppercase' as const,
                color: '#fbbf24',
                marginBottom: 12,
              }}
            >
              {t('deals.dealsReportPage.давно_без_движения_1')}</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: C.whiteMid, fontSize: 12, lineHeight: 1.6 }}>
              {stuck.map((d) => (
                <li key={d.id}>
                  {d.clientName} · {STAGE_LABELS[d.stage]} · {daysSinceUpdate(d.updatedAt)} {t('deals.dealsReportPage.дн')}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </DashboardShell>
  )
}
