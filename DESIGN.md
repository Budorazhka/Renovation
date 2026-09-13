# Design

## Direction

Спокойный локальный marketplace для реального каталога недвижимости. Визуальная
система следует выбранным Figma-frame из `docs/discovery/figma-local-handoff.md`
и не переносит CRM или экраны, отмеченные в Figma как неиспользуемые. Каталог
и профиль риэлторов с рейтингом (N-13, решение владельца 14.09.2026) —
исключение: переносятся по своему Figma-дизайну (`Рейтинг риелторов`
3576:53108, `Отзывы` 3576:53737).

## Color

| Role | Token | Value |
| --- | --- | --- |
| Primary green | `--color-accent` | `#169600` |
| Green hover | `--color-accent-hover` | `#107d07` |
| Page surface | `--color-paper` | `#f1f7eb` |
| Raised surface | `--color-paper-raised` | `#ffffff` |
| Ink | `--color-ink` | `#151515` |
| Muted ink | `--color-ink-muted` | `#555454` |
| Divider | `--color-line` | `#c8d5c0` |
| Soft accent | `--color-accent-soft` | `#e5f3dc` |

Primary green is reserved for active navigation, primary actions, selected
filters, prices and success states. Dividers and muted text stay neutral enough
to preserve contrast on the pale green page surface.

## Typography

- `Plus Jakarta Sans` for headings, prices and wordmarks.
- `Comfortaa` for controls, labels, supporting copy and metadata.
- Body text remains readable at the fixed product scale; display headings use a
  restrained responsive clamp and never overflow the viewport.

## Surfaces and layout

- Header: compact green bar with a controlled 30px lower corner radius.
- Home: white hero surface, visible operation tabs, real city search, then two
  promotional cards in a two-column desktop frame and one column on mobile.
- Catalogue: count and controls in one toolbar, filters inline below, cards in a
  responsive grid, map in a contained surface.
- Detail: media/gallery and fact copy share a two-column desktop layout and stack
  on small screens. Contact reveal stays inline and visibly follows the same
  action hierarchy as the catalogue.
- Wizard: preserve the existing functional step order and error/retry states;
  apply the same field, button, radius and focus vocabulary as the public pages.

## Responsive rules

The public surface must remain usable at 320px, 375px, 414px, 768px and 1440px.
At 680px the navigation collapses, catalogue controls wrap, cards become a
single or two-column flow as space allows, and the home hero/promos stack.

## Interaction states

Every button, filter, tab, link and form field has visible focus, hover and
disabled/loading treatment. Async loading, empty, 404 and network failure states
use the existing semantic live regions. Respect
`prefers-reduced-motion: reduce` by removing decorative transforms.
