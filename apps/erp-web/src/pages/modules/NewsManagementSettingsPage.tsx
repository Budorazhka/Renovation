import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { ImagePlus, Newspaper, Pencil, Trash2, X } from 'lucide-react'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { useNewsFeed } from '@/context/NewsFeedContext'
import type { DeliveryCounts, NewsArticle, NewsCategory, NewsDeliveryStats } from '@/services/newsApiV2'
import { mediaApiV2 } from '@/services/mediaApiV2'
import { useI18n } from '@/i18n'

const PANEL = 'rounded-md bg-[var(--hub-card-bg)] p-5 shadow-[inset_0_0_0_1px_rgba(201,168,76,0.18)]'
const MUTED = 'text-[color:var(--app-text-muted)]'
const LABEL = `text-[16px] ${MUTED}`
const INPUT =
  'w-full rounded-sm bg-[var(--workspace-row-bg)] px-3 py-2 text-[16px] text-[color:var(--app-text)] shadow-[inset_0_-1px_0_var(--green-border)] outline-none focus:shadow-[inset_0_-1px_0_var(--gold)]'
const CATEGORIES: readonly NewsCategory[] = ['company', 'market', 'developer', 'regulation']
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const IMAGE_MAX_BYTES = 20 * 1024 * 1024

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
  category: 'company',
  linkUrl: '',
  linkLabel: '',
  pinned: false,
  imageAssetId: null,
  imagePreview: null,
}

function draftFrom(article: NewsArticle): Draft {
  return {
    title: article.title,
    body: article.body,
    category: article.category,
    linkUrl: article.linkUrl ?? '',
    linkLabel: article.linkLabel ?? '',
    pinned: article.pinned,
    imageAssetId: article.imageAssetId,
    imagePreview: article.imageUrl,
  }
}

function total(counts: DeliveryCounts): number {
  return counts.pending + counts.sent + counts.failed + counts.skipped
}

/**
 * Новости компании: руководитель публикует новость для всех сотрудников
 * своей организации (POST /news), по желанию рассылает её на почту и в
 * Telegram, правит и удаляет. Раньше новость сохранялась только в браузере
 * автора — сотрудники её не видели.
 */
export default function NewsManagementSettingsPage() {
  const { t, formatDate } = useI18n()
  const { organizationArticles, canPublish, channels, status, publish, update, remove } = useNewsFeed()
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [editing, setEditing] = useState<{ id: string; version: number } | null>(null)
  const [sendEmail, setSendEmail] = useState(false)
  const [sendTelegram, setSendTelegram] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const localPreview = useRef<string | null>(null)

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

  async function onPickImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!IMAGE_TYPES.includes(file.type) || file.size > IMAGE_MAX_BYTES) {
      setMessage({ tone: 'error', text: t('news.imageInvalid') })
      return
    }
    setUploading(true)
    setMessage(null)
    try {
      const { assetId } = await mediaApiV2.uploadFile(file, 'news_image')
      if (localPreview.current) URL.revokeObjectURL(localPreview.current)
      localPreview.current = URL.createObjectURL(file)
      patch({ imageAssetId: assetId, imagePreview: localPreview.current })
    } catch {
      setMessage({ tone: 'error', text: t('news.imageFailed') })
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft.title.trim() || !draft.body.trim() || uploading) return
    setSaving(true)
    setMessage(null)
    const content = {
      title: draft.title,
      body: draft.body,
      category: draft.category,
      pinned: draft.pinned,
      linkUrl: draft.linkUrl.trim() || undefined,
      linkLabel: draft.linkLabel,
      imageAssetId: draft.imageAssetId ?? undefined,
    }
    try {
      if (editing) {
        await update(editing.id, content, editing.version)
        setMessage({ tone: 'ok', text: t('news.updated') })
      } else {
        await publish({ ...content, sendEmail: sendEmail && channels.email, sendTelegram: sendTelegram && channels.telegram })
        setMessage({ tone: 'ok', text: t('news.published') })
      }
      resetForm()
    } catch (error) {
      const conflict = isAxiosError(error) && error.response?.status === 409
      setMessage({
        tone: 'error',
        text: conflict ? t('news.conflict') : editing ? t('news.updateFailed') : t('news.publishFailed'),
      })
    } finally {
      setSaving(false)
    }
  }

  function startEdit(article: NewsArticle) {
    setDraft(draftFrom(article))
    setEditing({ id: article.id, version: article.version })
    setMessage(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleRemove(id: string) {
    setMessage(null)
    try {
      await remove(id)
      if (editing?.id === id) resetForm()
    } catch {
      setMessage({ tone: 'error', text: t('news.deleteFailed') })
    }
  }

  function deliveryLines(stats: NewsDeliveryStats | null): string[] {
    if (!stats) return []
    const lines: string[] = []
    for (const [channel, counts] of [
      [t('news.deliveryEmail'), stats.email],
      [t('news.deliveryTelegram'), stats.telegram],
    ] as const) {
      const all = total(counts)
      if (all === 0) continue
      let line = t('news.deliveryLine', { channel, sent: counts.sent, total: all })
      if (counts.failed) line += t('news.deliveryFailed', { failed: counts.failed })
      if (counts.pending) line += t('news.deliveryPending', { pending: counts.pending })
      lines.push(line)
    }
    return lines
  }

  return (
    <DashboardShell>
      <div className="flex w-full max-w-[760px] flex-col gap-6 px-6 pb-12 pt-6 text-[color:var(--app-text)]">
        <header>
          <h1 className="text-[30px] font-normal leading-tight text-[color:var(--theme-accent-heading)]">{t('news.manageTitle')}</h1>
          <p className={`mt-1 max-w-[65ch] text-[17px] ${MUTED}`}>{t('news.manageHint')}</p>
          <Link
            to="/dashboard/settings/info/news"
            className="mt-3 inline-flex items-center gap-2 text-[16px] text-[color:var(--gold)] hover:underline"
          >
            <Newspaper className="size-4" aria-hidden />
            {t('news.openFeed')}
          </Link>
        </header>

        {message ? (
          <p role={message.tone === 'error' ? 'alert' : 'status'} className={`text-[17px] ${message.tone === 'error' ? 'text-[#ffb4ab]' : MUTED}`}>
            {message.text}
          </p>
        ) : null}

        {status === 'ready' && !canPublish ? <p className={`text-[17px] ${MUTED}`}>{t('news.noRights')}</p> : null}

        {canPublish ? (
          <form onSubmit={(e) => void handleSubmit(e)} className={`${PANEL} flex flex-col gap-4`}>
            <h2 className="text-[24px] font-medium">{editing ? t('news.editTitle') : t('news.newArticle')}</h2>

            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>{t('news.fieldTitle')}</span>
              <input
                value={draft.title}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder={t('news.fieldTitlePlaceholder')}
                maxLength={200}
                required
                className={INPUT}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>{t('news.fieldBody')}</span>
              <textarea
                value={draft.body}
                onChange={(e) => patch({ body: e.target.value })}
                placeholder={t('news.fieldBodyPlaceholder')}
                maxLength={10_000}
                required
                rows={6}
                className={`${INPUT} min-h-[140px] resize-y leading-relaxed`}
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>{t('news.fieldImage')}</span>
              {draft.imagePreview ? (
                <div className="relative w-full max-w-[420px] overflow-hidden rounded-md">
                  <img src={draft.imagePreview} alt="" className="block max-h-[220px] w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => patch({ imageAssetId: null, imagePreview: null })}
                    aria-label={t('news.imageRemove')}
                    title={t('news.imageRemove')}
                    className="absolute right-2 top-2 flex size-9 items-center justify-center rounded-sm bg-[var(--workspace-card-bg)] text-[color:var(--app-text)]"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
              ) : null}
              <div>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-2 rounded-sm bg-[var(--workspace-row-bg)] px-4 py-2 text-[16px] text-[color:var(--app-text)] disabled:opacity-72"
                >
                  <ImagePlus className="size-4 text-[color:var(--gold)]" aria-hidden />
                  {uploading ? t('news.imageUploading') : draft.imagePreview ? t('news.imageReplace') : t('news.imagePick')}
                </button>
                <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(',')} onChange={(e) => void onPickImage(e)} className="hidden" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>{t('news.fieldCategory')}</span>
                <select value={draft.category} onChange={(e) => patch({ category: e.target.value as NewsCategory })} className={INPUT}>
                  {CATEGORIES.map((key) => (
                    <option key={key} value={key}>
                      {t(`news.categories.${key}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 self-end pb-2 text-[16px]">
                <input type="checkbox" checked={draft.pinned} onChange={(e) => patch({ pinned: e.target.checked })} className="size-4 accent-[var(--gold)]" />
                {t('news.fieldPinned')}
              </label>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>{t('news.fieldLink')}</span>
              <input
                value={draft.linkUrl}
                onChange={(e) => patch({ linkUrl: e.target.value })}
                placeholder={t('news.fieldLinkPlaceholder')}
                maxLength={2000}
                className={INPUT}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>{t('news.fieldLinkLabel')}</span>
              <input
                value={draft.linkLabel}
                onChange={(e) => patch({ linkLabel: e.target.value })}
                placeholder={t('news.fieldLinkLabelPlaceholder')}
                maxLength={80}
                className={INPUT}
              />
              <span className={LABEL}>{t('news.fieldLinkLabelHint')}</span>
            </label>

            {!editing ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-[16px] font-medium">{t('news.sendTitle')}</legend>
                <label className={`flex items-center gap-2 text-[16px] ${channels.email ? '' : MUTED}`}>
                  <input
                    type="checkbox"
                    checked={sendEmail && channels.email}
                    disabled={!channels.email}
                    onChange={(e) => setSendEmail(e.target.checked)}
                    className="size-4 accent-[var(--gold)]"
                  />
                  {t('news.sendEmail')}
                  {!channels.email ? ` (${t('news.channelOff')})` : ''}
                </label>
                <label className={`flex items-center gap-2 text-[16px] ${channels.telegram ? '' : MUTED}`}>
                  <input
                    type="checkbox"
                    checked={sendTelegram && channels.telegram}
                    disabled={!channels.telegram}
                    onChange={(e) => setSendTelegram(e.target.checked)}
                    className="size-4 accent-[var(--gold)]"
                  />
                  {t('news.sendTelegram')}
                  {!channels.telegram ? ` (${t('news.channelOff')})` : ''}
                </label>
                <span className={`max-w-[65ch] ${LABEL}`}>{t('news.sendHint')}</span>
              </fieldset>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={saving || uploading}
                className="rounded-sm bg-[var(--gold)] px-5 py-2 text-[16px] font-medium text-[color:var(--gold-btn-text)] disabled:opacity-72"
              >
                {saving ? t('news.publishing') : editing ? t('news.saveChanges') : t('news.publish')}
              </button>
              {editing ? (
                <button type="button" onClick={resetForm} className={`rounded-sm px-4 py-2 text-[16px] ${MUTED} hover:text-[color:var(--app-text)]`}>
                  {t('news.cancelEdit')}
                </button>
              ) : null}
            </div>
          </form>
        ) : null}

        {canPublish ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-[24px] font-medium">{t('news.companyNews')}</h2>
            {organizationArticles.length === 0 ? <p className={`text-[17px] ${MUTED}`}>{t('news.noCompanyNews')}</p> : null}
            <ul className="flex flex-col gap-2">
              {organizationArticles.map((a) => (
                <li key={a.id} className={`${PANEL} flex items-start justify-between gap-3 py-4`}>
                  <div className="min-w-0">
                    <p className="text-[18px]">{a.title}</p>
                    <p className={`mt-1 line-clamp-2 text-[16px] ${MUTED}`}>{a.body}</p>
                    <p className={`mt-1 text-[16px] ${MUTED}`}>
                      {formatDate(a.publishedAt, { day: 'numeric', month: 'short', year: 'numeric' })}
                      {a.authorName ? ` · ${a.authorName}` : ''}
                      {a.pinned ? ` · ${t('news.pinned')}` : ''}
                      {a.editedAt ? ` · ${t('news.edited')}` : ''}
                    </p>
                    {deliveryLines(a.delivery).map((line) => (
                      <p key={line} className="mt-1 text-[16px] text-[color:var(--gold)]">
                        {line}
                      </p>
                    ))}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      title={t('news.edit')}
                      aria-label={t('news.edit')}
                      onClick={() => startEdit(a)}
                      className="flex size-10 items-center justify-center rounded-sm bg-[var(--workspace-row-bg)] text-[color:var(--gold)]"
                    >
                      <Pencil className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      title={t('news.delete')}
                      aria-label={t('news.delete')}
                      onClick={() => void handleRemove(a.id)}
                      className="flex size-10 items-center justify-center rounded-sm bg-[rgba(248,113,113,0.1)] text-[#ffb4ab] hover:bg-[rgba(248,113,113,0.2)]"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </DashboardShell>
  )
}
