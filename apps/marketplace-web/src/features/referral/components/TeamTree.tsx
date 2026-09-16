import type { CSSProperties } from 'react'
import { useI18n } from '../../../i18n'
import type { MembershipStatus } from '../api/referral-api'
import { hangerPlace, hangerRows, initials } from '../lib/team-tree-layout'

export interface TeamTreeMember {
  id: string
  name: string
  joinedVia: 'invite_link' | 'admin'
  status: MembershipStatus
}

interface Props {
  curator: { id: string; name: string }
  members: TeamTreeMember[]
}

/**
 * Команда куратора деревом сверху вниз (исследование
 * docs/research/2026-09-16-referral-tree-ux.md): карточка куратора, стержень
 * и участники «вешалкой». Места в сетке заданы для двух ширин сразу, поэтому
 * на телефоне дерево перестраивается без JS. Пунктир — связь под вопросом.
 */
export function TeamTree({ curator, members }: Props) {
  const { t } = useI18n()
  const activeCount = members.filter((member) => member.status === 'active').length

  const style = {
    '--rows-wide': hangerRows(members.length, 2),
    '--rows-narrow': hangerRows(members.length, 1),
  } as CSSProperties

  return (
    <figure className="team-tree" aria-label={t('team.treeAria', { name: curator.name, count: members.length })}>
      <div className="team-tree__curator">
        <span className="team-tree__avatar team-tree__avatar--curator" aria-hidden>
          {initials(curator.name)}
        </span>
        <span className="team-tree__text">
          <span className="team-tree__name">{curator.name}</span>
          <span className="team-tree__sub">{t('team.treeCurator', { count: activeCount })}</span>
        </span>
      </div>

      {members.length > 0 ? (
        <ul className="team-tree__hanger" style={style}>
          <li className="team-tree__stem" aria-hidden />
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
                className={`team-tree__member${onReview ? ' is-review' : ''}`}
                data-side-wide={wide.side}
                data-depth-wide={wide.depth}
                data-side-narrow={narrow.side}
                style={placeStyle}
                tabIndex={0}
                aria-label={onReview ? t('team.memberOnReviewAria', { name: member.name }) : member.name}
              >
                <span className="team-tree__avatar" aria-hidden>
                  {initials(member.name)}
                </span>
                <span className="team-tree__text" aria-hidden>
                  <span className="team-tree__name">{member.name}</span>
                  <span className="team-tree__sub">
                    {onReview ? t('team.memberOnReview') : member.joinedVia === 'invite_link' ? t('team.viaLink') : t('team.viaAdmin')}
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
