import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import { companyLine, teamStatusLabel, teamStatusShortLabel } from '../lib/referral-format'
import {
  ADMIN_TREE_SIZES,
  branchKeys,
  curatorKey,
  initials,
  layoutNetwork,
  memberKey,
  rootKey,
  type CardBox,
} from '../lib/referral-tree-layout'
import type { AdminCuratorNode, ReferralRules, ReferralTeamMember } from '../types/referral'

interface Props {
  curators: AdminCuratorNode[]
  rules: ReferralRules
  expanded: ReadonlySet<string>
  onToggle: (curatorId: string) => void
  selectedKey: string | null
  onSelect: (key: string) => void
  /** Карточка, к которой надо подвести вид: найденный поиском человек. */
  focusKey: string | null
}

interface View {
  scale: number
  x: number
  y: number
}

const MIN_SCALE = 0.3
const MAX_SCALE = 1.6
/** Мельче «Уместить» не уменьшает: подписи 12–14px при 0.75 ещё читаются, дальше — нет. Остальное двигают. */
const MIN_FIT_SCALE = 0.75
const MIN_FRAME_HEIGHT = 360
const MAX_FRAME_HEIGHT = 760

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function joinedLabel(member: ReferralTeamMember): string {
  return member.joinedVia === 'invite_link' ? 'по ссылке' : 'добавлен BAZA'
}

/**
 * Дерево реферальной сети в виде карточек сверху вниз (исследование
 * docs/research/2026-09-16-referral-tree-ux.md): BAZA → кураторы → команда
 * «вешалкой». Команды свёрнуты, пока их не раскрыли; на свёрнутом кураторе —
 * размер команды и связи под вопросом. Колесо двигает вид, Ctrl+колесо и
 * кнопки масштабируют, «Уместить» показывает всю сеть.
 */
export function ReferralGenealogy({ curators, rules, expanded, onToggle, selectedKey, onSelect, focusKey }: Props) {
  const layout = useMemo(
    () =>
      layoutNetwork(
        curators.map((curator) => ({
          id: curator.person.identityId,
          members: curator.members.map((member) => ({ id: member.person.identityId, status: member.status })),
        })),
        expanded,
      ),
    [curators, expanded],
  )

  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 })
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const dragRef = useRef<{ id: number; startX: number; startY: number; origin: View; moved: boolean } | null>(null)
  const fittedRef = useRef(false)
  /** Высота холста по дереву: маленькая сеть не оставляет под собой пустое поле. */
  const [frameHeight, setFrameHeight] = useState(MAX_FRAME_HEIGHT)

  const byKey = useMemo(() => new Map(layout.cards.map((card) => [card.key, card])), [layout])
  const curatorById = useMemo(() => new Map(curators.map((c) => [c.person.identityId, c])), [curators])
  const memberById = useMemo(() => {
    const map = new Map<string, ReferralTeamMember>()
    for (const curator of curators) for (const member of curator.members) map.set(member.person.identityId, member)
    return map
  }, [curators])

  const activeKey = hoverKey ?? selectedKey
  const highlighted = useMemo(
    () => (activeKey && activeKey !== rootKey && byKey.has(activeKey) ? branchKeys(layout, activeKey) : null),
    [activeKey, byKey, layout],
  )

  const fit = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const { clientWidth } = viewport
    if (clientWidth === 0) return
    const scale = clamp((clientWidth - 24) / layout.width, MIN_FIT_SCALE, 1)
    const height = clamp(Math.ceil(layout.height * scale) + 24, MIN_FRAME_HEIGHT, MAX_FRAME_HEIGHT)
    setFrameHeight(height)
    // Влезает — по центру; не влезает — с левого края: сеть читается слева направо, остальное двигают.
    setView({ scale, x: Math.max(12, (clientWidth - layout.width * scale) / 2), y: 12 })
  }, [layout])

  // Первый показ — вся сеть в кадре.
  useLayoutEffect(() => {
    if (fittedRef.current) return
    fittedRef.current = true
    fit()
  }, [fit])

  /** Подвести вид к карточке, не меняя масштаб без нужды. */
  const centerOn = useCallback((card: CardBox, minScale = 0.8) => {
    const viewport = viewportRef.current
    if (!viewport) return
    setView((current) => {
      const scale = Math.max(current.scale, minScale)
      return {
        scale,
        x: viewport.clientWidth / 2 - (card.x + card.width / 2) * scale,
        y: Math.min(12, viewport.clientHeight / 3 - (card.y + card.height / 2) * scale),
      }
    })
  }, [])

  useEffect(() => {
    if (!focusKey) return
    const card = byKey.get(focusKey)
    if (card) centerOn(card)
  }, [focusKey, byKey, centerOn])

  function zoom(factor: number) {
    const viewport = viewportRef.current
    const cx = (viewport?.clientWidth ?? 0) / 2
    const cy = (viewport?.clientHeight ?? 0) / 2
    setView((current) => {
      const scale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE)
      const k = scale / current.scale
      return { scale, x: cx - (cx - current.x) * k, y: cy - (cy - current.y) * k }
    })
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1)
      return
    }
    setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }))
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    dragRef.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, origin: view, moved: false }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) < 5) return
    if (!drag.moved) {
      drag.moved = true
      viewportRef.current?.setPointerCapture(event.pointerId)
    }
    setView({ ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy })
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    if (drag.moved) viewportRef.current?.releasePointerCapture(event.pointerId)
    // Отпускание после перетаскивания — не клик по карточке.
    window.setTimeout(() => {
      dragRef.current = null
    }, 0)
  }

  const guard = (action: () => void) => () => {
    if (dragRef.current?.moved) return
    action()
  }

  const dim = (key: string) => (highlighted ? !highlighted.has(key) : false)
  const onReviewTotal = curators.reduce((sum, c) => sum + c.members.filter((m) => m.status === 'on_review').length, 0)
  const membersTotal = curators.reduce((sum, c) => sum + c.members.length, 0)

  return (
    <div className="genealogy">
      <div className="genealogy__toolbar" role="group" aria-label="Масштаб дерева">
        <button type="button" className="secondary" onClick={() => zoom(1.2)} aria-label="Приблизить">
          +
        </button>
        <button type="button" className="secondary" onClick={() => zoom(1 / 1.2)} aria-label="Отдалить">
          −
        </button>
        <button type="button" className="secondary" onClick={fit}>
          Уместить
        </button>
      </div>

      <div
        ref={viewportRef}
        className="genealogy__viewport"
        style={{ height: frameHeight }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => setHoverKey(null)}
        aria-label={`Дерево сети: кураторов ${curators.length}, участников ${membersTotal}`}
        role="region"
      >
        <div
          className="genealogy__canvas"
          style={{ width: layout.width, height: layout.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          <svg className="genealogy__links" width={layout.width} height={layout.height} aria-hidden>
            {layout.connectors.map((connector) => (
              <path
                key={connector.key}
                d={connector.path}
                className={`genealogy__link${highlighted?.has(connector.targetKey) ? ' is-highlighted' : ''}${dim(connector.targetKey) ? ' is-dimmed' : ''}`}
              />
            ))}
          </svg>

          {layout.cards.map((card) => {
            const style = { left: card.x, top: card.y, width: card.width, height: card.height }
            const state = `${card.key === selectedKey ? ' is-selected' : ''}${dim(card.key) ? ' is-dimmed' : ''}`

            if (card.kind === 'root') {
              return (
                <button
                  key={card.key}
                  type="button"
                  className={`genealogy-card genealogy-card--root${state}`}
                  style={style}
                  onClick={guard(() => onSelect(rootKey))}
                  aria-label="BAZA: вся сеть"
                  aria-pressed={card.key === selectedKey}
                  onPointerEnter={() => setHoverKey(null)}
                >
                  <span className="genealogy-card__root-title">BAZA</span>
                  <span className="genealogy-card__root-sub">
                    {curators.length} кураторов · {membersTotal} в командах
                    {onReviewTotal > 0 ? ` · ${onReviewTotal} под вопросом` : ''}
                  </span>
                </button>
              )
            }

            if (card.kind === 'curator') {
              const curator = curatorById.get(card.id)
              if (!curator) return null
              const open = expanded.has(card.id)
              const onReview = curator.members.filter((m) => m.status === 'on_review').length
              return (
                <div
                  key={card.key}
                  className={`genealogy-card genealogy-card--curator${open ? ' is-open' : ''}${state}`}
                  style={style}
                  onPointerEnter={() => setHoverKey(card.key)}
                  onPointerLeave={() => setHoverKey(null)}
                >
                  <button
                    type="button"
                    className="genealogy-card__main"
                    onClick={guard(() => onSelect(card.key))}
                    aria-label={`Куратор ${curator.person.name}, в команде ${curator.teamSize}`}
                    aria-pressed={card.key === selectedKey}
                  >
                    <span className="genealogy-avatar genealogy-avatar--curator" aria-hidden>
                      {initials(curator.person.name)}
                    </span>
                    <span className="genealogy-card__text">
                      <span className="genealogy-card__name">{curator.person.name}</span>
                      <span className="genealogy-card__sub">{companyLine(curator.person)}</span>
                    </span>
                  </button>
                  <div className="genealogy-card__footer">
                    <span className={`genealogy-status genealogy-status--${curator.teamStatus}`} title={teamStatusLabel(curator.teamStatus)}>
                      <span className="genealogy-status__dot" aria-hidden />
                      {teamStatusShortLabel(curator.teamStatus)}
                    </span>
                    {curator.members.length > 0 ? (
                      <button
                        type="button"
                        className="genealogy-card__toggle"
                        aria-expanded={open}
                        aria-label={`${open ? 'Свернуть' : 'Показать'} команду: ${curator.teamSize} из ${rules.teamSizeIdealMax}${onReview > 0 ? `, ${onReview} под вопросом` : ''}`}
                        onClick={guard(() => onToggle(card.id))}
                      >
                        {curator.teamSize}
                        {onReview > 0 ? <span className="genealogy-card__warn">+{onReview}</span> : null}
                        <span aria-hidden className="genealogy-card__chevron">
                          {open ? '▴' : '▾'}
                        </span>
                      </button>
                    ) : (
                      <span className="genealogy-card__empty">пустая</span>
                    )}
                  </div>
                </div>
              )
            }

            const member = memberById.get(card.id)
            if (!member) return null
            const onReview = member.status === 'on_review'
            return (
              <button
                key={card.key}
                type="button"
                className={`genealogy-card genealogy-card--member${onReview ? ' is-review' : ''}${state}`}
                style={style}
                onClick={guard(() => onSelect(memberKey(card.id)))}
                onPointerEnter={() => setHoverKey(card.key)}
                onPointerLeave={() => setHoverKey(null)}
                aria-label={`${member.person.name}${onReview ? ', связь под вопросом' : ''}`}
                aria-pressed={card.key === selectedKey}
              >
                <span className="genealogy-avatar" aria-hidden>
                  {initials(member.person.name)}
                </span>
                <span className="genealogy-card__text">
                  <span className="genealogy-card__name">{member.person.name}</span>
                  <span className="genealogy-card__sub">{onReview ? 'под вопросом' : joinedLabel(member)}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export { curatorKey, memberKey, rootKey, ADMIN_TREE_SIZES }
