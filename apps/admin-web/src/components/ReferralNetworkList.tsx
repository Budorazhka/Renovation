import { companyLine, teamStatusLabel } from '../lib/referral-format'
import { curatorKey, memberKey } from '../lib/referral-tree-layout'
import type { AdminCuratorNode, ReferralRules } from '../types/referral'

interface Props {
  curators: AdminCuratorNode[]
  rules: ReferralRules
  expanded: ReadonlySet<string>
  onToggle: (curatorId: string) => void
  selectedKey: string | null
  onSelect: (key: string) => void
}

/**
 * Сеть списком с отступами — второй вид дерева (исследование
 * docs/research/2026-09-16-referral-tree-ux.md): предсказуем, как папки, лучше
 * всего подходит для длинных имён и большой сети. Кураторы раскрываются,
 * участники вложены.
 */
export function ReferralNetworkList({ curators, rules, expanded, onToggle, selectedKey, onSelect }: Props) {
  return (
    <ul className="network-list" role="tree" aria-label="Сеть списком">
      {curators.map((curator) => {
        const id = curator.person.identityId
        const open = expanded.has(id)
        const onReview = curator.members.filter((m) => m.status === 'on_review').length
        return (
          <li key={id} role="treeitem" aria-expanded={curator.members.length > 0 ? open : undefined} aria-selected={selectedKey === curatorKey(id)}>
            <div className={`network-list__row network-list__row--curator${selectedKey === curatorKey(id) ? ' is-selected' : ''}`}>
              <button
                type="button"
                className="network-list__toggle"
                onClick={() => onToggle(id)}
                disabled={curator.members.length === 0}
                aria-label={open ? 'Свернуть команду' : 'Показать команду'}
              >
                <span aria-hidden>{curator.members.length === 0 ? '·' : open ? '▾' : '▸'}</span>
              </button>
              <button type="button" className="network-list__name" onClick={() => onSelect(curatorKey(id))}>
                {curator.person.name}
              </button>
              <span className="network-list__meta">{companyLine(curator.person)}</span>
              <span className="network-list__meta">
                {curator.teamSize} из {rules.teamSizeIdealMax}
              </span>
              <span className={`genealogy-status genealogy-status--${curator.teamStatus}`}>
                <span className="genealogy-status__dot" aria-hidden />
                {teamStatusLabel(curator.teamStatus)}
              </span>
              {onReview > 0 ? <span className="network-list__warn">{onReview} под вопросом</span> : null}
            </div>
            {open && curator.members.length > 0 ? (
              <ul role="group">
                {curator.members.map((member) => {
                  const key = memberKey(member.person.identityId)
                  return (
                    <li key={key} role="treeitem" aria-selected={selectedKey === key}>
                      <div className={`network-list__row network-list__row--member${selectedKey === key ? ' is-selected' : ''}`}>
                        <button type="button" className="network-list__name" onClick={() => onSelect(key)}>
                          {member.person.name}
                        </button>
                        <span className="network-list__meta">{companyLine(member.person)}</span>
                        <span className="network-list__meta">{member.joinedVia === 'invite_link' ? 'по ссылке' : 'добавлен BAZA'}</span>
                        {member.status === 'on_review' ? <span className="network-list__warn">под вопросом</span> : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
