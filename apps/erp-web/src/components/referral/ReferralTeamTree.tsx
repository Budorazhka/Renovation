import { useId, useState, type CSSProperties } from 'react'
import { hangerPlace, hangerRows, initials } from '@/lib/referral-team-layout'
import type { MembershipStatus, TeamSizeStatus } from '@/services/referralNetworkApi'
import { useI18n } from '@/i18n'
import './referral-team-tree.css'

export interface ReferralTreeMember {
  id: string
  name: string
  joinedVia: 'invite_link' | 'admin'
  status: MembershipStatus
}

interface Props {
  curatorName: string
  members: ReferralTreeMember[]
  /** Статус набора под именем куратора — для списка кураторов компании. */
  teamStatus?: TeamSizeStatus
  /** Команда свёрнута, пока её не раскроют: в списке кураторов компании. */
  collapsible?: boolean
}

/**
 * Команда куратора деревом сверху вниз в палитре ERP (DESIGN.md и
 * docs/research/2026-09-16-referral-tree-ux.md): карточка куратора с золотым
 * внутренним свечением, стержень и участники «вешалкой» — по двое с каждой
 * стороны, на узком экране по одному. Пунктир — связь под вопросом.
 */
export function ReferralTeamTree({ curatorName, members, teamStatus, collapsible = false }: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(!collapsible)
  const hangerId = useId()
  const activeCount = members.filter((member) => member.status === 'active').length
  const showHanger = open && members.length > 0

  const hangerStyle = {
    '--rows-wide': hangerRows(members.length, 2),
    '--rows-narrow': hangerRows(members.length, 1),
  } as CSSProperties

  return (
    <figure className="referral-tree" aria-label={t('mlm.treeAria', { name: curatorName, count: members.length })}>
      <div className="referral-tree__curator">
        <span className="referral-tree__avatar referral-tree__avatar--curator" aria-hidden>
          {initials(curatorName)}
        </span>
        <span className="referral-tree__text">
          <span className="referral-tree__name">{curatorName}</span>
          <span className="referral-tree__sub">{t('mlm.treeCurator', { count: activeCount })}</span>
          {teamStatus ? (
            <span className={`referral-tree__sub team-status-erp team-status-erp--${teamStatus}`}>{t(`mlm.teamStatus.${teamStatus}`)}</span>
          ) : null}
        </span>
        {collapsible && members.length > 0 ? (
          <button
            type="button"
            className="referral-tree__toggle"
            aria-expanded={open}
            aria-controls={hangerId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? t('mlm.hideTeam') : t('mlm.showTeam')}
          </button>
        ) : null}
      </div>

      {showHanger ? (
        <ul id={hangerId} className="referral-tree__hanger" style={hangerStyle}>
          <li className="referral-tree__stem" aria-hidden />
          {members.map((member, index) => {
            const wide = hangerPlace(index, 2)
            const narrow = hangerPlace(index, 1)
            const onReview = member.status === 'on_review'
            const placeStyle = {
              '--row-wide': wide.row,
              '--col-wide': wide.column,
              '--row-narrow': narrow.row,
              '--col-narrow': narrow.column,
            } as CSSProperties
            return (
              <li
                key={member.id}
                className={`referral-tree__member${onReview ? ' is-review' : ''}`}
                data-side-wide={wide.side}
                data-depth-wide={wide.depth}
                data-side-narrow={narrow.side}
                style={placeStyle}
                tabIndex={0}
                aria-label={onReview ? t('mlm.onReviewAria', { name: member.name }) : member.name}
              >
                <span className="referral-tree__avatar" aria-hidden>
                  {initials(member.name)}
                </span>
                <span className="referral-tree__text" aria-hidden>
                  <span className="referral-tree__name">{member.name}</span>
                  <span className="referral-tree__sub">
                    {onReview ? t('mlm.onReviewShort') : member.joinedVia === 'invite_link' ? t('mlm.viaLink') : t('mlm.viaAdmin')}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}
    </figure>
  )
}
