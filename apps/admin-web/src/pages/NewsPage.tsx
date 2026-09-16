import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react'
import { adminApi } from '../api/admin-api'
import { newsErrorMessage, useAdminNews } from '../hooks/useAdminNews'
import { formatDateTime } from '../lib/format'
import type { DeliveryCounts, NewsArticle, NewsCategory, NewsDeliveryStats } from '../types/admin'

const CATEGORIES: { value: NewsCategory; label: string }[] = [
  { value: 'market', label: 'Рынок' },
  { value: 'developer', label: 'Застройщики' },
  { value: 'regulation', label: 'Законодательство' },
  { value: 'company', label: 'Компания' },
]
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const IMAGE_MAX_BYTES = 20 * 1024 * 1024

function categoryLabel(category: NewsCategory): string {
  return CATEGORIES.find((item) => item.value === category)?.label ?? category
}

/** Адрес без протокола дополняется https:// — сервер принимает только http(s) с протоколом. */
function normalizeUrl(url: string): string | undefined {
  const trimmed = url.trim()
  if (!trimmed) return undefined
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/\//, '')}`
}

function total(counts: DeliveryCounts): number {
  return counts.pending + counts.sent + counts.failed + counts.skipped
}

/** «Почта: 12 из 14, ошибок 1» — только по каналам, куда что-то уходило. */
function deliverySummary(stats: NewsDeliveryStats | null): string[] {
  if (!stats) return []
  const lines: string[] = []
  for (const [label, counts] of [
    ['Почта', stats.email],
    ['Telegram', stats.telegram],
  ] as const) {
    const all = total(counts)
    if (all === 0) continue
    let line = `${label}: отправлено ${counts.sent} из ${all}`
    if (counts.failed) line += `, ошибок ${counts.failed}`
    if (counts.pending) line += `, в очереди ${counts.pending}`
    lines.push(line)
  }
  return lines
}

interface Draft {
  title: string
  body: string
  category: NewsCategory
  linkUrl: string
  linkLabel: string
  pinned: boolean
  imageAssetId: string | null
  imagePreview: string | null
}

const EMPTY_DRAFT: Draft = {
  title: '',
  body: '',
  category: 'market',
  linkUrl: '',
  linkLabel: '',
  pinned: false,
  imageAssetId: null,
  imagePreview: null,
}

/**
 * Новости платформы BAZA: публикация сразу появляется в ленте ERP у
 * сотрудников всех организаций; по желанию — рассылка на почту и в
 * Telegram. Новости своей компании руководители публикуют в ERP сами.
 */
export function NewsPage() {
  const { state, applyCreated, applyUpdated, applyDeleted } = useAdminNews()
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [editing, setEditing] = useState<{ id: string; version: number } | null>(null)
  const [sendEmail, setSendEmail] = useState(false)
  const [sendTelegram, setSendTelegram] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<NewsArticle | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const localPreview = useRef<string | null>(null)
  const channels = state.status === 'ready' ? state.channels : { email: false, telegram: false }

  useEffect(() => () => {
    if (localPreview.current) URL.revokeObjectURL(localPreview.current)
  }, [])

  const patch = (next: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...next }))

  function resetForm() {
    setDraft(EMPTY_DRAFT)
    setEditing(null)
    setSendEmail(false)
    setSendTelegram(false)
  }

  async function pickImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!IMAGE_TYPES.includes(file.type) || file.size > IMAGE_MAX_BYTES) {
      setMessage({ tone: 'error', text: 'Картинка — JPG, PNG или WebP до 20 МБ.' })
      return
    }
    setUploading(true)
    setMessage(null)
    try {
      const { assetId } = await adminApi.uploadNewsImage(file)
      if (localPreview.current) URL.revokeObjectURL(localPreview.current)
      localPreview.current = URL.createObjectURL(file)
      patch({ imageAssetId: assetId, imagePreview: localPreview.current })
    } catch (cause) {
      setMessage({ tone: 'error', text: newsErrorMessage(cause, 'Не удалось загрузить картинку.') })
    } finally {
      setUploading(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft.title.trim() || !draft.body.trim() || uploading) return
    setSaving(true)
    setMessage(null)
    const url = normalizeUrl(draft.linkUrl)
    const content = {
      title: draft.title.trim(),
      body: draft.body.trim(),
      category: draft.category,
      pinned: draft.pinned,
      ...(url ? { linkUrl: url } : {}),
      ...(url && draft.linkLabel.trim() ? { linkLabel: draft.linkLabel.trim() } : {}),
      ...(draft.imageAssetId ? { imageAssetId: draft.imageAssetId } : {}),
    }
    try {
      if (editing) {
        applyUpdated(await adminApi.updateNews(editing.id, content, editing.version))
        setMessage({ tone: 'ok', text: 'Изменения сохранены: лента ERP уже показывает новую версию.' })
      } else {
        applyCreated(
          await adminApi.createNews({
            ...content,
            sendEmail: sendEmail && channels.email,
            sendTelegram: sendTelegram && channels.telegram,
          }),
        )
        setMessage({ tone: 'ok', text: 'Новость опубликована: она уже в ленте ERP у всех организаций.' })
      }
      resetForm()
    } catch (cause) {
      setMessage({ tone: 'error', text: newsErrorMessage(cause, editing ? 'Не удалось сохранить изменения.' : 'Не удалось опубликовать новость.') })
    } finally {
      setSaving(false)
    }
  }

  function startEdit(item: NewsArticle) {
    setDraft({
      title: item.title,
      body: item.body,
      category: item.category,
      linkUrl: item.linkUrl ?? '',
      linkLabel: item.linkLabel ?? '',
      pinned: item.pinned,
      imageAssetId: item.imageAssetId,
      imagePreview: item.imageUrl,
    })
    setEditing({ id: item.id, version: item.version })
    setMessage(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await adminApi.deleteNews(pendingDelete.id)
      applyDeleted(pendingDelete.id)
      if (editing?.id === pendingDelete.id) resetForm()
      setPendingDelete(null)
    } catch (cause) {
      setDeleteError(newsErrorMessage(cause, 'Не удалось удалить новость.'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className="page">
      <div className="page-header">
        <h1>Новости платформы</h1>
        <p className="page-caption">
          Публикация сразу появляется в ленте ERP у сотрудников всех организаций. Новости своей компании руководители
          публикуют в ERP сами.
        </p>
      </div>

      <form className="news-form" onSubmit={(event) => void submit(event)}>
        <h2>{editing ? 'Правка новости' : 'Новая новость'}</h2>
        <div className="filter-field">
          <label htmlFor="news-title">Заголовок</label>
          <input id="news-title" value={draft.title} onChange={(e) => patch({ title: e.target.value })} maxLength={200} required />
        </div>
        <div className="filter-field">
          <label htmlFor="news-body">Текст</label>
          <textarea id="news-body" value={draft.body} onChange={(e) => patch({ body: e.target.value })} maxLength={10000} rows={6} required />
        </div>
        <div className="news-form__image">
          {draft.imagePreview ? <img src={draft.imagePreview} alt="" className="news-image-preview" /> : null}
          <div className="row-actions">
            <button type="button" className="secondary" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? 'Загружаем картинку…' : draft.imagePreview ? 'Заменить картинку' : 'Добавить картинку'}
            </button>
            {draft.imagePreview ? (
              <button type="button" className="secondary" onClick={() => patch({ imageAssetId: null, imagePreview: null })}>
                Убрать картинку
              </button>
            ) : null}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_TYPES.join(',')}
            aria-label="Картинка к новости"
            onChange={(event) => void pickImage(event)}
            hidden
          />
        </div>
        <div className="news-form__row">
          <div className="filter-field">
            <label htmlFor="news-category">Категория</label>
            <select id="news-category" value={draft.category} onChange={(e) => patch({ category: e.target.value as NewsCategory })}>
              {CATEGORIES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="news-link">Ссылка (необязательно)</label>
            <input id="news-link" value={draft.linkUrl} onChange={(e) => patch({ linkUrl: e.target.value })} placeholder="https://baza.sale/…" maxLength={2000} />
          </div>
          <div className="filter-field">
            <label htmlFor="news-link-label">Подпись ссылки</label>
            <input
              id="news-link-label"
              value={draft.linkLabel}
              onChange={(e) => patch({ linkLabel: e.target.value })}
              placeholder="Подробнее"
              maxLength={80}
            />
          </div>
          <label className="checkbox-field">
            <input type="checkbox" checked={draft.pinned} onChange={(e) => patch({ pinned: e.target.checked })} />
            Закрепить в ленте
          </label>
        </div>
        {!editing ? (
          <fieldset className="news-form__send">
            <legend>Рассылка сотрудникам всех организаций</legend>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={sendEmail && channels.email}
                disabled={!channels.email}
                onChange={(e) => setSendEmail(e.target.checked)}
              />
              На почту{channels.email ? '' : ' (не настроено на сервере)'}
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={sendTelegram && channels.telegram}
                disabled={!channels.telegram}
                onChange={(e) => setSendTelegram(e.target.checked)}
              />
              В Telegram{channels.telegram ? '' : ' (не настроено на сервере)'}
            </label>
          </fieldset>
        ) : null}
        <div className="news-form__actions">
          <button type="submit" disabled={saving || uploading}>
            {saving ? 'Сохраняем…' : editing ? 'Сохранить изменения' : 'Опубликовать'}
          </button>
          {editing ? (
            <button type="button" className="secondary" onClick={resetForm}>
              Отмена
            </button>
          ) : null}
          {message ? (
            <p role={message.tone === 'error' ? 'alert' : 'status'} className={message.tone === 'error' ? 'dialog-error' : 'news-form__ok'}>
              {message.text}
            </p>
          ) : null}
        </div>
      </form>

      {state.status === 'loading' ? <div className="state-panel">Загружаем новости…</div> : null}
      {state.status === 'error' ? (
        <div className="state-panel state-panel--error">
          <p>{state.message}</p>
          <button type="button" onClick={state.retry}>
            Повторить
          </button>
        </div>
      ) : null}
      {state.status === 'ready' && state.items.length === 0 ? (
        <div className="state-panel">Новостей платформы пока нет. Первая появится в ленте ERP сразу после публикации.</div>
      ) : null}

      {state.status === 'ready' && state.items.length > 0 ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Новость</th>
                <th>Категория</th>
                <th>Рассылка</th>
                <th>Опубликована</th>
                <th aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {state.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="news-cell">
                      {item.imageUrl ? <img src={item.imageUrl} alt="" className="news-thumb" /> : null}
                      <div>
                        {item.pinned ? <span className="status-pill status-pill--published">Закреплена</span> : null}
                        <p className="news-title">{item.title}</p>
                        <p className="news-body">{item.body}</p>
                        {item.linkUrl ? (
                          <a className="news-link" href={item.linkUrl} target="_blank" rel="noopener noreferrer">
                            {item.linkLabel ?? 'Подробнее'}
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td>{categoryLabel(item.category)}</td>
                  <td>
                    {deliverySummary(item.delivery).length > 0
                      ? deliverySummary(item.delivery).map((line) => <p key={line} className="news-delivery">{line}</p>)
                      : '—'}
                  </td>
                  <td>
                    {formatDateTime(item.publishedAt)}
                    {item.editedAt ? <p className="news-delivery">изменена {formatDateTime(item.editedAt)}</p> : null}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="secondary" onClick={() => startEdit(item)}>
                        Изменить
                      </button>
                      <button type="button" className="danger" onClick={() => setPendingDelete(item)}>
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="dialog-backdrop" role="presentation" onClick={() => !deleting && setPendingDelete(null)}>
          <div
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="news-delete-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="news-delete-title">Удалить новость?</h2>
            <p className="dialog-target">{pendingDelete.title}</p>
            <p className="dialog-warning">Новость пропадёт из ленты ERP у всех организаций. Удаление фиксируется в журнале аудита.</p>
            {deleteError ? <p className="dialog-error">{deleteError}</p> : null}
            <div className="dialog-actions">
              <button type="button" className="secondary" onClick={() => setPendingDelete(null)} disabled={deleting}>
                Отмена
              </button>
              <button type="button" className="danger" onClick={() => void confirmDelete()} disabled={deleting}>
                {deleting ? 'Удаляем…' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
