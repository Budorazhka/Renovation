import { useEffect, useState } from 'react'
import { isAxiosError } from 'axios'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { ReferralTeamTree } from '@/components/referral/ReferralTeamTree'
import {
  referralNetworkApi,
  type CuratorNode,
  type MoneyAmount,
  type MyReferralNetwork,
  type OrganizationReferralNetwork,
} from '@/services/referralNetworkApi'
import { useI18n } from '@/i18n'

const MUTED = 'text-[color:var(--app-text-muted)]'

type Load<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'forbidden' } | { status: 'error' }

function formatMoney(money: MoneyAmount, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: money.currency }).format(money.amountMinorUnits / 100)
}

function moneyList(list: MoneyAmount[], locale: string): string {
  return list.length === 0 ? '—' : list.map((money) => formatMoney(money, locale)).join(' · ')
}

function toMembers(node: CuratorNode) {
  return node.members.map((member) => ({
    id: member.person.identityId,
    name: member.person.name,
    joinedVia: member.joinedVia,
    status: member.status,
  }))
}

/**
 * «Партнёры → MLM»: реферальная сеть BAZA глазами сотрудника агентства.
 * Раньше пункт меню перекидывал на нарисованную аналитику города. Теперь —
 * своя команда деревом «вешалкой» (у куратора) или свой куратор (у участника), а
 * руководителю — кураторы компании и их команды. Денег компании здесь нет:
 * 7% куратору платит BAZA (решение владельца 16.09.2026).
 */
export default function PartnersMlmAnalyticsPage() {
  const { t, language } = useI18n()
  const locale = language === 'en' ? 'en-US' : language === 'ka' ? 'ka-GE' : language === 'es' ? 'es-ES' : language === 'tr' ? 'tr-TR' : 'ru-RU'
  const [mine, setMine] = useState<Load<MyReferralNetwork>>({ status: 'loading' })
  const [company, setCompany] = useState<Load<OrganizationReferralNetwork>>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    referralNetworkApi
      .getMine()
      .then((data) => !cancelled && setMine({ status: 'ready', data }))
      .catch(() => !cancelled && setMine({ status: 'error' }))
    referralNetworkApi
      .getOrganization()
      .then((data) => !cancelled && setCompany({ status: 'ready', data }))
      .catch((error: unknown) => {
        if (cancelled) return
        setCompany(isAxiosError(error) && error.response?.status === 403 ? { status: 'forbidden' } : { status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const rules = mine.status === 'ready' ? mine.data.rules : company.status === 'ready' ? company.data.rules : null

  // Свою команду куратор уже видит выше — в списке компании её не повторяем.
  // Независимый риэлтор-куратор и есть вся «компания»: тогда раздел не нужен.
  const myCuratorId = mine.status === 'ready' ? mine.data.curator?.node.person.identityId : undefined
  const companyCurators =
    company.status === 'ready' ? company.data.curators.filter((c) => c.person.identityId !== myCuratorId) : []
  const showCompany = company.status === 'ready' && (companyCurators.length > 0 || !myCuratorId)

  return (
    <DashboardShell>
      <div className="flex w-full max-w-[1100px] flex-col gap-6 px-6 pb-12 pt-6 text-[color:var(--app-text)]">
        <header>
          <h1 className="text-[30px] font-normal leading-tight text-[color:var(--theme-accent-heading)]">{t('mlm.title')}</h1>
          <p className={`mt-1 max-w-[70ch] text-[17px] ${MUTED}`}>
            {rules
              ? t('mlm.subtitle', { rate: rules.ratePercent, min: rules.teamSizeMin, max: rules.teamSizeIdealMax })
              : t('mlm.subtitleShort')}
          </p>
        </header>

        {mine.status === 'loading' ? <p className={`text-[17px] ${MUTED}`}>{t('common.loading')}</p> : null}
        {mine.status === 'error' ? <p role="alert" className="text-[17px] text-[#ffb4ab]">{t('mlm.loadFailed')}</p> : null}

        {mine.status === 'ready' && mine.data.role === 'curator' && mine.data.curator ? (
          <section className="flex flex-col gap-6 rounded-md bg-[var(--hub-card-bg)] p-5">
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
              <div className="flex flex-col gap-1">
                <h2 className="text-[20px] font-medium text-[color:var(--gold)]">{t('mlm.myTeam')}</h2>
                <p className="text-[26px] font-medium tabular-nums">
                  {t('mlm.teamCount', { count: mine.data.curator.node.teamSize, max: mine.data.rules.teamSizeIdealMax })}
                </p>
                <p className={`text-[16px] team-status-erp team-status-erp--${mine.data.curator.node.teamStatus}`}>
                  {t(`mlm.teamStatus.${mine.data.curator.node.teamStatus}`)}
                </p>
              </div>
              <dl className="flex flex-wrap gap-x-8 gap-y-3 text-[16px]">
                <div className="flex flex-col gap-1">
                  <dt className={MUTED}>{t('mlm.earned')}</dt>
                  <dd className="text-[20px] tabular-nums">{moneyList(mine.data.curator.totals.earned, locale)}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className={MUTED}>{t('mlm.paid')}</dt>
                  <dd className="text-[20px] tabular-nums">{moneyList(mine.data.curator.totals.paid, locale)}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className={MUTED}>{t('mlm.due')}</dt>
                  <dd className="text-[20px] tabular-nums text-[color:var(--gold)]">{moneyList(mine.data.curator.totals.due, locale)}</dd>
                </div>
              </dl>
            </div>
            <ReferralTeamTree curatorName={mine.data.curator.node.person.name} members={toMembers(mine.data.curator.node)} />
            <p className={`text-[16px] ${MUTED}`}>{t('mlm.inviteCode', { code: mine.data.curator.inviteCode })}</p>
          </section>
        ) : null}

        {mine.status === 'ready' && mine.data.role === 'member' && mine.data.membership ? (
          <section className="flex flex-col gap-2 rounded-md bg-[var(--hub-card-bg)] p-5">
            <h2 className="text-[20px] font-medium text-[color:var(--gold)]">{t('mlm.myCurator')}</h2>
            <p className="text-[22px]">{mine.data.membership.curator.name}</p>
            <p className={`text-[16px] ${MUTED}`}>
              {t('mlm.memberSince', { date: new Date(mine.data.membership.joinedAt).toLocaleDateString(locale) })}
            </p>
            {mine.data.membership.status === 'on_review' ? <p className="text-[16px] text-[#ffb4ab]">{t('mlm.onReview')}</p> : null}
          </section>
        ) : null}

        {mine.status === 'ready' && mine.data.role === 'none' ? (
          <p className={`rounded-md bg-[var(--hub-card-bg)] p-5 text-[17px] ${MUTED}`}>{t('mlm.notInNetwork')}</p>
        ) : null}

        {showCompany ? (
          <section className="flex flex-col gap-4">
            <h2 className="text-[22px] font-normal text-[color:var(--theme-accent-heading)]">{t('mlm.companyTitle')}</h2>
            {companyCurators.length === 0 ? (
              <p className={`text-[17px] ${MUTED}`}>{t('mlm.companyEmpty')}</p>
            ) : (
              <div className="flex flex-col gap-4">
                {companyCurators.map((curator) => (
                  <article key={curator.person.identityId} className="rounded-md bg-[var(--hub-card-bg)] p-4">
                    <ReferralTeamTree
                      collapsible
                      curatorName={curator.person.name}
                      members={toMembers(curator)}
                      teamStatus={curator.teamStatus}
                    />
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}
        {company.status === 'error' ? <p role="alert" className="text-[17px] text-[#ffb4ab]">{t('mlm.companyLoadFailed')}</p> : null}
      </div>
    </DashboardShell>
  )
}
